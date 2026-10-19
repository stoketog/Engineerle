import assert from 'node:assert/strict';
import { parseExpr } from '@/engineerle/expr';
import { makeGraph, checkGraph, graphFn, type GraphSpec } from '@/engineerle/graph';
import { makeLever, balancePoint, isLevel, settleAngle, tolerance, moment } from '@/engineerle/lever';
import { buildTruss, solveTruss, truckLoads, makeBridge, envelope, memberLength, capacity, UPGRADE } from '@/engineerle/truss';
import { makeEngine, isSmooth, forceSum, coupleSum, solutions as crankSolutions, unbalance } from '@/engineerle/crank';
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
    assert.ok(g.hints.length >= 2);
  }
  const q: GraphSpec = { kind: 'graph', family: 'quadratic', c: [2, 1, -3], answer: '2(x-1)^2 - 3', view: { xmin: -6, xmax: 6, ymin: -8, ymax: 30 }, hints: ['', ''] };
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

console.log('Puzzle 4: the engine');
test('perfect balance needs both the force sum and the couple to vanish', () => {
  for (let s = 1; s <= 40; s++) {
    const e = makeEngine(s * 211);
    assert.equal(e.answer[0], 0);
    assert.ok(isSmooth(e, e.answer), 'the stored answer is smooth');
    const f = forceSum(e, e.answer), c = coupleSum(e, e.answer);
    assert.ok(Math.hypot(f.x, f.y) < 1e-6 * 10 + 0.06 * e.m.reduce((a, b) => a + b, 0));
    assert.ok(Math.hypot(c.x, c.y) < 0.06 * e.m.reduce((a, b, i) => a + b * Math.abs(e.z[i]), 0) + 1e-6);
    assert.ok(!isSmooth(e, e.m.map(() => 0)), 'all cranks in line is a shaker');
    assert.ok(crankSolutions(e, 40).length >= 1);
  }
});
test('a known engine: the flat-plane four balances only one way', () => {
  const e = { m: [1, 1, 1, 1], z: [-1.35, -0.45, 0.45, 1.35] };
  assert.ok(isSmooth(e, [0, 180, 180, 0]));
  assert.ok(!isSmooth(e, [0, 180, 0, 180]), 'force balances but the couple does not');
  assert.ok(!isSmooth(e, [0, 0, 180, 180]));
  near(unbalance(e, [0, 180, 0, 180]).couple, 0.5, 1e-9, 'couple');
  near(unbalance(e, [0, 0, 180, 180]).couple, 1, 1e-9, 'worst couple');
  assert.ok(unbalance(e, [0, 180, 0, 180]).force < 1e-9, 'force is balanced even when the couple is not');
});

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
