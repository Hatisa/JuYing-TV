import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Film, Play } from 'lucide-react';
import type { MediaSummary, ProxyInfo } from '../types';
import { coverUrl } from '../lib/media';

interface Props {
  item: MediaSummary;
  proxy: ProxyInfo | null;
  sourceCount?: number;
  progress?: { position: number; duration: number };
  onClick?: () => void;
}

export default function MediaCard({ item, proxy, sourceCount, progress, onClick }: Props) {
  const [broken, setBroken] = useState(false);
  const percent = progress && progress.duration > 0 ? Math.min(100, (progress.position / progress.duration) * 100) : 0;

  const inner = (
    <>
      <div className="relative aspect-[2/3] overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel-2)]">
        {!broken && item.pic ? (
          <img
            src={coverUrl(item.pic, proxy, 360)}
            alt={item.name}
            loading="lazy"
            decoding="async"
            width={240}
            height={360}
            onError={() => setBroken(true)}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.06]"
          />
        ) : (
          <div className="grid h-full w-full place-items-center text-[var(--muted)]">
            <Film className="h-8 w-8 opacity-40" />
          </div>
        )}

        <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/0 to-black/0 opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
        <div className="absolute inset-0 grid place-items-center opacity-0 transition-opacity duration-300 group-hover:opacity-100">
          <span className="grid h-11 w-11 place-items-center rounded-full bg-white/15 backdrop-blur-md ring-1 ring-white/30">
            <Play className="h-5 w-5 translate-x-[1px] fill-white text-white" />
          </span>
        </div>

        {item.remarks && (
          <span className="absolute left-2 top-2 max-w-[calc(100%-16px)] truncate rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white/90 backdrop-blur">
            {item.remarks}
          </span>
        )}
        {sourceCount && sourceCount > 1 && (
          <span className="absolute right-2 top-2 rounded-md px-1.5 py-0.5 text-[10px] font-semibold text-white" style={{ backgroundColor: 'var(--brand)' }}>
            {sourceCount} 源
          </span>
        )}

        {item.rating ? (
          <span
            className="absolute bottom-2 right-2 rounded-md bg-black/70 px-1.5 py-0.5 text-[10px] font-bold text-amber-300 backdrop-blur"
            title="豆瓣评分"
            data-rating={item.rating}
          >
            ★ {item.rating.toFixed(1)}
          </span>
        ) : null}

        {percent > 0 && (
          <div className="absolute inset-x-0 bottom-0 h-[3px] bg-white/20">
            <div className="h-full rounded-r-full" style={{ width: `${percent}%`, backgroundColor: 'var(--brand)' }} />
          </div>
        )}
      </div>

      <div className="mt-2.5 space-y-1 px-0.5">
        <h3 className="line-2 text-[13.5px] font-medium leading-snug text-[var(--text)] transition-colors group-hover:text-[var(--brand)]">{item.name}</h3>
        <div className="flex items-center gap-1.5 text-[11px] text-[var(--muted)]">
          {item.year && <span>{item.year}</span>}
          {item.typeName && <span className="truncate">{item.typeName}</span>}
          {!item.year && !item.typeName && <span className="truncate">{item.sourceName}</span>}
        </div>
      </div>
    </>
  );

  const className = 'group block w-full text-left';

  if (onClick) {
    return (
      <button className={className} onClick={onClick}>
        {inner}
      </button>
    );
  }

  return (
    <Link to={`/detail/${item.sourceKey}/${item.vodId}`} className={className}>
      {inner}
    </Link>
  );
}
