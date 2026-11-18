import { useMemo, useState } from 'react';
import { Check, Clock3, Pencil, Play, Trash2, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { EmptyState, PageHeader } from '../components/States';
import { formatDuration, progressPercent, relativeTime } from '../lib/format';
import { coverUrl } from '../lib/media';
import { useApp } from '../store/app';

export default function HistoryPage() {
  const history = useApp((s) => s.history);
  const proxy = useApp((s) => s.proxy);
  const removeHistory = useApp((s) => s.removeHistory);
  const clearHistory = useApp((s) => s.clearHistory);
  const renameHistory = useApp((s) => s.renameHistory);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const commit = (id: string) => {
    if (draft.trim()) renameHistory(id, draft);
    setEditing(null);
  };

  /** 同一部剧只展示最近观看的一集 */
  const rows = useMemo(() => {
    const map = new Map<string, (typeof history)[number]>();
    for (const h of history) {
      const prev = map.get(h.id);
      if (!prev || prev.updatedAt < h.updatedAt) map.set(h.id, h);
    }
    return Array.from(map.values()).sort((a, b) => b.updatedAt - a.updatedAt);
  }, [history]);

  return (
    <div className="animate-fade-in px-7 py-6">
      <PageHeader
        title="观看历史"
        subtitle={`最近观看 ${rows.length} 部作品 · 共 ${history.length} 条记录`}
        right={
          rows.length > 0 ? (
            <button
              className="btn btn-ghost"
              onClick={() => {
                if (window.confirm('确定要清空全部观看记录吗？')) clearHistory();
              }}
            >
              <Trash2 className="h-4 w-4" /> 清空记录
            </button>
          ) : undefined
        }
      />

      {rows.length === 0 ? (
        <EmptyState
          icon={<Clock3 className="h-6 w-6" />}
          title="还没有观看记录"
          description="播放过的内容会自动出现在这里，方便下次接着看。"
          action={
            <Link to="/" className="btn btn-primary mt-2">
              开始观看
            </Link>
          }
        />
      ) : (
        <div className="space-y-2.5">
          {rows.map((h) => {
            const percent = progressPercent(h.position, h.duration);
            return (
              <div
                key={h.id}
                className="group flex items-center gap-4 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-2.5 transition-colors hover:border-[var(--border-strong)]"
              >
                <Link to={`/detail/${h.sourceKey}/${h.vodId}`} className="relative h-[70px] w-[50px] shrink-0 overflow-hidden rounded-lg bg-[var(--panel-2)]">
                  {h.cover ? (
                    <img src={coverUrl(h.cover, proxy, 240)} alt={h.title} className="h-full w-full object-cover" loading="lazy" decoding="async" width={96} height={144} />
                  ) : (
                    <div className="grid h-full place-items-center text-[var(--muted)]">
                      <Clock3 className="h-4 w-4" />
                    </div>
                  )}
                  <div className="absolute inset-x-0 bottom-0 h-[3px] bg-black/40">
                    <div className="h-full" style={{ width: `${percent}%`, backgroundColor: 'var(--brand)' }} />
                  </div>
                </Link>

                <div className="min-w-0 flex-1">
                  {editing === h.id ? (
                    <div className="flex items-center gap-1.5">
                      <input
                        autoFocus
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commit(h.id);
                          if (e.key === 'Escape') setEditing(null);
                        }}
                        className="h-8 min-w-0 flex-1 rounded-lg border border-[var(--brand)] bg-[var(--panel-2)] px-2 text-[13px] outline-none"
                        placeholder={h.title}
                      />
                      <button className="rounded p-1 text-[var(--brand)] hover:bg-[var(--panel-2)]" onClick={() => commit(h.id)} title="保存">
                        <Check className="h-4 w-4" />
                      </button>
                      <button className="rounded p-1 text-[var(--muted)] hover:bg-[var(--panel-2)]" onClick={() => setEditing(null)} title="取消">
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <Link to={`/detail/${h.sourceKey}/${h.vodId}`} className="truncate text-[14px] font-medium hover:text-[var(--brand)]">
                        {h.alias || h.title}
                      </Link>
                      <button
                        className="shrink-0 rounded p-1 text-[var(--muted)] opacity-0 transition group-hover:opacity-100 hover:text-[var(--brand)]"
                        title="重命名这条记录"
                        onClick={() => { setEditing(h.id); setDraft(h.alias || h.title); }}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                  {h.alias && <div className="truncate text-[10.5px] text-[var(--muted)]">原名：{h.title}</div>}
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-[var(--muted)]">
                    <span>{h.episodeName}</span>
                    <span>
                      {formatDuration(h.position)} / {h.duration ? formatDuration(h.duration) : '--:--'}
                    </span>
                    <span>{relativeTime(h.updatedAt)}</span>
                    <span className="rounded bg-[var(--panel-2)] px-1.5 py-0.5 text-[10.5px]">{h.sourceName}</span>
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  <Link to={`/play/${h.sourceKey}/${h.vodId}/${h.lineIndex}/${h.episodeIndex}`} className="btn btn-primary h-8 px-3 text-[12px]">
                    <Play className="h-3.5 w-3.5 fill-white" /> 继续
                  </Link>
                  <button
                    className="btn btn-ghost h-8 w-8 p-0 opacity-0 transition-opacity group-hover:opacity-100"
                    title="删除这条记录"
                    onClick={() => removeHistory(h.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
