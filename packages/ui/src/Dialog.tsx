import { useEffect, useId, useRef, type ReactNode } from 'react';

/** A centred modal from md up; a bottom sheet on phones (same element, CSS only). */
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
  const titleId = useId();
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
      aria-labelledby={titleId}
      className="m-auto w-[min(560px,calc(100vw-32px))] rounded-card border border-line bg-surface p-0 text-ink shadow-modal backdrop:bg-ink/40 backdrop:backdrop-blur-sm max-md:mb-0 max-md:w-full max-md:max-w-none max-md:rounded-b-none max-md:border-x-0 max-md:border-b-0"
    >
      <div aria-hidden="true" className="mx-auto mt-2 h-1 w-10 rounded-full bg-line-strong md:hidden" />
      <div className="flex items-center justify-between gap-2 border-b border-line py-2 pl-5 pr-2">
        <h2 id={titleId} className="text-[17px] font-bold tracking-[-0.01em]">
          {title}
        </h2>
        <button
          aria-label="Close"
          onClick={onClose}
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-control text-ink-muted hover:bg-surface-2 hover:text-ink"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div className="max-h-[75dvh] overflow-y-auto p-5 max-md:pb-[calc(1.25rem+env(safe-area-inset-bottom))]">{open && children}</div>
    </dialog>
  );
}
