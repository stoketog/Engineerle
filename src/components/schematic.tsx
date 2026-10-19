import type { ReactNode } from 'react';

/** Drawing primitives for circuit schematics (SVG, on the drafting board). Coordinates are in the schematic's own viewBox. */

const INK = 'var(--en-ink)';
const ACCENT = 'var(--en-accent)';
const MUTE = 'var(--en-mute)';

export function Schematic({ width, height, label, children, testId }: { width: number; height: number; label: string; children: ReactNode; testId?: string }) {
  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} data-testid={testId} style={{ width: '100%', height: '100%', display: 'block' }} fontFamily="var(--font-mono, ui-monospace, monospace)">
      <g fill="none" stroke={INK} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{children}</g>
    </svg>
  );
}

export function Wire({ pts }: { pts: Array<[number, number]> }) {
  return <polyline points={pts.map((p) => p.join(',')).join(' ')} />;
}

export function Dot({ x, y }: { x: number; y: number }) {
  return <circle cx={x} cy={y} r="3.2" fill={INK} stroke="none" />;
}

/** A resistor between two points (any angle): leads, a zigzag body, and a two-line label on the chosen side. */
export function Resistor({ x1, y1, x2, y2, name, value, free = false, side = 'above' }: { x1: number; y1: number; x2: number; y2: number; name: string; value: string; free?: boolean; side?: 'above' | 'below' | 'left' | 'right' }) {
  const dx = x2 - x1, dy = y2 - y1;
  const L = Math.hypot(dx, dy);
  const ux = dx / L, uy = dy / L, nx = -uy, ny = ux;
  const lead = Math.min(14, L * 0.2);
  const body = L - 2 * lead;
  const peaks = 6, amp = 6;
  const pt = (t: number, off: number): [number, number] => [x1 + ux * t + nx * off, y1 + uy * t + ny * off];
  const path: Array<[number, number]> = [pt(0, 0), pt(lead, 0)];
  for (let i = 0; i < peaks; i++) path.push(pt(lead + (body * (i + 0.5)) / peaks, i % 2 ? amp : -amp));
  path.push(pt(L - lead, 0), pt(L, 0));
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
  const gap = 20;
  const [tx, ty, anchor] = side === 'above' ? [mx, my - gap - 6, 'middle'] : side === 'below' ? [mx, my + gap + 12, 'middle'] : side === 'left' ? [mx - gap, my - 2, 'end'] : [mx + gap, my - 2, 'start'];
  const col = free ? ACCENT : INK;
  return (
    <g>
      <polyline points={path.map((p) => p.join(',')).join(' ')} stroke={col} strokeWidth={free ? 2.4 : 1.8} />
      <text x={tx} y={ty} textAnchor={anchor as 'start' | 'middle' | 'end'} fontSize="12" fontWeight="700" fill={col} stroke="none">{name}</text>
      <text x={tx} y={ty + 13} textAnchor={anchor as 'start' | 'middle' | 'end'} fontSize="12" fill={free ? ACCENT : MUTE} stroke="none" fontWeight={free ? 700 : 400}>{value}</text>
    </g>
  );
}

/** A battery between (x, y1) at the top (+) and (x, y2) at the bottom (−). */
export function Battery({ x, y1, y2, volts }: { x: number; y1: number; y2: number; volts: number }) {
  const m = (y1 + y2) / 2;
  return (
    <g>
      <line x1={x} y1={y1} x2={x} y2={m - 7} />
      <line x1={x - 14} y1={m - 7} x2={x + 14} y2={m - 7} strokeWidth="2.6" />
      <line x1={x - 8} y1={m + 3} x2={x + 8} y2={m + 3} strokeWidth="2.6" />
      <line x1={x} y1={m + 3} x2={x} y2={y2} />
      <text x={x - 22} y={m - 12} textAnchor="end" fontSize="11" fill={INK} stroke="none">+</text>
      <text x={x - 20} y={m + 4} textAnchor="end" fontSize="13" fontWeight="700" fill={INK} stroke="none">{volts} V</text>
    </g>
  );
}

export function Ground({ x, y }: { x: number; y: number }) {
  return (
    <g>
      <line x1={x} y1={y} x2={x} y2={y + 8} />
      <line x1={x - 11} y1={y + 8} x2={x + 11} y2={y + 8} />
      <line x1={x - 7} y1={y + 13} x2={x + 7} y2={y + 13} />
      <line x1={x - 3} y1={y + 18} x2={x + 3} y2={y + 18} />
    </g>
  );
}

/** A circular meter symbol with its letter, and its reading beside it (below, or to the right) once there is one. */
export function Meter({ x, y, letter, reading, testId, inline = false, plus }: { x: number; y: number; letter: string; reading?: string; testId?: string; inline?: boolean; plus?: 'left' | 'right' }) {
  return (
    <g>
      <circle cx={x} cy={y} r="15" fill="var(--en-panel, transparent)" />
      <text x={x} y={y + 5} textAnchor="middle" fontSize="15" fontWeight="700" fill={INK} stroke="none">{letter}</text>
      {plus && <text x={plus === 'left' ? x - 24 : x + 24} y={y - 6} textAnchor="middle" fontSize="13" fontWeight="700" fill={INK} stroke="none">+</text>}
      {reading !== undefined && (
        <text x={inline ? x + 24 : x} y={inline ? y + 5 : y + 31} textAnchor={inline ? 'start' : 'middle'} fontSize="12" fontWeight="700" fill={ACCENT} stroke="none" data-testid={testId}>{reading}</text>
      )}
    </g>
  );
}

/** A capacitor between two points that lie on a horizontal or vertical line: two plates with the leads running to them, and a label. */
export function Capacitor({ x1, y1, x2, y2, name, value, side = 'above' }: { x1: number; y1: number; x2: number; y2: number; name: string; value: string; side?: 'above' | 'below' | 'left' | 'right' }) {
  const dx = x2 - x1, dy = y2 - y1;
  const L = Math.hypot(dx, dy);
  const ux = dx / L, uy = dy / L, nx = -uy, ny = ux;
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
  const gap = 4, half = 11;
  const p = (t: number, off = 0): [number, number] => [x1 + ux * t + nx * off, y1 + uy * t + ny * off];
  const a = L / 2 - gap, b = L / 2 + gap;
  const lab = 20;
  const [tx, ty, anchor] = side === 'above' ? [mx, my - lab - 6, 'middle'] : side === 'below' ? [mx, my + lab + 12, 'middle'] : side === 'left' ? [mx - lab, my - 2, 'end'] : [mx + lab, my - 2, 'start'];
  return (
    <g>
      <line x1={x1} y1={y1} x2={p(a)[0]} y2={p(a)[1]} />
      <line x1={p(b)[0]} y1={p(b)[1]} x2={x2} y2={y2} />
      <line x1={p(a, -half)[0]} y1={p(a, -half)[1]} x2={p(a, half)[0]} y2={p(a, half)[1]} strokeWidth="2.6" />
      <line x1={p(b, -half)[0]} y1={p(b, -half)[1]} x2={p(b, half)[0]} y2={p(b, half)[1]} strokeWidth="2.6" />
      <text x={tx} y={ty} textAnchor={anchor as 'start' | 'middle' | 'end'} fontSize="12" fontWeight="700" fill={ACCENT} stroke="none">{name}</text>
      <text x={tx} y={ty + 13} textAnchor={anchor as 'start' | 'middle' | 'end'} fontSize="12" fill={ACCENT} stroke="none" fontWeight="700">{value}</text>
    </g>
  );
}
