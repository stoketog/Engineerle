import assert from 'node:assert/strict';
import { parseExpr } from '@/engineerle/expr';
import { makeGraph, makeWaveform, checkGraph, graphFn, type GraphSpec } from '@/engineerle/graph';
import { makeLever, balancePoint, isLevel, settleAngle, tolerance, moment } from '@/engineerle/lever';
import { buildTruss, solveTruss, truckLoads, makeBridge, envelope, memberLength, capacity, UPGRADE } from '@/engineerle/truss';
import { makeBarge, bargeState, isSolved, solutions as bargeSolutions, withinLimits } from '@/engineerle/barge';

let passed = 0;
const test = (name: string, fn: () => void) => {
  try { fn(); passed++; console.log('  ✓', name); } catch (e) { console.error('  ✗', name, '\n   ', (e as Error).message); process.exitCode = 1; }
};
const near = (a: number, b: number, tol: number, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} ${a} vs ${b}`);

console.log('Equation reader');
test('parses precedence, implicit multiplication and powers', () => {
  near(parseExpr('2x^2 - 3x + 1')(3), 10, 1e-9);
  near(parseExpr('y = 3(x+1)^2')(1), 12, 1e-9);
  near(parseExpr('-x^2')(3), -9, 1e-9);
  near(parseExpr('2^x')(3), 8, 1e-9);
  near(parseExpr('sin(2x)')(Math.PI / 4), 1, 1e-9);
  near(parseExpr('4/(x-1) + 2')(3), 4, 1e-9);
  near(parseExpr('|x - 2|')(-1), 3, 1e-9);
  near(parseExpr('x² + √4')(3), 11, 1e-9);
});
test('refuses code and nonsense instead of running it', () => {
  for (const bad of ['alert(1)', 'process.exit()', 'x +', '((x)', 'constructor', '']) {
    let threw = false;
    try { parseExpr(bad); } catch { threw = true; }
    assert.ok(threw, bad);
  }
});

console.log('Puzzle 1: the curve');
test('the setter\'s own answer and an equivalent form are accepted; a near miss is not', () => {
  for (let s = 1; s <= 40; s++) {
    const g = makeGraph(s * 101);
    assert.ok(checkGraph(g, g.answer).ok, `${g.family}: ${g.answer}`);
  }
  const q: GraphSpec = { kind: 'graph', family: 'quadratic', c: [2, 1, -3], answer: '2(x-1)^2 - 3', view: { xmin: -6, xmax: 6, ymin: -8, ymax: 30 } };
  assert.ok(checkGraph(q, '2x^2 - 4x - 1').ok);
  assert.ok(!checkGraph(q, '2x^2 - 4x').ok);
  assert.ok(!checkGraph(q, 'x^2').ok);
  assert.ok(checkGraph(q, 'rubbish +').error);
});
test('graph generation is deterministic and varied', () => {
  assert.equal(makeGraph(5).answer, makeGraph(5).answer);
  assert.ok(new Set(Array.from({ length: 30 }, (_, i) => makeGraph(i * 977).family)).size >= 4);
  const g = makeGraph(12);
  assert.ok(Number.isFinite(graphFn(g)(0)) || g.family === 'rational');
});

console.log('Waveform (oscilloscope)');
test('every generated waveform is an A sin(2 pi f t + p) + c in the ranges the brief gives, and its stated answer solves it', () => {
  for (let seed = 1; seed <= 500; seed++) {
    const w = makeWaveform(seed * 40503);
    assert.equal(w.kind, 'waveform');
    const [A, f, p, c] = w.c;
    assert.ok(A >= 0.5 && A <= 5 && Math.abs(A * 2 - Math.round(A * 2)) < 1e-9, `A ${A}`);
    assert.ok(f >= 50 && f <= 5000, `f ${f}`);
    const k = (p * 12) / Math.PI;
    assert.ok(Math.abs(k - Math.round(k)) < 1e-9 && k >= 0 && k < 24, `phase ${p}`);
    assert.ok(Math.abs(c * 2 - Math.round(c * 2)) < 1e-9, `c ${c}`);
    assert.ok(w.scope && w.scope.vdiv > 0 && w.scope.tdiv > 0);
    // the trace fits the screen and fills a useful part of it
    assert.ok(Math.abs(c) + A <= 4 * w.scope.vdiv * 0.96 && A >= w.scope.vdiv, `fit A=${A} c=${c} vdiv=${w.scope.vdiv}`);
    // two to five periods across the ten divisions, a period being a whole number of half-divisions
    const periods = 10 * w.scope.tdiv * f;
    assert.ok(periods >= 2 - 1e-9 && periods <= 5 + 1e-9, `periods ${periods}`);
    assert.ok(checkGraph(w, w.answer).ok, `${w.answer}`);
  }
});
const FIXED: GraphSpec = { kind: 'waveform', family: 'waveform', c: [2, 500, Math.PI / 6, 1], answer: '2 sin(2 pi 500 t + pi/6) + 1', view: { xmin: 0, xmax: 0.004, ymin: -4, ymax: 4 }, scope: { vdiv: 1, tdiv: 0.0004 } };
test('equivalent ways of writing the answer all pass', () => {
  for (const t of ['2 sin(2 pi 500 t + pi/6) + 1', '2*sin(2*pi*500*t+pi/6)+1', '1 + 2 sin(pi/6 + 2 pi 500 t)', '2sin(1000πt + π/6) + 1', 'v = 2 sin(2π·500·t + 30π/180) + 1', 'y = 2sin(6.283185307179586*500*t + 0.5235987755982988) + 1']) {
    assert.ok(checkGraph(FIXED, t).ok, t);
  }
});
test('a phase out by 15 degrees, a wrong frequency, a wrong amplitude or offset all fail', () => {
  const fits = (t: string) => checkGraph(FIXED, t);
  assert.ok(fits('2 sin(2 pi 500 t + pi/6) + 1').ok);
  assert.ok(!fits('2 sin(2 pi 500 t + pi/6 + pi/12) + 1').ok, '15 degrees later');
  assert.ok(!fits('2 sin(2 pi 500 t + pi/6 - pi/12) + 1').ok, '15 degrees earlier');
  assert.ok(!fits('2 sin(2 pi 520 t + pi/6) + 1').ok, '4% fast');
  assert.ok(!fits('2.25 sin(2 pi 500 t + pi/6) + 1').ok, 'amplitude');
  assert.ok(!fits('2 sin(2 pi 500 t + pi/6)').ok, 'offset missing');
  assert.ok(!fits('2 sin(2 pi 500 t + pi/6 + pi) + 1').ok, 'inverted');
});
test('unreadable or empty answers are refused and so cost no guess; x is not the variable of a waveform', () => {
  const w = makeWaveform(9);
  for (const bad of ['', '   ', 't +', '1/0', 'sin(', 'alert(1)', 'ln(-1)', '2 sin(2 pi 500 x)']) {
    const v = checkGraph(w, bad);
    assert.ok(!v.ok && typeof v.error === 'string' && v.error.length > 0, `${JSON.stringify(bad)} -> ${JSON.stringify(v)}`);
  }
});
test('the ordinary curve puzzle still reads x and still refuses an expression that draws nothing', () => {
  const g = makeGraph(5);
  assert.ok(checkGraph(g, g.answer).ok);
  const v = checkGraph(g, '1/0');
  assert.ok(!v.ok && v.error);
  assert.ok(parseExpr('t', 't')(3) === 3 && parseExpr('2 pi t', 't')(1) === 2 * Math.PI);
  assert.throws(() => parseExpr('x', 't'));
  assert.throws(() => parseExpr('t'));
});

console.log('Puzzle 2: the lever');
test('the pivot at the centre of mass balances; torque about it is zero', () => {
  for (let s = 1; s <= 40; s++) {
    const l = makeLever(s * 313);
    near(moment(l, balancePoint(l)), 0, 1e-6);
    near(l.answer, balancePoint(l), 0.06);
    assert.ok(isLevel(l, Math.round(l.answer * 20) / 20), 'the slider notch next to the answer must be level');
    assert.ok(!isLevel(l, 0), 'doing nothing must not already be right');
    assert.ok(l.loads.length >= 3);
  }
});
test('the beam tilts toward the heavier side and the band is a few tenths of a metre', () => {
  const l = makeLever(77);
  const p = balancePoint(l);
  assert.ok(settleAngle(l, p - 1) > 0 && settleAngle(l, p + 1) < 0);
  const t = tolerance(l);
  assert.ok(t > 0.04 && t < 0.4, String(t));
  assert.ok(isLevel(l, p + t * 0.9) && !isLevel(l, p + t * 1.2));
});

console.log('Puzzle 3: the bridge');
test('the truss is in equilibrium: reactions carry the load, joints balance', () => {
  const t = buildTruss(5);
  assert.equal(t.members.length, 2 * t.nodes.length - 3, 'statically determinate');
  const areas = t.members.map(() => 0.002);
  const f = truckLoads(t, { weight: 200000, spacing: 0.7, front: 0.4 }, 2.3);
  const sol = solveTruss(t, areas, f);
  const total = -f.reduce((s, v, i) => (i % 2 ? s + v : s), 0);
  near(sol.reactions[0] + sol.reactions[1], total, 1, 'reactions');
  // joint equilibrium at every node
  const res = new Array(t.nodes.length * 2).fill(0);
  t.members.forEach((m, i) => {
    const dx = t.nodes[m.b].x - t.nodes[m.a].x, dy = t.nodes[m.b].y - t.nodes[m.a].y, L = Math.hypot(dx, dy);
    res[2 * m.a] += (sol.force[i] * dx) / L; res[2 * m.a + 1] += (sol.force[i] * dy) / L;
    res[2 * m.b] -= (sol.force[i] * dx) / L; res[2 * m.b + 1] -= (sol.force[i] * dy) / L;
  });
  const last = t.panels;
  for (let n = 0; n < t.nodes.length; n++) {
    const ex = n === 0 ? sol.reactions[0] * 0 : 0;
    const ey = n === 0 ? sol.reactions[0] : n === last ? sol.reactions[1] : 0;
    near(res[2 * n] + ex + f[2 * n], 0, 50, `x@${n}`);
    near(res[2 * n + 1] + ey + f[2 * n + 1], 0, 50, `y@${n}`);
  }
});
test('member forces do not depend on how thick the members are (determinate truss)', () => {
  const t = buildTruss(5);
  const f = truckLoads(t, { weight: 200000, spacing: 0.7, front: 0.4 }, 2.3);
  const a = solveTruss(t, t.members.map(() => 0.002), f).force;
  const b = solveTruss(t, t.members.map((_, i) => 0.001 + 0.0004 * (i % 5)), f).force;
  a.forEach((v, i) => near(v, b[i], Math.abs(v) * 1e-6 + 1, `member ${i}`));
});
test('buckling: a long slender strut carries less than the same steel in tension', () => {
  assert.ok(capacity(0.001, 4.5, true) < capacity(0.001, 4.5, false));
  assert.ok(capacity(0.0004, 4.5, true) < capacity(0.0004, 3, true));
  near(capacity(0.002, 4, true) / capacity(0.001, 4, true), 4, 1e-9, 'Euler load grows with A squared');
});
test('generated bridges fail exactly at the weak members and are fixed by upgrading them', () => {
  for (let s = 1; s <= 8; s++) {
    const b = makeBridge(s * 4099);
    const t = buildTruss(b.panels);
    assert.equal(b.budget, b.weak.length);
    const env = envelope(t, b.areas, b.truck);
    env.forEach((u, i) => assert.equal(u > 1, b.weak.includes(i), `member ${i} util ${u.toFixed(2)}`));
    const up = envelope(t, b.areas.map((a, i) => (b.weak.includes(i) ? a * UPGRADE : a)), b.truck);
    assert.ok(up.every((u) => u <= 1), 'upgraded bridge holds');
    // upgrading a strong member instead leaves the weak ones failing
    const wrong = b.areas.map((a, i) => (!b.weak.includes(i) && i === 0 ? a * UPGRADE : a));
    assert.ok(envelope(t, wrong, b.truck).some((u) => u > 1));
  }
});
/* the collapse is now part of BridgeSim and is tested in tests/truss.test.ts */

console.log('Puzzle 5: the barge');
test('hydrostatics: draft, stability and heel agree with the textbook', () => {
  const b = makeBarge(1);
  const st = bargeState(b, [0, 0, 0, 0]);
  near(st.draft, st.mass / (1.025 * 40 * 12), 1e-9);
  near(st.gmT, st.draft / 2 + 144 / (12 * st.draft) - st.kg, 1e-9);
  // heel satisfies tan θ (GM + ½BM tan²θ) = yG
  const th = (st.heel * Math.PI) / 180, bm = 144 / (12 * st.draft);
  near(Math.tan(th) * (st.gmT + 0.5 * bm * Math.tan(th) ** 2), st.yg, 1e-6);
});
test('generated barges list awkwardly and have honest solutions', () => {
  for (let s = 1; s <= 12; s++) {
    const b = makeBarge(s * 7919);
    const bare = bargeState(b, [0, 0, 0, 0]);
    assert.ok(Math.abs(bare.heel) >= 3 || Math.abs(bare.trim) >= 0.35);
    assert.ok(!isSolved(b, [0, 0, 0, 0]));
    const sol = bargeSolutions(b, 10, 5);
    assert.ok(sol.length >= 1);
    for (const w of sol) {
      assert.ok(withinLimits(b, w) && isSolved(b, w));
      const st = bargeState(b, w);
      assert.ok(Math.abs(st.heel) <= 1 && Math.abs(st.trim) <= 0.3 && st.freeboard >= 0.3);
    }
    assert.ok(!isSolved(b, [110, 110, 110, 110]), 'over the pump limit');
  }
});

console.log(`\n${passed} passed`);
