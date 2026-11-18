import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Flame, Loader2, RefreshCw, Sparkles } from 'lucide-react';
import DoubanRail from './DoubanRail';
import MediaCard from './MediaCard';
import { isAdultMedia } from '../lib/adult';
import { latestFromSource } from '../lib/api';
import { CATEGORY_LABELS, categoryOf } from '../lib/categories';
import type { CategoryKey } from '../lib/categories';
import { normalizeTitle, relativeTime } from '../lib/format';
import { sortByHealth, timeoutForSource } from '../lib/health';
import { coverUrl } from '../lib/media';
import { buildGroups } from '../lib/rank';
import type { SearchGroup } from '../lib/rank';
import { enabledSources, useApp } from '../store/app';
import { useHealth } from '../store/health';
import type { MediaSummary } from '../types';

type HotTab = 'movie' | 'tv' | 'variety';

const HOT_TABS: { key: HotTab; label: string; category: CategoryKey }[] = [
  { key: 'movie', label: '电影', category: 'movie' },
  { key: 'tv', label: '剧集', category: 'tv' },
  { key: 'variety', label: '综艺', category: 'variety' },
];

const POOL_TTL = 3 * 60_000;
const AUTO_REFRESH = 5 * 60_000;

interface PoolCache {
  key: string;
  at: number;
  items: MediaSummary[];
}

/** 页面间共享的「全源最新」缓存，避免每次回到搜索页都重新打全部接口 */
let poolCache: PoolCache | null = null;

function hotScore(group: SearchGroup): number {
  const year = parseInt(group.year || '', 10) || 0;
  const recent = year >= 2024 ? 30 : year >= 2022 ? 18 : year >= 2020 ? 8 : 0;
  return group.sourceCount * 12 + recent + (group.rating ?? 0) * 4;
}

function useDiscoverPool() {
  const sources = useApp((s) => s.sources);
  const enabled = useMemo(() => enabledSources(sources), [sources]);
  const enabledKey = enabled.map((s) => s.key).join(',');
  const enabledRef = useRef(enabled);
  const seq = useRef(0);

  const [pool, setPool] = useState<MediaSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  useEffect(() => {
    const id = ++seq.current;
    const cached = poolCache && poolCache.key === enabledKey ? poolCache : null;

    if (cached) {
      setPool(cached.items);
      setUpdatedAt(cached.at);
    } else {
      setPool([]);
      setUpdatedAt(0);
    }

    // 首次进入优先用 3 分钟内的缓存；手动/定时刷新则强制重新请求
    if (cached && refreshKey === 0 && Date.now() - cached.at < POOL_TTL) {
      setLoading(false);
      return;
    }

    setLoading(true);
    const ordered = sortByHealth(enabledRef.current, useHealth.getState().statuses);
    let collected: MediaSummary[] = [];

    void Promise.allSettled(
      ordered.map(async (source) => {
        try {
          const result = await latestFromSource(source, 1, {
            timeoutMs: timeoutForSource(useHealth.getState().statuses[source.key]?.state),
          });
          if (id !== seq.current) return;
          collected = collected.concat(result.list);
          setPool([...collected]);
        } catch {
          // 单个源失败不展示给用户，也不阻塞其余源
        }
      }),
    ).then(() => {
      if (id !== seq.current) return;
      const final = collected.slice();
      poolCache = { key: enabledKey, at: Date.now(), items: final };
      setPool(final);
      setUpdatedAt(Date.now());
      setLoading(false);
    });
  }, [enabledKey, refreshKey]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') setRefreshKey((k) => k + 1);
    }, AUTO_REFRESH);
    return () => window.clearInterval(timer);
  }, []);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  return { pool, loading, updatedAt, refresh };
}

