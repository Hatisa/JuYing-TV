import { NavLink } from 'react-router-dom';
import { Bot, Clapperboard, Clock3, Film, Heart, Radio, Settings, ShieldAlert, Sparkles } from 'lucide-react';
import { useApp } from '../store/app';
import { FEATURES } from '../lib/features';

const items = [
  { to: '/', label: '首页', icon: Film, end: true },
  { to: '/assistant', label: 'AI 助手', icon: Bot },
  { to: '/search', label: '搜索', icon: Sparkles },
  { to: '/shorts', label: '短剧', icon: Clapperboard },
  { to: '/favorites', label: '收藏', icon: Heart },
  { to: '/history', label: '历史', icon: Clock3 },
  ...(FEATURES.live ? [{ to: '/live', label: '直播', icon: Radio }] : []),
];

export default function Sidebar() {
  const adult18 = useApp((s) => s.settings.adult18);

  return (
    <aside className="app-sidebar flex w-[196px] shrink-0 flex-col border-r border-[var(--border)] bg-[var(--bg-soft)] px-3 py-4">
      <nav className="flex flex-col gap-1">
        {items.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) => `nav-item ${isActive ? 'nav-active' : ''}`}
          >
            <Icon className="h-[18px] w-[18px]" strokeWidth={1.9} />
            <span>{label}</span>
          </NavLink>
        ))}
        {adult18 && (
          <NavLink
            to="/adult"
            className={({ isActive }) => `nav-item ${isActive ? 'nav-active' : ''}`}
            title="仅限年满 18 周岁用户"
          >
            <ShieldAlert className="h-[18px] w-[18px]" strokeWidth={1.9} />
            <span>18+</span>
            <span className="ml-auto rounded bg-rose-500/15 px-1 py-0.5 text-[9px] font-bold leading-none text-rose-400">18+</span>
          </NavLink>
        )}
      </nav>

      <div className="mt-auto space-y-1">
        <NavLink to="/settings" className={({ isActive }) => `nav-item ${isActive ? 'nav-active' : ''}`}>
          <Settings className="h-[18px] w-[18px]" strokeWidth={1.9} />
          <span>设置</span>
        </NavLink>
      </div>
    </aside>
  );
}