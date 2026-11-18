import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Star } from 'lucide-react';
import { api } from '../lib/bridge';
import { coverUrl } from '../lib/media';
import { useApp } from '../store/app';
import type { DoubanTopItem } from '../types';

/** 首页「豆瓣高分电影」横向榜单 */
export default function DoubanRail() {
  const proxy = useApp((s) => s.proxy);
  const [items, setItems] = useState<DoubanTopItem[]>([]);

  useEffect(() => {
    let alive = true;
    api.douban
      .top(18)
      .then((list) => {
        if (alive) setItems(list.filter((x) => x.title).slice(0, 12));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  if (items.length === 0) return null;

  return (
    <section className="mb-7" data-testid="douban-rail">
      <div className="mb-3 flex items-end justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-[15px] font-semibold">
            <Star className="h-4 w-4 text-amber-400" />
            豆瓣高分电影
          </h2>
          <p className="mt-0.5 text-xs text-[var(--muted)]">来自豆瓣电影 Top 250，点击可直接聚合搜索片源</p>
        </div>
        <Link to="/search" className="text-xs text-[var(--muted)] hover:text-[var(--brand)]">
          去搜索 →
        </Link>
      </div>
      <div className="no-scrollbar -mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-1">
        {items.map((item, index) => (
          <Link
            key={item.id || item.title}
            to={`/search?wd=${encodeURIComponent(item.title)}`}
            className="group w-[112px] shrink-0 snap-start"
            title={`${item.title} ${item.rating ? '· 豆瓣 ' + item.rating.toFixed(1) : ''}`}
          >
            <div className="relative aspect-[2/3] overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--panel-2)]">
              {item.cover ? (
                <img
                  src={coverUrl(item.cover, proxy, 240)}
                  alt={item.title}
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                />
              ) : null}
              <span className="absolute left-1.5 top-1.5 grid h-5 min-w-5 place-items-center rounded bg-black/65 px-1 text-[10px] font-bold text-white/90">
                {index + 1}
              </span>
              {item.rating ? (
                <span className="absolute bottom-1.5 right-1.5 rounded bg-black/70 px-1 py-0.5 text-[10px] font-bold text-amber-300">
                  {item.rating.toFixed(1)}
                </span>
              ) : null}
            </div>
            <div className="mt-1.5 truncate text-xs font-medium group-hover:text-[var(--brand)]">{item.title}</div>
            <div className="truncate text-[10px] text-[var(--muted)]">{[item.year, item.regions?.[0]].filter(Boolean).join(' · ')}</div>
          </Link>
        ))}
      </div>
    </section>
  );
}
