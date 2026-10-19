import { useEffect, useRef, type ReactNode } from 'react';
import { IconClose } from './Icons';

export function Modal({ title, onClose, children, testId, peek = false }: { title: string; onClose: () => void; children: ReactNode; testId?: string; peek?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    ref.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  return (
    <>
      <div className={`scrim ${peek ? 'peek' : ''}`} onClick={onClose} />
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} data-testid={testId} className={`sheet outline-none ${peek ? 'peek' : ''}`}>
        <div className="sheet-head sticky top-0 z-10 flex items-center justify-between px-5 py-4 backdrop-blur">
          <h2 className="eyebrow !text-mist-300">{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <IconClose size={16} />
          </button>
        </div>
        <div className="px-5 pb-6">{children}</div>
      </div>
    </>
  );
}
