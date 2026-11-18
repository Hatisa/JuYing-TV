import type { ReactNode } from 'react';
import { AlertTriangle, Loader2, SearchX } from 'lucide-react';

export function SkeletonCard() {
  return (
    <div>
      <div className="skeleton aspect-[2/3] rounded-xl" />
      <div className="skeleton mt-3 h-3.5 w-4/5 rounded" />
      <div className="skeleton mt-2 h-3 w-1/2 rounded" />
    </div>
  );
}

export function SkeletonGrid({ count = 12 }: { count?: number }) {
  return (
    <div className="grid grid-cols-3 gap-x-4 gap-y-6 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}

export function Spinner({ className = 'h-5 w-5' }: { className?: string }) {
  return <Loader2 className={`animate-spin ${className}`} />;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
      <div className="grid h-14 w-14 place-items-center rounded-2xl border border-[var(--border)] bg-[var(--panel)] text-[var(--muted)]">
        {icon || <SearchX className="h-6 w-6" />}
      </div>
      <div className="text-base font-medium">{title}</div>
      {description && <div className="max-w-md text-sm leading-relaxed text-[var(--muted)]">{description}</div>}
      {action}
    </div>
  );
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/10 px-3.5 py-2.5 text-[12.5px] text-amber-500">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <span className="leading-relaxed">{message}</span>
    </div>
  );
}

export function PageHeader({ title, subtitle, right }: { title: string; subtitle?: string; right?: ReactNode }) {
  return (
    <div className="mb-6 flex items-end justify-between gap-4">
      <div>
        <h1 className="text-[26px] font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-[13px] text-[var(--muted)]">{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}
