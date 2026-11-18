export type CategoryKey = 'all' | 'movie' | 'tv' | 'anime' | 'variety' | 'short' | 'other';

export const CATEGORY_LABELS: Record<CategoryKey, string> = {
  all: '全部',
  movie: '电影',
  tv: '剧集',
  anime: '动漫',
  variety: '综艺',
  short: '短剧',
  other: '其他',
};

export const CATEGORY_ORDER: CategoryKey[] = ['all', 'movie', 'tv', 'anime', 'variety', 'short'];

const SHORT_TYPE = /短剧|微短剧|竖屏|爽剧|小程序剧|短剧场/i;
const ANIME_TYPE = /动漫|动画|国漫|日漫|番剧|卡通/i;
const VARIETY_TYPE = /综艺|真人秀|脱口秀|晚会|访谈/i;
const MOVIE_TYPE = /电影|影片|片$|纪录片|动作片|喜剧片|爱情片|科幻片|恐怖片|剧情片|战争片|悬疑片|犯罪片|冒险片|奇幻片|伦理片/i;
const TV_TYPE = /电视剧|连续剧|国产剧|港剧|台剧|日剧|韩剧|美剧|欧美剧|海外剧|泰剧|剧集|网剧/i;

/** 把数据源的 type_name 归入统一分类 */
export function categoryOf(typeName?: string | null): CategoryKey {
  const t = (typeName || '').trim();
  if (!t) return 'other';
  if (SHORT_TYPE.test(t)) return 'short';
  if (ANIME_TYPE.test(t)) return 'anime';
  if (VARIETY_TYPE.test(t)) return 'variety';
  if (MOVIE_TYPE.test(t)) return 'movie';
  if (TV_TYPE.test(t) || /剧/.test(t)) return 'tv';
  return 'other';
}

export function isShortType(typeName?: string | null): boolean {
  return categoryOf(typeName) === 'short';
}

/** 类型在「智能排序」中的权重：电影/剧集优先，短剧降权 */
export function categoryPriority(category: CategoryKey): number {
  switch (category) {
    case 'movie':
      return 26;
    case 'tv':
      return 20;
    case 'anime':
      return 12;
    case 'variety':
      return 8;
    case 'other':
      return 2;
    case 'short':
      return -18;
    default:
      return 0;
  }
}

export interface YearFilter {
  key: string;
  label: string;
  match: (year?: string) => boolean;
}

const decade = (start: number, end: number) => (year?: string) => {
  const n = parseInt(year || '', 10);
  return Number.isFinite(n) && n >= start && n <= end;
};

export const YEAR_FILTERS: YearFilter[] = [
  { key: 'all', label: '全部年份', match: () => true },
  { key: '2020s', label: '2020 年代', match: decade(2020, 2029) },
  { key: '2010s', label: '2010 年代', match: decade(2010, 2019) },
  { key: '2000s', label: '2000 年代', match: decade(2000, 2009) },
  { key: 'older', label: '更早', match: (y) => { const n = parseInt(y || '', 10); return Number.isFinite(n) && n < 2000; } },
];

export function matchYearFilter(year: string | undefined, key: string): boolean {
  const f = YEAR_FILTERS.find((x) => x.key === key);
  return f ? f.match(year) : true;
}
