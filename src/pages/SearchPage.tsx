import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Check, Loader2, Pencil, SearchX, Trash2, X } from 'lucide-react';
import MediaCard from '../components/MediaCard';
import SearchDiscover from '../components/SearchDiscover';
import { EmptyState, PageHeader, SkeletonGrid } from '../components/States';
import { searchSource } from '../lib/api';
import { api } from '../lib/bridge';
import { isAdultGroup } from '../lib/adult';
import { CATEGORY_LABELS, CATEGORY_ORDER, YEAR_FILTERS, matchYearFilter } from '../lib/categories';
import type { CategoryKey } from '../lib/categories';
import { sortByHealth, timeoutForSource } from '../lib/health';
import { SORT_OPTIONS, buildGroups, sortGroups } from '../lib/rank';
import type { SearchGroup, SortKey } from '../lib/rank';
import { enabledSources, useApp } from '../store/app';
import { useHealth } from '../store/health';
import type { DoubanHit, MediaSummary, SearchHistoryItem, SourceConfig } from '../types';

type Status = { state: 'loading' | 'ok' | 'error'; count: number; error?: string; ms?: number };

interface Props {
  /** 18+ 频道：只展示成人内容，搜索历史独立 */
  adultMode?: boolean;
}

function HistoryList({ scope }: { scope?: 'adult' }) {
  const navigate = useNavigate();
  const base = scope === 'adult' ? '/adult' : '/search';
  const all = useApp((s) => s.searchHistory);
  const removeSearch = useApp((s) => s.removeSearch);
  const renameSearch = useApp((s) => s.renameSearch);
  const clearSearch = useApp((s) => s.clearSearch);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const items = all.filter((s) => (s.scope || undefined) === scope);
  if (items.length === 0) return null;

  const commit = (item: SearchHistoryItem) => {
    if (draft.trim()) renameSearch(item.id, draft);
    setEditing(null);
  };

  return (
    <div className="mt-8">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm text-[var(--muted)]">最近搜索</div>
        <button className="text-xs text-[var(--muted)] hover:text-[var(--brand)]" onClick={() => clearSearch(scope)}>
          清空全部
        </button>
      </div>
      <div className="flex flex-wrap gap-2" data-testid="search-history">
        {items.map((item) =>
          editing === item.id ? (
            <span key={item.id} className="chip gap-1 border-[var(--brand)] pr-1.5">
              <input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commit(item);
                  if (e.key === 'Escape') setEditing(null);
                }}
                className="w-28 bg-transparent text-sm outline-none"
              />
              <button className="rounded p-0.5 hover:text-[var(--brand)]" onClick={() => commit(item)} title="保存">
                <Check className="h-3.5 w-3.5" />
              </button>
              <button className="rounded p-0.5 hover:text-[var(--brand)]" onClick={() => setEditing(null)} title="取消">
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          ) : (
            <span key={item.id} className="chip group gap-1 pr-1.5">
              <button onClick={() => navigate(`${base}?wd=${encodeURIComponent(item.wd)}`)} className="max-w-40 truncate">
                {item.wd}
              </button>
              <button
                className="rounded p-0.5 text-[var(--muted)] opacity-0 transition group-hover:opacity-100 hover:text-[var(--brand)]"
                title="编辑"
                onClick={() => {
                  setEditing(item.id);
                  setDraft(item.wd);
                }}
              >
                <Pencil className="h-3 w-3" />
              </button>
              <button
                className="rounded p-0.5 text-[var(--muted)] opacity-0 transition group-hover:opacity-100 hover:text-red-400"
                title="删除"
                onClick={() => removeSearch(item.id)}
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </span>
          ),
        )}
      </div>
    </div>
  );
}

