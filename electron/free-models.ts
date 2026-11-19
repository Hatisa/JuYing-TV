import { BrowserWindow } from 'electron';
import type { AiChatMessage, AiChatResult, AiFreeModelInfo, AiFreeStatus, FreeAiState, FreeModelChannel } from '../src/types';
import {
  FREE_CHAT_TIMEOUT_MS,
  FREE_CHECKIN_BOOT_MS,
  FREE_CHECKIN_RETRY_MS,
  FREE_CHECKIN_TICK_MS,
  FREE_MAX_ATTEMPTS,
  FREE_TEST_TIMEOUT_MS,
  KILO_DEFAULT_BASE,
  POLLINATIONS_DEFAULT_ENDPOINT,
  availableFreeModels,
  defaultFreeModelSeeds,
  freeContentOf,
  freeModelId,
  makeFreeStatus,
  parseKiloFreeModels,
  rankFreeModels,
  shouldAutoCheckin,
  utc8Date,
} from '../src/lib/free-models';
import { normalizeFreeChannels } from '../src/lib/ai';
import { fetchJson, fetchText } from './net';
import type { Store } from './store';

const KILO_BASE = (process.env.JUYING_KILO_BASE || KILO_DEFAULT_BASE).replace(/\/+$/, '');
const POLLINATIONS_ENDPOINT = process.env.JUYING_POLLINATIONS_ENDPOINT || POLLINATIONS_DEFAULT_ENDPOINT;
const MAX_MESSAGES = 20;
const MAX_CONTENT = 8000;

/** 429 冷却 15 分钟，鉴权失败冷却 1 小时，上游 5xx 冷却 3 分钟 */
const COOLDOWN_RATE_LIMIT = 15 * 60_000;
const COOLDOWN_AUTH = 60 * 60_000;
const COOLDOWN_SERVER = 3 * 60_000;
const COOLDOWN_BAD_MODEL = 30 * 60_000;

