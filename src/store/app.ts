import { create } from 'zustand';
import type {
  AppData,
  FavoriteItem,
  HistoryItem,
  LiveSource,
  MediaSummary,
  ProxyInfo,
  SearchHistoryItem,
  Settings,
  SourceConfig,
} from '../types';
import { normalizeAiSettings } from '../lib/ai';
import { DEFAULT_WEB_SEARCH, normalizeWebSearchConfig } from '../lib/web-search';
import { api } from '../lib/bridge';
import { DEFAULT_SOURCES } from '../lib/default-sources';
import { setHealthSources } from '../lib/source-registry';

interface AppState {
  ready: boolean;
  settings: Settings;
  sources: SourceConfig[];
  liveSources: LiveSource[];
  favorites: FavoriteItem[];
  history: HistoryItem[];
  searchHistory: SearchHistoryItem[];
  proxy: ProxyInfo | null;
  init: () => Promise<void>;
  updateSettings: (patch: Partial<Settings>) => void;
  addFavorite: (item: MediaSummary) => void;
  removeFavorite: (id: string) => void;
  toggleFavorite: (item: MediaSummary) => void;
  isFavorite: (id: string) => boolean;
  upsertHistory: (item: HistoryItem) => void;
  removeHistory: (id: string) => void;
  renameHistory: (id: string, alias: string) => void;
  clearHistory: () => void;
  addSearch: (wd: string, scope?: 'adult') => void;
  removeSearch: (id: string) => void;
  renameSearch: (id: string, wd: string) => void;
  clearSearch: (scope?: 'adult') => void;
  addSource: (source: Omit<SourceConfig, 'key'>) => void;
  updateSource: (key: string, patch: Partial<SourceConfig>) => void;
  removeSource: (key: string) => void;
  addLiveSource: (source: Omit<LiveSource, 'key'>) => void;
  updateLiveSource: (key: string, patch: Partial<LiveSource>) => void;
  removeLiveSource: (key: string) => void;
  resetSources: () => void;
}

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
  proxyEnabled: true,
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

function applyTheme(settings: Settings): void {
  const root = document.documentElement;
  root.classList.toggle('light', settings.theme === 'light');
  root.classList.toggle('dark', settings.theme === 'dark');
  root.dataset.accent = settings.accent;
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;
function persist<K extends keyof AppData>(key: K, value: AppData[K]): void {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    void api.store.write(key, value).catch(() => {});
  }, 150);
}

