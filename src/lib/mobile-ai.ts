import type {
  AiChatMessage,
  AiChatRequest,
  AiChatResult,
  AiConfig,
  AiFreeModelInfo,
  AiFreeStatus,
  AiTestResult,
  FreeAiState,
  FreeModelChannel,
  NetJsonResult,
  NetTextResult,
  NetRequest,
} from '../types';
import { aiMode, isAiConfigured, normalizeAiConfig, normalizeChatEndpoint, normalizeFreeChannels, normalizeAiSettings } from './ai';
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
  cooldownActive,
  defaultFreeModelSeeds,
  emptyFreeAiState,
  freeContentOf,
  freeModelId,
  makeFreeStatus,
  parseKiloFreeModels,
  rankFreeModels,
  shouldAutoCheckin,
  utc8Date,
} from './free-models';

/**
 * Android 端 AI 实现：与桌面共用同一套免费池策略，但走本地 HTTP 服务，
 * 避免同步 JSBridge 长时间阻塞 WebView 线程。
 */

const KILO_BASE = KILO_DEFAULT_BASE.replace(/\/+$/, '');
const POLLINATIONS_ENDPOINT = POLLINATIONS_DEFAULT_ENDPOINT;
const MAX_MESSAGES = 20;
const MAX_CONTENT = 8000;

const COOLDOWN_RATE_LIMIT = 15 * 60_000;
const COOLDOWN_AUTH = 60 * 60_000;
const COOLDOWN_SERVER = 3 * 60_000;
const COOLDOWN_BAD_MODEL = 30 * 60_000;

export interface MobileAiDeps {
  /** 读取当前设置里的 AI 配置（每次都重新读，保证设置页修改立即生效） */
  readAi(): Promise<AiConfig>;
  /** 读取持久化的免费池状态 */
  readFreeAi(): Promise<FreeAiState | undefined>;
  /** 写入免费池状态 */
  writeFreeAi(state: FreeAiState): Promise<boolean> | boolean;
  json(req: NetRequest): Promise<NetJsonResult>;
  text(req: NetRequest): Promise<NetTextResult>;
}

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
  if (status === 429) return '接口限流（HTTP 429）' + (detail ? '：' + detail : '');
  if (status === 401 || status === 403) return '密钥无效或无权限（HTTP ' + status + '）' + (detail ? '：' + detail : '');
  if (status >= 500) return '上游暂时不可用（HTTP ' + status + '）' + (detail ? '：' + detail : '');
  return '接口返回 HTTP ' + status + (detail ? '：' + detail : '');
}

function cooldownFor(status: number): number {
  if (status === 429) return COOLDOWN_RATE_LIMIT;
  if (status === 401 || status === 403) return COOLDOWN_AUTH;
  if (status >= 500) return COOLDOWN_SERVER;
  return COOLDOWN_BAD_MODEL;
}

