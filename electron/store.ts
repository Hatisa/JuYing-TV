import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { AppData } from '../src/types';
import { DEFAULT_LIVE_SOURCES, DEFAULT_SETTINGS, DEFAULT_SOURCES, SOURCES_VERSION } from './defaults';

const HISTORY_LIMIT = 300;
const WRITABLE_KEYS: (keyof AppData)[] = ['settings', 'sources', 'liveSources', 'favorites', 'history', 'health', 'searchHistory'];

function defaults(): AppData {
  return {
    version: SOURCES_VERSION,
    settings: { ...DEFAULT_SETTINGS },
    sources: DEFAULT_SOURCES.map((s) => ({ ...s })),
    liveSources: DEFAULT_LIVE_SOURCES.map((s) => ({ ...s })),
    favorites: [],
    history: [],
    searchHistory: [],
  };
}

/** 极简 JSON 持久化：单文件 + 原子写入 + 防抖，避免频繁写盘 */
export class Store {
  private file: string;
  private data: AppData;
  private timer: NodeJS.Timeout | null = null;

  constructor() {
    const dir = app.getPath('userData');
    fs.mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, 'juying-data.json');
    this.data = this.load();
  }

  private load(): AppData {
    try {
      if (!fs.existsSync(this.file)) return defaults();
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      const base = defaults();
      const version = Number(parsed?.version) || 1;
      let sources = Array.isArray(parsed?.sources) ? parsed.sources : base.sources;
      // 版本升级：把新增的内置源补进旧数据，用户已有的启停状态与自定义源保持不变
      if (version < SOURCES_VERSION) {
        const known = new Set(sources.map((s: any) => s.key));
        for (const item of DEFAULT_SOURCES) {
          if (!known.has(item.key)) sources = [...sources, { ...item }];
        }
      }
      return {
        version: SOURCES_VERSION,
        settings: { ...base.settings, ...(parsed?.settings || {}) },
        sources,
        liveSources: Array.isArray(parsed?.liveSources) ? parsed.liveSources : base.liveSources,
        favorites: Array.isArray(parsed?.favorites) ? parsed.favorites : [],
        history: Array.isArray(parsed?.history) ? parsed.history : [],
        health: parsed?.health && typeof parsed.health === 'object' ? parsed.health : undefined,
        searchHistory: Array.isArray(parsed?.searchHistory) ? parsed.searchHistory.slice(0, 40) : [],
      };
    } catch {
      return defaults();
    }
  }

  read(): AppData {
    return this.data;
  }

  write(key: keyof AppData, value: unknown): boolean {
    if (!WRITABLE_KEYS.includes(key)) return false;
    if (key === 'history' && Array.isArray(value)) {
      this.data.history = (value as AppData['history'])
        .filter((h) => h && h.id)
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, HISTORY_LIMIT);
    } else {
      (this.data as any)[key] = value;
    }
    this.schedulePersist();
    return true;
  }

  private schedulePersist(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 200);
  }

  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    try {
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
      fs.renameSync(tmp, this.file);
    } catch (err) {
      console.error('[store] 写入失败', err);
    }
  }
}
