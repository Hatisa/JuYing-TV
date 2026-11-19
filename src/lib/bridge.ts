import type {
  AppBridge,
  AppData,
  AppInfo,
  DoubanHit,
  DoubanTopItem,
  HealthPayload,
  HealthStatus,
  NetJsonResult,
  NetRequest,
  NetTextResult,
  ProxyInfo,
  Settings,
  SourceTestResult,
} from '../types';
import { normalizeAiSettings } from './ai';
import { DEFAULT_WEB_SEARCH, normalizeWebSearchConfig } from './web-search';
import { searchWeb as runWebSearch, testWebSearch as runWebSearchTest, type WebSearchTransport } from './web-search-engine';
import { MobileAiService } from './mobile-ai';
import { DEFAULT_SOURCES } from './default-sources';
import { emptyFreeAiState, makeFreeStatus } from './free-models';
import { SLOW_MS } from './health';
import { getHealthSources } from './source-registry';

/** 联网搜索走本地服务时固定用桌面版 UA，避免 Bing / DuckDuckGo 返回移动版页面导致解析不到 */
const MOBILE_WEB_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/** 非桌面端没有免费模型池 */
function unavailableFreeAi() {
  return makeFreeStatus(emptyFreeAiState(), { enabled: false, autoCheckin: false, checking: false });
}

/** 浏览器环境下的兜底实现（仅在非 Electron / 非 Android 环境使用，便于开发调试） */
const FALLBACK_KEY = 'juying:fallback-data';

const FALLBACK_SETTINGS: Settings = {
  theme: 'dark',
  hideAdult: true,
  adult18: false,
  autoNext: true,
  autoPlay: true,
  rememberProgress: true,
  volume: 0.8,
  playbackRate: 1,
  homeSource: 'all',
  accent: 'rose',
  proxyEnabled: false,
  ai: {
    mode: 'auto',
    autoCheckin: true,
    baseUrl: '',
    apiKey: '',
    model: '',
    freeChannels: [],
  },
  webSearch: { ...DEFAULT_WEB_SEARCH },
};

function fallbackSources() {
  return DEFAULT_SOURCES.map((s) => ({ ...s }));
}

function loadFallback(): AppData {
  const empty: AppData = {
    settings: { ...FALLBACK_SETTINGS },
    sources: fallbackSources(),
    liveSources: [],
    favorites: [],
    history: [],
  };
  try {
    const raw = localStorage.getItem(FALLBACK_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<AppData>) : null;
    if (!parsed) return empty;
    return {
      ...empty,
      ...parsed,
      settings: {
        ...empty.settings,
        ...(parsed.settings || {}),
        ai: normalizeAiSettings({ ...empty.settings.ai, ...(parsed.settings?.ai || {}), mode: parsed.settings?.ai?.mode }),
        webSearch: normalizeWebSearchConfig({ ...empty.settings.webSearch, ...(parsed.settings?.webSearch || {}) }),
      },
      sources: Array.isArray(parsed.sources) && parsed.sources.length ? parsed.sources : empty.sources,
    };
  } catch {
    return empty;
  }
}

