/* 全局类型定义：主进程与渲染进程共享 */

export type ThemeMode = 'dark' | 'light';

/** 苹果CMS（Apple CMS）采集站配置 */
export interface SourceConfig {
  key: string;
  name: string;
  /** API 根地址，例如 https://example.com/api.php/provide/vod */
  url: string;
  /** 可选：详情页根地址（部分源需要抓取详情页） */
  detail?: string;
  isAdult?: boolean;
  enabled?: boolean;
  builtin?: boolean;
}

/** 直播源（M3U 订阅地址） */
export interface LiveSource {
  key: string;
  name: string;
  url: string;
  enabled?: boolean;
  builtin?: boolean;
}

/** AI 运行模式：auto = 免费模型池自动选路，custom = 用户自己的 OpenAI 兼容接口 */
export type AiMode = 'auto' | 'custom';

/** 自定义免费通道（任意 OpenAI 兼容端点，可填自己的免费额度 Key） */
export interface FreeModelChannel {
  id: string;
  name: string;
  /** API 根地址，例如 https://openrouter.ai/api/v1 */
  baseUrl: string;
  apiKey: string;
  /** 该通道使用的模型名 */
  model: string;
  enabled: boolean;
}

/** AI 推荐助手配置（OpenAI 兼容接口） */
export interface AiConfig {
  /** auto 使用内置免费模型池；custom 使用下面的 baseUrl/model/apiKey */
  mode?: AiMode;
  /** 是否每天自动签到（刷新免费通道额度并检测模型） */
  autoCheckin?: boolean;
  /** API 根地址，例如 https://api.deepseek.com 或 https://api.openai.com/v1 */
  baseUrl: string;
  /** 供应商密钥；本地模型可留空 */
  apiKey: string;
  /** 模型名，例如 deepseek-chat */
  model: string;
  /** 免费 Auto 池里的自定义通道（与内置 Kilo / Pollinations 一起排序） */
  freeChannels?: FreeModelChannel[];
}

export interface AiChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AiChatRequest {
  messages: AiChatMessage[];
  /** 不传则使用设置中保存的配置 */
  config?: AiConfig;
}

export interface AiChatResult {
  ok: boolean;
  content?: string;
  error?: string;
  model?: string;
  ms?: number;
  /** 实际使用的通道：kilo / pollinations / custom */
  provider?: string;
  /** 是否由免费模型池自动选路 */
  auto?: boolean;
  /** 本次请求尝试过的模型数量 */
  attempts?: number;
}

export interface AiTestResult {
  ok: boolean;
  error?: string;
  model?: string;
  ms?: number;
}

/** 免费模型健康状态（复用采集源的 online/slow/offline/unknown） */
export interface AiFreeModelInfo {
  /** 稳定 id：provider/model */
  id: string;
  provider: 'kilo' | 'pollinations' | 'custom';
  providerName: string;
  /** 自定义免费通道 id（provider 为 custom 时使用） */
  channelId?: string;
  model: string;
  /** 实际 chat/completions 地址（主进程使用，不在 UI 展示） */
  endpoint: string;
  state: HealthState;
  ok: boolean;
  ms: number;
  error?: string;
  checkedAt: number;
  failStreak: number;
  /** 冷却截止时间（epoch ms），期间不自动选路 */
  cooldownUntil?: number;
  successCount: number;
  failCount: number;
  lastUsedAt?: number;
}


/** 免费模型签到与健康状态（持久化到 AppData.freeAi） */
export interface FreeAiState {
  models: AiFreeModelInfo[];
  /** UTC+8 日期 YYYY-MM-DD */
  lastCheckinDate: string;
  lastCheckinAt: number;
  lastResult: string;
  updatedAt: number;
}

export interface AiFreeStatus extends FreeAiState {
  enabled: boolean;
  autoCheckin: boolean;
  today: string;
  checking: boolean;
  available: number;
}

/** 联网搜索提供商：DuckDuckGo 免 Key，Tavily / Serper 需要自己的 Key */
export type WebSearchProvider = 'bing' | 'duckduckgo' | 'tavily' | 'serper';

