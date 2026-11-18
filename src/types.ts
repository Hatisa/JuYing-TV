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
