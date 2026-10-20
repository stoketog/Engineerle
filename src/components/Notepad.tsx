'use client';

import { useEffect, useRef, useState } from 'react';
import { MAX_NOTE, loadNote, saveNote } from '@/engineerle/notes';
import { IconClose } from './Icons';

/**
 * Scratch paper for the day's working. It is a panel beside (or under, on a phone) the puzzle, not a dialog: the puzzle
 * stays in view and the clock keeps running, as it would on a real desk. Saved on this device only, one page per day.
 */
export function Notepad({ dateKey, onClose, onChange }: { dateKey: string; onClose: () => void; onChange: (has: boolean) => void }) {
  const [text, setText] = useState(() => loadNote(dateKey));
  const [sure, setSure] = useState(false);
  const latest = useRef(text);
  const timer = useRef(0);
  const area = useRef<HTMLTextAreaElement>(null);

  const flush = () => {
    window.clearTimeout(timer.current);
    saveNote(dateKey, latest.current);
    onChange(latest.current.trim() !== '');
  };
  useEffect(() => {
    area.current?.focus();
    const hide = () => document.visibilityState === 'hidden' && flush();
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', hide);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', hide);
      flush();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!sure) return;
    const id = window.setTimeout(() => setSure(false), 3500);
    return () => window.clearTimeout(id);
  }, [sure]);

  const edit = (v: string) => {
    const next = v.slice(0, MAX_NOTE);
    latest.current = next;
    setText(next);
    setSure(false);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, 350);
  };

  return (
    <aside className="ens-notes" data-testid="ens-notes" role="complementary" aria-label="Notepad" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <header>
        <div>
          <b>Notepad</b>
          <small>Kept on this device, for today only.</small>
        </div>
        <button className="icon-btn" aria-label="Close notepad" onClick={onClose} data-testid="ens-notes-close">
          <IconClose size={16} />
        </button>
      </header>
      <textarea
        ref={area}
        className="ens-notes-text"
        data-testid="ens-notes-text"
        value={text}
        onChange={(e) => edit(e.target.value)}
        placeholder="Working goes here. Equations, sums, a sketch in words."
        aria-label="Your notes for today"
        spellCheck={false}
        autoCapitalize="off"
        autoComplete="off"
        maxLength={MAX_NOTE}
      />
      <footer>
        <span className="ens-label font-mono" data-testid="ens-notes-count">{text.length} / {MAX_NOTE}</span>
        <button
          className="ens-ghost"
          disabled={!text}
          data-testid="ens-notes-clear"
          onClick={() => {
            if (!sure) return setSure(true);
            edit('');
            flush();
          }}
        >
          {sure ? 'Really clear it?' : 'Clear'}
        </button>
      </footer>
    </aside>
  );
}
