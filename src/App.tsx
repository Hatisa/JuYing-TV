import { useEffect } from 'react';
import { Route, Routes } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import TitleBar from './components/TitleBar';
import Toaster from './components/Toaster';
import MobileNav from './components/MobileNav';
import { Spinner } from './components/States';
import { useApp } from './store/app';
import { useHealth } from './store/health';
import { isMobile } from './lib/bridge';
import HomePage from './pages/HomePage';
import SearchPage from './pages/SearchPage';
import AdultPage from './pages/AdultPage';
import ShortsPage from './pages/ShortsPage';
import DetailPage from './pages/DetailPage';
import PlayPage from './pages/PlayPage';
import FavoritesPage from './pages/FavoritesPage';
import HistoryPage from './pages/HistoryPage';
import LivePage from './pages/LivePage';
import SettingsPage from './pages/SettingsPage';
import { FEATURES } from './lib/features';

export default function App() {
  const ready = useApp((s) => s.ready);
  const init = useApp((s) => s.init);
  const initHealth = useHealth((s) => s.init);

  useEffect(() => {
    let alive = true;
    // 移动端必须先等数据源加载完成，健康检测才能拿到源列表
    void init().finally(() => {
      if (alive) initHealth();
    });
    return () => {
      alive = false;
    };
  }, [init, initHealth]);

  useEffect(() => {
    if (!isMobile) return;
    // 移动端没有主进程定时器：前台每 4 分钟自动巡检一次，切回前台时补检
    const check = () => {
      if (document.visibilityState !== 'visible') return;
      const state = useHealth.getState();
      if (state.ready && !state.checking) state.checkAll();
    };
    const timer = window.setInterval(check, 4 * 60_000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') check();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  if (!ready) {
    return (
      <div className="grid h-full place-items-center bg-[var(--bg)] text-[var(--muted)]">
        <div className="flex flex-col items-center gap-3">
          <Spinner className="h-7 w-7" />
          <span className="text-sm">正在启动聚影 TV…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell flex h-full flex-col overflow-hidden bg-[var(--bg)] text-[var(--text)]">
      <TitleBar />
      <div className="app-body flex min-h-0 flex-1">
        <Sidebar />
        <main className="app-main min-w-0 flex-1 overflow-y-auto">
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/adult" element={<AdultPage />} />
            <Route path="/shorts" element={<ShortsPage />} />
            <Route path="/detail/:sourceKey/:vodId" element={<DetailPage />} />
            <Route path="/play/:sourceKey/:vodId/:lineIndex/:epIndex" element={<PlayPage />} />
            <Route path="/favorites" element={<FavoritesPage />} />
            <Route path="/history" element={<HistoryPage />} />
            {FEATURES.live && <Route path="/live" element={<LivePage />} />}
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<HomePage />} />
          </Routes>
        </main>
      </div>
      <Toaster />
      <MobileNav />
    </div>
  );
}