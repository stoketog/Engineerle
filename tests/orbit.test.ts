import assert from 'node:assert/strict';
import { MU, visViva, hohmann, leadAngle, propagate, circularState, apoapsisByPropagation, makeOrbit, evaluate, type OrbitSpec, type State } from '@/engineerle/orbit';

let passed = 0;
const test = (name: string, fn: () => void) => {
  try { fn(); passed++; console.log('  ✓', name); } catch (e) { console.error('  ✗', name, '\n   ', (e as Error).message.split('\n').slice(0, 3).join('\n    ')); process.exitCode = 1; }
};
const near = (a: number, b: number, tol = 1e-9, m = '') => assert.ok(Math.abs(a - b) <= tol, `${m} expected ${b} got ${a}`);
const rel = (a: number, b: number, tol: number, m = '') => assert.ok(Math.abs(a - b) <= tol * Math.abs(b), `${m} expected ${b} got ${a} (relative ${Math.abs(a - b) / Math.abs(b)})`);
const energy = (s: State) => (s.vx * s.vx + s.vy * s.vy) / 2 - MU / Math.hypot(s.x, s.y);

console.log('Orbit: the vis-viva equation (Curtis, Orbital Mechanics for Engineering Students, ch. 2 and 6)');
test('mu of the Earth is 398600.4418 km^3/s^2', () => { assert.equal(MU, 398600.4418); });
test('on a circle the speed is sqrt(mu / r)', () => { for (const r of [6578, 6678.137, 26560, 42164]) rel(visViva(r, r), Math.sqrt(MU / r), 1e-12); });
test('at the ends of an ellipse the speeds are the textbook periapsis and apoapsis speeds', () => {
  const r1 = 6678.137, r2 = 42164, a = (r1 + r2) / 2;
  rel(visViva(r1, a), Math.sqrt((MU / a) * (r2 / r1)), 1e-12); // v_p = sqrt(mu/a) sqrt(ra/rp)
  rel(visViva(r2, a), Math.sqrt((MU / a) * (r1 / r2)), 1e-12);
});

console.log('Orbit: the Hohmann transfer against a numerical two-body integration');
test('LEO to GEO: dv1, dv2 and the time of flight agree with an RK4 propagation within 1e-4', () => {
  const r1 = 6678.137, r2 = 42164;
  const h = hohmann(r1, r2);
  // textbook magnitudes: about 2.4 km/s, 1.5 km/s, 5.3 hours
  assert.ok(h.dv1 > 2.3 && h.dv1 < 2.5 && h.dv2 > 1.4 && h.dv2 < 1.6 && h.time / 3600 > 5.2 && h.time / 3600 < 5.4, `${JSON.stringify(h)}`);
  // burn dv1 at periapsis and fly to apoapsis numerically
  const start: State = { x: r1, y: 0, vx: 0, vy: Math.sqrt(MU / r1) + h.dv1 };
  const dt = 2;
  let s = start, t = 0, prevRv = 0;
  for (let i = 0; i < 60_000; i++) {
    const n = propagate(s, dt, 1);
    const rv = n.x * n.vx + n.y * n.vy;
    if (rv < 0 && prevRv >= 0 && i > 0) { // crossed apoapsis between s and n: refine by bisection
      let lo = 0, hi = dt;
      for (let k = 0; k < 60; k++) { const mid = (lo + hi) / 2; const m = propagate(s, mid, 1); if (m.x * m.vx + m.y * m.vy > 0) lo = mid; else hi = mid; }
      const apo = propagate(s, lo, 1);
      const tApo = t + lo;
      rel(Math.hypot(apo.x, apo.y), r2, 1e-4, 'apoapsis radius');
      near(Math.hypot(apo.x, apo.y), r2, 0.1, 'apoapsis km');
      rel(tApo, h.time, 1e-4, 'half period');
      const dv2 = Math.sqrt(MU / r2) - Math.hypot(apo.vx, apo.vy);
      rel(dv2, h.dv2, 1e-4, 'dv2');
      return;
    }
    prevRv = rv; s = n; t += dt;
  }
  assert.fail('never reached apoapsis');
});
test('the helper that flies the burn agrees: apoapsis from propagation equals r2 within 0.1 km for several pairs', () => {
  for (const [r1, r2] of [[6578, 8000], [7000, 26560], [7500, 42164], [6678.137, 20000]] as const) {
    const h = hohmann(r1, r2);
    near(apoapsisByPropagation(r1, h.dv1 * 1000), r2, 0.1, `${r1}->${r2}`);
  }
});
test('total energy is conserved over 10 orbits to 1e-9 relative', () => {
  const r = 6678.137, v = Math.sqrt(MU / r) * 1.1; // an ellipse, so the speed and radius both vary
  const s0: State = { x: r, y: 0, vx: 0, vy: v };
  const a = -MU / (2 * energy(s0)), period = 2 * Math.PI * Math.sqrt(a ** 3 / MU);
  const dt = 1, steps = Math.round((10 * period) / dt);
  const s1 = propagate(s0, dt, steps);
  rel(energy(s1), energy(s0), 1e-9, 'energy');
  // angular momentum too
  rel(s1.x * s1.vy - s1.y * s1.vx, s0.x * s0.vy - s0.y * s0.vx, 1e-9, 'angular momentum');
});
test('the circular state stays on its circle', () => {
  const r = 7000, s = propagate(circularState(r), 5, 4000);
  rel(Math.hypot(s.x, s.y), r, 1e-9);
});