export interface WebSearchConfig {
  enabled: boolean;
  provider: WebSearchProvider;
  apiKey: string;
  /** 最多注入 AI 上下文的条数（1-6） */
  maxResults: number;
  timeoutMs: number;
}

export interface WebSearchItem {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchResult {
  ok: boolean;
  provider: WebSearchProvider;
  query: string;
  results: WebSearchItem[];
  error?: string;
  ms: number;
}

export interface WebSearchTestResult {
  ok: boolean;
  count: number;
  error?: string;
  ms: number;
}

export interface Settings {
  theme: ThemeMode;
  /** 旧字段：保留兼容，实际以 adult18 为准 */
  hideAdult: boolean;
  /** 已确认年满 18 周岁并开启成人内容 */
  adult18: boolean;
  autoNext: boolean;
  autoPlay: boolean;
  rememberProgress: boolean;
  volume: number;
  playbackRate: number;
  homeSource: string; // 'all' 或源 key
  accent: 'rose' | 'amber' | 'violet' | 'cyan';
  proxyEnabled: boolean;
  /** AI 推荐助手（桌面端） */
  ai: AiConfig;
  /** AI 助手联网搜索（桌面端） */
  webSearch: WebSearchConfig;
}

export interface FavoriteItem {
  id: string;
  sourceKey: string;
  sourceName: string;
  vodId: string;
  title: string;
  cover?: string;
  typeName?: string;
  year?: string;
  remarks?: string;
  createdAt: number;
}

export interface HistoryItem {
  id: string;
  sourceKey: string;
  sourceName: string;
  vodId: string;
  title: string;
  cover?: string;
  episodeIndex: number;
  episodeName: string;
  /** 用户自定义标题（重命名观看记录） */
  alias?: string;
  typeName?: string;
  lineIndex: number;
  position: number;
  duration: number;
  updatedAt: number;
}

export type HealthState = 'online' | 'slow' | 'offline' | 'unknown' | 'checking';

/** 采集源健康状态（主进程实时探测并推送到渲染层） */
export interface HealthStatus {
  key: string;
  name: string;
  state: HealthState;
  ok: boolean;
  /** 最近一次探测耗时（毫秒） */
  ms: number;
  /** 返回条目数 */
  count?: number;
  error?: string;
  /** 最近一次探测时间（epoch ms） */
  checkedAt: number;
  /** 连续失败次数 */
  failStreak: number;
}

export interface HealthPayload {
  statuses: Record<string, HealthStatus>;
  /** 本轮检测是否已结束 */
  done: boolean;
  checked: number;
  total: number;
}

export interface AppData {
  /** 数据版本，用于内置源升级迁移 */
  version?: number;
  settings: Settings;
  sources: SourceConfig[];
  liveSources: LiveSource[];
  favorites: FavoriteItem[];
  history: HistoryItem[];
  /** 最近一次健康检测结果（启动时先展示旧值） */
  health?: Record<string, HealthStatus>;
  /** 搜索历史（可按条编辑/删除） */
  searchHistory?: SearchHistoryItem[];
  /** 免费模型池的签到与健康状态 */
  freeAi?: FreeAiState;
}

/* ---------- CMS 数据 ---------- */

export interface MediaSummary {
  sourceKey: string;
  sourceName: string;
  vodId: string;
  name: string;
  pic?: string;
  typeName?: string;
  year?: string;
  area?: string;
  remarks?: string;
  isAdult?: boolean;
  /** 豆瓣评分（0-10，来自豆瓣实时查询） */
  rating?: number;
  doubanId?: string;
  doubanType?: string;
}

/** 搜索历史（可编辑、可删除） */
export interface SearchHistoryItem {
  id: string;
  wd: string;
  at: number;
  /** adult = 18+ 频道独立搜索历史 */
  scope?: 'adult';
}

/** 豆瓣检索命中 */
export interface DoubanHit {
  title: string;
  id: string;
  rating?: number;
  type?: string;
  year?: string;
  cover?: string;
  card?: string;
}

export interface DoubanTopItem {
  id: string;
  title: string;
  rating?: number;
  cover?: string;
  year?: string;
  types?: string[];
  regions?: string[];
}

export interface Episode {
  /** 集名，如「第01集」 */
  name: string;
  /** 播放地址（m3u8 / mp4 / 中转页） */
  url: string;
}

/** 一条播放线路（对应 vod_play_from 中的源） */
export interface PlayLine {
  name: string;
  episodes: Episode[];
}

export interface MediaDetail {
  line: PlayLine[];
  info: {
    title?: string;
    cover?: string;
    desc?: string;
    typeName?: string;
    year?: string;
    area?: string;
    director?: string;
    actor?: string;
    remarks?: string;
    sourceKey: string;
    sourceName: string;
    sourceUrl: string;
  };
}

/* ---------- IPC 契约 ---------- */

export interface NetRequest {
  url: string;
  timeoutMs?: number;
  headers?: Record<string, string>;
  /** 默认 GET；AI / Tavily / Serper 等接口需要 POST */
  method?: string;
  /** 请求体（字符串） */
  body?: string;
}

export interface NetJsonResult {
  ok: boolean;
  status?: number;
  data?: any;
  error?: string;
  ms?: number;
}

export interface NetTextResult {
  ok: boolean;
  status?: number;
  text?: string;
  error?: string;
  ms?: number;
}

export interface SourceTestResult {
  ok: boolean;
  ms: number;
  count?: number;
  error?: string;
}

export interface ProxyInfo {
  base: string;
  token: string;
  enabled: boolean;
}

export interface AppInfo {
  version: string;
  electron: string;
  chrome: string;
  platform: string;
  userData: string;
}

export interface AppBridge {
  store: {
    read(): Promise<AppData>;
    write<K extends keyof AppData>(key: K, value: AppData[K]): Promise<boolean>;
  };
  net: {
    json(req: NetRequest): Promise<NetJsonResult>;
    text(req: NetRequest): Promise<NetTextResult>;
  };
  proxy: { info(): Promise<ProxyInfo> };
  source: { test(url: string): Promise<SourceTestResult> };
  health: {
    list(): Promise<Record<string, HealthStatus>>;
    /** 不传 keys 表示全部源；立即返回当前状态，检测过程通过 onChange 事件推送 */
    check(keys?: string[]): Promise<Record<string, HealthStatus>>;
    onChange(cb: (payload: HealthPayload) => void): () => void;
  };
  douban: {
    /** 按片名批量查评分（key 为原始片名） */
    ratings(titles: string[]): Promise<Record<string, DoubanHit | null>>;
    /** 豆瓣高分榜（电影） */
    top(limit?: number): Promise<DoubanTopItem[]>;
  };
  websearch: {
    /** 联网搜索，结果会作为 AI 上下文；失败不阻塞 AI */
    query(query: string, config?: WebSearchConfig): Promise<WebSearchResult>;
    test(config?: WebSearchConfig): Promise<WebSearchTestResult>;
  };
  ai: {
    /** 调用 OpenAI 兼容的 /chat/completions 接口（auto 模式走免费模型池） */
    chat(req: AiChatRequest): Promise<AiChatResult>;
    /** 测试供应商地址与密钥是否可用 */
    test(config?: AiConfig): Promise<AiTestResult>;
    /** 免费模型池：签到、健康检测与状态订阅（仅桌面端） */
    free: {
      status(): Promise<AiFreeStatus>;
      checkin(): Promise<AiFreeStatus>;
      test(): Promise<AiFreeStatus>;
      /** 设置里的自定义通道改动后立即同步到 Auto 池 */
      sync(): Promise<AiFreeStatus>;
      onChange(cb: (status: AiFreeStatus) => void): () => void;
    };
  };
  app: {
    info(): Promise<AppInfo>;
    openExternal(url: string): Promise<void>;
    quit(): Promise<void>;
  };
  window: {
    minimize(): Promise<void>;
    toggleMaximize(): Promise<void>;
    close(): Promise<void>;
    onMaximizedChange(cb: (maximized: boolean) => void): () => void;
  };
}

declare global {
  interface Window {
    api?: AppBridge;
  }
}