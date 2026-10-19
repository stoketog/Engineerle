import assert from 'node:assert/strict';
import {
  E, I_FACTOR, buildTruss, solveTruss, truckLoads, capacity, makeBridge, UPGRADE, toM2, memberLength,
  BridgeSim, SIM_DT, dynamicResponse, type Truss, type Truck,
} from '@/engineerle/truss';

let passed = 0;
const test = (name: string, fn: () => void) => {
  try { fn(); passed++; console.log('  ✓', name); } catch (e) { console.error('  ✗', name, '\n   ', (e as Error).message); process.exitCode = 1; }
};
const near = (a: number, b: number, tol: number, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} ${a} vs ${b} (tol ${tol})`);
const TRUCK: Truck = { weight: 260000, spacing: 0.7, front: 0.4 };

console.log('Truck loads');
test('both axles on the deck: the nodal loads add up to the truck plus the bridge, and change smoothly as it rolls', () => {
  const t = buildTruss(6);
  const dead = 9000 * 7 + 3500 * 6;
  let prev: number[] | null = null;
  for (let u = TRUCK.spacing; u <= t.panels; u += 0.01) {
    const f = truckLoads(t, TRUCK, u);
    const sumY = f.filter((_, k) => k % 2 === 1).reduce((s, v) => s + v, 0);
    near(sumY, -(dead + TRUCK.weight), 1e-6, `u=${u}`);
    if (prev) for (let k = 0; k < f.length; k++) assert.ok(Math.abs(f[k] - prev[k]) <= 0.05 * TRUCK.weight, `jump at u=${u} dof ${k}`);
    prev = f;
  }
});

console.log('Truss statics (independent hand calculations)');
test('triangle truss (two rafters and a tie): rafters carry P / (2 sin a) in compression, the tie P / (2 tan a) in tension', () => {
  const a = 3, h = 2, P = 50000;
  const t: Truss = { panels: 2, panel: a, height: h, nodes: [{ x: 0, y: 0 }, { x: a, y: h }, { x: 2 * a, y: 0 }], members: [{ a: 0, b: 1, kind: 'diag' }, { a: 1, b: 2, kind: 'diag' }, { a: 0, b: 2, kind: 'bottom' }] };
  const sol = solveTruss(t, [0.002, 0.002, 0.002], [0, 0, 0, -P, 0, 0]);
  const alpha = Math.atan2(h, a);
  near(sol.force[0] / (-P / (2 * Math.sin(alpha))), 1, 1e-9);
  near(sol.force[1] / (-P / (2 * Math.sin(alpha))), 1, 1e-9);
  near(sol.force[2] / (P / (2 * Math.tan(alpha))), 1, 1e-9);
  near(sol.reactions[0], P / 2, 1e-6);
  near(sol.reactions[1], P / 2, 1e-6);
});
test('3-panel Warren truss with 90 kN on joint 1: every member matches the method of joints', () => {
  const t = buildTruss(3, 4, 4);
  const loads = new Array(2 * t.nodes.length).fill(0);
  loads[2 * 1 + 1] = -90000;
  const sol = solveTruss(t, t.members.map(() => 0.003), loads);
  const r = 67.0820393, s = 33.5410197;
  const hand = [30, 45, 15, -60, -30, -r, r, s, -s, s, -s].map((v) => v * 1000);
  hand.forEach((v, i) => near(sol.force[i], v, 1e-3 * 1000 * 0.001 + 1, `member ${i}`));
  near(sol.reactions[0], 60000, 1e-4);
  near(sol.reactions[1], 30000, 1e-4);
});

console.log('Euler buckling (independent finite-difference eigenvalue)');
test('capacity in compression equals the buckling load of a pinned column found by finite differences', () => {
  const area = toM2(8), L = 40; // slender: buckles long before it yields
  const I = I_FACTOR * area * area;
  const n = 400, h = L / n;
  // smallest eigenvalue of -y'' = lambda y, y(0) = y(L) = 0, by inverse iteration on the tridiagonal matrix
  const m = n - 1;
  let y = new Array<number>(m).fill(1);
  let lambda = 0;
  for (let it = 0; it < 60; it++) {
    // solve (tridiag(-1, 2, -1) / h^2) z = y with the Thomas algorithm
    const c = new Array<number>(m), d = new Array<number>(m);
    c[0] = -0.5; d[0] = (y[0] * h * h) / 2;
    for (let i = 1; i < m; i++) {
      const den = 2 + c[i - 1];
      c[i] = -1 / den;
      d[i] = (y[i] * h * h + d[i - 1]) / den;
    }
    const z = new Array<number>(m);
    z[m - 1] = d[m - 1];
    for (let i = m - 2; i >= 0; i--) z[i] = d[i] - c[i] * z[i + 1];
    const norm = Math.hypot(...z);
    lambda = Math.hypot(...y) / norm;
    y = z.map((v) => v / norm);
  }
  const pcr = E * I * lambda;
  near(capacity(area, L, true) / pcr, 1, 2e-4);
  near(capacity(area, L, true) / ((Math.PI ** 2 * E * I) / (L * L)), 1, 1e-12);
});

console.log('Bridge dynamics');
test('at rest under its own weight the deck settles to the static solution and stays still', () => {
  const t = buildTruss(6);
  const areas = t.members.map(() => 30);
  const sim = new BridgeSim(t, areas.map(toM2), TRUCK, { truck: false });
  const stat = solveTruss(t, areas.map(toM2), truckLoads(t, TRUCK, -50));
  sim.advance(0.01); // starts from the static equilibrium
  const mid = t.panels / 2;
  near(sim.displacement()[2 * mid + 1] / stat.disp[2 * mid + 1], 1, 1e-2);
  const v0 = sim.kineticEnergy();
  sim.advance(2);
  assert.ok(sim.kineticEnergy() < 1e-3 + v0, 'no jitter at rest');
  near(sim.displacement()[2 * mid + 1] / stat.disp[2 * mid + 1], 1, 1e-2);
});
test('without damping the energy of a plucked truss is conserved (symplectic step)', () => {
  const t = buildTruss(5);
  const sim = new BridgeSim(t, t.members.map(() => toM2(25)), TRUCK, { damping: false, truck: false });
  sim.pluck(0.002);
  const e0 = sim.excitation();
  let worst = 0;
  for (let i = 0; i < 40; i++) { sim.advance(0.05); worst = Math.max(worst, Math.abs(sim.excitation() - e0) / e0); }
  assert.ok(worst < 2e-3, `energy drift ${worst}`);
});
test('with damping the energy never grows', () => {
  const t = buildTruss(5);
  const sim = new BridgeSim(t, t.members.map(() => toM2(25)), TRUCK, { truck: false });
  sim.pluck(0.002);
  let prev = sim.excitation();
  for (let i = 0; i < 40; i++) { sim.advance(0.05); const e = sim.excitation(); assert.ok(e <= prev * (1 + 1e-6) + 1e-9, `energy grew at ${i}`); prev = e; }
});
test('halving the time step changes the peak mid-span deflection by under 1%', () => {
  const t = buildTruss(6);
  const areas = t.members.map(() => 40);
  const peak = (dt: number) => {
    const sim = new BridgeSim(t, areas.map(toM2), TRUCK, { dt });
    let m = 0;
    while (sim.u < t.panels + 0.5 && !sim.collapsed) { sim.advance(0.05); m = Math.min(m, sim.displacement()[2 * 3 + 1]); }
    return m;
  };
  near(peak(SIM_DT) / peak(SIM_DT / 2), 1, 0.01);
});
test('frame rate does not matter: 30 frames of 1/60 s equal one frame of 0.5 s', () => {
  const t = buildTruss(6);
  const areas = t.members.map(() => 40);
  const a = new BridgeSim(t, areas.map(toM2), TRUCK), b = new BridgeSim(t, areas.map(toM2), TRUCK);
  for (let i = 0; i < 30; i++) a.advance(1 / 60);
  b.advance(0.5);
  assert.equal(a.steps, b.steps);
  const da = a.displacement(), db = b.displacement();
  da.forEach((v, i) => near(v, db[i], 1e-9));
});
test('a collapse is the same however the frames are cut', () => {
  const t = buildTruss(6);
  const areas = t.members.map((_, i) => (i === 2 ? 2 : 40));
  const run = (frame: number, total: number) => { const s = new BridgeSim(t, areas.map(toM2), TRUCK); for (let k = 0; k < Math.round(total / frame); k++) s.advance(frame); return s; };
  const a = run(1 / 60, 9), b = run(1 / 30, 9);
  assert.ok(a.collapsed && b.collapsed, 'the thin member fails');
  assert.equal(a.steps, b.steps);
  const pa = a.positions(), pb = b.positions();
  pa.forEach((p, i) => { near(p.x, pb[i].x, 1e-9); near(p.y, pb[i].y, 1e-9); });
});
test('an overloaded member fails by the right mode and the span keeps falling under gravity', () => {
  const t = buildTruss(6);
  const areas = t.members.map((_, i) => (i === 2 ? 1.5 : 40));
  const sim = new BridgeSim(t, areas.map(toM2), TRUCK);
  sim.advance(12);
  assert.ok(sim.collapsed);
  assert.ok([...sim.broken.values()].every((m) => m === 'snapped' || m === 'buckled'));
  const lowest = Math.min(...sim.positions().map((p) => p.y));
  assert.ok(lowest < -2, `the span falls (lowest ${lowest})`);
});
test('dynamic amplification is small: a pass never fails a member that the static envelope passes', () => {
  for (let seed = 1; seed <= 60; seed++) {
    const spec = makeBridge(seed * 7919);
    const t = buildTruss(spec.panels);
    const up = spec.areas.map((a, i) => (spec.weak.includes(i) ? a * UPGRADE : a));
    const okSim = new BridgeSim(t, up.map(toM2), spec.truck);
    while (okSim.u < spec.panels + 1.2 && !okSim.collapsed) okSim.advance(0.1);
    assert.ok(!okSim.collapsed, `seed ${seed}: reinforced bridge failed dynamically`);
    const badSim = new BridgeSim(t, spec.areas.map(toM2), spec.truck);
    while (badSim.u < spec.panels + 1.2 && !badSim.collapsed) badSim.advance(0.1);
    assert.ok(badSim.collapsed, `seed ${seed}: weak bridge did not fail`);
    assert.ok(badSim.firstFailure.length > 0 && badSim.firstFailure.every((i) => spec.weak.includes(i)), `seed ${seed}: first to fail was ${badSim.firstFailure} but the weak ones are ${spec.weak}`);
  }
});
test('dynamicResponse samples the pass at the requested interval', () => {
  const t = buildTruss(6);
  const r = dynamicResponse(t, t.members.map(() => toM2(40)), TRUCK, 0.1, 20);
  assert.equal(r.time.length, 20);
  assert.equal(r.disp.length, 20);
  near(r.time[1] - r.time[0], 0.1, 1e-6);
  assert.ok(r.maxUtil.every((u) => u >= 0 && u < 1));
});

void memberLength;
console.log(`\n${passed} passed`);
