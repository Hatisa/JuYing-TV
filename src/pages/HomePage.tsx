import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, RefreshCw, ServerCrash } from 'lucide-react';
import { Link } from 'react-router-dom';
import DoubanRail from '../components/DoubanRail';
import MediaCard from '../components/MediaCard';
import { EmptyState, ErrorNote, PageHeader, SkeletonGrid } from '../components/States';
import { isAdultMedia } from '../lib/adult';
import { latestFromSource } from '../lib/api';
import { sortByHealth, timeoutForSource } from '../lib/health';
import { interleave } from '../lib/utils';
import { enabledSources, useApp } from '../store/app';
import { useHealth } from '../store/health';
import type { MediaSummary } from '../types';

export default function HomePage() {
  const sources = useApp((s) => s.sources);
  const settings = useApp((s) => s.settings);
  const proxy = useApp((s) => s.proxy);
  const history = useApp((s) => s.history);
  const updateSettings = useApp((s) => s.updateSettings);

  const enabled = useMemo(() => enabledSources(sources), [sources]);
  const active = useMemo(() => {
    if (settings.homeSource !== 'all') {
      const hit = enabled.filter((s) => s.key === settings.homeSource);
      if (hit.length > 0) return hit;
    }
    return enabled;
  }, [enabled, settings.homeSource]);

  const [items, setItems] = useState<MediaSummary[]>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [errors, setErrors] = useState<{ source: string; message: string }[]>([]);
  const [loadedSources, setLoadedSources] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);
  const seenRef = useRef<Set<string>>(new Set());
  const reqRef = useRef(0);

  /** 逐源渲染：哪个源先返回就先显示，避免被慢源/失效源拖住整页 */
  useEffect(() => {
    const id = ++reqRef.current;
    seenRef.current = new Set();
    setItems([]);
    setPage(1);
    setHasMore(true);
    setLoading(true);
    setErrors([]);
    setLoadedSources(0);

    if (active.length === 0) {
      setLoading(false);
      setHasMore(false);
      return;
    }

    const groups = new Map<string, MediaSummary[]>();
    const errs: { source: string; message: string }[] = [];
    let settled = 0;
    const statusesNow = useHealth.getState().statuses;
    // 健康度好的源先请求，首屏内容更早出现
    const ordered = sortByHealth(active, statusesNow);

    ordered.forEach((source) => {
      latestFromSource(source, 1, { timeoutMs: timeoutForSource(statusesNow[source.key]?.state) })
        .then((r) => {
          if (id !== reqRef.current) return;
          groups.set(
            source.key,
            r.list.filter((it) => {
              if (isAdultMedia(it)) return false;
              const key = it.name.replace(/\s+/g, '').toLowerCase();
              if (seenRef.current.has(key)) return false;
              seenRef.current.add(key);
              return true;
            })
          );
          setItems(interleave([...groups.values()]));
          setLoadedSources(groups.size);
        })
        .catch((err: any) => {
          if (id !== reqRef.current) return;
          errs.push({ source: source.name, message: err?.message || '请求失败' });
          setErrors([...errs]);
        })
        .finally(() => {
          if (id !== reqRef.current) return;
          settled += 1;
          setLoadedSources(groups.size);
          if (settled >= active.length) {
            setLoading(false);
            setHasMore(groups.size > 0);
          }
        });
    });
  }, [active, reloadKey]);

  const loadMore = async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    const next = page + 1;
    const errs: { source: string; message: string }[] = [];
    const statusesNow = useHealth.getState().statuses;
    const groups = await Promise.all(
      sortByHealth(active, statusesNow).map(async (source) => {
        try {
          const r = await latestFromSource(source, next, { timeoutMs: timeoutForSource(statusesNow[source.key]?.state) });
          return r.list;
        } catch (err: any) {
          errs.push({ source: source.name, message: err?.message || '请求失败' });
          return [] as MediaSummary[];
        }
      })
    );
    const merged = interleave(groups).filter((it) => {
      if (isAdultMedia(it)) return false;
      const key = it.name.replace(/\s+/g, '').toLowerCase();
      if (seenRef.current.has(key)) return false;
      seenRef.current.add(key);
      return true;
    });
    setItems((prev) => [...prev, ...merged]);
    setPage(next);
    setHasMore(merged.length > 0);
    if (errs.length > 0) setErrors(errs);
    setLoadingMore(false);
  };

  const progressMap = useMemo(() => {
    const map = new Map<string, { position: number; duration: number }>();
    for (const h of history) map.set(h.id, { position: h.position, duration: h.duration });
    return map;
  }, [history]);

  const chips = [{ key: 'all', name: '全部来源' }, ...enabled.map((s) => ({ key: s.key, name: s.name }))];

  return (
    <div className="animate-fade-in px-7 py-6">
      <PageHeader
        title="最近更新"
        subtitle={
          loading
            ? `正在从 ${active.length} 个采集源抓取最新影视资源${loadedSources ? `（已返回 ${loadedSources} 个）` : ''}`
            : `已从 ${active.length} 个采集源聚合到 ${items.length} 部作品`
        }
        right={
          <button className="btn btn-ghost" onClick={() => setReloadKey((k) => k + 1)} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            刷新
          </button>
        }
      />

      <DoubanRail />

      <div className="mb-5 flex flex-wrap items-center gap-2">
        {chips.map((chip) => (
          <button
            key={chip.key}
            onClick={() => updateSettings({ homeSource: chip.key })}
            className={`chip ${settings.homeSource === chip.key ? 'chip-active' : ''}`}
          >
            {chip.name}
          </button>
        ))}
      </div>

      {errors.length > 0 && !loading && (
        <div className="mb-5">
          <ErrorNote message={`${errors.length} 个来源暂时不可用：${errors.map((e) => e.source).join('、')}。可稍后刷新或在设置中检测源状态。`} />
        </div>
      )}

      {loading && items.length === 0 ? (
        <SkeletonGrid count={18} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<ServerCrash className="h-6 w-6" />}
          title="暂时没有拿到内容"
          description="所有启用的采集源都没有返回数据，可能是网络波动或源站暂时不可用。可以刷新重试，或前往设置检查数据源。"
          action={
            <Link to="/settings" className="btn btn-primary mt-2">
              检查数据源
            </Link>
          }
        />
      ) : (
        <>
          <div className="grid grid-cols-3 gap-x-4 gap-y-7 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7">
            {items.map((item) => (
              <MediaCard
                key={`${item.sourceKey}_${item.vodId}`}
                item={item}
                proxy={proxy}
                progress={progressMap.get(`${item.sourceKey}:${item.vodId}`)}
              />
            ))}
          </div>

          <div className="mt-9 flex justify-center pb-6">
            {loading ? (
              <span className="flex items-center gap-2 text-xs text-[var(--muted)]">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> 其余来源加载中…
              </span>
            ) : hasMore ? (
              <button className="btn btn-ghost px-8" onClick={() => void loadMore()} disabled={loadingMore}>
                {loadingMore ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {loadingMore ? '加载中…' : '加载更多'}
              </button>
            ) : (
              <span className="text-xs text-[var(--muted)]">已经到底啦 · 共 {items.length} 部作品</span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