console.log('Orbit: phasing for a rendezvous');
test('the target advances sqrt(mu / r2^3) * time during the transfer, which is pi minus the lead angle', () => {
  for (const [r1, r2] of [[6678.137, 42164], [7000, 26560], [6578, 12000]] as const) {
    const h = hohmann(r1, r2);
    near(Math.sqrt(MU / r2 ** 3) * h.time, Math.PI - leadAngle(r1, r2), 1e-9, `${r1}->${r2}`);
  }
  // LEO to GEO, independently: a geostationary target turns at the Earth's sidereal rate 7.292115e-5 rad/s during the 5.27 h transfer,
  // so it must start 180 degrees minus that far ahead (about 100.7 degrees)
  const t = hohmann(6678.137, 42164).time;
  near((leadAngle(6678.137, 42164) * 180) / Math.PI, 180 - (7.292115e-5 * t * 180) / Math.PI, 0.05);
  near((leadAngle(6678.137, 42164) * 180) / Math.PI, 100.7, 0.1);
});

console.log('Orbit: judging a burn');
const spec = (o: Partial<OrbitSpec> = {}): OrbitSpec => ({ kind: 'orbit', r1: 6678.137, r2: 42164, tolerance: 0.01, ...o });
test('evaluate refuses non-finite, negative, non-numeric and enormous burns without testing them', () => {
  for (const x of [NaN, Infinity, -Infinity, -1, -0.001, 1e9, 20_001, undefined as unknown as number, '2400' as unknown as number, null as unknown as number]) {
    const e = evaluate(spec(), x); assert.ok(e.refused, `refused ${String(x)}`); assert.equal(e.solved, false);
  }
});
test('a burn of zero does not solve: the craft stays on its circle', () => {
  const e = evaluate(spec(), 0); assert.equal(e.refused, undefined); assert.equal(e.solved, false); near(e.apoapsis!, 6678.137, 1e-6);
});
test('the exact Hohmann burn solves; 5% too little or too much does not; the edge of the 1% band is honoured', () => {
  const s = spec(), h = hohmann(s.r1, s.r2), dv = h.dv1 * 1000;
  assert.equal(evaluate(s, dv).solved, true);
  near(evaluate(s, dv).apoapsis!, s.r2, 1e-6);
  assert.equal(evaluate(s, dv * 0.95).solved, false);
  assert.equal(evaluate(s, dv * 1.05).solved, false);
  const wide = evaluate(s, dv + 6).apoapsis!; assert.ok(Math.abs(wide - s.r2) < 0.01 * s.r2, 'inside the band');
  const out = evaluate(s, dv + 8).apoapsis!; assert.ok(Math.abs(out - s.r2) > 0.01 * s.r2, 'outside the band');
});
test('a burn past escape speed is a hyperbola: no apoapsis, not solved, reported as escaping', () => {
  const e = evaluate(spec(), 4000); // LEO escape needs about 3.2 km/s
  assert.equal(e.escapes, true); assert.equal(e.solved, false); assert.equal(e.apoapsis, undefined);
});
test('evaluate agrees with flying the burn numerically', () => {
  for (const dv of [500, 1500, 2400, 2900]) {
    const e = evaluate(spec(), dv);
    near(apoapsisByPropagation(6678.137, dv), e.apoapsis!, 0.2, `dv ${dv}`);
  }
});

console.log('Orbit: the generator');
test('over 1000 seeds: radii in range, a whole-number burn solves, and the burn tolerance is 1%', () => {
  for (let seed = 1; seed <= 1000; seed++) {
    const s = makeOrbit(seed);
    assert.ok(s.r1 >= 6578 && s.r1 <= 7500, `seed ${seed} r1 ${s.r1}`);
    assert.ok(s.r2 >= 8000 && s.r2 <= 42164, `seed ${seed} r2 ${s.r2}`);
    assert.ok(s.r2 > s.r1 * 1.05, `seed ${seed}: target well above the start`);
    assert.equal(s.tolerance, 0.01);
    const dv = hohmann(s.r1, s.r2).dv1 * 1000;
    let ok = false;
    for (let d = Math.floor(dv) - 3; d <= Math.ceil(dv) + 3; d++) if (evaluate(s, d).solved) { ok = true; break; }
    assert.ok(ok, `seed ${seed}: no whole-number burn solves`);
    assert.equal(evaluate(s, 0).solved, false);
  }
});
test('the generator is deterministic and varies', () => {
  assert.deepEqual(makeOrbit(5), makeOrbit(5));
  assert.ok(new Set(Array.from({ length: 40 }, (_, i) => makeOrbit(i + 1).r2)).size > 4);
});

console.log(`\n${passed} passed`);
