import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Clapperboard, Loader2, Play, RefreshCw, Search } from 'lucide-react';
import MediaCard from '../components/MediaCard';
import { EmptyState, PageHeader } from '../components/States';
import { isAdultMedia } from '../lib/adult';
import { latestFromSource, searchSource } from '../lib/api';
import { CATEGORY_LABELS, categoryOf } from '../lib/categories';
import { coverUrl } from '../lib/media';
import { timeoutForSource } from '../lib/health';
import { buildGroups } from '../lib/rank';
import type { SearchGroup } from '../lib/rank';
import { enabledSources, useApp } from '../store/app';
import { useHealth } from '../store/health';
import type { MediaSummary } from '../types';

const THEMES = ['全部', '都市', '逆袭', '甜宠', '古装', '悬疑', '战神', '家庭'];

function looksShort(item: MediaSummary): boolean {
  const category = categoryOf(item.typeName);
  if (category === 'short') return true;
  if (category === 'variety') return false;
  return /短剧|微短剧|竖屏|爽剧/.test(item.name) || /短剧/.test(item.remarks || '');
}

export default function ShortsPage() {
  const navigate = useNavigate();
  const sources = useApp((s) => s.sources);
  const proxy = useApp((s) => s.proxy);
  const enabled = useMemo(() => enabledSources(sources), [sources]);
  const enabledKey = enabled.map((s) => s.key).join(',');
  const statuses = useHealth((s) => s.statuses);

  const [items, setItems] = useState<MediaSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [wd, setWd] = useState('');
  const [theme, setTheme] = useState('全部');
  const [reloadKey, setReloadKey] = useState(0);
  const reqRef = useRef(0);

  useEffect(() => {
    const id = ++reqRef.current;
    setLoading(true);
    setItems([]);
    const term = wd || (theme !== '全部' ? theme + ' 短剧' : '短剧');
    const opts = (key: string) => ({ timeoutMs: timeoutForSource(statuses[key]?.state) });

    const run = async () => {
      try {
        if (!wd && theme === '全部') {
          // 先看各源最新更新里的短剧，数量不足再回退到「短剧」关键词搜索
          const latest = await Promise.all(
            enabled.map((s) => latestFromSource(s, 1, opts(s.key)).catch(() => null)),
          );
          let list = latest.flatMap((r) => r?.list ?? []).filter((it) => !isAdultMedia(it) && looksShort(it));
          if (list.length < 8) {
            const searched = await Promise.all(
              enabled.map((s) => searchSource(s, '短剧', 1, opts(s.key)).catch(() => null)),
            );
            list = list.concat(searched.flatMap((r) => r?.list ?? []).filter((it) => !isAdultMedia(it) && looksShort(it)));
          }
          if (id === reqRef.current) setItems(list);
        } else {
          const searched = await Promise.all(
            enabled.map((s) => searchSource(s, term, 1, opts(s.key)).catch(() => null)),
          );
          const list = searched.flatMap((r) => r?.list ?? []).filter((it) => !isAdultMedia(it));
          if (id === reqRef.current) setItems(list);
        }
      } finally {
        if (id === reqRef.current) setLoading(false);
      }
    };
    void run();
  }, [enabledKey, wd, theme, reloadKey]);

  const groups = useMemo(() => buildGroups(items), [items]);
  const spotlight = groups.slice(0, 8);

  const quickPlay = (group: SearchGroup) => {
    const item = group.primary;
    navigate(`/play/${item.sourceKey}/${item.vodId}/0/0?vertical=1`);
  };

  return (
    <div className="animate-fade-in flex h-full min-h-0 flex-col px-7 py-6">
      <PageHeader
        title="短剧"
        subtitle="多源聚合短剧，竖屏刷剧、自动连播"
        right={
          <button className="btn btn-ghost" onClick={() => setReloadKey((k) => k + 1)} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            刷新
          </button>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto pb-2">
          <div className="surface mb-5 rounded-2xl p-4" data-testid="shorts-search">
            <form
              className="flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                setWd(query.trim());
                setTheme('全部');
              }}
            >
              <div className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--panel-2)] px-3">
                <Search className="h-4 w-4 text-[var(--muted)]" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="搜短剧、演员或题材，如：逆袭"
                  className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-[var(--muted)]"
                />
                {query && (
                  <button type="button" className="text-[11px] text-[var(--muted)] hover:text-[var(--text)]" onClick={() => { setQuery(''); setWd(''); }}>
                    清空
                  </button>
                )}
              </div>
              <button type="submit" className="btn btn-primary h-10 px-5">
                搜短剧
              </button>
            </form>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="mr-1 text-xs text-[var(--muted)]">题材</span>
              {THEMES.map((t) => (
                <button
                  key={t}
                  className={`chip ${theme === t && !wd ? 'border-[var(--brand)] text-[var(--brand)]' : ''}`}
                  onClick={() => {
                    setWd('');
                    setQuery('');
                    setTheme(t);
                  }}
                >
                  {t}
                </button>
              ))}
              {wd && (
                <span className="chip border-[var(--brand)] text-[var(--brand)]">
                  搜索：{wd}
                  <button className="ml-1 text-[var(--muted)] hover:text-[var(--text)]" onClick={() => { setWd(''); setQuery(''); }}>
                    ×
                  </button>
                </span>
              )}
            </div>
          </div>

          {loading ? (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="aspect-[9/16] animate-pulse rounded-2xl bg-[var(--panel-2)]" />
              ))}
            </div>
          ) : groups.length === 0 ? (
            <EmptyState
              icon={<Clapperboard className="h-6 w-6" />}
              title="暂时没有短剧内容"
              description="换一个题材或关键词试试，短剧片库会随各采集源更新。"
            />
          ) : (
            <>
              <section className="mb-8">
                <div className="mb-3 flex items-end justify-between">
                  <div>
                    <h2 className="text-[15px] font-semibold">沉浸式刷剧</h2>
                    <p className="mt-0.5 text-xs text-[var(--muted)]">点击即从第一集开始竖屏播放，右侧选集可连续追剧</p>
                  </div>
                  <span className="text-xs text-[var(--muted)]">共 {groups.length} 部</span>
                </div>
                <div className="no-scrollbar -mx-1 flex snap-x gap-4 overflow-x-auto px-1 pb-2" data-testid="shorts-feed">
                  {spotlight.map((g) => (
                    <div
                      key={g.key}
                      className="group relative h-[380px] w-[214px] shrink-0 snap-start overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--panel-2)]"
                    >
                      {g.primary.pic ? (
                        <img
                          src={coverUrl(g.primary.pic, proxy, 480)}
                          alt={g.title}
                          loading="lazy"
                          decoding="async"
                          className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
                        />
                      ) : (
                        <div className="grid h-full w-full place-items-center text-[var(--muted)]">
                          <Clapperboard className="h-10 w-10 opacity-40" />
                        </div>
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-black/10" />
                      <div className="absolute inset-x-0 top-0 flex items-center justify-between p-3">
                        <span className="rounded-md bg-black/55 px-1.5 py-0.5 text-[10px] font-medium text-white/90 backdrop-blur">
                          {CATEGORY_LABELS[g.category] === '短剧' ? '短剧' : g.primary.typeName || '短剧'}
                        </span>
                        {g.rating ? (
                          <span className="rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-bold text-amber-300">★ {g.rating.toFixed(1)}</span>
                        ) : null}
                      </div>
                      <div className="absolute inset-x-0 bottom-0 p-3.5">
                        <h3 className="line-2 text-[16px] font-semibold leading-tight text-white drop-shadow">{g.title}</h3>
                        <div className="mt-1 truncate text-[11px] text-white/70">
                          {[g.primary.remarks, g.year, g.primary.sourceName].filter(Boolean).join(' · ')}
                        </div>
                        <div className="mt-3 flex items-center gap-2">
                          <button
                            className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg bg-white text-[12px] font-semibold text-black transition hover:bg-white/90"
                            onClick={() => quickPlay(g)}
                          >
                            <Play className="h-3.5 w-3.5 fill-black" /> 立即播放
                          </button>
                          <button
                            className="flex h-9 items-center justify-center rounded-lg bg-white/15 px-3 text-[12px] text-white backdrop-blur transition hover:bg-white/25"
                            onClick={() => navigate(`/detail/${g.primary.sourceKey}/${g.primary.vodId}`)}
                          >
                            详情
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section>
                <h2 className="mb-3 text-[15px] font-semibold">全部短剧</h2>
                <div className="grid grid-cols-3 gap-x-4 gap-y-7 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7">
                  {groups.map((g) => (
                    <MediaCard key={g.key} item={g.primary} proxy={proxy} sourceCount={g.sourceCount} />
                  ))}
                </div>
              </section>
            </>
          )}
      </div>
    </div>
  );
}
