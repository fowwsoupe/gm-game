import { useState } from 'react';

export interface PaletteItem {
  id: string;
  label: string;
  /** Right-aligned hint, e.g. "Player" or "Screen". */
  hint?: string;
}

const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** Keyboard-driven search box: type, arrows to move, Enter to pick, Esc to close. */
export function Palette({
  items,
  placeholder,
  empty,
  onPick,
  onClose,
}: {
  items: PaletteItem[];
  placeholder: string;
  empty: string;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const [cursor, setCursor] = useState(0);
  const words = norm(q).split(/\s+/).filter(Boolean);
  const shown = items.filter((i) => words.every((w) => norm(i.label).includes(w))).slice(0, 8);
  const at = Math.min(cursor, shown.length - 1);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-24"
      onMouseDown={onClose}
    >
      <div
        className="w-full max-w-lg rounded-[var(--radius-card)] border border-line bg-panel p-2 shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <input
          autoFocus
          value={q}
          placeholder={placeholder}
          onChange={(e) => {
            setQ(e.target.value);
            setCursor(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose();
            else if (e.key === 'ArrowDown') {
              e.preventDefault();
              setCursor(Math.min(at + 1, shown.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setCursor(Math.max(at - 1, 0));
            } else if (e.key === 'Enter' && shown[at]) onPick(shown[at].id);
          }}
          className="w-full rounded bg-panel-2 px-3 py-2 text-sm text-ink outline-none"
        />
        <ul className="mt-1">
          {shown.map((i, n) => (
            <li
              key={i.id}
              onMouseEnter={() => setCursor(n)}
              onClick={() => onPick(i.id)}
              className={`flex cursor-pointer justify-between rounded px-3 py-1.5 text-sm ${n === at ? 'bg-panel-2 text-ink' : 'text-muted'}`}
            >
              <span>{i.label}</span>
              <span className="text-xs">{i.hint}</span>
            </li>
          ))}
          {shown.length === 0 && <li className="px-3 py-2 text-sm text-muted">{empty}</li>}
        </ul>
      </div>
    </div>
  );
}
