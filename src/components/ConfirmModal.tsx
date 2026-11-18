import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, X } from 'lucide-react';

interface Props {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'brand' | 'danger';
  onConfirm: () => void;
  onCancel: () => void;
  children?: React.ReactNode;
}

export default function ConfirmModal({
  open,
  title,
  description,
  confirmLabel = '确认',
  cancelLabel = '取消',
  tone = 'brand',
  onConfirm,
  onCancel,
  children,
}: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[80] grid place-items-center bg-black/60 p-6 backdrop-blur-sm" onClick={onCancel}>
      <div
        className="w-full max-w-md rounded-2xl border border-[var(--border-strong)] bg-[var(--panel)] p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="mb-3 flex items-start justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-full bg-amber-400/15 text-amber-400">
              <AlertTriangle className="h-4.5 w-4.5" />
            </span>
            <h3 className="text-[15px] font-semibold">{title}</h3>
          </div>
          <button className="btn btn-ghost h-7 w-7 p-0" onClick={onCancel} aria-label="关闭">
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="text-[12.5px] leading-relaxed text-[var(--muted)]">{description}</p>
        {children}
        <div className="mt-6 flex justify-end gap-2">
          <button className="btn btn-ghost px-4" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button className={`btn ${tone === 'danger' ? 'bg-red-500 text-white' : 'btn-primary'} px-4`} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
