import { useId } from 'react';

/** The Engineerle mark: a hex nut with a sine wave running through its bore. */
export function EngineerleMark({ size = 28, className = '' }: { size?: number; className?: string }) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const hex = Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i + Math.PI / 6;
    return `${(32 + 28 * Math.cos(a)).toFixed(2)},${(32 + 28 * Math.sin(a)).toFixed(2)}`;
  }).join(' ');
  let wave = '';
  for (let x = 6; x <= 58; x += 2) wave += `${x === 6 ? 'M' : 'L'}${x} ${(32 - 9 * Math.sin(((x - 6) / 52) * Math.PI * 2)).toFixed(2)}`;
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} aria-hidden>
      <defs>
        <clipPath id={`${id}c`}><circle cx="32" cy="32" r="14.5" /></clipPath>
      </defs>
      <polygon points={hex} fill="none" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" />
      <circle cx="32" cy="32" r="14.5" fill="none" stroke="currentColor" strokeWidth="2.4" />
      <path d={wave} fill="none" stroke="var(--en-accent, #ff8a3d)" strokeWidth="3" strokeLinecap="round" clipPath={`url(#${id}c)`} />
      <line x1="32" y1="2" x2="32" y2="8" stroke="currentColor" strokeWidth="1.6" opacity="0.6" />
      <line x1="32" y1="56" x2="32" y2="62" stroke="currentColor" strokeWidth="1.6" opacity="0.6" />
    </svg>
  );
}

/** The name with a dimension line under it. */
export function EngineerleWord({ className = '' }: { className?: string }) {
  return (
    <span className={`ens-word ${className}`}>
      <b>Engineerle</b>
      <svg viewBox="0 0 100 9" preserveAspectRatio="none" aria-hidden>
        <g stroke="currentColor" strokeWidth="1.1" fill="none">
          <line x1="0" y1="0.5" x2="0" y2="8.5" vectorEffect="non-scaling-stroke" />
          <line x1="100" y1="0.5" x2="100" y2="8.5" vectorEffect="non-scaling-stroke" />
          <line x1="1" y1="4.5" x2="99" y2="4.5" vectorEffect="non-scaling-stroke" />
        </g>
        <path d="M0.5 4.5 L5 2 L5 7 Z" fill="currentColor" />
        <path d="M99.5 4.5 L95 2 L95 7 Z" fill="currentColor" />
      </svg>
    </span>
  );
}