function uid(): string {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export const useApp = create<AppState>((set, get) => ({
  ready: false,
  settings: FALLBACK_SETTINGS,
  sources: [],
  liveSources: [],
  favorites: [],
  history: [],
  searchHistory: [],
  proxy: null,

  init: async () => {
    try {
      const [data, proxy] = await Promise.all([api.store.read(), api.proxy.info().catch(() => null)]);
      applyTheme(data.settings);
      let searchHistory = Array.isArray(data.searchHistory) ? data.searchHistory : [];
      if (searchHistory.length === 0) {
        // 迁移旧版 localStorage 里的搜索历史
        try {
          const raw = localStorage.getItem('juying:recent-search');
          const old = raw ? JSON.parse(raw) : [];
          if (Array.isArray(old)) {
            searchHistory = old
              .filter((w: unknown) => typeof w === 'string' && w.trim())
              .slice(0, 20)
              .map((w: string, i: number) => ({ id: `migrate_${i}_${w}`, wd: w, at: Date.now() - i * 1000 }));
          }
        } catch {
          searchHistory = [];
        }
      }
      set({
        ready: true,
        settings: {
          ...FALLBACK_SETTINGS,
          ...data.settings,
          ai: normalizeAiSettings({ ...FALLBACK_SETTINGS.ai, ...(data.settings?.ai || {}), mode: data.settings?.ai?.mode }),
          webSearch: normalizeWebSearchConfig({ ...FALLBACK_SETTINGS.webSearch, ...(data.settings?.webSearch || {}) }),
        },
        sources: Array.isArray(data.sources) && data.sources.length > 0 ? data.sources : DEFAULT_SOURCES.map((s) => ({ ...s })),
        liveSources: data.liveSources,
        favorites: data.favorites,
        history: data.history,
        searchHistory,
        proxy,
      });
    } catch (err) {
      console.error('[init]', err);
      set({ ready: true });
    }
  },

  updateSettings: (patch) => {
    const settings = { ...get().settings, ...patch };
    applyTheme(settings);
    set({ settings });
    persist('settings', settings);
  },

  addFavorite: (item) => {
    const id = `${item.sourceKey}:${item.vodId}`;
    if (get().favorites.some((f) => f.id === id)) return;
    const favorite: FavoriteItem = {
      id,
      sourceKey: item.sourceKey,
      sourceName: item.sourceName,
      vodId: item.vodId,
      title: item.name,
      cover: item.pic,
      typeName: item.typeName,
      year: item.year,
      remarks: item.remarks,
      createdAt: Date.now(),
    };
    const favorites = [favorite, ...get().favorites];
    set({ favorites });
    persist('favorites', favorites);
  },

  removeFavorite: (id) => {
    const favorites = get().favorites.filter((f) => f.id !== id);
    set({ favorites });
    persist('favorites', favorites);
  },

  toggleFavorite: (item) => {
    const id = `${item.sourceKey}:${item.vodId}`;
    if (get().favorites.some((f) => f.id === id)) get().removeFavorite(id);
    else get().addFavorite(item);
  },

  isFavorite: (id) => get().favorites.some((f) => f.id === id),

  upsertHistory: (item) => {
    const history = [item, ...get().history.filter((h) => !(h.id === item.id && h.episodeIndex === item.episodeIndex && h.lineIndex === item.lineIndex))];
    set({ history });
    persist('history', history);
  },

  removeHistory: (id) => {
    const history = get().history.filter((h) => h.id !== id);
    set({ history });
    persist('history', history);
  },

  renameHistory: (id, alias) => {
    const history = get().history.map((h) => (h.id === id ? { ...h, alias: alias.trim() || undefined } : h));
    set({ history });
    persist('history', history);
  },

  clearHistory: () => {
    set({ history: [] });
    persist('history', []);
  },

  addSearch: (wd, scope) => {
    const text = wd.trim();
    if (!text) return;
    const existing = get().searchHistory.find((s) => s.wd === text && (s.scope || undefined) === scope);
    if (existing) {
      const searchHistory = get().searchHistory.map((s) =>
        s.id === existing.id ? { ...s, at: Date.now(), wd: text } : s,
      );
      set({ searchHistory });
      persist('searchHistory', searchHistory);
      return;
    }
    const searchHistory = [
      { id: `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`, wd: text, at: Date.now(), scope },
      ...get().searchHistory,
    ].slice(0, 40);
    set({ searchHistory });
    persist('searchHistory', searchHistory);
  },

  removeSearch: (id) => {
    const searchHistory = get().searchHistory.filter((s) => s.id !== id);
    set({ searchHistory });
    persist('searchHistory', searchHistory);
  },

  renameSearch: (id, wd) => {
    const text = wd.trim();
    if (!text) return;
    const searchHistory = get().searchHistory.map((s) => (s.id === id ? { ...s, wd: text } : s));
    set({ searchHistory });
    persist('searchHistory', searchHistory);
  },

  clearSearch: (scope) => {
    const searchHistory = get().searchHistory.filter((s) => (s.scope || undefined) !== scope);
    set({ searchHistory });
    persist('searchHistory', searchHistory);
  },

  addSource: (source) => {
    const key = `custom_${uid()}`;
    const sources = [...get().sources, { ...source, key, enabled: true }];
    set({ sources });
    persist('sources', sources);
  },

  updateSource: (key, patch) => {
    const sources = get().sources.map((s) => (s.key === key ? { ...s, ...patch } : s));
    set({ sources });
    persist('sources', sources);
  },

  removeSource: (key) => {
    const sources = get().sources.filter((s) => s.key !== key);
    const settings = get().settings.homeSource === key ? { ...get().settings, homeSource: 'all' } : get().settings;
    set({ sources, settings });
    persist('sources', sources);
    persist('settings', settings);
  },

  addLiveSource: (source) => {
    const key = `live_${uid()}`;
    const liveSources = [...get().liveSources, { ...source, key, enabled: true }];
    set({ liveSources });
    persist('liveSources', liveSources);
  },

  updateLiveSource: (key, patch) => {
    const liveSources = get().liveSources.map((s) => (s.key === key ? { ...s, ...patch } : s));
    set({ liveSources });
    persist('liveSources', liveSources);
  },

  removeLiveSource: (key) => {
    const liveSources = get().liveSources.filter((s) => s.key !== key);
    set({ liveSources });
    persist('liveSources', liveSources);
  },

  resetSources: () => {
    const sources: SourceConfig[] = DEFAULT_SOURCES.map((s) => ({ ...s }));
    set({ sources });
    persist('sources', sources);
  },
}));

// 供移动端健康检测读取当前源（桌面端健康检测在主进程，不依赖此快照）
setHealthSources(useApp.getState().sources);
useApp.subscribe((state) => setHealthSources(state.sources));

export const enabledSources = (sources: SourceConfig[]): SourceConfig[] => sources.filter((s) => s.enabled !== false);

export const enabledLiveSources = (sources: LiveSource[]): LiveSource[] => sources.filter((s) => s.enabled !== false);