import { useEffect, useRef, type ReactNode } from 'react';

export function Dialog({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby="dlg-title"
      className="w-[min(560px,calc(100vw-32px))] rounded-[var(--radius-card)] border border-line bg-surface p-0 text-ink backdrop:bg-black/40"
    >
      <div className="flex items-center justify-between border-b border-line p-4">
        <h2 id="dlg-title" className="font-semibold">
          {title}
        </h2>
        <button aria-label="Close" onClick={onClose} className="min-h-11 min-w-11">
          ✕
        </button>
      </div>
      <div className="max-h-[75dvh] overflow-y-auto p-4">{open && children}</div>
    </dialog>
  );
}
