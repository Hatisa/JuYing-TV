import type { AiFreeModelInfo, AiFreeStatus, FreeAiState, FreeModelChannel, HealthState } from '../types';
import { normalizeChatEndpoint } from './ai';

/** 免费模型池：Kilo 公共网关 + Pollinations 匿名通道 + 用户自定义免费通道 */
export const KILO_DEFAULT_BASE = 'https://ai-gateway.kilo.ai/api/v1';
export const POLLINATIONS_DEFAULT_ENDPOINT = 'https://text.pollinations.ai/openai';
/** 免费通道每日签到巡检间隔 */
export const FREE_CHECKIN_TICK_MS = 30 * 60_000;
/** 首次启动延迟，避免和首页加载抢带宽 */
export const FREE_CHECKIN_BOOT_MS = 15_000;
/** 全天无可用模型时，自动重试签到前的等待时间 */
export const FREE_CHECKIN_RETRY_MS = 60 * 60_000;
/** 免费模型健康检测超时 */
export const FREE_TEST_TIMEOUT_MS = 20_000;
/** 免费模型聊天超时 */
export const FREE_CHAT_TIMEOUT_MS = 45_000;
/** 单次对话最多尝试的模型数 */
export const FREE_MAX_ATTEMPTS = 3;

export interface FreeModelSeed {
  provider: AiFreeModelInfo['provider'];
  providerName: string;
  model: string;
  endpoint: string;
  channelId?: string;
}

/** 稳定 id：同一通道的模型重名时也不会互相覆盖 */
export function freeModelId(seed: Pick<FreeModelSeed, 'provider' | 'model' | 'channelId'>): string {
  return seed.provider + '/' + (seed.channelId ? seed.channelId + '/' : '') + seed.model;
}

/** 默认候选：Kilo 的路由模型、Pollinations 匿名模型，以及用户启用的自定义通道 */
export function defaultFreeModelSeeds(
  kiloBase: string,
  pollinationsEndpoint: string,
  channels: FreeModelChannel[] = []
): FreeModelSeed[] {
  const base = String(kiloBase || KILO_DEFAULT_BASE).replace(/\/+$/, '');
  const seeds: FreeModelSeed[] = [
    { provider: 'kilo', providerName: 'Kilo 公共网关', model: 'kilo-auto/free', endpoint: base + '/chat/completions' },
    { provider: 'kilo', providerName: 'Kilo 公共网关', model: 'reflection/beam-free', endpoint: base + '/chat/completions' },
    {
      provider: 'pollinations',
      providerName: 'Pollinations 匿名',
      model: 'openai-fast',
      endpoint: pollinationsEndpoint || POLLINATIONS_DEFAULT_ENDPOINT,
    },
  ];
  for (const channel of Array.isArray(channels) ? channels : []) {
    if (!channel || channel.enabled === false || !channel.baseUrl || !channel.model) continue;
    try {
      seeds.push({
        provider: 'custom',
        providerName: String(channel.name || '自定义免费通道').trim() || '自定义免费通道',
        channelId: channel.id,
        model: String(channel.model).trim(),
        endpoint: normalizeChatEndpoint(channel.baseUrl),
      });
    } catch {
      // 地址还没填完整时跳过，不影响内置通道
    }
  }
  return seeds;
}

/** UTC+8 日期（免费额度按北京时间的自然日刷新） */
export function utc8Date(now = Date.now()): string {
  const ts = Number.isFinite(now) ? now : Date.now();
  return new Date(ts + 8 * 3600_000).toISOString().slice(0, 10);
}

/** 是否需要自动签到（每天最多一次） */
export function shouldAutoCheckin(enabled: boolean, lastDate: string | undefined, now = Date.now()): boolean {
  return enabled && lastDate !== utc8Date(now);
}

export function cooldownActive(model: Pick<AiFreeModelInfo, 'cooldownUntil'>, now = Date.now()): boolean {
  return !!model.cooldownUntil && model.cooldownUntil > now;
}