function cleanMessages(messages: AiChatMessage[]): AiChatMessage[] {
  return (Array.isArray(messages) ? messages : [])
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

export class MobileAiService {
  private deps: MobileAiDeps;
  private state: FreeAiState = emptyFreeAiState();
  private channels: FreeModelChannel[] = [];
  private autoCheckin = true;
  private loaded = false;
  private loadPromise: Promise<void> | null = null;
  private checking: Promise<AiFreeStatus> | null = null;
  private listeners = new Set<(status: AiFreeStatus) => void>();
  private bootTimer: ReturnType<typeof setTimeout> | null = null;
  private tickTimer: ReturnType<typeof setInterval> | null = null;

  constructor(deps: MobileAiDeps) {
    this.deps = deps;
  }

  /** 首次加载持久化状态；设置里的通道以最新配置为准 */
  private ensureLoaded(): Promise<void> {
    if (this.loaded) return Promise.resolve();
    if (this.loadPromise) return this.loadPromise;
    this.loadPromise = (async () => {
      const [config, saved] = await Promise.all([this.deps.readAi(), this.deps.readFreeAi()]);
      this.channels = normalizeFreeChannels(config?.freeChannels);
      this.autoCheckin = config?.autoCheckin !== false;
      this.state = this.restore(saved);
      await this.syncCustomModels();
      this.loaded = true;
    })().finally(() => {
      this.loadPromise = null;
    });
    return this.loadPromise;
  }

  private restore(saved?: FreeAiState): FreeAiState {
    const prev = Array.isArray(saved?.models) ? saved.models : [];
    const seeds = defaultFreeModelSeeds(KILO_BASE, POLLINATIONS_ENDPOINT, this.channels);
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
  private async syncCustomModels(): Promise<void> {
    const seeds = defaultFreeModelSeeds(KILO_BASE, POLLINATIONS_ENDPOINT, this.channels).filter((s) => s.provider === 'custom');
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

  private async refreshSettings(): Promise<AiConfig> {
    const config = normalizeAiSettings(await this.deps.readAi());
    this.channels = normalizeFreeChannels(config.freeChannels);
    this.autoCheckin = config.autoCheckin !== false;
    return config;
  }

  status(): Promise<AiFreeStatus> {
    return this.ensureLoaded().then(() =>
      makeFreeStatus(this.state, {
        enabled: true,
        autoCheckin: this.autoCheckin,
        checking: !!this.checking,
      })
    );
  }

  onChange(cb: (status: AiFreeStatus) => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  private emit(): void {
    if (this.listeners.size === 0) return;
    const payload = makeFreeStatus(this.state, {
      enabled: true,
      autoCheckin: this.autoCheckin,
      checking: !!this.checking,
    });
    for (const cb of this.listeners) {
      try {
        cb(payload);
      } catch {
        /* 单个订阅出错不影响其他订阅 */
      }
    }
  }

  private persist(): void {
    try {
      void this.deps.writeFreeAi(this.state);
    } catch {
      /* 本地存储失败不阻塞对话 */
    }
  }

  /** App 启动后延迟自动签到，避免和首页加载抢带宽 */
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
    try {
      await this.ensureLoaded();
      if (!this.autoCheckin) return;
      const today = utc8Date();
      const dueDaily = shouldAutoCheckin(true, this.state.lastCheckinDate);
      const retryUnavailable =
        this.state.lastCheckinDate === today &&
        availableFreeModels(this.state.models) === 0 &&
        Date.now() - this.state.updatedAt >= FREE_CHECKIN_RETRY_MS;
      if (!dueDaily && !retryUnavailable) return;
      await this.checkin();
    } catch {
      /* 自动签到失败不打扰用户 */
    }
  }

  checkin(): Promise<AiFreeStatus> {
    return this.run('checkin');
  }

  /** 免费池一键健康检测 */
  testModels(): Promise<AiFreeStatus> {
    return this.run('test');
  }

  async sync(): Promise<AiFreeStatus> {
    await this.ensureLoaded();
    await this.refreshSettings();
    await this.syncCustomModels();
    this.persist();
    this.emit();
    return this.status();
  }

  private run(kind: 'checkin' | 'test'): Promise<AiFreeStatus> {
    if (this.checking) return this.checking;
    this.checking = this.runChecks(kind).finally(() => {
      this.checking = null;
    }) as Promise<AiFreeStatus>;
    return this.checking;
  }

  private async runChecks(kind: 'checkin' | 'test'): Promise<AiFreeStatus> {
    await this.ensureLoaded();
    await this.refreshSettings();
    await this.syncCustomModels();
    this.state.models = this.state.models.map((m) => ({ ...m, state: 'checking' as const }));
    this.emit();
    await this.discoverKiloModels();
    await this.syncCustomModels();

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
      const res = await this.deps.json({ url: KILO_BASE + '/models', timeoutMs: 15000 });
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
    const channel = this.channels.find((item) => item.id === model.channelId);
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
    const res = await this.deps.text({
      url: model.endpoint,
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
      const error = res.status === 0 ? '无法连接：' + (res.error || '网络请求失败') : statusError(res.status || 0, res.text || '');
      return {
        ...model,
        state: 'offline',
        ok: false,
        ms: res.ms || 0,
        error,
        checkedAt: Date.now(),
        failStreak: model.failStreak + 1,
      };
    }
    let data: any = null;
    try {
      data = JSON.parse(res.text || '');
    } catch {
      return {
        ...model,
        state: 'offline',
        ok: false,
        ms: res.ms || 0,
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
        ms: res.ms || 0,
        error: short(String(data.error?.message || data.error?.code || '模型返回错误')),
        checkedAt: Date.now(),
        failStreak: model.failStreak + 1,
      };
    }
    return {
      ...model,
      state: (res.ms || 0) > 8000 ? 'slow' : 'online',
      ok: true,
      ms: res.ms || 0,
      error: undefined,
      checkedAt: Date.now(),
      failStreak: 0,
      cooldownUntil: undefined,
    };
  }

  private async customChat(messages: AiChatMessage[], config: Partial<AiConfig> | null | undefined): Promise<AiChatResult> {
    let normalized: AiConfig;
    try {
      normalized = normalizeAiConfig(config);
    } catch (err: any) {
      return { ok: false, error: err?.message || 'AI 配置不完整' };
    }
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
    if (normalized.apiKey) headers.Authorization = 'Bearer ' + normalized.apiKey;
    const res = await this.deps.text({
      url: normalizeChatEndpoint(normalized.baseUrl),
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: normalized.model,
        messages,
        temperature: 0.1,
        max_tokens: 2000,
        stream: false,
      }),
      timeoutMs: 60000,
    });
    if (!res.ok) {
      if (res.status === 0) {
        return { ok: false, error: '无法连接模型供应商：' + (res.error || '网络请求失败') };
      }
      return { ok: false, error: statusError(res.status || 0, res.text || ''), model: normalized.model };
    }
    let data: any;
    try {
      data = JSON.parse(res.text || '');
    } catch {
      return { ok: false, error: '模型接口返回的不是 JSON，请确认地址是 OpenAI 兼容接口', model: normalized.model };
    }
    if (data?.error) {
      const detail = data.error?.message || data.error?.code;
      return {
        ok: false,
        error: detail ? short(String(detail)) : '模型供应商返回错误',
        model: normalized.model,
      };
    }
    const content = freeContentOf(data);
    if (!content.trim()) {
      return { ok: false, error: '模型返回了空内容，请稍后重试或更换模型', model: normalized.model };
    }
    return {
      ok: true,
      content: content.slice(0, 20000),
      model: typeof data?.model === 'string' ? data.model : normalized.model,
    };
  }

  private async freeChat(messages: AiChatMessage[]): Promise<AiChatResult> {
    const now = Date.now();
    const candidates = rankFreeModels(this.state.models, now)
      .filter((m) => !cooldownActive(m, now))
      .slice(0, FREE_MAX_ATTEMPTS);
    if (candidates.length === 0) {
      return { ok: false, error: '免费模型都在冷却中，请稍后再试，或在设置中切换为自定义 API', auto: true };
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
      const res = await this.deps.text({
        url: model.endpoint,
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: model.model,
          messages,
          temperature: 0.1,
          max_tokens: 2200,
          stream: false,
        }),
        timeoutMs: FREE_CHAT_TIMEOUT_MS,
      });
      if (!res.ok) {
        const error = res.status === 0 ? '无法连接：' + (res.error || '网络请求失败') : statusError(res.status || 0, res.text || '');
        errors.push(model.model + '：' + error);
        this.recordFailure(model.id, error, res.status ? Date.now() + cooldownFor(res.status) : undefined);
        continue;
      }
      let data: any = null;
      try {
        data = JSON.parse(res.text || '');
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
      this.recordSuccess(model.id, res.ms || 0);
      return {
        ok: true,
        content: content.slice(0, 20000),
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

  async chat(req: AiChatRequest): Promise<AiChatResult> {
    await this.ensureLoaded();
    const config = await this.refreshSettings();
    const messages = cleanMessages(req?.messages || []);
    if (messages.length === 0) return { ok: false, error: '请输入你想找的影片描述' };
    if (aiMode(config) === 'auto') return this.freeChat(messages);
    if (!isAiConfigured(config)) return { ok: false, error: '请先在设置中填写 API 地址与模型名称' };
    return this.customChat(messages, config);
  }

  /** 测试自定义供应商地址与密钥 */
  async testConnection(config?: AiConfig): Promise<AiTestResult> {
    const target = config || (await this.refreshSettings());
    const result = await this.customChat(
      [
        { role: 'system', content: '你是连接测试助手，只回复 OK。' },
        { role: 'user', content: '只回复 OK' },
      ],
      { ...target, mode: 'custom' }
    );
    return { ok: result.ok, error: result.error, model: result.model, ms: result.ms };
  }
}
