import type { HealthStatus, MediaSummary, SourceConfig } from '../types';
import { isAdultMedia } from './adult';
import type { AiRecommendation } from './ai';
import { searchSource } from './api';
import { normalizeTitle } from './format';
import { buildGroups, type SearchGroup } from './rank';

export interface AiLookupOptions {
  /** 单源超时，默认 6 秒 */
  timeoutMs?: number;
  /** 是否允许成人内容，默认 false */
  allowAdult?: boolean;
  /** 健康度状态，用于优先选择可用源 */
  statuses?: Record<string, HealthStatus>;
  /** 最多查询多少个源，默认 12 */
  maxSources?: number;
}

export interface AiLookupResult {
  group?: SearchGroup;
  /** 是否用 AI 返回的外文原名命中 */
  viaOriginal?: boolean;
  /** 所有源都请求失败时的错误信息 */
  error?: string;
}

function stripBrackets(text: string): string {
  return String(text || '')
    .replace(/[《》「」『』]/g, '')
    .replace(/[（(][^）)]*[)）]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 生成用于片库检索的候选词：正式名、去书名号、去年份括号、外文原名 */
export function recommendationQueries(rec: AiRecommendation): string[] {
  const raw = [rec.title, rec.originalTitle].filter((x): x is string => !!x && !!x.trim());
  const out: string[] = [];
  const seen = new Set<string>();
  for (const text of raw) {
    for (const variant of [text.trim(), stripBrackets(text)]) {
      const key = normalizeTitle(variant);
      if (!variant || !key || seen.has(key)) continue;
      seen.add(key);
      out.push(variant);
    }
  }
  return out.slice(0, 4);
}

/** 从已启用源中按健康度挑出最适合做片库查找的一批 */
export function rankLookupSources(
  sources: SourceConfig[],
  statuses: Record<string, HealthStatus> = {},
  maxSources = 12
): SourceConfig[] {
  const rank: Record<string, number> = { online: 0, slow: 1, unknown: 2, checking: 3, offline: 4 };
  return sources
    .filter((s) => s.enabled !== false)
    .slice()
    .sort((a, b) => {
      const ar = rank[statuses[a.key]?.state || 'unknown'] ?? 2;
      const br = rank[statuses[b.key]?.state || 'unknown'] ?? 2;
      if (ar !== br) return ar - br;
      return 0;
    })
    .slice(0, Math.max(1, maxSources));
}

function titleMatchScore(title: string, target: string): number {
  const name = normalizeTitle(title);
  if (!name || !target) return 0;
  if (name === target) return 3;
  if (name.startsWith(target)) return 2;
  if (target.startsWith(name) && name.length >= 2) return 1;
  return 0;
}

/**
 * 用 AI 推荐片名在采集源片库里查找可播放条目。
 * 先查正式片名，再回退到外文原名；只接受完全匹配/前缀匹配，避免推荐《西游记》却返回无关影片。
 */
export async function lookupRecommendation(
  rec: AiRecommendation,
  sources: SourceConfig[],
  options: AiLookupOptions = {}
): Promise<AiLookupResult> {
  const pool = sources.filter((s) => options.allowAdult || !s.isAdult);
  if (pool.length === 0) return {};

  const queries = recommendationQueries(rec);
  let requestErrors = 0;
  let requestCount = 0;
  let lastError = '';

  for (const query of queries) {
    const target = normalizeTitle(query);
    if (!target) continue;
    const settled = await Promise.all(
      pool.map(async (source) => {
        requestCount += 1;
        try {
          const result = await searchSource(source, query, 1, { timeoutMs: options.timeoutMs ?? 6000 });
          return result.list;
        } catch (err: any) {
          requestErrors += 1;
          lastError = err?.message || '请求失败';
          return [] as MediaSummary[];
        }
      })
    );
    const items = settled.flat().filter((item) => options.allowAdult || !isAdultMedia(item));
    if (items.length === 0) continue;

    let best = 0;
    for (const item of items) best = Math.max(best, titleMatchScore(item.name, target));
    if (best === 0) continue;

    const chosen = items.filter((item) => titleMatchScore(item.name, target) === best);
    const groups = buildGroups(chosen);
    const group =
      groups.find((g) => normalizeTitle(g.title) === target) ||
      groups.slice().sort((a, b) => b.sourceCount - a.sourceCount)[0];
    if (!group) continue;
    return {
      group,
      viaOriginal: !!rec.originalTitle && query === rec.originalTitle.trim(),
    };
  }

  if (requestCount > 0 && requestErrors === requestCount) {
    return { error: lastError || '片库检索失败' };
  }
  return {};
}
