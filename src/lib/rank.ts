import type { DoubanHit, MediaSummary } from '../types';
import { categoryOf, categoryPriority } from './categories';
import type { CategoryKey } from './categories';
import { normalizeTitle } from './format';

export type SortKey = 'smart' | 'rating' | 'newest' | 'sources';

export const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'smart', label: '综合排序' },
  { key: 'rating', label: '豆瓣高分' },
  { key: 'newest', label: '最新上映' },
  { key: 'sources', label: '来源最多' },
];

export interface SearchGroup {
  key: string;
  title: string;
  items: MediaSummary[];
  primary: MediaSummary;
  sourceCount: number;
  category: CategoryKey;
  year?: string;
  rating?: number;
  doubanType?: string;
  doubanId?: string;
}

/** 查询词与片名的相关性（0-120） */
export function relevanceScore(query: string, title: string): number {
  const q = normalizeTitle(query);
  const t = normalizeTitle(title);
  if (!q || !t) return 20;
  if (q === t) return 120;
  if (t.startsWith(q) || q.startsWith(t)) return 95;
  if (t.includes(q) || q.includes(t)) return 75;
  let hits = 0;
  for (let i = 0; i < q.length - 1; i += 1) {
    if (t.includes(q.slice(i, i + 2))) hits += 1;
  }
  if (hits > 0) return Math.min(60, 28 + hits * 12);
  const chars = Array.from(new Set(q.split(''))).filter((c) => t.includes(c)).length;
  if (chars > 0) return Math.min(40, 10 + chars * 6);
  return 8;
}

function pickCategory(items: MediaSummary[]): CategoryKey {
  const counts = new Map<CategoryKey, number>();
  for (const item of items) {
    const c = categoryOf(item.typeName);
    counts.set(c, (counts.get(c) || 0) + 1);
  }
  const priority: CategoryKey[] = ['movie', 'tv', 'anime', 'variety', 'short', 'other'];
  return Array.from(counts.entries()).sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return priority.indexOf(a[0]) - priority.indexOf(b[0]);
  })[0]?.[0] ?? 'other';
}

/** 合并同名资源为搜索分组，并挂上豆瓣评分 */
export function buildGroups(items: MediaSummary[], ratings: Record<string, DoubanHit | null> = {}): SearchGroup[] {
  const map = new Map<string, MediaSummary[]>();
  for (const item of items) {
    const key = normalizeTitle(item.name) || item.name;
    const list = map.get(key);
    if (list) list.push(item);
    else map.set(key, [item]);
  }
  const byTitle: Record<string, DoubanHit | null> = {};
  for (const [title, hit] of Object.entries(ratings)) byTitle[normalizeTitle(title)] = hit;

  const groups: SearchGroup[] = [];
  for (const [key, list] of map) {
    const primary = list.find((i) => !!i.pic) || list[0];
    const hit = ratings[primary.name] ?? byTitle[key] ?? null;
    const year = primary.year || list.find((i) => i.year)?.year;
    groups.push({
      key,
      title: primary.name,
      items: list,
      primary,
      sourceCount: new Set(list.map((i) => i.sourceKey)).size,
      category: pickCategory(list),
      year,
      rating: hit?.rating,
      doubanType: hit?.type,
      doubanId: hit?.id,
    });
  }
  return groups;
}

export function smartScore(group: SearchGroup, query: string): number {
  const rating = group.rating ?? 0;
  let score =
    relevanceScore(query, group.title) +
    categoryPriority(group.category) +
    rating * 8 +
    Math.min(group.sourceCount, 10) * 3;
  if (group.doubanType === 'movie') score += 10;
  if (group.doubanType === 'tv') score += 6;
  if (group.category === 'short' && group.doubanType === 'movie') score -= 30;
  return score;
}

const yearOf = (g: SearchGroup) => parseInt(g.year || '', 10) || 0;

export function sortGroups(groups: SearchGroup[], query: string, sort: SortKey): SearchGroup[] {
  const list = groups.slice();
  if (sort === 'smart') {
    list.sort((a, b) => smartScore(b, query) - smartScore(a, query) || b.sourceCount - a.sourceCount);
  } else if (sort === 'rating') {
    list.sort(
      (a, b) =>
        (b.rating ?? -1) - (a.rating ?? -1) ||
        smartScore(b, query) - smartScore(a, query) ||
        b.sourceCount - a.sourceCount,
    );
  } else if (sort === 'newest') {
    list.sort((a, b) => yearOf(b) - yearOf(a) || smartScore(b, query) - smartScore(a, query));
  } else {
    list.sort((a, b) => b.sourceCount - a.sourceCount || smartScore(b, query) - smartScore(a, query));
  }
  return list;
}