const fallback: AppBridge = {
  store: {
    read: async () => loadFallback(),
    write: async (key, value) => {
      const data = loadFallback();
      (data as any)[key] = value;
      localStorage.setItem(FALLBACK_KEY, JSON.stringify(data));
      return true;
    },
  },
  net: {
    json: async (req) => {
      try {
        const res = await fetch(req.url);
        return { ok: res.ok, status: res.status, data: await res.json() };
      } catch (err: any) {
        return { ok: false, error: err?.message || '网络错误（浏览器模式受跨域限制）' };
      }
    },
    text: async (req) => {
      try {
        const res = await fetch(req.url);
        return { ok: res.ok, status: res.status, text: await res.text() };
      } catch (err: any) {
        return { ok: false, error: err?.message || '网络错误（浏览器模式受跨域限制）' };
      }
    },
  },
  proxy: { info: async () => ({ base: '', token: '', enabled: false }) },
  source: { test: async () => ({ ok: false, ms: 0, error: '浏览器模式不支持探活' }) },
  health: {
    list: async () => ({}),
    check: async () => ({}),
    onChange: () => () => {},
  },
  douban: {
    ratings: async () => ({}),
    top: async () => [],
  },
  websearch: {
    query: async (query) => ({ ok: false, provider: 'duckduckgo', query, results: [], error: '联网搜索目前仅支持电脑端', ms: 0 }),
    test: async () => ({ ok: false, count: 0, error: '联网搜索目前仅支持电脑端', ms: 0 }),
  },
  ai: {
    chat: async () => ({ ok: false, error: 'AI 助手目前仅支持电脑端' }),
    test: async () => ({ ok: false, error: 'AI 助手目前仅支持电脑端' }),
    free: {
      status: async () => unavailableFreeAi(),
      checkin: async () => unavailableFreeAi(),
      test: async () => unavailableFreeAi(),
      sync: async () => unavailableFreeAi(),
      onChange: () => () => {},
    },
  },
  app: {
    info: async () => ({ version: 'web', electron: '-', chrome: '-', platform: 'web', userData: '-' }),
    openExternal: async (url: string) => {
      window.open(url, '_blank');
    },
    quit: async () => {},
  },
  window: {
    minimize: async () => {},
    toggleMaximize: async () => {},
    close: async () => {},
    onMaximizedChange: () => () => {},
  },
};

/** Android WebView 注入的原生接口（全部为同步方法，避免 JSBridge 的 Promise 兼容问题） */
interface NativeApi {
  proxyInfo(): string;
  storeRead(): string;
  storeWrite(key: string, value: string): boolean;
  netJson(url: string, timeoutMs: number, headersJson: string): string;
  netText(url: string, timeoutMs: number, headersJson: string): string;
  sourceTest(url: string): string;
  appInfo(): string;
  openExternal(url: string): void;
  quit(): void;
}

function nativeApi(): NativeApi | null {
  if (typeof window === 'undefined') return null;
  const native = (window as any).JuYingNative as NativeApi | undefined;
  return native && typeof native.storeRead === 'function' ? native : null;
}

function parseJson<T>(raw: string | null | undefined, fallbackValue: T): T {
  if (!raw || typeof raw !== 'string') return fallbackValue;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallbackValue;
  }
}

function mobileProxy(native: NativeApi): ProxyInfo {
  return parseJson<ProxyInfo>(native.proxyInfo(), { base: '', token: '', enabled: false });
}

/** 通过本地 HTTP 服务访问上游，避免同步 JSBridge 阻塞 WebView 主线程 */
function apiUrl(native: NativeApi, path: string, params: Record<string, string>): string {
  const proxy = mobileProxy(native);
  const base = (proxy.base || '').replace(/\/+$/, '');
  const query = new URLSearchParams({ t: proxy.token, ...params });
  return base + path + '?' + query.toString();
}

/**
 * 移动端请求统一走本地服务：GET 用查询串，POST 把 JSON 请求体原样交给本地服务转发。
 * 这样 WebView 不会遇到跨域，也不会被同步 JSBridge 卡住。
 */
function mobileRequestInit(req: NetRequest): RequestInit {
  const method = String(req.method || 'GET').toUpperCase() === 'POST' ? 'POST' : 'GET';
  if (method === 'GET') return { cache: 'no-store' };
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const contentType = req.headers?.['Content-Type'] || req.headers?.['content-type'];
  if (contentType) headers['Content-Type'] = contentType;
  return { cache: 'no-store', method: 'POST', headers, body: req.body || '' };
}

async function mobileNetJson(native: NativeApi, req: NetRequest): Promise<NetJsonResult> {
  const started = performance.now();
  try {
    const url = apiUrl(native, '/api/json', {
      u: req.url,
      timeout: String(req.timeoutMs ?? 15000),
      h: JSON.stringify(req.headers || {}),
    });
    const res = await fetch(url, mobileRequestInit(req));
    const parsed = (await res.json()) as NetJsonResult;
    if (!parsed || typeof parsed !== 'object') {
      return { ok: false, error: '本地代理返回格式错误', ms: Math.round(performance.now() - started) };
    }
    return parsed;
  } catch (err: any) {
    return { ok: false, error: err?.message || '网络请求失败', ms: Math.round(performance.now() - started) };
  }
}

