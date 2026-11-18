import { AlertCircle, CheckCircle2, Info } from 'lucide-react';
import { useToast } from '../store/toast';

export default function Toaster() {
  const toasts = useToast((s) => s.toasts);
  return (
    <div className="pointer-events-none fixed bottom-6 right-6 z-50 flex w-[320px] flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="animate-slide-up flex items-start gap-2.5 rounded-xl border border-[var(--border)] bg-[var(--panel)] px-4 py-3 text-[13px] shadow-card"
        >
          {t.type === 'success' ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
          ) : t.type === 'error' ? (
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
          ) : (
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-[var(--brand)]" />
          )}
          <span className="leading-relaxed">{t.message}</span>
        </div>
      ))}
    </div>
  );
}