/** 从 /models 返回值中筛出可聊天的免费模型 id */
export function parseKiloFreeModels(payload: unknown): string[] {
  const raw = payload as any;
  const list = Array.isArray(raw?.data) ? raw.data : Array.isArray(raw) ? raw : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list) {
    const id = typeof item === 'string' ? item : typeof item?.id === 'string' ? item.id.trim() : '';
    if (!id || seen.has(id)) continue;
    const free = id === 'kilo-auto/free' || /:free$/i.test(id) || /\/free$/i.test(id);
    if (!free) continue;
    const outputs = item?.architecture?.output_modalities;
    if (Array.isArray(outputs) && outputs.length > 0 && !outputs.includes('text')) continue;
    if (/embed|image|video|audio|rerank|whisper|tts/i.test(id) && !/vision|vl/i.test(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= 10) break;
  }
  return out;
}


/** 单模型评分：在线优先，其次未知/较慢，冷却与连续失败降权 */
export function freeModelScore(model: Pick<AiFreeModelInfo, 'state' | 'ms' | 'failStreak' | 'successCount' | 'failCount' | 'cooldownUntil'>, now = Date.now()): number {
  if (cooldownActive(model, now)) return -10_000;
  const base: Record<HealthState, number> = { online: 100, slow: 62, unknown: 48, checking: 35, offline: 8 };
  const total = model.successCount + model.failCount;
  const rate = total > 0 ? model.successCount / total : 0.6;
  const latency = model.ms > 0 ? Math.max(0, 24 - Math.min(24, model.ms / 1000)) : 8;
  return base[model.state] + rate * 24 + latency - Math.min(30, model.failStreak * 6);
}

/** 自动选路排序（稳定排序，不修改入参） */
export function rankFreeModels<T extends Pick<AiFreeModelInfo, 'state' | 'ms' | 'failStreak' | 'successCount' | 'failCount' | 'cooldownUntil'>>(
  models: T[],
  now = Date.now()
): T[] {
  return models
    .map((model, index) => ({ model, index, score: freeModelScore(model, now) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((item) => item.model);
}

/** 可用（在线或较慢，且不在冷却）的模型数量 */
export function availableFreeModels(models: Pick<AiFreeModelInfo, 'state' | 'cooldownUntil'>[], now = Date.now()): number {
  return models.filter((m) => (m.state === 'online' || m.state === 'slow') && !cooldownActive(m, now)).length;
}

export function freeModelStateLabel(state: HealthState): string {
  switch (state) {
    case 'online':
      return '在线';
    case 'slow':
      return '较慢';
    case 'offline':
      return '离线';
    case 'checking':
      return '检测中';
    default:
      return '未检测';
  }
}

/** 兼容 OpenAI 响应里的 content 数组、旧式 text 与 reasoning 兜底 */
export function freeContentOf(data: any): string {
  const message = data?.choices?.[0]?.message;
  const content = message?.content;
  if (typeof content === 'string' && content.trim()) return content;
  if (Array.isArray(content)) {
    const joined = content
      .map((part: any) => {
        if (typeof part === 'string') return part;
        if (typeof part?.text === 'string') return part.text;
        return '';
      })
      .join('');
    if (joined.trim()) return joined;
  }
  if (typeof data?.choices?.[0]?.text === 'string' && data.choices[0].text.trim()) return data.choices[0].text;
  if (typeof message?.reasoning === 'string' && message.reasoning.trim()) return message.reasoning;
  if (typeof data?.reasoning === 'string' && data.reasoning.trim()) return data.reasoning;
  return '';
}

/** 空状态（首次启动 / 浏览器兜底） */
export function emptyFreeAiState(): FreeAiState {
  return { models: [], lastCheckinDate: '', lastCheckinAt: 0, lastResult: '', updatedAt: 0 };
}

export function makeFreeStatus(
  state: FreeAiState,
  options: { enabled: boolean; autoCheckin: boolean; checking: boolean; now?: number }
): AiFreeStatus {
  return {
    ...state,
    enabled: options.enabled,
    autoCheckin: options.autoCheckin,
    today: utc8Date(options.now),
    checking: options.checking,
    available: availableFreeModels(state.models, options.now),
  };
}