function useTaste() {
  const history = useApp((s) => s.history);
  const favorites = useApp((s) => s.favorites);

  return useMemo(() => {
    const catScore = new Map<CategoryKey, number>();
    const typeScore = new Map<string, number>();
    const watched = new Set<string>();
    let sample = '';

    const add = (title: string, typeName: string | undefined, weight: number, alias?: string) => {
      if (!title || isAdultMedia({ name: title, typeName })) return;
      const key = normalizeTitle(title);
      if (key) watched.add(key);
      if (!sample) sample = alias || title;

      const category = categoryOf(typeName);
      if (category !== 'all' && category !== 'other') {
        catScore.set(category, (catScore.get(category) || 0) + weight);
      }
      for (const token of (typeName || '').split(/[\/、,，|]/)) {
        const t = token.trim();
        if (t.length >= 2) typeScore.set(t, (typeScore.get(t) || 0) + weight * 0.6);
      }
    };

    history.slice(0, 60).forEach((item, index) => {
      add(item.title, item.typeName, Math.max(1, 6 - index * 0.2), item.alias);
    });
    favorites.slice(0, 40).forEach((item) => add(item.title, item.typeName, 5));

    const preferredCats = Array.from(catScore.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([category]) => category);
    const preferredTypes = Array.from(typeScore.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([type]) => type);

    return {
      watched,
      preferredCats,
      preferredTypes,
      sample,
      hasTaste: catScore.size > 0 || typeScore.size > 0,
    };
  }, [history, favorites]);
}

