import { useEffect, useMemo, useState } from 'react';
import { Loader2, Radio, RefreshCw, Search, Tv } from 'lucide-react';
import Player from '../components/Player';
import { EmptyState, PageHeader } from '../components/States';
import { api } from '../lib/bridge';
import { proxyMedia, streamType } from '../lib/media';
import { parseM3U, type LiveChannel } from '../lib/m3u';
import { enabledLiveSources, useApp } from '../store/app';

export default function LivePage() {
  const liveSources = useApp((s) => s.liveSources);
  const proxy = useApp((s) => s.proxy);
  const enabled = useMemo(() => enabledLiveSources(liveSources), [liveSources]);

  const [sourceKey, setSourceKey] = useState('');
  const activeKey = sourceKey || enabled[0]?.key || '';
  const source = enabled.find((s) => s.key === activeKey);

  const [channels, setChannels] = useState<LiveChannel[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState('全部');
  const [current, setCurrent] = useState<LiveChannel | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!source) {
      setChannels([]);
      return;
    }
    let alive = true;
    setLoading(true);
    setError('');
    api.net
      .text({ url: source.url, timeoutMs: 30000 })
      .then((res) => {
        if (!alive) return;
        if (!res.ok || !res.text) throw new Error(res.error || '直播源读取失败');
        const list = parseM3U(res.text);
        setChannels(list);
        setCurrent(list[0] || null);
        setGroup('全部');
      })
      .catch((err: any) => alive && setError(err?.message || '直播源加载失败'))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [source, reloadKey]);

  const groups = useMemo(() => {
    const set = new Set<string>();
    for (const c of channels) set.add(c.group);
    return ['全部', ...Array.from(set)];
  }, [channels]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return channels.filter((c) => (group === '全部' || c.group === group) && (!q || c.name.toLowerCase().includes(q)));
  }, [channels, group, query]);

  const playing = current || filtered[0] || null;
  const playUrl = playing ? (streamType(playing.url) === 'm3u8' || streamType(playing.url) === 'flv' ? proxyMedia(playing.url, proxy) : playing.url) : '';

  return (
    <div className="animate-fade-in flex h-full flex-col">
      <div className="px-6 pt-5">
        <PageHeader
          title="电视直播"
          subtitle={`${enabled.length} 个直播源 · ${channels.length} 个频道`}
          right={
            <button className="btn btn-ghost" onClick={() => setReloadKey((k) => k + 1)} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} 刷新频道
            </button>
          }
        />
        <div className="mb-4 flex flex-wrap gap-2">
          {enabled.map((s) => (
            <button
              key={s.key}
              className={`chip ${s.key === activeKey ? 'chip-active' : ''}`}
              onClick={() => {
                setSourceKey(s.key);
                setQuery('');
              }}
            >
              {s.name}
            </button>
          ))}
          {enabled.length === 0 && <span className="text-[12px] text-[var(--muted)]">还没有启用的直播源，去设置里添加吧</span>}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 gap-4 px-6 pb-5">
        <aside className="flex w-[300px] shrink-0 flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel)]">
          <div className="border-b border-[var(--border)] p-2.5">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--muted)]" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索频道"
                className="input h-8 w-full pl-8 text-[12px]"
              />
            </div>
            <div className="mt-2 flex gap-1 overflow-x-auto pb-0.5">
              {groups.slice(0, 12).map((g) => (
                <button key={g} onClick={() => setGroup(g)} className={`chip shrink-0 text-[11px] ${group === g ? 'chip-active' : ''}`}>
                  {g}
                </button>
              ))}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
            {loading ? (
              <div className="grid h-full place-items-center text-[12px] text-[var(--muted)]">
                <div className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" /> 加载频道…
                </div>
              </div>
            ) : filtered.length === 0 ? (
              <div className="grid h-full place-items-center px-4 text-center text-[12px] text-[var(--muted)]">
                没有匹配的频道
              </div>
            ) : (
              filtered.map((c) => {
                const active = playing?.id === c.id;
                return (
                  <button
                    key={c.id}
                    data-channel={c.id}
                    onClick={() => setCurrent(c)}
                    className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-[12.5px] transition-colors ${
                      active ? 'bg-[var(--brand-soft)] text-[var(--brand)]' : 'text-[var(--text)] hover:bg-[var(--panel-2)]'
                    }`}
                  >
                    <span className={`grid h-5 w-5 shrink-0 place-items-center rounded ${active ? 'bg-[var(--brand)] text-white' : 'bg-[var(--panel-2)] text-[var(--muted)]'}`}>
                      <Tv className="h-3 w-3" />
                    </span>
                    <span className="truncate">{c.name}</span>
                    {active && <span className="ml-auto text-[10px]">播放中</span>}
                  </button>
                );
              })
            )}
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-black">
          {error ? (
            <div className="grid h-full place-items-center px-6 text-center text-[12.5px] text-white/70">{error}</div>
          ) : playUrl ? (
            <Player key={playUrl} url={playUrl} type={streamType(playing!.url) === 'flv' ? 'flv' : 'm3u8'} autoplay />
          ) : (
            <div className="grid h-full place-items-center text-[12.5px] text-white/60">
              {loading ? '正在加载频道…' : '选择一个频道开始观看'}
            </div>
          )}
          {playing && (
            <div className="flex items-center gap-2 border-t border-white/10 px-4 py-2.5 text-[12px] text-white/80">
              <Radio className="h-3.5 w-3.5 text-[var(--brand)]" />
              <span className="truncate">{playing.name}</span>
              <span className="ml-auto truncate text-[10.5px] text-white/40">{playing.group}</span>
            </div>
          )}
        </div>
      </div>

      {!loading && !error && channels.length === 0 && enabled.length > 0 && (
        <div className="px-6 pb-6">
          <EmptyState
            icon={<Radio className="h-6 w-6" />}
            title="直播源里没有频道"
            description="该 M3U 订阅可能已失效，换一个直播源试试。"
          />
        </div>
      )}
    </div>
  );
}
