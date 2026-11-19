import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Flame, Loader2, RefreshCw } from 'lucide-react';
import MediaCard from './MediaCard';
import { isAdultMedia } from '../lib/adult';
import { searchSource } from '../lib/api';
import { relativeTime } from '../lib/format';
import { sortByHealth, timeoutForSource } from '../lib/health';
import { buildGroups } from '../lib/rank';
import type { SearchGroup } from '../lib/rank';
import { enabledSources, useApp } from '../store/app';
import { useHealth } from '../store/health';
import type { MediaSummary } from '../types';

/** 成人片库的关键词入口；不同采集源的分类词不完全一致，轮换覆盖 */
const HOT_WORDS = ['伦理片', '人妻', '熟女', '无码', '三级片', '情色'];
const WORDS_PER_BATCH = 3;
const SOURCE_LIMIT = 6;
const CONCURRENCY = 4;
const CACHE_TTL = 3 * 60_000;
const MAX_CARDS = 18;

interface BatchCache {
  key: string;
  at: number;
  items: MediaSummary[];
}

/** 模块级缓存：在 18+ 频道内切换批次或返回页面时避免重复打接口 */
const batchCache = new Map<string, BatchCache>();

function scoreGroup(group: SearchGroup): number {
  const year = parseInt(group.year || '', 10) || 0;
  const recent = year >= 2024 ? 24 : year >= 2022 ? 14 : year >= 2020 ? 6 : 0;
  return group.sourceCount * 15 + recent + (group.rating ?? 0) * 4;
}

function wordsOf(batch: number): string[] {
  const start = (batch * WORDS_PER_BATCH) % HOT_WORDS.length;
  return Array.from({ length: WORDS_PER_BATCH }, (_, i) => HOT_WORDS[(start + i) % HOT_WORDS.length]);
}

/** 按固定并发跑任务，避免一次打满所有采集源 */
async function runLimited<T>(tasks: (() => Promise<T>)[], limit: number): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (next < tasks.length) {
      const index = next++;
      try {
        await tasks[index]();
      } catch {
        // 单个源/关键词失败不影响其余结果
      }
    }
  });
  await Promise.all(workers);
}

function useAdultPool(batch: number) {
  const sources = useApp((s) => s.sources);
  const enabled = useMemo(() => enabledSources(sources), [sources]);
  const enabledKey = enabled.map((s) => s.key).join(',');
  const enabledRef = useRef(enabled);
  const seq = useRef(0);
  const words = useMemo(() => wordsOf(batch), [batch]);
  const cacheKey = enabledKey + '|' + words.join(',');

  const [pool, setPool] = useState<MediaSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState(0);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  const fetchBatch = useCallback(() => {
    const id = ++seq.current;
    const cached = batchCache.get(cacheKey);
    if (cached) {
      setPool(cached.items);
      setUpdatedAt(cached.at);
      setLoading(false);
      return;
    }

    setPool([]);
    setUpdatedAt(0);
    setLoading(true);
    const statuses = useHealth.getState().statuses;
    const ordered = sortByHealth(enabledRef.current, statuses).slice(0, SOURCE_LIMIT);
    let collected: MediaSummary[] = [];
    let adultCount = 0;

    const tasks: (() => Promise<void>)[] = [];
    for (const source of ordered) {
      for (const word of words) {
        tasks.push(async () => {
          const result = await searchSource(source, word, 1, {
            timeoutMs: timeoutForSource(statuses[source.key]?.state),
          });
          if (id !== seq.current) return;
          const adult = result.list.filter((item) => isAdultMedia(item));
          if (adult.length > 0) {
            adultCount += adult.length;
            collected = collected.concat(adult);
            // 渐进展示：哪个源先回，就先出现对应的卡片
            setPool(collected.slice());
          }
        });
      }
    }

    void runLimited(tasks, CONCURRENCY).then(() => {
      if (id !== seq.current) return;
      const final = collected.slice();
      if (adultCount > 0) batchCache.set(cacheKey, { key: cacheKey, at: Date.now(), items: final });
      setPool(final);
      setUpdatedAt(Date.now());
      setLoading(false);
    });
  }, [cacheKey, words]);

  useEffect(() => {
    fetchBatch();
  }, [fetchBatch]);

  return { pool, loading, updatedAt, words, refresh: fetchBatch };
}

export default function AdultDiscover() {
  const proxy = useApp((s) => s.proxy);
  const [batch, setBatch] = useState(0);
  const { pool, loading, updatedAt, words, refresh } = useAdultPool(batch);

  const groups = useMemo(() => {
    const grouped = buildGroups(pool.filter((item) => isAdultMedia(item)));
    return grouped
      .sort((a, b) => scoreGroup(b) - scoreGroup(a) || b.sourceCount - a.sourceCount)
      .slice(0, MAX_CARDS);
  }, [pool]);

  const nextBatch = () => {
    setBatch((value) => (value + 1) % Math.ceil(HOT_WORDS.length / WORDS_PER_BATCH));
  };

  return (
    <section className="surface mt-4 rounded-2xl p-5" data-testid="adult-discover">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-[var(--brand-soft)] text-[var(--brand)]">
            <Flame className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-[15px] font-semibold">18+ 热门推荐</h2>
            <p className="mt-0.5 text-xs text-[var(--muted)]">
              {updatedAt
                ? `汇总健康源「${words.join(' / ')}」· 更新于 ${relativeTime(updatedAt)}`
                : `正在检索「${words.join(' / ')}」…`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden text-[11px] text-[var(--muted)] sm:block">仅展示已开启的采集源</span>
          <button
            className="btn btn-ghost h-8 px-3 text-[12px]"
            data-testid="adult-discover-refresh"
            onClick={nextBatch}
            disabled={loading}
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            换一批
          </button>
        </div>
      </div>

      {groups.length === 0 ? (
        <div className="mt-4 rounded-xl bg-[var(--panel-2)] px-4 py-9 text-center text-xs text-[var(--muted)]">
          {loading ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              正在从健康采集源汇总推荐…
            </span>
          ) : (
            <div className="space-y-2">
              <div>暂时没有汇总到 18+ 影片，可以试试上方的热词搜索。</div>
              <button className="btn btn-ghost h-8 px-3 text-[12px]" onClick={refresh}>
                重新检索
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-3 gap-x-4 gap-y-6 sm:grid-cols-4 lg:grid-cols-6">
          {groups.map((group) => (
            <MediaCard key={group.key} item={group.primary} proxy={proxy} sourceCount={group.sourceCount} />
          ))}
        </div>
      )}

      {groups.length > 0 && (
        <p className="mt-4 text-[11px] leading-relaxed text-[var(--muted)]">
          推荐来自公开采集源的分类与片名匹配，可能随源站更新变化；内容仅面向成年人，请遵守所在地法律法规。
        </p>
      )}
    </section>
  );
}
