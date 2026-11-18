import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ChevronLeft, ChevronRight, Heart, ListVideo, Loader2, Monitor, Radio, ServerCrash, SkipForward, Smartphone } from 'lucide-react';
import Player from '../components/Player';
import { EmptyState, Spinner } from '../components/States';
import { resolvePlayable } from '../lib/api';
import { loadDetail } from '../lib/detail-cache';
import { resolvePlaySource, streamType } from '../lib/media';
import { useApp } from '../store/app';
import type { MediaDetail } from '../types';

export default function PlayPage() {
  const { sourceKey = '', vodId = '', lineIndex: lineParam = '0', epIndex: epParam = '0' } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const sources = useApp((s) => s.sources);
  const proxy = useApp((s) => s.proxy);
  const settings = useApp((s) => s.settings);
  const history = useApp((s) => s.history);
  const upsertHistory = useApp((s) => s.upsertHistory);
  const favorites = useApp((s) => s.favorites);
  const toggleFavorite = useApp((s) => s.toggleFavorite);

  const lineIndex = Math.max(0, Number(lineParam) || 0);
  const epIndex = Math.max(0, Number(epParam) || 0);
  const [searchParams, setSearchParams] = useSearchParams();
  const vertical = searchParams.get('vertical') === '1';
  const source = useMemo(() => sources.find((s) => s.key === sourceKey), [sources, sourceKey]);
  const id = `${sourceKey}:${vodId}`;
  const favorite = favorites.some((f) => f.id === id);

  const [detail, setDetail] = useState<MediaDetail | null>(null);
  const [error, setError] = useState('');
  const [playUrl, setPlayUrl] = useState('');
  const [resolving, setResolving] = useState(false);
  const epListRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!source) {
      setError('数据源不存在');
      return;
    }
    let alive = true;
    setError('');
    loadDetail(source, vodId)
      .then((d) => alive && setDetail(d))
      .catch((err: any) => alive && setError(err?.message || '加载失败'));
    return () => {
      alive = false;
    };
  }, [source, vodId]);

  const lines = detail?.line || [];
  const line = lines[lineIndex];
  const episodes = line?.episodes || [];
  const episode = episodes[epIndex];
  const info = detail?.info;

  // 计算真实可播放地址
  useEffect(() => {
    if (!episode?.url) {
      setPlayUrl('');
      return;
    }
    const raw = episode.url;
    const kind = streamType(raw);
    const direct = resolvePlaySource(raw, proxy);
    if (kind !== 'other' || /\.(mkv|avi|rmvb|wmv|mov|ts|m2ts)$/i.test(raw)) {
      setPlayUrl(direct.url);
      return;
    }
    // 中转页 / 未知类型：尝试抓取网页提取 m3u8
    let alive = true;
    setResolving(true);
    setPlayUrl('');
    resolvePlayable(raw)
      .then((resolved) => {
        if (!alive) return;
        setPlayUrl(resolvePlaySource(resolved, proxy).url);
      })
      .finally(() => alive && setResolving(false));
    return () => {
      alive = false;
    };
  }, [episode?.url, proxy]);

  const resume = useMemo(() => {
    const hit = history.find((h) => h.id === id && h.episodeIndex === epIndex && h.lineIndex === lineIndex);
    return hit && settings.rememberProgress ? hit.position : 0;
  }, [history, id, epIndex, lineIndex, settings.rememberProgress]);

  const lastSave = useRef(0);
  const progressRef = useRef({ position: 0, duration: 0 });

  const saveProgress = (force = false) => {
    if (!info || !episode || !settings.rememberProgress) return;
    const { position, duration } = progressRef.current;
    if (!Number.isFinite(position) || position < 3) return;
    const now = Date.now();
    if (!force && now - lastSave.current < 5000) return;
    lastSave.current = now;
    upsertHistory({
      id,
      sourceKey,
      sourceName: source?.name || info.sourceName,
      vodId,
      title: info.title || '未命名',
      cover: info.cover,
      episodeIndex: epIndex,
      episodeName: episode.name || `第 ${epIndex + 1} 集`,
      lineIndex,
      position,
      duration: Number.isFinite(duration) ? duration : 0,
      updatedAt: now,
    });
  };

  useEffect(() => {
    return () => saveProgress(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, epIndex, lineIndex]);

  useEffect(() => {
    const el = epListRef.current?.querySelector('[data-active="true"]') as HTMLElement | null;
    el?.scrollIntoView({ block: 'nearest' });
  }, [epIndex, lineIndex]);

  const go = (nextLine: number, nextEp: number) => {
    saveProgress(true);
    navigate(`/play/${sourceKey}/${vodId}/${nextLine}/${nextEp}${vertical ? '?vertical=1' : ''}`, {
      replace: true,
      state: location.state,
    });
  };

  // 返回上一页：从详情页进入时直接后退（避免把详情页再次压栈导致返回键死循环）；
  // 从短剧/外链直接进入且已有历史时后退，否则用详情页替换当前记录。
  const goBack = () => {
    const fromDetail = Boolean((location.state as { fromDetail?: boolean } | null)?.fromDetail);
    const idx = Number((window.history.state as { idx?: number } | null)?.idx ?? 0);
    if (fromDetail || idx > 0) navigate(-1);
    else navigate('/detail/' + sourceKey + '/' + vodId, { replace: true });
  };

  const hasNext = epIndex + 1 < episodes.length;
  const hasPrev = epIndex > 0;

  if (error) {
    return (
      <div className="px-7 py-6">
        <button className="btn btn-ghost mb-5" onClick={goBack}>
          <ArrowLeft className="h-4 w-4" /> 返回
        </button>
        <EmptyState icon={<ServerCrash className="h-6 w-6" />} title="播放失败" description={error} />
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="grid h-full place-items-center">
        <div className="flex items-center gap-2 text-sm text-[var(--muted)]">
          <Spinner /> 准备播放…
        </div>
      </div>
    );
  }

  const playerBody = resolving ? (
    <div className="grid h-full place-items-center text-sm text-white/70">
      <div className="flex items-center gap-2">
        <Loader2 className="h-5 w-5 animate-spin" /> 正在解析播放地址…
      </div>
    </div>
  ) : playUrl ? (
    <Player
      url={playUrl}
      type={streamType(episode?.url || '') === 'other' ? 'm3u8' : streamType(episode?.url || '')}
      poster={info?.cover}
      autoplay={settings.autoPlay}
      volume={settings.volume}
      rate={settings.playbackRate}
      resumeAt={resume}
      onProgress={(position, duration) => {
        progressRef.current = { position, duration };
        saveProgress();
      }}
      onEnded={() => {
        if (settings.autoNext && hasNext) go(lineIndex, epIndex + 1);
      }}
    />
  ) : (
    <div className="grid h-full place-items-center px-6 text-center text-sm text-white/70">
      <div>
        <div className="mb-2 text-base text-white/90">这个剧集没有可播放的地址</div>
        <div>换一条线路，或回到详情页选择其他来源</div>
      </div>
    </div>
  );

  return (
    <div className="animate-fade-in flex h-full flex-col">

      <div className="flex items-center gap-3 border-b border-[var(--border)] px-5 py-3">
        <button className="btn btn-ghost" onClick={goBack} title="返回上一页">
          <ArrowLeft className="h-4 w-4" /> 返回
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-medium">{info?.title || '未命名'}</div>
          <div className="truncate text-[11px] text-[var(--muted)]">
            {line?.name || `线路 ${lineIndex + 1}`} · {episode?.name || `第 ${epIndex + 1} 集`}
          </div>
        </div>
        <button
          className="btn btn-ghost"
          onClick={() => {
            const next = new URLSearchParams(searchParams);
            if (vertical) next.delete('vertical');
            else next.set('vertical', '1');
            setSearchParams(next, { replace: true });
          }}
          title={vertical ? '切换横屏播放' : '切换竖屏播放'}
        >
          {vertical ? <Monitor className="h-4 w-4" /> : <Smartphone className="h-4 w-4" />}
          {vertical ? '横屏' : '竖屏'}
        </button>
        <button className="btn btn-ghost" onClick={() => info && toggleFavorite({ sourceKey, sourceName: source?.name || info.sourceName, vodId, name: info.title || '', pic: info.cover, typeName: info.typeName, year: info.year, remarks: info.remarks })}>
          <Heart className={`h-4 w-4 ${favorite ? 'fill-rose-400 text-rose-400' : ''}`} />
          {favorite ? '已收藏' : '收藏'}
        </button>
      </div>

      {vertical ? (
        <div className="flex min-h-0 flex-1 flex-col bg-black">
          <div className="grid min-h-0 flex-1 place-items-center overflow-hidden p-2">
            <div
              className="relative h-full max-w-full overflow-hidden rounded-xl bg-black shadow-[0_0_60px_rgba(0,0,0,0.8)]"
              style={{ aspectRatio: '9 / 16' }}
              data-testid="vertical-player"
            >
              {playerBody}
            </div>
          </div>
          <div className="border-t border-white/10 bg-[var(--panel)]">
            <div className="flex items-center gap-2 px-4 pt-2.5">
              <button className="btn btn-ghost" disabled={!hasPrev} onClick={() => go(lineIndex, epIndex - 1)}>
                <ChevronLeft className="h-4 w-4" /> 上一集
              </button>
              <button className="btn btn-ghost" disabled={!hasNext} onClick={() => go(lineIndex, epIndex + 1)}>
                下一集 <ChevronRight className="h-4 w-4" />
              </button>
              <span className="ml-auto truncate text-[11px] text-[var(--muted)]">
                {line?.name || ('线路 ' + (lineIndex + 1))} · {epIndex + 1}/{episodes.length}
              </span>
            </div>
            <div className="no-scrollbar flex gap-1.5 overflow-x-auto px-4 py-2.5">
              {episodes.map((ep, i) => {
                const active = i === epIndex;
                return (
                  <button
                    key={ep.name + '_' + i}
                    data-active={active}
                    onClick={() => go(lineIndex, i)}
                    title={ep.name}
                    className={'shrink-0 rounded-lg border px-2.5 py-1.5 text-[11.5px] transition-colors ' + (active
                      ? 'border-[var(--brand)] bg-[var(--brand-soft)] text-[var(--brand)]'
                      : 'border-[var(--border)] bg-[var(--panel)] hover:text-[var(--brand)]')}
                  >
                    {i + 1}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <div className="flex min-w-0 flex-1 flex-col bg-black">
            <div className="relative flex-1">{playerBody}</div>

            <div className="flex flex-wrap items-center gap-2 border-t border-white/10 bg-[var(--panel)] px-4 py-3">
              <button className="btn btn-ghost" disabled={!hasPrev} onClick={() => go(lineIndex, epIndex - 1)}>
                <ChevronLeft className="h-4 w-4" /> 上一集
              </button>
              <button className="btn btn-ghost" disabled={!hasNext} onClick={() => go(lineIndex, epIndex + 1)}>
                下一集 <ChevronRight className="h-4 w-4" />
              </button>
              {hasNext && (
                <button className="btn btn-ghost" onClick={() => go(lineIndex, Math.min(episodes.length - 1, epIndex + 1))}>
                  <SkipForward className="h-4 w-4" /> 跳过片尾
                </button>
              )}
              <div className="ml-auto flex items-center gap-2 text-[11px] text-[var(--muted)]">
                {settings.rememberProgress && <span className="flex items-center gap-1"><Radio className="h-3 w-3" /> 自动记录进度</span>}
              </div>
            </div>
          </div>

          <aside className="flex w-[280px] shrink-0 flex-col border-l border-[var(--border)] bg-[var(--bg-soft)]">
            <div className="flex items-center gap-2 border-b border-[var(--border)] px-4 py-3 text-[12.5px] font-medium">
              <ListVideo className="h-4 w-4" /> 选集
              <span className="ml-auto text-[11px] font-normal text-[var(--muted)]">{episodes.length} 集</span>
            </div>

            {lines.length > 1 && (
              <div className="flex flex-wrap gap-1.5 border-b border-[var(--border)] px-3 py-2.5">
                {lines.map((l, i) => (
                  <button
                    key={l.name + '_' + i}
                    onClick={() => go(i, Math.min(epIndex, l.episodes.length - 1))}
                    className={'chip text-[11px] ' + (i === lineIndex ? 'chip-active' : '')}
                    title={l.name + ' · ' + l.episodes.length + ' 集'}
                  >
                    {l.name || ('线路 ' + (i + 1))}
                  </button>
                ))}
              </div>
            )}

            <div ref={epListRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
              <div className="grid grid-cols-3 gap-1.5">
                {episodes.map((ep, i) => {
                  const active = i === epIndex;
                  const watched = history.some((h) => h.id === id && h.lineIndex === lineIndex && h.episodeIndex === i);
                  return (
                    <button
                      key={ep.name + '_' + i}
                      data-active={active}
                      onClick={() => go(lineIndex, i)}
                      title={ep.name}
                      className={'truncate rounded-lg border px-1 py-2 text-[11.5px] transition-colors ' + (active
                        ? 'border-[var(--brand)] bg-[var(--brand-soft)] text-[var(--brand)]'
                        : watched
                          ? 'border-[var(--border)] bg-[var(--panel)] text-[var(--muted)]'
                          : 'border-[var(--border)] bg-[var(--panel)] hover:border-[var(--border-strong)] hover:text-[var(--brand)]')}
                    >
                      {ep.name || ('第 ' + (i + 1) + ' 集')}
                    </button>
                  );
                })}
              </div>
            </div>

            {info?.desc && (
              <div className="max-h-[150px] overflow-y-auto border-t border-[var(--border)] px-4 py-3 text-[11.5px] leading-relaxed text-[var(--muted)]">
                {info.desc}
              </div>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
