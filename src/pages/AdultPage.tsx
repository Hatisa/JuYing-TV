import { Link } from 'react-router-dom';
import { Lock, ShieldAlert } from 'lucide-react';
import SearchPage from './SearchPage';
import { useApp } from '../store/app';

export default function AdultPage() {
  const adult18 = useApp((s) => s.settings.adult18);

  if (!adult18) {
    return (
      <div className="grid h-full place-items-center px-8">
        <div className="surface max-w-md rounded-2xl p-8 text-center">
          <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-rose-500/10 text-rose-400">
            <Lock className="h-6 w-6" />
          </div>
          <h1 className="text-lg font-semibold">18+ 频道未开启</h1>
          <p className="mt-2 text-[13px] leading-relaxed text-[var(--muted)]">
            该频道包含成人/伦理内容，默认关闭。请在设置中确认你已年满 18 周岁后再开启。
          </p>
          <Link to="/settings" className="btn btn-primary mt-5 inline-flex">
            <ShieldAlert className="h-4 w-4" /> 去设置开启
          </Link>
        </div>
      </div>
    );
  }

  return <SearchPage adultMode />;
}