async function mobileNetText(native: NativeApi, req: NetRequest): Promise<NetTextResult> {
  const started = performance.now();
  try {
    const url = apiUrl(native, '/api/text', {
      u: req.url,
      timeout: String(req.timeoutMs ?? 15000),
      h: JSON.stringify(req.headers || {}),
    });
    const res = await fetch(url, mobileRequestInit(req));
    const parsed = (await res.json()) as NetTextResult;
    if (!parsed || typeof parsed !== 'object') {
      return { ok: false, error: '本地代理返回格式错误', ms: Math.round(performance.now() - started) };
    }
    return parsed;
  } catch (err: any) {
    return { ok: false, error: err?.message || '网络请求失败', ms: Math.round(performance.now() - started) };
  }
}

async function mobileSourceTest(native: NativeApi, url: string): Promise<SourceTestResult> {
  const started = performance.now();
  try {
    const target = apiUrl(native, '/api/test', { u: url, timeout: '9000' });
    const res = await fetch(target, { cache: 'no-store' });
    const parsed = (await res.json()) as SourceTestResult;
    if (!parsed || typeof parsed !== 'object') {
      return { ok: false, ms: Math.round(performance.now() - started), error: '本地代理返回格式错误' };
    }
    return parsed;
  } catch (err: any) {
    return { ok: false, ms: Math.round(performance.now() - started), error: err?.message || '探活失败' };
  }
}

/* ---------- 移动端豆瓣（复用桌面端算法，通过原生网络绕开 CORS） ---------- */

const DOUBAN_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36',
  Referer: 'https://movie.douban.com/',
  Accept: 'application/json, text/plain, */*',
};

const DOUBAN_CACHE_KEY = 'juying:mobile-douban';
const RATING_TTL = 7 * 24 * 60 * 60 * 1000;
const TOP_TTL = 12 * 60 * 60 * 1000;

interface MobileDoubanCache {
  ratings: Record<string, { at: number; hit: DoubanHit | null }>;
  top?: { at: number; items: DoubanTopItem[] };
}

function loadDoubanCache(): MobileDoubanCache {
  try {
    const raw = localStorage.getItem(DOUBAN_CACHE_KEY);
    const parsed = raw ? parseJson<MobileDoubanCache>(raw, { ratings: {} }) : { ratings: {} };
    if (!parsed.ratings || typeof parsed.ratings !== 'object') parsed.ratings = {};
    return parsed;
  } catch {
    return { ratings: {} };
  }
}

function saveDoubanCache(cache: MobileDoubanCache): void {
  try {
    const entries = Object.entries(cache.ratings);
    if (entries.length > 500) {
      entries.sort((a, b) => b[1].at - a[1].at);
      cache.ratings = Object.fromEntries(entries.slice(0, 500));
    }
    localStorage.setItem(DOUBAN_CACHE_KEY, JSON.stringify(cache));
  } catch {
    /* 缓存失败不影响主流程 */
  }
}