export default function SearchPage({ adultMode = false }: Props) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const wd = (params.get('wd') || '').trim();
  const sources = useApp((s) => s.sources);
  const proxy = useApp((s) => s.proxy);
  const history = useApp((s) => s.history);
  const addSearch = useApp((s) => s.addSearch);
  const adultAllowed = adultMode;

  const [category, setCategory] = useState<CategoryKey>('all');
  const [year, setYear] = useState('all');
  const [sort, setSort] = useState<SortKey>('smart');
  const [minRating, setMinRating] = useState(false);

  const enabled = useMemo(() => enabledSources(sources), [sources]);
  const enabledKey = enabled.map((s) => s.key).join(',');
  const healthStatuses = useHealth((s) => s.statuses);
  const orderedRef = useRef<SourceConfig[]>([]);
  // 健康度好的源先发请求，结果更快出现；健康度变化不触发重新搜索
  orderedRef.current = sortByHealth(enabled, healthStatuses);

  const [raw, setRaw] = useState<MediaSummary[]>([]);
  const [statuses, setStatuses] = useState<Record<string, Status>>({});
  const [page, setPage] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);
  const [ratings, setRatings] = useState<Record<string, DoubanHit | null>>({});
  const ratingsRef = useRef<Record<string, DoubanHit | null>>({});
  const seqRef = useRef(0);
  const keysRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!wd) return;
    const seq = ++seqRef.current;
    keysRef.current = new Set();
    ratingsRef.current = {};
    setRaw([]);
    setRatings({});
    setPage(1);
    const init: Record<string, Status> = {};
    enabled.forEach((s) => (init[s.key] = { state: 'loading', count: 0 }));
    setStatuses(init);
    addSearch(wd, adultMode ? 'adult' : undefined);

    const statusesNow = useHealth.getState().statuses;
    orderedRef.current.forEach((source) => {
      const started = performance.now();
      searchSource(source, wd, 1, { timeoutMs: timeoutForSource(statusesNow[source.key]?.state) })
        .then((r) => {
          if (seq !== seqRef.current) return;
          for (const item of r.list) keysRef.current.add(`${item.sourceKey}:${item.vodId}`);
          setRaw((prev) => [...prev, ...r.list]);
          setStatuses((prev) => ({ ...prev, [source.key]: { state: 'ok', count: r.list.length, ms: Math.round(performance.now() - started) } }));
        })
        .catch((err: any) => {
          if (seq !== seqRef.current) return;
          setStatuses((prev) => ({
            ...prev,
            [source.key]: { state: 'error', count: 0, error: err?.message || '请求失败', ms: Math.round(performance.now() - started) },
          }));
        });
    });
  }, [wd, enabledKey, adultMode]);

  // 结果变化后批量补齐豆瓣评分（只补缺失项，最多 30 个/次）
  useEffect(() => {
    if (raw.length === 0) return;
    const timer = setTimeout(() => {
      const groups = buildGroups(raw);
      const missing = Array.from(new Set(groups.map((g) => g.title)))
        .filter((t) => !(t in ratingsRef.current))
        .slice(0, 30);
      if (missing.length === 0) return;
      missing.forEach((t) => (ratingsRef.current[t] = null));
      void api.douban
        .ratings(missing)
        .then((res) => {
          if (seqRef.current === 0) return;
          setRatings((prev) => ({ ...prev, ...res }));
        })
        .catch(() => {});
    }, 250);
    return () => clearTimeout(timer);
  }, [raw]);

  const allGroups = useMemo(() => buildGroups(raw, ratings), [raw, ratings]);

  const groups = useMemo(() => {
    const scoped = allGroups.filter((g) => (adultAllowed ? isAdultGroup(g) : !isAdultGroup(g)));
    const filtered = scoped.filter(
      (g) =>
        (category === 'all' || g.category === category) &&
        matchYearFilter(g.year, year) &&
        (!minRating || (g.rating ?? 0) >= 7),
    );
    return sortGroups(filtered, wd, sort);
  }, [allGroups, adultAllowed, category, year, minRating, sort, wd]);

  const categoryCounts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const g of allGroups) map[g.category] = (map[g.category] || 0) + 1;
    return map;
  }, [allGroups]);

  const allDone = enabled.length > 0 && enabled.every((s) => statuses[s.key] && statuses[s.key].state !== 'loading');
  const anyLoading = enabled.some((s) => statuses[s.key]?.state === 'loading');
  const showSkeleton = enabled.length > 0 && raw.length === 0 && anyLoading;

  const loadMore = async () => {
    if (loadingMore || !wd) return;
    setLoadingMore(true);
    const next = page + 1;
    const statusesNow = useHealth.getState().statuses;
    const results = await Promise.all(
      enabled.map(async (source) => {
        try {
          const r = await searchSource(source, wd, next, { timeoutMs: timeoutForSource(statusesNow[source.key]?.state) });
          return r.list;
        } catch {
          return [] as MediaSummary[];
        }
      }),
    );
    const fresh = results.flat().filter((it) => {
      const key = `${it.sourceKey}:${it.vodId}`;
      if (keysRef.current.has(key)) return false;
      keysRef.current.add(key);
      return true;
    });
    setRaw((prev) => [...prev, ...fresh]);
    setPage(next);
    setLoadingMore(false);
  };

  const progressMap = useMemo(() => {
    const map = new Map<string, { position: number; duration: number }>();
    for (const h of history) map.set(h.id, { position: h.position, duration: h.duration });
    return map;
  }, [history]);

  const hotWords = adultMode
    ? ['伦理片', '人妻', '熟女', '无码', '三级片']
    : ['流浪地球', '庆余年', '三体', '狂飙', '沙丘', '繁花'];

  if (!wd) {
    return (
      <div className="animate-fade-in px-7 py-6">
        <PageHeader
          title={adultMode ? '18+ 专属搜索' : '搜索'}
          subtitle={adultMode ? '仅检索成人内容，与主站搜索记录完全独立' : '聚合多个采集源，按类型、年份、豆瓣评分快速筛选'}
        />
        <div className="surface rounded-2xl p-8">
          <div className="mb-4 text-sm text-[var(--muted)]">
            {adultMode ? '输入关键词，或试试这些：' : '在顶部输入片名开始搜索，试试这些关键词：'}
          </div>
          <div className="flex flex-wrap gap-2">
            {hotWords.map((w) => (
              <button
                key={w}
                className="chip hover:border-[var(--brand)] hover:text-[var(--brand)]"
                onClick={() => navigate(`${adultMode ? '/adult' : '/search'}?wd=${encodeURIComponent(w)}`)}
              >
                {w}
              </button>
            ))}
          </div>
          <HistoryList scope={adultMode ? 'adult' : undefined} />
        </div>
        {!adultMode && <SearchDiscover />}
      </div>
    );
  }

  return (
    <div className="animate-fade-in px-7 py-6">
      <PageHeader
        title={adultMode ? `18+：“${wd}” 的搜索结果` : `“${wd}” 的搜索结果`}
        subtitle={
          allDone
            ? `共 ${groups.length} 部作品 · 来自 ${enabled.length} 个来源`
            : '正在并行搜索各采集源…'
        }
      />

      <div className="surface mb-6 space-y-3 rounded-2xl p-4" data-testid="search-filters">
        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-1 text-xs text-[var(--muted)]">类型</span>
          {CATEGORY_ORDER.map((c) => (
            <button
              key={c}
              className={`chip ${category === c ? 'border-[var(--brand)] text-[var(--brand)]' : ''}`}
              onClick={() => setCategory(c)}
              data-category={c}
            >
              {CATEGORY_LABELS[c]}
              {c !== 'all' && categoryCounts[c] ? <span className="text-[var(--muted)]">{categoryCounts[c]}</span> : null}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-1 text-xs text-[var(--muted)]">年份</span>
          {YEAR_FILTERS.map((f) => (
            <button
              key={f.key}
              className={`chip ${year === f.key ? 'border-[var(--brand)] text-[var(--brand)]' : ''}`}
              onClick={() => setYear(f.key)}
              data-year={f.key}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-1 text-xs text-[var(--muted)]">排序</span>
          {SORT_OPTIONS.map((s) => (
            <button
              key={s.key}
              className={`chip ${sort === s.key ? 'border-[var(--brand)] text-[var(--brand)]' : ''}`}
              onClick={() => setSort(s.key)}
              data-sort={s.key}
            >
              {s.label}
            </button>
          ))}
          <span className="mx-1 h-4 w-px bg-[var(--border)]" />
          <button
            className={`chip ${minRating ? 'border-amber-400/60 text-amber-300' : ''}`}
            onClick={() => setMinRating((v) => !v)}
            data-min-rating={minRating ? '1' : '0'}
          >
            豆瓣 7 分以上
          </button>
          <button className="chip" onClick={() => void loadMore()} disabled={loadingMore || anyLoading}>
            加载更多
          </button>
        </div>
      </div>

      {showSkeleton ? (
        <SkeletonGrid count={18} />
      ) : groups.length === 0 && allDone ? (
        <EmptyState
          icon={<SearchX className="h-6 w-6" />}
          title={raw.length > 0 ? '当前筛选条件下没有结果' : '没有找到相关内容'}
          description={raw.length > 0 ? '试试放宽类型、年份或评分筛选。' : '换个关键词试试，或在设置中添加更多数据源后再搜索。'}
          action={
            raw.length > 0 ? (
              <button
                className="btn btn-ghost mt-2"
                onClick={() => {
                  setCategory('all');
                  setYear('all');
                  setMinRating(false);
                }}
              >
                清除筛选
              </button>
            ) : (
              <button className="btn btn-ghost mt-2" onClick={() => navigate('/settings')}>
                管理数据源
              </button>
            )
          }
        />
      ) : (
        <>
          <div className="grid grid-cols-3 gap-x-4 gap-y-7 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7">
            {groups.map((g: SearchGroup) => (
              <MediaCard
                key={g.key}
                item={{ ...g.primary, rating: g.rating, doubanType: g.doubanType, doubanId: g.doubanId }}
                proxy={proxy}
                sourceCount={g.sourceCount}
                progress={progressMap.get(`${g.primary.sourceKey}:${g.primary.vodId}`)}
              />
            ))}
          </div>
          <div className="mt-9 flex justify-center pb-6">
            <button className="btn btn-ghost px-8" onClick={() => void loadMore()} disabled={loadingMore || anyLoading}>
              {loadingMore ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {loadingMore ? '加载中…' : '加载更多结果'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
