import { useMemo } from 'react';
import { Heart, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import MediaCard from '../components/MediaCard';
import { EmptyState, PageHeader } from '../components/States';
import { relativeTime } from '../lib/format';
import { useApp } from '../store/app';

export default function FavoritesPage() {
  const favorites = useApp((s) => s.favorites);
  const proxy = useApp((s) => s.proxy);
  const removeFavorite = useApp((s) => s.removeFavorite);
  const history = useApp((s) => s.history);

  const progressMap = useMemo(() => {
    const map = new Map<string, { position: number; duration: number }>();
    for (const h of history) map.set(h.id, { position: h.position, duration: h.duration });
    return map;
  }, [history]);

  return (
    <div className="animate-fade-in px-7 py-6">
      <PageHeader title="我的收藏" subtitle={`共 ${favorites.length} 部作品`} />

      {favorites.length === 0 ? (
        <EmptyState
          icon={<Heart className="h-6 w-6" />}
          title="还没有收藏任何作品"
          description="在详情页点击「收藏」，之后就能在这里快速找到。"
          action={
            <Link to="/" className="btn btn-primary mt-2">
              去发现好片
            </Link>
          }
        />
      ) : (
        <div className="grid grid-cols-3 gap-x-4 gap-y-7 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7">
          {favorites.map((f) => (
            <div key={f.id} className="group/fav relative">
              <MediaCard
                item={{
                  sourceKey: f.sourceKey,
                  sourceName: f.sourceName,
                  vodId: f.vodId,
                  name: f.title,
                  pic: f.cover,
                  typeName: f.typeName,
                  year: f.year,
                  remarks: f.remarks,
                }}
                proxy={proxy}
                progress={progressMap.get(f.id)}
              />
              <button
                title={`取消收藏（${relativeTime(f.createdAt)}添加）`}
                onClick={() => removeFavorite(f.id)}
                className="absolute right-1.5 top-1.5 hidden h-7 w-7 place-items-center rounded-lg bg-black/65 text-white/90 backdrop-blur transition-colors hover:bg-red-500/90 group-hover/fav:grid"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