export default function SearchDiscover() {
  const proxy = useApp((s) => s.proxy);
  const { pool, loading, updatedAt, refresh } = useDiscoverPool();
  const taste = useTaste();
  const [tab, setTab] = useState<HotTab>('movie');

  const groups = useMemo(
    () => buildGroups(pool.filter((item) => !isAdultMedia(item))),
    [pool],
  );

  const hot = useMemo(() => {
    const result = {} as Record<HotTab, SearchGroup[]>;
    for (const t of HOT_TABS) {
      result[t.key] = groups
        .filter((g) => g.category === t.category)
        .sort((a, b) => hotScore(b) - hotScore(a) || b.sourceCount - a.sourceCount)
        .slice(0, 10);
    }
    return result;
  }, [groups]);

  const guess = useMemo(() => {
    const scored = groups
      .filter((g) => g.category !== 'other' && !taste.watched.has(normalizeTitle(g.title)))
      .map((g) => {
        const typeName = g.primary.typeName || '';
        const typeMatch = taste.preferredTypes.some((t) => typeName.includes(t)) ? 6 : 0;
        const categoryScore = taste.preferredCats.indexOf(g.category);
        const categoryWeight = categoryScore === -1 ? 0 : Math.max(1, 5 - categoryScore) * 5;
        const score = taste.hasTaste
          ? categoryWeight + typeMatch + g.sourceCount * 2 + (g.rating ?? 0) * 2
          : hotScore(g);
        return { group: g, score };
      })
      .sort((a, b) => b.score - a.score)
      .map((x) => x.group);

    if (scored.length > 0) return scored.slice(0, 12);
    return groups
      .slice()
      .sort((a, b) => hotScore(b) - hotScore(a))
      .slice(0, 12);
  }, [groups, taste, hot]);

  const tasteLabels = taste.preferredCats
    .slice(0, 2)
    .map((c) => CATEGORY_LABELS[c])
    .join('、');
  const guessReason = taste.sample
    ? `因为你最近看过《${taste.sample}》${tasteLabels ? `，偏好${tasteLabels}` : ''}`
    : '先看看多源热播，观看几部后推荐会更贴合你';

  return (
    <div className="mt-7 space-y-7" data-testid="search-discover">
      <DoubanRail />

      <section className="surface rounded-2xl p-5" data-testid="hot-board">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-[var(--brand-soft)] text-[var(--brand)]">
              <Flame className="h-4 w-4" />
            </span>
            <div>
              <h2 className="flex items-center gap-2 text-[15px] font-semibold">
                实时热播榜
                <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-normal text-emerald-400">实时</span>
              </h2>
              <p className="mt-0.5 text-xs text-[var(--muted)]">
                {updatedAt ? `更新于 ${relativeTime(updatedAt)} · 每 5 分钟自动刷新` : '汇总各采集源最新更新'}
              </p>
            </div>
          </div>
          <button className="btn btn-ghost h-8 px-3 text-[12px]" onClick={refresh} disabled={loading}>
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            刷新
          </button>
        </div>

        <div className="mt-3 flex items-center gap-1.5">
          {HOT_TABS.map((t) => (
            <button
              key={t.key}
              className={`chip ${tab === t.key ? 'chip-active' : ''}`}
              data-testid={`hot-tab-${t.key}`}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
          <span className="ml-auto hidden text-[11px] text-[var(--muted)] sm:block">按多源热度与上映时间排序</span>
        </div>

        {hot[tab].length === 0 ? (
          <div className="mt-4 rounded-xl bg-[var(--panel-2)] px-4 py-8 text-center text-xs text-[var(--muted)]">
            {loading ? '正在汇总各源热播…' : '该分类暂时没有更新，刷新或稍后再看看'}
          </div>
        ) : (
          <div className="mt-2 grid gap-x-5 md:grid-cols-2">
            {hot[tab].map((g, index) => (
              <Link
                key={g.key}
                to={`/search?wd=${encodeURIComponent(g.title)}`}
                className="group flex items-center gap-3 rounded-xl px-2 py-2 transition hover:bg-[var(--panel-2)]"
              >
                <span className={`w-6 shrink-0 text-center text-[16px] font-black ${index < 3 ? 'text-[var(--brand)]' : 'text-[var(--muted)]'}`}>
                  {String(index + 1).padStart(2, '0')}
                </span>
                <div className="h-14 w-10 shrink-0 overflow-hidden rounded-md border border-[var(--border)] bg-[var(--panel-2)]">
                  {g.primary.pic ? (
                    <img
                      src={coverUrl(g.primary.pic, proxy, 160)}
                      alt={g.title}
                      loading="lazy"
                      decoding="async"
                      className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                  ) : null}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium transition-colors group-hover:text-[var(--brand)]">{g.title}</div>
                  <div className="mt-1 flex items-center gap-1.5 text-[11px] text-[var(--muted)]">
                    <span>{g.year || '—'}</span>
                    <span>·</span>
                    <span className="truncate">{g.primary.typeName || CATEGORY_LABELS[g.category]}</span>
                    {g.sourceCount > 1 && (
                      <span className="shrink-0 rounded bg-[var(--brand-soft)] px-1.5 text-[10px] text-[var(--brand)]">
                        {g.sourceCount} 源
                      </span>
                    )}
                  </div>
                </div>
                {g.rating ? (
                  <span className="shrink-0 text-[11px] font-bold text-amber-300">★ {g.rating.toFixed(1)}</span>
                ) : null}
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[var(--muted)] opacity-0 transition group-hover:opacity-100" />
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="surface rounded-2xl p-5" data-testid="guess-rail">
        <div className="flex items-center gap-2.5">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-[var(--brand-soft)] text-[var(--brand)]">
            <Sparkles className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-[15px] font-semibold">猜你喜欢</h2>
            <p className="mt-0.5 line-1 text-xs text-[var(--muted)]">{guessReason}</p>
          </div>
        </div>

        {loading && pool.length === 0 ? (
          <div className="mt-4 grid grid-cols-3 gap-x-4 gap-y-5 sm:grid-cols-4 lg:grid-cols-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="aspect-[2/3] animate-pulse rounded-xl bg-[var(--panel-2)]" />
            ))}
          </div>
        ) : guess.length === 0 ? (
          <div className="mt-4 rounded-xl bg-[var(--panel-2)] px-4 py-8 text-center text-xs text-[var(--muted)]">
            多看几部之后，这里会出现更懂你的片单
          </div>
        ) : (
          <div className="mt-4 grid grid-cols-3 gap-x-4 gap-y-6 sm:grid-cols-4 lg:grid-cols-6">
            {guess.map((g) => (
              <MediaCard key={g.key} item={g.primary} proxy={proxy} sourceCount={g.sourceCount} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