function cleanTitle(input: string): string {
  return input
    .toLowerCase()
    .replace(/[\s\u3000·・:：\-—_.,，。!！?？'"“”‘’()（）\[\]【】《》<>/\\|+~]+/g, '');
}

function matchScore(query: string, target: string): number {
  const q = cleanTitle(query);
  const t = cleanTitle(target);
  if (!q || !t) return 0;
  if (q === t) return 100;
  if (t.startsWith(q) || q.startsWith(t)) return 78;
  if (t.includes(q) || q.includes(t)) return 58;
  return 0;
}

function toDoubanHit(target: any): DoubanHit | null {
  if (!target || !target.title) return null;
  const rating = Number(target.rating?.value);
  const hit: DoubanHit = { title: String(target.title), id: String(target.id || '') };
  if (Number.isFinite(rating) && rating > 0) hit.rating = Math.round(rating * 10) / 10;
  if (target.type) hit.type = String(target.type);
  const card = typeof target.card_subtitle === 'string' ? target.card_subtitle : '';
  if (card) {
    hit.card = card;
    const m = card.match(/^(\d{4})/);
    if (m) hit.year = m[1];
  }
  if (target.cover_url) hit.cover = String(target.cover_url).replace(/^http:/, 'https:');
  return hit;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const output = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      output[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return output;
}

function mobileDouban(netJson: (req: NetRequest) => Promise<NetJsonResult>): AppBridge['douban'] {
  return {
    ratings: async (titles) => {
      const cache = loadDoubanCache();
      const unique = Array.from(new Set((Array.isArray(titles) ? titles : []).map((t) => t.trim()).filter(Boolean))).slice(0, 60);
      const result: Record<string, DoubanHit | null> = {};
      const pending: string[] = [];
      const now = Date.now();
      for (const title of unique) {
        const entry = cache.ratings[title];
        if (entry && now - entry.at < RATING_TTL) result[title] = entry.hit;
        else pending.push(title);
      }
      if (pending.length) {
        const hits = await mapLimit(pending, 4, async (title) => {
          const url =
            'https://m.douban.com/rexxar/api/v2/search/subjects?q=' +
            encodeURIComponent(title) +
            '&for_mobile=1';
          const res = await netJson({ url, timeoutMs: 7000, headers: DOUBAN_HEADERS });
          if (!res.ok) return null;
          const items: any[] = res.data?.subjects?.items ?? [];
          let best: { hit: DoubanHit; score: number } | null = null;
          for (const item of items.slice(0, 12)) {
            const hit = toDoubanHit(item?.target);
            if (!hit) continue;
            let score = matchScore(title, hit.title);
            if (score === 0) continue;
            if (hit.type === 'movie') score += 6;
            if (hit.rating) score += 2;
            if (!best || score > best.score) best = { hit, score };
          }
          return best && best.score >= 50 ? best.hit : null;
        });
        pending.forEach((title, i) => {
          result[title] = hits[i];
          const at = hits[i] ? Date.now() : Date.now() - RATING_TTL + 6 * 60 * 60 * 1000;
          cache.ratings[title] = { at, hit: hits[i] };
        });
        saveDoubanCache(cache);
      }
      return result;
    },
    top: async (limit = 18) => {
      const cache = loadDoubanCache();
      const now = Date.now();
      if (cache.top && now - cache.top.at < TOP_TTL) return cache.top.items.slice(0, limit);
      const count = Math.max(1, Math.min(30, limit));
      const url =
        'https://movie.douban.com/j/chart/top_list?type=11&interval_id=100:90&action=&start=0&limit=' + count;
      const res = await netJson({ url, timeoutMs: 8000, headers: DOUBAN_HEADERS });
      if (!res.ok) return cache.top?.items.slice(0, limit) ?? [];
      const items: DoubanTopItem[] = (Array.isArray(res.data) ? res.data : [])
        .map((row: any) => {
          const rating = Number(row.score ?? row.rating?.[0]);
          const year = typeof row.release_date === 'string' ? row.release_date.slice(0, 4) : undefined;
          return {
            id: String(row.id || ''),
            title: String(row.title || ''),
            rating: Number.isFinite(rating) && rating > 0 ? rating : undefined,
            cover: row.cover_url ? String(row.cover_url).replace(/^http:/, 'https:') : undefined,
            year,
            types: Array.isArray(row.types) ? row.types : undefined,
            regions: Array.isArray(row.regions) ? row.regions : undefined,
          };
        })
        .filter((item: DoubanTopItem) => item.title);
      cache.top = { at: now, items };
      saveDoubanCache(cache);
      return items.slice(0, limit);
    },
  };
}

/* ---------- 移动端健康度（原生网络 + localStorage 持久化） ---------- */

const HEALTH_KEY = 'juying:mobile-health';

function loadHealthStatuses(): Record<string, HealthStatus> {
  try {
    const raw = localStorage.getItem(HEALTH_KEY);
    const parsed = raw ? parseJson<Record<string, HealthStatus>>(raw, {}) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveHealthStatuses(statuses: Record<string, HealthStatus>): void {
  try {
    localStorage.setItem(HEALTH_KEY, JSON.stringify(statuses));
  } catch {
    /* 忽略存储失败 */
  }
}

function mobileHealth(test: (url: string) => Promise<SourceTestResult>): AppBridge['health'] {
  let statuses = loadHealthStatuses();
  const listeners = new Set<(payload: HealthPayload) => void>();
  let running: Promise<Record<string, HealthStatus>> | null = null;

  const emit = (done: boolean, checked: number, total: number) => {
    const payload: HealthPayload = { statuses: { ...statuses }, done, checked, total };
    listeners.forEach((cb) => {
      try {
        cb(payload);
      } catch {
        /* 忽略监听器异常 */
      }
    });
  };

  const probe = async (source: { key: string; name: string; url: string }): Promise<HealthStatus> => {
    const res = await test(source.url);
    const ms = res.ms || 0;
    const ok = res.ok;
    const prev = statuses[source.key];
    const failStreak = ok ? 0 : (prev?.failStreak || 0) + 1;
    if (!ok) {
      return {
        key: source.key,
        name: source.name,
        state: 'offline',
        ok: false,
        ms,
        error: res.error || '请求失败',
        checkedAt: Date.now(),
        failStreak,
      };
    }
    return {
      key: source.key,
      name: source.name,
      state: ms > SLOW_MS ? 'slow' : 'online',
      ok: true,
      ms,
      count: res.count ?? 0,
      checkedAt: Date.now(),
      failStreak,
    };
  };

  const run = (keys?: string[]): Promise<Record<string, HealthStatus>> => {
    if (running) return running;
    const all = getHealthSources();
    const selected = keys?.length ? all.filter((s) => keys.includes(s.key)) : all;
    if (selected.length === 0) {
      emit(true, 0, 0);
      return Promise.resolve({ ...statuses });
    }
    selected.forEach((source) => {
      statuses[source.key] = {
        key: source.key,
        name: source.name,
        state: 'checking',
        ok: false,
        ms: 0,
        checkedAt: Date.now(),
        failStreak: statuses[source.key]?.failStreak || 0,
      };
    });
    emit(false, 0, selected.length);
    running = (async () => {
      let checked = 0;
      await mapLimit(selected, 4, async (source) => {
        try {
          const status = await probe(source);
          statuses[source.key] = status;
        } catch (err: any) {
          statuses[source.key] = {
            key: source.key,
            name: source.name,
            state: 'offline',
            ok: false,
            ms: 0,
            error: err?.message || '检测失败',
            checkedAt: Date.now(),
            failStreak: (statuses[source.key]?.failStreak || 0) + 1,
          };
        }
        checked += 1;
        saveHealthStatuses(statuses);
        emit(checked >= selected.length, checked, selected.length);
      });
      running = null;
      return { ...statuses };
    })();
    return running;
  };

  return {
    list: async () => ({ ...statuses }),
    check: (keys) => run(keys),
    onChange: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}

/* ---------- 移动端 AppBridge ---------- */

const MOBILE_DEFAULT_SETTINGS: Settings = {
  ...FALLBACK_SETTINGS,
  proxyEnabled: true,
};

function createMobileBridge(native: NativeApi): AppBridge {
  const netJson = (req: NetRequest) => mobileNetJson(native, req);
  const netText = (req: NetRequest) => mobileNetText(native, req);
  const test = (url: string) => mobileSourceTest(native, url);

  const readStore = async (): Promise<AppData> => {
    const raw = parseJson<Partial<AppData>>(native.storeRead(), {});
    return {
      version: raw.version,
      settings: {
        ...MOBILE_DEFAULT_SETTINGS,
        ...(raw.settings || {}),
        ai: normalizeAiSettings({
          ...MOBILE_DEFAULT_SETTINGS.ai,
          ...(raw.settings?.ai || {}),
          mode: raw.settings?.ai?.mode,
        }),
        webSearch: normalizeWebSearchConfig({
          ...MOBILE_DEFAULT_SETTINGS.webSearch,
          ...(raw.settings?.webSearch || {}),
        }),
      },
      sources: Array.isArray(raw.sources) && raw.sources.length ? raw.sources : fallbackSources(),
      liveSources: Array.isArray(raw.liveSources) ? raw.liveSources : [],
      favorites: Array.isArray(raw.favorites) ? raw.favorites : [],
      history: Array.isArray(raw.history) ? raw.history : [],
      searchHistory: Array.isArray(raw.searchHistory) ? raw.searchHistory : [],
      health: raw.health,
      freeAi: raw.freeAi,
    };
  };

  /** 联网搜索与 AI 都通过本地服务访问上游，绕开 WebView 跨域限制 */
  const webTransport: WebSearchTransport = {
    text: async (url, opts = {}) => {
      const res = await netText({
        url,
        timeoutMs: opts.timeoutMs,
        headers: { 'User-Agent': MOBILE_WEB_UA, ...(opts.headers || {}) },
        method: opts.method,
        body: opts.body,
      });
      return { ok: res.ok, status: res.status, text: res.text, error: res.error, ms: res.ms };
    },
    json: async (url, opts = {}) => {
      const res = await netJson({ url, timeoutMs: opts.timeoutMs, headers: opts.headers, method: opts.method, body: opts.body });
      return { ok: res.ok, status: res.status, data: res.data, error: res.error, ms: res.ms };
    },
  };

  const mobileAi = new MobileAiService({
    readAi: async () => (await readStore()).settings.ai,
    readFreeAi: async () => (await readStore()).freeAi,
    writeFreeAi: (state) => {
      try {
        return native.storeWrite('freeAi', JSON.stringify(state));
      } catch {
        return false;
      }
    },
    json: netJson,
    text: netText,
  });
  mobileAi.start();

  return {
    store: {
      read: readStore,
      write: async (key, value) => {
        try {
          native.storeWrite(String(key), JSON.stringify(value));
          return true;
        } catch {
          return false;
        }
      },
    },
    net: {
      json: netJson,
      text: netText,
    },
    proxy: {
      info: async () => {
        const parsed = parseJson<ProxyInfo>(native.proxyInfo(), { base: '', token: '', enabled: false });
        return parsed;
      },
    },
    source: { test },
    health: mobileHealth(test),
    douban: mobileDouban(netJson),
    websearch: {
      query: (query, config) => runWebSearch(query, config, webTransport),
      test: (config) => runWebSearchTest(config, webTransport),
    },
    ai: {
      chat: (req) => mobileAi.chat(req),
      test: (config) => mobileAi.testConnection(config),
      free: {
        status: () => mobileAi.status(),
        checkin: () => mobileAi.checkin(),
        test: () => mobileAi.testModels(),
        sync: () => mobileAi.sync(),
        onChange: (cb) => mobileAi.onChange(cb),
      },
    },
    app: {
      info: async () => {
        const info = parseJson<AppInfo>(native.appInfo(), {
          version: 'android',
          electron: '-',
          chrome: '-',
          platform: 'android',
          userData: '-',
        });
        return info;
      },
      openExternal: async (url) => {
        if (/^https?:\/\//i.test(url)) native.openExternal(url);
      },
      quit: async () => {
        native.quit();
      },
    },
    window: {
      minimize: async () => {},
      toggleMaximize: async () => {},
      close: async () => {
        native.quit();
      },
      onMaximizedChange: () => () => {},
    },
  };
}

const native = nativeApi();

export const isDesktop = typeof window !== 'undefined' && !!window.api;
export const isMobile = !!native && !isDesktop;
export const api: AppBridge = (typeof window !== 'undefined' && window.api) || (native ? createMobileBridge(native) : fallback);