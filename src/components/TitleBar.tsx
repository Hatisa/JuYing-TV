import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Copy, Minus, Search, Square, X } from 'lucide-react';
import { api } from '../lib/bridge';

export default function TitleBar() {
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const [keyword, setKeyword] = useState('');
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (location.pathname === '/search' || location.pathname === '/adult') setKeyword(params.get('wd') || '');
  }, [location.pathname, params]);

  useEffect(() => {
    const off = api.window.onMaximizedChange(setMaximized);
    return off;
  }, []);

  const submit = () => {
    const wd = keyword.trim();
    if (!wd) return;
    navigate(`${location.pathname === '/adult' ? '/adult' : '/search'}?wd=${encodeURIComponent(wd)}`);
  };

  return (
    <header className="app-titlebar drag relative z-30 flex h-[60px] shrink-0 items-center gap-6 border-b border-[var(--border)] bg-[var(--bg)]/95 px-5">
      <div className="titlebar-brand flex w-[196px] shrink-0 items-center gap-2.5">
        <div
          className="grid h-8 w-8 place-items-center rounded-[10px] text-white shadow-glow"
          style={{ backgroundImage: 'linear-gradient(135deg, var(--brand), var(--brand-2))' }}
        >
          <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m10 8 6 4-6 4V8Z" fill="currentColor" stroke="none" />
            <rect x="3" y="3" width="18" height="18" rx="5" />
          </svg>
        </div>
        <div className="leading-tight">
          <div className="text-[15px] font-semibold tracking-wide">聚影 TV</div>
          <div className="text-[10px] tracking-[.18em] text-[var(--muted)]">JUYING</div>
        </div>
      </div>

      <div className="titlebar-search no-drag flex min-w-0 flex-1 justify-center">
        <div className="group relative w-full max-w-[520px]">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted)]" />
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
            }}
            placeholder={location.pathname === '/adult' ? '搜索 18+ 内容…' : '搜索电影、剧集、综艺…'}
            className="h-10 w-full rounded-full border border-[var(--border)] bg-[var(--panel)] pl-10 pr-20 text-sm outline-none transition-all placeholder:text-[var(--muted)] focus:border-[var(--brand)] focus:bg-[var(--panel-2)] focus:shadow-[0_0_0_3px_var(--brand-soft)]"
          />
          <button onClick={submit} className="no-drag absolute right-1.5 top-1/2 -translate-y-1/2 rounded-full px-3.5 py-1.5 text-xs font-medium text-white" style={{ backgroundImage: 'linear-gradient(135deg, var(--brand), var(--brand-2))' }}>
            搜索
          </button>
        </div>
      </div>

      <div className="window-controls no-drag flex shrink-0 items-center gap-1">
        <button onClick={() => void api.window.minimize()} className="grid h-8 w-9 place-items-center rounded-lg text-[var(--muted)] transition hover:bg-[var(--panel-2)] hover:text-[var(--text)]" title="最小化">
          <Minus className="h-4 w-4" />
        </button>
        <button onClick={() => void api.window.toggleMaximize()} className="grid h-8 w-9 place-items-center rounded-lg text-[var(--muted)] transition hover:bg-[var(--panel-2)] hover:text-[var(--text)]" title={maximized ? '还原' : '最大化'}>
          {maximized ? <Copy className="h-[14px] w-[14px]" /> : <Square className="h-[13px] w-[13px]" />}
        </button>
        <button onClick={() => void api.window.close()} className="grid h-8 w-9 place-items-center rounded-lg text-[var(--muted)] transition hover:bg-red-500 hover:text-white" title="关闭">
          <X className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}