import { describe, expect, it } from 'vitest';
import { isAdultMedia, isAdultType } from '../src/lib/adult';
import { categoryOf, matchYearFilter } from '../src/lib/categories';
import { buildGroups, relevanceScore, sortGroups } from '../src/lib/rank';
import type { DoubanHit, MediaSummary } from '../src/types';

function item(over: Partial<MediaSummary> & { name: string }): MediaSummary {
  return {
    sourceKey: 'ffzy5',
    sourceName: '非凡影视',
    vodId: over.name,
    typeName: '电影',
    ...over,
  };
}

describe('成人内容识别', () => {
  it('类型关键词命中', () => {
    expect(isAdultType('伦理片')).toBe(true);
    expect(isAdultType('福利')).toBe(true);
    expect(isAdultType('动作片')).toBe(false);
    expect(isAdultType(undefined)).toBe(false);
  });

  it('片名或源标记命中', () => {
    expect(isAdultMedia(item({ name: '某部无码影片' }))).toBe(true);
    expect(isAdultMedia(item({ name: '普通电影', typeName: '剧情' }))).toBe(false);
    expect(isAdultMedia(item({ name: '普通电影', isAdult: true }))).toBe(true);
  });
});

describe('分类与年份', () => {
  it('按类型名归类', () => {
    expect(categoryOf('电影')).toBe('movie');
    expect(categoryOf('国产剧')).toBe('tv');
    expect(categoryOf('动漫')).toBe('anime');
    expect(categoryOf('综艺')).toBe('variety');
    expect(categoryOf('短剧')).toBe('short');
    expect(categoryOf('')).toBe('other');
  });

  it('年份筛选', () => {
    expect(matchYearFilter(2024, '2020s')).toBe(true);
    expect(matchYearFilter(2015, '2020s')).toBe(false);
    expect(matchYearFilter(2015, '2010s')).toBe(true);
    expect(matchYearFilter(2003, '2000s')).toBe(true);
    expect(matchYearFilter(1999, 'older')).toBe(true);
    expect(matchYearFilter(undefined, 'all')).toBe(true);
    expect(matchYearFilter(undefined, '2020s')).toBe(false);
  });
});

describe('搜索相关性排序', () => {
  const movie = item({ name: '流浪地球', typeName: '电影', year: 2019, pic: 'https://x/p.jpg', remarks: 'HD' });
  const movie2 = item({ name: '流浪地球2', typeName: '电影', year: 2023, sourceKey: 'lzi', sourceName: '量子' });
  const short = item({ name: '流浪地球之末日短剧', typeName: '短剧', year: 2024, sourceKey: 'wujin', sourceName: '无尽' });
  const unrelated = item({ name: '三体', typeName: '国产剧', year: 2023, sourceKey: 'uku', sourceName: 'U酷' });
  const ratings: Record<string, DoubanHit | null> = {
    流浪地球: { title: '流浪地球', id: '26266893', rating: 7.9, type: 'movie', year: 2019 },
    流浪地球2: { title: '流浪地球2', id: '35267208', rating: 8.3, type: 'movie', year: 2023 },
  };

  it('完全匹配得分更高，短剧被降权', () => {
    expect(relevanceScore('流浪地球', '流浪地球')).toBeGreaterThan(relevanceScore('流浪地球', '流浪地球2'));
    expect(relevanceScore('流浪地球', '三体')).toBeLessThan(30);

    const groups = sortGroups(buildGroups([short, unrelated, movie2, movie], ratings), '流浪地球', 'smart');
    expect(groups.map((g) => g.title)).toEqual(['流浪地球', '流浪地球2', '流浪地球之末日短剧', '三体']);
  });

  it('合并多源同名结果并统计来源', () => {
    const other = item({ name: '流浪地球', sourceKey: 'lzi', sourceName: '量子', pic: '' });
    const groups = buildGroups([movie, other], ratings);
    expect(groups).toHaveLength(1);
    expect(groups[0].sourceCount).toBe(2);
    expect(groups[0].primary.sourceKey).toBe('ffzy5');
    expect(groups[0].rating).toBe(7.9);
  });

  it('按豆瓣评分排序时未评分排在最后', () => {
    const groups = sortGroups(buildGroups([unrelated, movie, movie2], ratings), '流浪地球', 'rating');
    expect(groups.map((g) => g.title)).toEqual(['流浪地球2', '流浪地球', '三体']);
  });
});