function short(text: string, limit = 200): string {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function errorDetail(text: string): string {
  try {
    const data = JSON.parse(text);
    const message = data?.error?.message || data?.message || data?.error?.code;
    if (typeof message === 'string' && message.trim()) return short(message);
  } catch {
    /* 非 JSON */
  }
  return short(text, 160);
}

function statusError(status: number, text: string): string {
  const detail = errorDetail(text);
  if (status === 429) return '免费通道限流（HTTP 429）' + (detail ? '：' + detail : '');
  if (status === 401 || status === 403) return '免费通道拒绝访问（HTTP ' + status + '）' + (detail ? '：' + detail : '');
  if (status >= 500) return '上游暂时不可用（HTTP ' + status + '）' + (detail ? '：' + detail : '');
  return '接口返回 HTTP ' + status + (detail ? '：' + detail : '');
}

function cooldownFor(status: number): number {
  if (status === 429) return COOLDOWN_RATE_LIMIT;
  if (status === 401 || status === 403) return COOLDOWN_AUTH;
  if (status >= 500) return COOLDOWN_SERVER;
  return COOLDOWN_BAD_MODEL;
}

function makeModel(
  seed: { provider: AiFreeModelInfo['provider']; providerName: string; model: string; endpoint: string; channelId?: string },
  prev?: AiFreeModelInfo
): AiFreeModelInfo {
  const id = freeModelId(seed);
  return {
    id,
    provider: seed.provider,
    providerName: seed.providerName,
    channelId: seed.channelId,
    model: seed.model,
    endpoint: seed.endpoint,
    state: prev?.state || 'unknown',
    ok: prev?.ok || false,
    ms: prev?.ms || 0,
    error: prev?.error,
    checkedAt: prev?.checkedAt || 0,
    failStreak: prev?.failStreak || 0,
    cooldownUntil: prev?.cooldownUntil,
    successCount: prev?.successCount || 0,
    failCount: prev?.failCount || 0,
    lastUsedAt: prev?.lastUsedAt,
  };
}

function cleanMessages(messages: AiChatMessage[]): AiChatMessage[] {
  return messages
    .filter((m) => m && (m.role === 'system' || m.role === 'user' || m.role === 'assistant'))
    .filter((m) => typeof m.content === 'string' && m.content.trim())
    .slice(-MAX_MESSAGES)
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_CONTENT) }));
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, limit), items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      out[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * 免费模型池：不需要登录账号，自动选路 + 每日签到 + 健康检测。
 * 内置 Kilo 公共网关与 Pollinations 匿名通道；用户可在设置里添加任意 OpenAI 兼容的免费通道。
 */
export class FreeModelService {
  private store: Store;
  private state: FreeAiState;
  private checking: Promise<AiFreeStatus> | null = null;
  private bootTimer: NodeJS.Timeout | null = null;
  private tickTimer: NodeJS.Timeout | null = null;

  constructor(store: Store) {
    this.store = store;
    this.state = this.restore();
  }

  private channels(): FreeModelChannel[] {
    return normalizeFreeChannels(this.store.read().settings?.ai?.freeChannels);
  }

  private restore(): FreeAiState {
    const saved = this.store.read().freeAi;
    const prev = Array.isArray(saved?.models) ? saved.models : [];
    const seeds = defaultFreeModelSeeds(KILO_BASE, POLLINATIONS_ENDPOINT, this.channels());
    const models = seeds.map((seed) => makeModel(seed, prev.find((item) => item.id === freeModelId(seed))));
    for (const item of prev) {
      if (!item || typeof item.id !== 'string' || item.provider === 'custom' || models.some((m) => m.id === item.id)) continue;
      models.push({ ...item, state: item.state || 'unknown' });
    }
    return {
      models,
      lastCheckinDate: saved?.lastCheckinDate || '',
      lastCheckinAt: saved?.lastCheckinAt || 0,
      lastResult: saved?.lastResult || '',
      updatedAt: saved?.updatedAt || 0,
    };
  }

  /** 设置里的自定义通道变化后，实时增删模型；保留健康历史，地址变化时重置状态 */
  private syncCustomModels(): void {
    const seeds = defaultFreeModelSeeds(KILO_BASE, POLLINATIONS_ENDPOINT, this.channels()).filter((s) => s.provider === 'custom');
    const valid = new Set(seeds.map((s) => freeModelId(s)));
    const prev = new Map(this.state.models.filter((m) => m.provider === 'custom').map((m) => [m.id, m]));
    const models = seeds.map((seed) => {
      const id = freeModelId(seed);
      const old = prev.get(id);
      const model = makeModel(seed, old);
      if (old && old.endpoint !== seed.endpoint) {
        model.state = 'unknown';
        model.ok = false;
        model.ms = 0;
        model.error = undefined;
        model.failStreak = 0;
        model.cooldownUntil = undefined;
      }
      return model;
    });
    this.state.models = [...this.state.models.filter((m) => m.provider !== 'custom' || valid.has(m.id)), ...models];
  }

  private autoCheckinEnabled(): boolean {
    return this.store.read().settings.ai.autoCheckin !== false;
  }

  status(): AiFreeStatus {
    return makeFreeStatus(this.state, {
      enabled: true,
      autoCheckin: this.autoCheckinEnabled(),
      checking: !!this.checking,
    });
  }

  start(initialDelayMs = FREE_CHECKIN_BOOT_MS): void {
    this.stop();
    this.bootTimer = setTimeout(() => {
      this.bootTimer = null;
      void this.maybeDaily();
    }, Math.max(0, initialDelayMs));
    this.tickTimer = setInterval(() => void this.maybeDaily(), FREE_CHECKIN_TICK_MS);
  }

  stop(): void {
    if (this.bootTimer) clearTimeout(this.bootTimer);
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.bootTimer = null;
    this.tickTimer = null;
  }

  private async maybeDaily(): Promise<void> {
    const enabled = this.autoCheckinEnabled();
    const today = utc8Date();
    const dueDaily = shouldAutoCheckin(enabled, this.state.lastCheckinDate);
    // 当天签到过但一个模型都不可用（例如启动时断网）：每小时补试一次
    const retryUnavailable =
      enabled &&
      this.state.lastCheckinDate === today &&
      availableFreeModels(this.state.models) === 0 &&
      Date.now() - this.state.updatedAt >= FREE_CHECKIN_RETRY_MS;
    if (!dueDaily && !retryUnavailable) return;
    try {
      await this.checkin();
    } catch (err) {
      console.error('[free-ai] 自动签到失败', err);
    }
  }

  checkin(): Promise<AiFreeStatus> {
    return this.run('checkin');
  }

  test(): Promise<AiFreeStatus> {
    return this.run('test');
  }

  /** 设置里的自定义通道改动后立即重建模型池（不发起网络探测） */
  sync(): AiFreeStatus {
    this.syncCustomModels();
    this.persist();
    this.emit();
    return this.status();
  }

  /** 签到与一键检测共用：刷新模型池 + 并发探测；重复调用复用同一轮 */
  private run(kind: 'checkin' | 'test'): Promise<AiFreeStatus> {
    if (this.checking) return this.checking;
    this.checking = this.runChecks(kind).finally(() => {
      this.checking = null;
    }) as Promise<AiFreeStatus>;
    return this.checking;
  }

  private async runChecks(kind: 'checkin' | 'test'): Promise<AiFreeStatus> {
    this.syncCustomModels();
    this.state.models = this.state.models.map((m) => ({ ...m, state: 'checking' as const }));
    this.emit();
    await this.discoverKiloModels();
    this.syncCustomModels();

    const checked = await mapLimit(this.state.models, 3, (model) => this.probe(model));
    this.state.models = checked;
    const available = availableFreeModels(checked);
    const total = checked.length;
    const today = utc8Date();
    const customCount = checked.filter((m) => m.provider === 'custom').length;
    const customNote = customCount > 0 ? ' · 自定义通道 ' + customCount + ' 个' : '';
    this.state.lastResult =
      (kind === 'checkin'
        ? '免费通道 ' + available + '/' + total + ' 可用 · 已刷新每日额度'
        : '健康检测完成：' + available + '/' + total + ' 可用') + customNote;
    if (kind === 'checkin') {
      this.state.lastCheckinDate = today;
      this.state.lastCheckinAt = Date.now();
    }
    this.state.updatedAt = Date.now();
    this.persist();
    this.emit();
    return this.status();
  }

  private async discoverKiloModels(): Promise<void> {
    try {
      const res = await fetchJson(KILO_BASE + '/models', { timeoutMs: 15_000 });
      if (!res.ok) return;
      const ids = parseKiloFreeModels(res.data);
      for (const id of ids) {
        if (this.state.models.some((m) => m.provider === 'kilo' && m.model === id)) continue;
        this.state.models.push(
          makeModel({
            provider: 'kilo',
            providerName: 'Kilo 公共网关',
            model: id,
            endpoint: KILO_BASE + '/chat/completions',
          })
        );
      }
    } catch {
      /* 模型清单失败不影响已知候选 */
    }
  }

  private requestHeaders(model: AiFreeModelInfo): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
    if (model.provider !== 'custom') return headers;
    const channel = this.channels().find((item) => item.id === model.channelId);
    if (!channel) throw new Error('自定义通道已删除');
    if (channel.apiKey) headers.Authorization = 'Bearer ' + channel.apiKey;
    return headers;
  }

  private async probe(model: AiFreeModelInfo): Promise<AiFreeModelInfo> {
    let headers: Record<string, string> = {};
    try {
      headers = this.requestHeaders(model);
    } catch (err: any) {
      return {
        ...model,
        state: 'offline',
        ok: false,
        ms: 0,
        error: '自定义通道配置无效：' + short(err?.message || String(err)),
        checkedAt: Date.now(),
        failStreak: model.failStreak + 1,
      };
    }
    const res = await fetchText(model.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: model.model,
        messages: [
          { role: 'system', content: '你是连接测试助手，只回复 OK。' },
          { role: 'user', content: '只回复 OK' },
        ],
        temperature: 0,
        max_tokens: 16,
        stream: false,
      }),
      timeoutMs: FREE_TEST_TIMEOUT_MS,
    });
    if (!res.ok) {
      const error = res.status === 0 ? '无法连接：' + (res.error || '网络请求失败') : statusError(res.status, res.text);
      return {
        ...model,
        state: 'offline',
        ok: false,
        ms: res.ms,
        error,
        checkedAt: Date.now(),
        failStreak: model.failStreak + 1,
      };
    }
    let data: any = null;
    try {
      data = JSON.parse(res.text);
    } catch {
      return {
        ...model,
        state: 'offline',
        ok: false,
        ms: res.ms,
        error: '返回内容不是 JSON',
        checkedAt: Date.now(),
        failStreak: model.failStreak + 1,
      };
    }
    if (data?.error) {
      return {
        ...model,
        state: 'offline',
        ok: false,
        ms: res.ms,
        error: short(String(data.error?.message || data.error?.code || '模型返回错误')),
        checkedAt: Date.now(),
        failStreak: model.failStreak + 1,
      };
    }
    return {
      ...model,
      state: res.ms > 8000 ? 'slow' : 'online',
      ok: true,
      ms: res.ms,
      error: undefined,
      checkedAt: Date.now(),
      failStreak: 0,
      cooldownUntil: undefined,
    };
  }

  /** 自动选路：按健康度与历史成功率排序，429/5xx 自动切换下一个 */
  async chat(messages: AiChatMessage[]): Promise<AiChatResult> {
    const clean = cleanMessages(messages);
    if (clean.length === 0) return { ok: false, error: '请输入你想找的影片描述' };
    this.syncCustomModels();
    const now = Date.now();
    const candidates = rankFreeModels(this.state.models, now)
      .filter((m) => !m.cooldownUntil || m.cooldownUntil <= now)
      .slice(0, FREE_MAX_ATTEMPTS);
    if (candidates.length === 0) {
      return { ok: false, error: '免费模型都在冷却中，请稍后再试，或在设置中切换为自定义 API' };
    }

    const errors: string[] = [];
    for (let index = 0; index < candidates.length; index += 1) {
      const model = candidates[index];
      let headers: Record<string, string> = {};
      try {
        headers = this.requestHeaders(model);
      } catch (err: any) {
        const error = '自定义通道配置无效：' + short(err?.message || String(err));
        errors.push(model.model + '：' + error);
        this.recordFailure(model.id, error);
        continue;
      }
      const res = await fetchText(model.endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: model.model,
          messages: clean,
          temperature: 0.1,
          max_tokens: 2200,
          stream: false,
        }),
        timeoutMs: FREE_CHAT_TIMEOUT_MS,
      });

      if (!res.ok) {
        const error = res.status === 0 ? '无法连接：' + (res.error || '网络请求失败') : statusError(res.status, res.text);
        errors.push(model.model + '：' + error);
        this.recordFailure(model.id, error, res.status ? Date.now() + cooldownFor(res.status) : undefined);
        continue;
      }

      let data: any = null;
      try {
        data = JSON.parse(res.text);
      } catch {
        errors.push(model.model + '：返回内容不是 JSON');
        this.recordFailure(model.id, '返回内容不是 JSON');
        continue;
      }
      if (data?.error) {
        const error = short(String(data.error?.message || data.error?.code || '模型返回错误'));
        errors.push(model.model + '：' + error);
        this.recordFailure(model.id, error);
        continue;
      }

      const content = freeContentOf(data);
      if (!content.trim()) {
        errors.push(model.model + '：返回空内容');
        this.recordFailure(model.id, '返回空内容', Date.now() + COOLDOWN_SERVER);
        continue;
      }

      this.recordSuccess(model.id, res.ms);
      return {
        ok: true,
        content: content.slice(0, 20_000),
        ms: res.ms,
        model: typeof data?.model === 'string' ? data.model : model.model,
        provider: model.provider,
        auto: true,
        attempts: index + 1,
      };
    }

    this.persist();
    this.emit();
    const detail = errors.slice(0, 2).join('；');
    return {
      ok: false,
      error: '免费模型暂时不可用' + (detail ? '：' + detail : '') + '。可稍后重试，或在设置中切换为自定义 API。',
      auto: true,
      attempts: errors.length,
    };
  }

  private recordSuccess(id: string, ms: number): void {
    this.state.models = this.state.models.map((m) =>
      m.id === id
        ? {
            ...m,
            state: 'online',
            ok: true,
            ms,
            error: undefined,
            checkedAt: Date.now(),
            failStreak: 0,
            cooldownUntil: undefined,
            successCount: m.successCount + 1,
            lastUsedAt: Date.now(),
          }
        : m
    );
    this.state.updatedAt = Date.now();
    this.persist();
    this.emit();
  }

  private recordFailure(id: string, error: string, cooldownUntil?: number): void {
    this.state.models = this.state.models.map((m) =>
      m.id === id
        ? {
            ...m,
            state: 'offline',
            ok: false,
            error,
            checkedAt: Date.now(),
            failStreak: m.failStreak + 1,
            failCount: m.failCount + 1,
            cooldownUntil,
          }
        : m
    );
    this.state.updatedAt = Date.now();
    this.persist();
    this.emit();
  }

  private persist(): void {
    this.store.write('freeAi', this.state);
  }

  private emit(): void {
    const payload = this.status();
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('ai:free-update', payload);
    }
  }
}
