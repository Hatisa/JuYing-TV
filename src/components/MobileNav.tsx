import { NavLink } from 'react-router-dom';
import { Clapperboard, Clock3, Film, Heart, Search, Settings, ShieldAlert } from 'lucide-react';
import { useApp } from '../store/app';

const baseItems = [
  { to: '/', label: '首页', icon: Film, end: true },
  { to: '/search', label: '搜索', icon: Search },
  { to: '/shorts', label: '短剧', icon: Clapperboard },
  { to: '/favorites', label: '收藏', icon: Heart },
  { to: '/history', label: '历史', icon: Clock3 },
  { to: '/settings', label: '设置', icon: Settings },
];

/** 移动端底部导航（桌面端由 CSS 隐藏） */
export default function MobileNav() {
  const adult18 = useApp((s) => s.settings.adult18);
  const items = adult18
    ? [...baseItems.slice(0, 5), { to: '/adult', label: '18+', icon: ShieldAlert }, baseItems[5]]
    : baseItems;

  return (
    <nav className="mobile-nav" aria-label="移动端导航">
      {items.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) => 'mobile-nav-item ' + (isActive ? 'mobile-nav-active' : '')}
        >
          <Icon className="h-[20px] w-[20px]" strokeWidth={1.9} />
          <span>{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
