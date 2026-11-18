import type { MediaDetail, MediaSummary, NetRequest, ProxyInfo, SourceConfig } from '../types';
import { api } from './bridge';
import { detailUrl, latestUrl, parseDetail, parseList, parseLines, searchUrl, extractM3u8, type ParsedList } from './cms';

const resultCache = new Map<string, { at: number; value: ParsedList }>();
/** 结果缓存 5 分钟：来回切页/重复搜索不再重复请求源站 */
const CACHE_TTL = 5 * 60_000;
const CACHE_MAX = 400;

function cacheSet(key: string, value: ParsedList): void {
  resultCache.set(key, { at: Date.now(), value });
  if (resultCache.size > CACHE_MAX) {
    const now = Date.now();
    for (const [k, v] of resultCache) {
      if (now - v.at > CACHE_TTL) resultCache.delete(k);
    }
    while (resultCache.size > CACHE_MAX) {
      const oldest = resultCache.keys().next().value as string | undefined;
      if (!oldest) break;
      resultCache.delete(oldest);
    }
  }
}

function cacheGet(key: string): ParsedList | null {
  const hit = resultCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL) {
    resultCache.delete(key);
    return null;
  }
  // LRU：命中后移到队尾
  resultCache.delete(key);
  resultCache.set(key, hit);
  return hit.value;
}

async function getJson(url: string, timeoutMs = 15000): Promise<any> {
  const req: NetRequest = { url, timeoutMs };
  const res = await api.net.json(req);
  if (!res.ok) throw new Error(res.error || '请求失败');
  return res.data;
}

export interface SourceFetchOptions {
  /** 单源超时（毫秒），默认 15s */
  timeoutMs?: number;
}

/** 聚合搜索单个源 */
export async function searchSource(
  source: SourceConfig,
  wd: string,
  page = 1,
  opts: SourceFetchOptions = {}
): Promise<ParsedList> {
  const key = `s|${source.key}|${wd}|${page}`;
  const cached = cacheGet(key);
  if (cached) return cached;
  const data = await getJson(searchUrl(source, wd, page), opts.timeoutMs ?? 15000);
  const parsed = parseList(data, source);
  cacheSet(key, parsed);
  return parsed;
}

/** 某个源的最新更新 */
export async function latestFromSource(source: SourceConfig, page = 1, opts: SourceFetchOptions = {}): Promise<ParsedList> {
  const key = `l|${source.key}|${page}`;
  const cached = cacheGet(key);
  if (cached) return cached;
  const data = await getJson(latestUrl(source, page), opts.timeoutMs ?? 15000);
  const parsed = parseList(data, source);
  cacheSet(key, parsed);
  return parsed;
}

export async function fetchDetail(source: SourceConfig, vodId: string, opts: SourceFetchOptions = {}): Promise<MediaDetail> {
  const data = await getJson(detailUrl(source, vodId), opts.timeoutMs ?? 15000);
  return parseDetail(data, source);
}

/** 中转页兜底：抓取网页并从 HTML 中提取 m3u8 */
export async function resolvePlayable(url: string): Promise<string> {
  const res = await api.net.text({ url, timeoutMs: 15000 });
  if (!res.ok || !res.text) return url;
  return extractM3u8(res.text) || url;
}

/** 并行聚合多个源的最新更新，返回按源分组的结果与错误 */
export async function latestAll(
  sources: SourceConfig[],
  page = 1
): Promise<{ items: MediaSummary[]; errors: { source: string; message: string }[] }> {
  const errors: { source: string; message: string }[] = [];
  const results = await Promise.all(
    sources.map(async (source) => {
      try {
        const r = await latestFromSource(source, page);
        return r.list;
      } catch (err: any) {
        errors.push({ source: source.name, message: err?.message || '请求失败' });
        return [] as MediaSummary[];
      }
    })
  );
  return { items: results.flat(), errors };
}

export interface SourceSearchOutcome {
  source: SourceConfig;
  items: MediaSummary[];
  pageCount: number;
  total: number;
  error?: string;
  ms: number;
}

/** 并行搜索多个源，返回每个源的结果（UI 可逐源展示状态） */
export async function searchAll(sources: SourceConfig[], wd: string, page = 1): Promise<SourceSearchOutcome[]> {
  const results = await Promise.all(
    sources.map(async (source) => {
      const start = performance.now();
      try {
        const r = await searchSource(source, wd, page);
        return { source, items: r.list, pageCount: r.pageCount, total: r.total, ms: Math.round(performance.now() - start) };
      } catch (err: any) {
        return {
          source,
          items: [] as MediaSummary[],
          pageCount: 1,
          total: 0,
          error: err?.message || '请求失败',
          ms: Math.round(performance.now() - start),
        };
      }
    })
  );
  return results;
}

export async function loadProxy(): Promise<ProxyInfo | null> {
  try {
    return await api.proxy.info();
  } catch {
    return null;
  }
}

export { parseLines };
