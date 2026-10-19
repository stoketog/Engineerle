import { nextElapsed } from '@/hooks/useStopwatch';

let pass = 0, fail = 0;
function t(name: string, fn: () => void) {
  try { fn(); pass++; console.log('  ✓', name); } catch (e) { fail++; console.error('  ✗', name, '\n     ', (e as Error).message); }
}
const eq = (a: number, b: number) => { if (Math.abs(a - b) > 1e-9) throw new Error(`expected ${b} got ${a}`); };

t('a visible tick adds its time in seconds', () => eq(nextElapsed(10, 250, true), 10.25));
t('a long gap (sleep, throttled tab) counts at most two seconds', () => eq(nextElapsed(10, 3_600_000, true), 12));
t('a hidden tab adds nothing', () => eq(nextElapsed(10, 250, false), 10));
t('a negative or zero gap adds nothing', () => { eq(nextElapsed(10, -500, true), 10); eq(nextElapsed(10, 0, true), 10); });

console.log(`\n${pass} passed${fail ? `, ${fail} failed` : ''}`);
if (fail) process.exit(1);
