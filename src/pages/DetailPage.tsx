import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Heart, Loader2, Lock, Play, RefreshCw, ServerCrash, Star, Tv } from 'lucide-react';
import { EmptyState, ErrorNote, Spinner } from '../components/States';
import { api } from '../lib/bridge';
import { isAdultMedia } from '../lib/adult';
import { loadDetail, peekDetail } from '../lib/detail-cache';
import { coverUrl } from '../lib/media';
import { useApp } from '../store/app';
import type { MediaDetail, MediaSummary } from '../types';

export default function DetailPage() {
  const { sourceKey = '', vodId = '' } = useParams();
  const navigate = useNavigate();
  const sources = useApp((s) => s.sources);
  const proxy = useApp((s) => s.proxy);
  const favorites = useApp((s) => s.favorites);
  const toggleFavorite = useApp((s) => s.toggleFavorite);
  const history = useApp((s) => s.history);
  const adult18 = useApp((s) => s.settings.adult18);

  const source = useMemo(() => sources.find((s) => s.key === sourceKey), [sources, sourceKey]);
  const id = `${sourceKey}:${vodId}`;
  const favorite = favorites.some((f) => f.id === id);
  const resume = useMemo(() => history.find((h) => h.id === id), [history, id]);

  const [detail, setDetail] = useState<MediaDetail | undefined>(() => peekDetail(sourceKey, vodId));
  const [lineIndex, setLineIndex] = useState(0);
  const [loading, setLoading] = useState(!detail);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [rating, setRating] = useState<number | undefined>();
  const [doubanId, setDoubanId] = useState<string | undefined>();

  useEffect(() => {
    if (!source || !vodId) {
      setLoading(false);
      setError('找不到对应的数据源，可能已被删除');
      return;
    }
    let alive = true;
    setLoading(true);
    setError('');
    loadDetail(source, vodId, reloadKey > 0)
      .then((d) => {
        if (!alive) return;
        setDetail(d);
        setLineIndex(0);
      })
      .catch((err: any) => alive && setError(err?.message || '详情加载失败'))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [source, vodId, reloadKey]);

  const info = detail?.info;
  const title = info?.title;
  const lines = detail?.line || [];
  const episodes = lines[lineIndex]?.episodes || [];

  const summary: MediaSummary | null = info
    ? {
        sourceKey,
        sourceName: source?.name || info.sourceName,
        vodId,
        name: info.title || '未命名',
        pic: info.cover,
        typeName: info.typeName,
        year: info.year,
        area: info.area,
        remarks: info.remarks,
      }
    : null;

  useEffect(() => {
    if (!title) return;
    let alive = true;
    api.douban
      .ratings([title])
      .then((res) => {
        if (!alive) return;
        const hit = res[title];
        setRating(hit?.rating);
        setDoubanId(hit?.id);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [title]);

  const adultBlocked = Boolean(summary && !adult18 && isAdultMedia(summary));

  const play = (epIndex: number) => {
    if (!summary) return;
    navigate(`/play/${sourceKey}/${vodId}/${lineIndex}/${epIndex}`, { state: { fromDetail: true } });
  };

  if (loading && !detail) {
    return (
      <div className="grid h-full place-items-center">
        <div className="flex items-center gap-2 text-sm text-[var(--muted)]">
          <Spinner /> 正在读取影片详情…
        </div>
      </div>
    );
  }

  if (error && !detail) {
    return (
      <div className="px-7 py-6">
        <button className="btn btn-ghost mb-5" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-4 w-4" /> 返回
        </button>
        <EmptyState
          icon={<ServerCrash className="h-6 w-6" />}
          title="详情加载失败"
          description={error}
          action={
            <button className="btn btn-primary mt-2" onClick={() => setReloadKey((k) => k + 1)}>
              <RefreshCw className="h-4 w-4" /> 重试
            </button>
          }
        />
      </div>
    );
  }

  if (adultBlocked) {
    return (
      <div className="grid h-full place-items-center px-8">
        <div className="surface max-w-md rounded-2xl p-8 text-center">
          <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-rose-500/10 text-rose-400">
            <Lock className="h-6 w-6" />
          </div>
          <h1 className="text-lg font-semibold">该内容已隐藏</h1>
          <p className="mt-2 text-[13px] leading-relaxed text-[var(--muted)]">
            这部作品属于成人/伦理分类。如需浏览，请先在设置中开启 18+ 频道。
          </p>
          <div className="mt-5 flex justify-center gap-2">
            <button className="btn btn-ghost" onClick={() => navigate(-1)}>
              返回
            </button>
            <Link to="/settings" className="btn btn-primary">
              去设置
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade-in pb-10">
      <div className="relative h-[260px] w-full overflow-hidden">
        {info?.cover && (
          <img src={coverUrl(info.cover, proxy, 360)} alt="" className="h-full w-full scale-110 object-cover opacity-30 blur-2xl" loading="lazy" decoding="async" />
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[var(--bg)]/40 to-[var(--bg)]" />
        <button className="btn btn-ghost absolute left-6 top-5 bg-black/30 backdrop-blur" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-4 w-4" /> 返回
        </button>
      </div>

      <div className="relative -mt-[190px] px-7">
        <div className="flex gap-7">
          <div className="w-[190px] shrink-0">
            <div className="aspect-[2/3] overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--panel-2)] shadow-2xl">
              {info?.cover ? (
                <img src={coverUrl(info.cover, proxy, 720)} alt={info.title} className="h-full w-full object-cover" decoding="async" />
              ) : (
                <div className="grid h-full place-items-center text-[var(--muted)]">
                  <Tv className="h-9 w-9 opacity-40" />
                </div>
              )}
            </div>
          </div>

          <div className="min-w-0 flex-1 pt-[190px]">
            <div className="flex flex-wrap items-center gap-2">
              <span className="chip">{info?.sourceName || source?.name}</span>
              {info?.typeName && <span className="chip">{info.typeName}</span>}
              {info?.year && <span className="chip">{info.year}</span>}
              {info?.area && <span className="chip">{info.area}</span>}
              {info?.remarks && <span className="chip chip-active">{info.remarks}</span>}
              {rating != null && (
                <span
                  className="flex items-center gap-1 rounded-full border border-amber-400/40 bg-amber-400/10 px-2.5 py-1 text-[12px] font-semibold text-amber-300"
                  data-douban-rating={rating}
                  title={doubanId ? `豆瓣条目 ${doubanId}` : '豆瓣评分'}
                >
                  <Star className="h-3.5 w-3.5 fill-amber-300" /> {rating.toFixed(1)}
                  <span className="text-[10px] font-normal text-amber-200/70">豆瓣</span>
                </span>
              )}
            </div>

            <h1 className="mt-3 text-[28px] font-semibold leading-tight tracking-tight">{info?.title}</h1>

            {(info?.director || info?.actor) && (
              <div className="mt-2 space-y-1 text-[12.5px] text-[var(--muted)]">
                {info?.director && <div>导演：{info.director}</div>}
                {info?.actor && <div className="line-2">主演：{info.actor}</div>}
              </div>
            )}

            <div className="mt-5 flex flex-wrap items-center gap-2.5">
              <button className="btn btn-primary px-6" onClick={() => play(resume?.episodeIndex ?? 0)} disabled={episodes.length === 0}>
                <Play className="h-4 w-4 fill-white" />
                {resume ? `继续观看 · ${resume.episodeName}` : '立即播放'}
              </button>
              {summary && (
                <button className="btn btn-ghost" onClick={() => toggleFavorite(summary)}>
                  <Heart className={`h-4 w-4 ${favorite ? 'fill-rose-400 text-rose-400' : ''}`} />
                  {favorite ? '已收藏' : '收藏'}
                </button>
              )}
              <button className="btn btn-ghost" onClick={() => setReloadKey((k) => k + 1)} disabled={loading}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                刷新
              </button>
            </div>

            {info?.desc && (
              <p data-testid="detail-desc" className="mt-5 max-w-3xl text-[12.5px] leading-relaxed text-[var(--muted)] line-clamp-4">{info.desc}</p>
            )}
          </div>
        </div>

        {error && (
          <div className="mt-6">
            <ErrorNote message={error} />
          </div>
        )}

        <div className="mt-9">
          <div className="mb-3 flex items-center gap-2">
            <h2 className="text-[15px] font-semibold">播放列表</h2>
            <span className="text-[11px] text-[var(--muted)]">
              {lines.length} 条线路 · {episodes.length} 个剧集
            </span>
          </div>

          {lines.length === 0 ? (
            <EmptyState title="没有可用的播放地址" description="该资源可能已失效，换个来源试试。" />
          ) : (
            <>
              <div className="mb-4 flex flex-wrap gap-2">
                {lines.map((line, i) => (
                  <button
                    key={`${line.name}_${i}`}
                    className={`chip ${i === lineIndex ? 'chip-active' : ''}`}
                    onClick={() => setLineIndex(i)}
                  >
                    <Star className={`h-3 w-3 ${i === 0 ? 'fill-current' : ''}`} />
                    {line.name || `线路 ${i + 1}`}
                    <span className="text-[10px] opacity-60">{line.episodes.length}</span>
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 2xl:grid-cols-12">
                {episodes.map((ep, i) => {
                  const active = resume && resume.lineIndex === lineIndex && resume.episodeIndex === i;
                  return (
                    <button
                      key={`${ep.name}_${i}`}
                      data-episode={i}
                      onClick={() => play(i)}
                      title={ep.name}
                      className={`truncate rounded-lg border px-2 py-2 text-[12px] transition-colors ${
                        active
                          ? 'border-[var(--brand)] bg-[var(--brand-soft)] text-[var(--brand)]'
                          : 'border-[var(--border)] bg-[var(--panel)] text-[var(--text)] hover:border-[var(--border-strong)] hover:text-[var(--brand)]'
                      }`}
                    >
                      {ep.name || `第 ${i + 1} 集`}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>

        <div className="mt-10 flex items-center gap-2 text-[11px] text-[var(--muted)]">
          <span>内容来自第三方采集源</span>
          {source && <span className="opacity-60">· {source.url}</span>}
          <Link to="/settings" className="ml-2 underline-offset-2 hover:underline">
            管理数据源
          </Link>
        </div>
      </div>
    </div>
  );
}
