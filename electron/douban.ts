import { app, net } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { DoubanHit, DoubanTopItem } from '../src/types';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';
const HEADERS: Record<string, string> = {
  'User-Agent': UA,
  Referer: 'https://movie.douban.com/',
  Accept: 'application/json, text/plain, */*',
};

const RATING_TTL = 7 * 24 * 60 * 60 * 1000;
const TOP_TTL = 12 * 60 * 60 * 1000;
const CACHE_LIMIT = 800;

interface RatingEntry {
  at: number;
  hit: DoubanHit | null;
}

interface TopEntry {
  at: number;
  items: DoubanTopItem[];
}

interface DoubanCache {
  ratings: Record<string, RatingEntry>;
  top?: TopEntry;
}

let cache: DoubanCache | null = null;
let cacheFile = '';
let saveTimer: NodeJS.Timeout | null = null;
let loading: Promise<void> | null = null;

function cachePath() {
  if (!cacheFile) cacheFile = path.join(app.getPath('userData'), 'cache', 'douban.json');
  return cacheFile;
}

async function ensureCache() {
  if (cache) return;
  if (!loading) {
    loading = (async () => {
      try {
        const raw = await fs.readFile(cachePath(), 'utf8');
        const parsed = JSON.parse(raw);
        cache = {
          ratings: parsed && typeof parsed.ratings === 'object' && parsed.ratings ? parsed.ratings : {},
          top: parsed && parsed.top && Array.isArray(parsed.top.items) ? parsed.top : undefined,
        };
      } catch {
        cache = { ratings: {} };
      }
    })();
  }
  await loading;
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void flush();
  }, 800);
}

async function flush() {
  if (!cache) return;
  try {
    const entries = Object.entries(cache.ratings);
    if (entries.length > CACHE_LIMIT) {
      entries.sort((a, b) => b[1].at - a[1].at);
      cache.ratings = Object.fromEntries(entries.slice(0, CACHE_LIMIT));
    }
    await fs.mkdir(path.dirname(cachePath()), { recursive: true });
    await fs.writeFile(cachePath(), JSON.stringify(cache), 'utf8');
  } catch {
    // 缓存写失败不影响主流程
  }
}

const AC = () => new AbortController();

async function getJson(url: string, timeoutMs = 7000): Promise<any> {
  const make = async (fetcher: typeof fetch) => {
    const ctrl = AC();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetcher(url, { headers: HEADERS, signal: ctrl.signal });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  };
  try {
    return await make(net.fetch as unknown as typeof fetch);
  } catch (err) {
    // 某些网络环境下 Chromium 栈会被拦截，退回 Node 原生 fetch
    return await make(globalThis.fetch);
  }
}

function cleanTitle(input: string) {
  return input
    .toLowerCase()
    .replace(/[\s\u3000·・:：\-—_.,，。!！?？'"“”‘’()（）\[\]【】《》<>/\\|+~]+/g, '');
}

/** 0-100：片名与豆瓣结果的匹配度 */
function matchScore(query: string, target: string) {
  const q = cleanTitle(query);
  const t = cleanTitle(target);
  if (!q || !t) return 0;
  if (q === t) return 100;
  if (t.startsWith(q) || q.startsWith(t)) return 78;
  if (t.includes(q) || q.includes(t)) return 58;
  return 0;
}

function toHit(target: any): DoubanHit | null {
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

async function searchOne(title: string): Promise<DoubanHit | null> {
  const url =
    'https://m.douban.com/rexxar/api/v2/search/subjects?q=' +
    encodeURIComponent(title) +
    '&for_mobile=1';
  const data = await getJson(url);
  const items: any[] = data?.subjects?.items ?? [];
  let best: { hit: DoubanHit; score: number } | null = null;
  for (const item of items.slice(0, 12)) {
    const hit = toHit(item?.target);
    if (!hit) continue;
    let score = matchScore(title, hit.title);
    if (score === 0) continue;
    if (hit.type === 'movie') score += 6;
    if (hit.rating) score += 2;
    if (!best || score > best.score) best = { hit, score };
  }
  if (!best || best.score < 50) return null;
  return best.hit;
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

export class DoubanService {
  async ratings(titles: string[]): Promise<Record<string, DoubanHit | null>> {
    await ensureCache();
    const unique = Array.from(new Set(titles.map((t) => t.trim()).filter((t) => t.length > 0))).slice(0, 60);
    const result: Record<string, DoubanHit | null> = {};
    const pending: string[] = [];
    const now = Date.now();
    for (const title of unique) {
      const entry = cache!.ratings[title];
      if (entry && now - entry.at < RATING_TTL) result[title] = entry.hit;
      else pending.push(title);
    }
    if (pending.length) {
      const hits = await mapLimit(pending, 4, async (title) => {
        try {
          return await searchOne(title);
        } catch {
          return null;
        }
      });
      pending.forEach((title, i) => {
        result[title] = hits[i];
        // 负结果只缓存 6 小时，避免豆瓣临时失败长期留空
        const at = hits[i] ? Date.now() : Date.now() - RATING_TTL + 6 * 60 * 60 * 1000;
        cache!.ratings[title] = { at, hit: hits[i] };
      });
      scheduleSave();
    }
    return result;
  }

  async top(limit = 18): Promise<DoubanTopItem[]> {
    await ensureCache();
    const now = Date.now();
    if (cache!.top && now - cache!.top.at < TOP_TTL) return cache!.top.items.slice(0, limit);
    try {
      const count = Math.max(1, Math.min(30, limit));
      const url =
        'https://movie.douban.com/j/chart/top_list?type=11&interval_id=100:90&action=&start=0&limit=' + count;
      const data = await getJson(url);
      const items: DoubanTopItem[] = (Array.isArray(data) ? data : [])
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
      cache!.top = { at: now, items };
      scheduleSave();
      return items.slice(0, limit);
    } catch {
      return cache!.top?.items.slice(0, limit) ?? [];
    }
  }
}

export const douban = new DoubanService();
