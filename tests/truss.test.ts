import assert from 'node:assert/strict';
import * as T from '@/engineerle/truss';

let passed = 0;
const test = (name: string, fn: () => void) => {
  try { fn(); passed++; console.log('  ✓', name); } catch (e) { console.error('  ✗', name, '\n   ', (e as Error).message.split('\n')[0]); process.exitCode = 1; }
};
const near = (a: number, b: number, tol: number, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} ${a} vs ${b} (tol ${tol})`);
const rel = (a: number, b: number, tol: number, msg = '') => assert.ok(Math.abs(a - b) <= tol * Math.max(Math.abs(a), Math.abs(b), 1e-300), `${msg} ${a} vs ${b} (rel ${tol})`);
const truck: T.Truck = { weight: 240000, spacing: 0.7, front: 0.4 };
const NO_DEAD = { bottom: 0, top: 0 };

console.log('Truck load');
test('the weight on the span is the weight of the axles that are on it, shared between the two nearest joints', () => {
  const t = T.buildTruss(6);
  for (let k = 0; k <= 400; k++) {
    const u = -2 + (k * (t.panels + 4)) / 400;
    const f = T.truckLoads(t, truck, u, NO_DEAD);
    const on = (p: number) => (p >= 0 && p <= t.panels ? 1 : 0);
    const expect = truck.weight * truck.front * on(u) + truck.weight * (1 - truck.front) * on(u - truck.spacing);
    let sum = 0;
    for (let i = 0; i < f.length; i += 2) {
      assert.equal(f[i], 0, 'no sideways load');
      sum -= f[i + 1];
    }
    near(sum, expect, 1e-6, `u=${u.toFixed(3)}`);
  }
});
test('the load on every joint that carries the span changes smoothly as the truck rolls (no jumps)', () => {
  const t = T.buildTruss(6);
  const steps = 200;
  let prev: number[] | null = null;
  for (let k = 0; k <= steps; k++) {
    const u = -truck.spacing - 0.5 + (k * (t.panels + 2 * truck.spacing + 1)) / steps;
    const f = T.truckLoads(t, truck, u, NO_DEAD);
    if (prev) for (let i = 1; i < t.panels; i++) assert.ok(Math.abs(f[2 * i + 1] - prev[2 * i + 1]) <= 0.05 * truck.weight, `joint ${i} jumps at u=${u.toFixed(3)}`);
    prev = f;
  }
});

console.log('Static solution against hand calculations');
test('three-bar triangle: method of joints gives P/(2 sin a) in the rafters and P/(2 tan a) in the tie', () => {
  const L = 8, h = 3, P = 100e3;
  const t: T.Truss = { panels: 1, panel: L, height: h, nodes: [{ x: 0, y: 0 }, { x: L, y: 0 }, { x: L / 2, y: h }], members: [{ a: 0, b: 1, kind: 'bottom' }, { a: 0, b: 2, kind: 'diag' }, { a: 2, b: 1, kind: 'diag' }] };
  const loads = new Array(6).fill(0);
  loads[5] = -P;
  const sol = T.solveTruss(t, [0.002, 0.002, 0.002], loads);
  const alpha = Math.atan2(h, L / 2);
  rel(sol.force[1], -P / (2 * Math.sin(alpha)), 1e-9, 'left rafter');
  rel(sol.force[2], -P / (2 * Math.sin(alpha)), 1e-9, 'right rafter');
  rel(sol.force[0], P / (2 * Math.tan(alpha)), 1e-9, 'tie');
  rel(sol.reactions[0], P / 2, 1e-9);
  rel(sol.reactions[1], P / 2, 1e-9);
});
test('three-panel Warren truss with a load P at mid-span: every member force matches the hand-solved joints', () => {
  const t = T.buildTruss(3, 4, 4);
  const P = 120000;
  const loads = new Array(t.nodes.length * 2).fill(0);
  loads[2 * 5 + 1] = -P; // top joint at x = 6 m
  const sol = T.solveTruss(t, t.members.map(() => 0.002), loads);
  const d = Math.sqrt(5) / 4; // 0.559017: diagonal force per unit P (63.43 degree diagonals)
  const expect = [0.25, 0.75, 0.25, -0.5, -0.5, -d, d, -d, -d, d, -d].map((x) => x * P);
  expect.forEach((e, i) => near(sol.force[i], e, 1e-6 * P, `member ${i}`));
});
test('Euler: pin-ended strut capacity is pi^2 E I / L^2 with the stated section', () => {
  const A = 0.001, len = 10;
  const euler = (Math.PI ** 2 * T.E * T.I_FACTOR * A * A) / (len * len);
  assert.ok(euler < T.YIELD * A, 'this strut is slender enough to buckle first');
  rel(T.capacity(A, len, true), euler, 1e-12);
  rel(T.capacity(A, len, false), T.YIELD * A, 1e-12);
  rel(T.capacity(0.02, 2, true), T.YIELD * 0.02, 1e-12, 'a short fat strut yields instead');
});

console.log('Dynamic response');
const bridge = () => {
  const t = T.buildTruss(6);
  return { t, areas: t.members.map(() => 0.004) };
};
const deadLoads = (t: T.Truss) => T.truckLoads(t, { weight: 0, spacing: 1, front: 0.5 }, -99);
test('a bridge at rest under its own weight stays exactly where it is (no jitter)', () => {
  const { t, areas } = bridge();
  const d = new T.Dynamics(t, areas, 1 / 240);
  const u0 = d.u.slice();
  for (let i = 0; i < 2400; i++) d.step(deadLoads(t));
  d.u.forEach((x, i) => near(x, u0[i], 1e-12, `dof ${i}`));
  assert.ok(Math.hypot(...d.v) < 1e-9);
});
test('held load: the damped response settles on the static finite-element answer', () => {
  const { t, areas } = bridge();
  const f = T.truckLoads(t, truck, 3.2);
  const stat = T.solveTruss(t, areas, f);
  const d = new T.Dynamics(t, areas, 1 / 240);
  for (let i = 0; i < 2400; i++) d.step(f); // 10 s
  stat.disp.forEach((x, i) => near(d.u[i], x, 1e-9 + Math.abs(x) * 1e-6, `dof ${i}`));
  assert.ok(Math.hypot(...d.v) < 1e-6, `still moving: ${Math.hypot(...d.v)}`);
  const force = d.force();
  stat.force.forEach((x, i) => near(force[i], x, 1 + Math.abs(x) * 1e-6, `member ${i}`));
});
test('free vibration in the first mode decays with the stated 5% damping and rings at the true frequency', () => {
  const { t, areas } = bridge();
  const dt = 1 / 4000;
  const d = new T.Dynamics(t, areas, dt, { zeta: 0.05 });
  const dead = d.u.slice();
  d.u = d.u.map((x, i) => x + 1e-3 * d.mode1[i]);
  const q: number[] = [];
  for (let i = 0; i < 4000; i++) {
    d.step(deadLoads(t));
    q.push(d.u.reduce((s, x, k) => s + d.mode1[k] * (x - dead[k]) * d.mass[k], 0) / d.mode1.reduce((s, m, k) => s + m * m * d.mass[k], 0));
  }
  const peaks: number[] = [];
  for (let i = 1; i < q.length - 1; i++) if (q[i] > q[i - 1] && q[i] >= q[i + 1] && q[i] > 0) peaks.push(i);
  assert.ok(peaks.length >= 3, `only ${peaks.length} peaks`);
  const zeta = 0.05, wd = d.omega1 * Math.sqrt(1 - zeta * zeta);
  rel((peaks[1] - peaks[0]) * dt, (2 * Math.PI) / wd, 0.01, 'period');
  rel(q[peaks[1]] / q[peaks[0]], Math.exp((-2 * Math.PI * zeta) / Math.sqrt(1 - zeta * zeta)), 0.02, 'decay per cycle');
});
test('energy never grows: kinetic plus strain stays below the start plus the work the load did', () => {
  const { t, areas } = bridge();
  const d = new T.Dynamics(t, areas, 1 / 240);
  const e0 = d.energy().kinetic + d.energy().strain;
  for (let i = 0; i < 1500; i++) {
    d.step(T.truckLoads(t, truck, -1 + i * 0.006));
    const e = d.energy();
    const total = e.kinetic + e.strain;
    assert.ok(total <= e0 + d.work + 1e-6 * Math.max(1, e0 + d.work), `step ${i}: ${total} > ${e0 + d.work}`);
  }
});
test('halving the time step changes the peak deflection by less than 1%', () => {
  const { t, areas } = bridge();
  const peak = (dt: number) => {
    const steps = Math.round(6 / dt);
    const r = T.dynamicResponse(t, areas, truck, dt, steps);
    assert.equal(r.disp.length, steps);
    return Math.max(...r.disp.map((u) => Math.max(...u.map(Math.abs))));
  };
  rel(peak(1 / 240), peak(1 / 480), 0.01);
});
test('the dynamic crossing stays close to the static one (dynamic factor between 0.97 and 1.12 on every busy member)', () => {
  for (let s = 1; s <= 6; s++) {
    const b = T.makeBridge(s * 977);
    const t = T.buildTruss(b.panels);
    const stat = T.envelope(t, b.areas, b.truck);
    const dyn = T.crossBridge(t, b.areas, b.truck).peak;
    stat.forEach((u, i) => { if (u > 0.2) { const r = dyn[i] / u; assert.ok(r > 0.97 && r < 1.12, `bridge ${s} member ${i}: factor ${r.toFixed(3)}`); } });
  }
});

console.log('Generated bridges');
test('as built the weak members fail the crossing; reinforcing exactly them holds; reinforcing others does not', () => {
  for (let s = 1; s <= 40; s++) {
    const b = T.makeBridge(s * 4099 + 7);
    const t = T.buildTruss(b.panels);
    const built = T.crossBridge(t, b.areas, b.truck);
    assert.equal(built.ok, false, `seed ${s}: as built holds`);
    built.failed.forEach((i) => assert.ok(b.weak.includes(i), `seed ${s}: ${i} failed but is not weak`));
    const fixed = T.crossBridge(t, b.areas.map((a, i) => (b.weak.includes(i) ? a * T.UPGRADE : a)), b.truck);
    assert.equal(fixed.ok, true, `seed ${s}: reinforced bridge fails (${fixed.failed})`);
    const others = b.areas.map((a, i) => (!b.weak.includes(i) && i < b.budget ? a * T.UPGRADE : a));
    assert.equal(T.crossBridge(t, others, b.truck).ok, false, `seed ${s}: wrong members fixed it`);
  }
});

console.log('Collapse');
const overloaded = () => {
  const b = T.makeBridge(2026);
  const t = T.buildTruss(b.panels);
  const areas = b.areas.map(T.toM2);
  const f = T.truckLoads(t, b.truck, b.panels / 2 + 0.3);
  const sol = T.solveTruss(t, areas, f);
  const broken = new Set<number>([b.weak[0]]);
  return { t, sol, broken, node: Math.round(b.panels / 2) };
};
const run = (frames: number[]) => {
  const { t, sol, broken, node } = overloaded();
  const c = T.startCollapse(t, broken, sol.disp, [{ node, mass: 4 }], -9);
  for (const dt of frames) T.stepCollapse(c, dt);
  return c.pos;
};
test('the collapse starts from the shape on screen: no member is stretched or squeezed at the first frame', () => {
  const { t, sol, broken } = overloaded();
  const c = T.startCollapse(t, broken, sol.disp, [], -9);
  const start = c.pos.map((p) => ({ ...p }));
  T.stepCollapse(c, 1 / 240);
  start.forEach((p, i) => assert.ok(Math.hypot(c.pos[i].x - p.x, c.pos[i].y - p.y) < 1e-3, `joint ${i} jumped ${Math.hypot(c.pos[i].x - p.x, c.pos[i].y - p.y)} m`));
});
test('the collapse looks the same at 30, 60 and 120 frames per second', () => {
  const ref = run(new Array(240).fill(1 / 240));
  for (const fps of [30, 60, 120]) {
    const got = run(new Array(fps).fill(1 / fps));
    got.forEach((p, i) => { near(p.x, ref[i].x, 1e-9, `${fps} fps x@${i}`); near(p.y, ref[i].y, 1e-9, `${fps} fps y@${i}`); });
  }
  const uneven = run(new Array(45).fill(1 / 45));
  uneven.forEach((p, i) => { near(p.x, ref[i].x, 1e-9, `45 fps x@${i}`); near(p.y, ref[i].y, 1e-9, `45 fps y@${i}`); });
});
test('the failed span falls, nothing goes below the river, and the wreck comes to rest', () => {
  const { t, sol, broken, node } = overloaded();
  const c = T.startCollapse(t, broken, sol.disp, [{ node, mass: 4 }], -9);
  for (let i = 0; i < 240 * 20; i++) T.stepCollapse(c, 1 / 240);
  assert.ok(c.pos.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)));
  assert.ok(c.pos.some((p, i) => p.y < t.nodes[i].y - 0.5), 'something fell');
  assert.ok(c.pos.every((p) => p.y >= c.floor - 1e-6));
  const before = c.pos.map((p) => ({ ...p }));
  for (let i = 0; i < 24; i++) T.stepCollapse(c, 1 / 240);
  before.forEach((p, i) => assert.ok(Math.hypot(c.pos[i].x - p.x, c.pos[i].y - p.y) < 0.02, `joint ${i} still moving`));
});

test('the live colouring depends on the forces alone, never on member size or capacity, so it cannot point at the weak members', () => {
  const forces = [120, -300, 40, -10, 0];
  const shade = T.loadShade(forces);
  assert.equal(shade.length, forces.length);
  assert.ok(shade.every((x) => x >= 0 && x <= 1));
  assert.equal(shade[1], Math.max(...shade), 'the member carrying the most is the strongest tint');
  assert.equal(shade[4], 0, 'a member carrying nothing is untinted');
  assert.deepEqual(T.loadShade(forces.map((f) => f * 7)), shade, 'only the pattern of forces matters, not their size');
  assert.deepEqual(T.loadShade([0, 0, 0]), [0, 0, 0], 'a bridge with no load has no tint (and no division by zero)');
  assert.deepEqual(T.loadShade([Number.NaN, 5]).every(Number.isFinite), true, 'a bad force cannot poison the rest');
});

console.log(`\n${passed} passed`);
