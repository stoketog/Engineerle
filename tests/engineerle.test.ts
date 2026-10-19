import assert from 'node:assert/strict';
import { parseExpr } from '@/engineerle/expr';
import { makeGraph, makeWaveform, checkGraph, graphFn, type GraphSpec } from '@/engineerle/graph';
import { makeLever, balancePoint, isLevel, settleAngle, tolerance, moment } from '@/engineerle/lever';
import { buildTruss, solveTruss, truckLoads, makeBridge, envelope, capacity, UPGRADE, startCollapse, stepCollapse } from '@/engineerle/truss';
import { makeBarge, bargeState, isSolved, solutions as bargeSolutions, withinLimits } from '@/engineerle/barge';
import { emptyStore, recordAttempt, addSeconds, getDay, dayDone, dayPoints, streak, totals, shareText, sanitise, square, STORE_VERSION } from '@/engineerle/store';
import { pickDay } from '@/engineerle/select';
import { byId } from '@/engineerle/registry';
import { puzzlePoints } from '@/engineerle/scoring';

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
    assert.ok(!('hints' in g), 'a puzzle carries no hints');
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

console.log('Puzzle 1b: the oscilloscope waveform');
const wave = (w: GraphSpec, o: { A?: number; f?: number; deg?: number; c?: number } = {}) => {
  const [A, f, p, c] = w.c;
  return `${o.A ?? A}*sin(2*pi*${o.f ?? f}*t + ${o.deg ?? Math.round((p * 180) / Math.PI)}*deg) + ${o.c ?? c}`;
};
test('a waveform is A sin(2 pi f t + p) + c with the stated ranges, and fits the screen', () => {
  const oneTwoFive = (v: number) => [1, 2, 5].some((m) => Math.abs(Math.log10(v / m) - Math.round(Math.log10(v / m))) < 1e-9);
  for (let s = 1; s <= 500; s++) {
    const w = makeWaveform(s * 97);
    assert.equal(w.kind, 'waveform');
    const [A, f, p, c] = w.c;
    assert.ok(A >= 0.5 && A <= 5 && Math.abs(A * 2 - Math.round(A * 2)) < 1e-9, `A ${A}`);
    assert.ok(f >= 50 && f <= 5000, `f ${f}`);
    const deg = (p * 180) / Math.PI;
    assert.ok(Math.abs(deg / 15 - Math.round(deg / 15)) < 1e-9, `phase ${deg}`);
    assert.ok(c === 0 || Math.abs(c * 2 - Math.round(c * 2)) < 1e-9, `offset ${c}`);
    const sc = w.scope!;
    assert.ok(oneTwoFive(sc.vdiv) && oneTwoFive(sc.tdiv), `1-2-5 scales ${sc.vdiv} ${sc.tdiv}`);
    assert.ok(A + Math.abs(c) <= 3.8 * sc.vdiv, 'the trace fits vertically');
    const cycles = 10 * sc.tdiv * f;
    assert.ok(cycles >= 2 - 1e-9 && cycles <= 5 + 1e-9, `cycles on screen ${cycles}`);
    assert.deepEqual(w.view, { xmin: 0, xmax: 10 * sc.tdiv, ymin: -4 * sc.vdiv, ymax: 4 * sc.vdiv });
  }
});
test('the setter\'s answer solves every waveform, in the forms people write', () => {
  for (let s = 1; s <= 500; s++) {
    const w = makeWaveform(s * 131);
    assert.ok(checkGraph(w, w.answer).ok, `${w.answer}`);
    assert.ok(checkGraph(w, wave(w)).ok, wave(w));
    const [A, f, p, c] = w.c;
    assert.ok(checkGraph(w, `${A} sin(${p} + 2 pi ${f} t) + ${c}`).ok, 'phase first, radians');
    assert.ok(checkGraph(w, `v(t) = ${c} + ${A}*sin(2*π*${f}*t + ${p})`).ok, 'v(t) = and π');
  }
});
test('a phase 15 degrees out, a wrong amplitude, frequency or offset do not solve it', () => {
  for (let s = 1; s <= 200; s++) {
    const w = makeWaveform(s * 71);
    const [A, f, p, c] = w.c;
    const deg = Math.round((p * 180) / Math.PI);
    assert.ok(!checkGraph(w, wave(w, { deg: deg + 15 })).ok, `+15: ${w.answer}`);
    assert.ok(!checkGraph(w, wave(w, { deg: deg - 15 })).ok, `-15: ${w.answer}`);
    assert.ok(!checkGraph(w, wave(w, { A: A + 0.5 })).ok, 'amplitude');
    assert.ok(!checkGraph(w, wave(w, { f: f * 1.1 })).ok, 'frequency +10%');
    assert.ok(!checkGraph(w, wave(w, { c: c + 0.5 })).ok, 'offset');
  }
});
test('unreadable or meaningless input is refused (no guess used)', () => {
  const w = makeWaveform(5);
  for (const bad of ['', '   ', 't +', '1/0', 'sin(', 'x', 'ln(-1)']) {
    const v = checkGraph(w, bad);
    assert.equal(v.ok, false, bad);
    assert.ok(typeof v.error === 'string' && v.error.length > 0, `refused: "${bad}"`);
  }
  assert.equal(checkGraph(w, '1').error, undefined, 'a constant is a wrong answer, not a refusal');
});
test('the parser knows deg and takes t as the variable only when told to', () => {
  near(parseExpr('90 deg')(0), Math.PI / 2, 1e-12);
  near(parseExpr('sin(30 deg)')(0), 0.5, 1e-12);
  near(parseExpr('2 pi t', 't')(0.25), Math.PI / 2, 1e-12);
  near(parseExpr('tan(t)', 't')(0.5), Math.tan(0.5), 1e-12);
  assert.throws(() => parseExpr('t'), /Unknown/);
  assert.throws(() => parseExpr('x', 't'), /Unknown/);
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
test('the collapse simulation keeps members at length and lets the broken span fall', () => {
  const b = makeBridge(2026);
  const t = buildTruss(b.panels);
  const c = startCollapse(t, new Set(b.weak), new Array(t.nodes.length * 2).fill(0));
  for (let i = 0; i < 240; i++) stepCollapse(c, 1 / 60);
  assert.ok(c.pos.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)));
  assert.ok(c.pos.some((p, i) => p.y < t.nodes[i].y - 0.5), 'something fell');
  assert.ok(c.pos.every((p) => p.y >= c.floor - 1e-6));
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

console.log('Progress');
const PAR = 90;
const DAY = '2026-10-20';
test('points follow the guess and the time, and a puzzle that runs out of guesses scores nothing', () => {
  let s = emptyStore();
  s = addSeconds(s, DAY, 0, 40); s = recordAttempt(s, DAY, 0, true, PAR);
  s = addSeconds(s, DAY, 1, 225); s = recordAttempt(s, DAY, 1, false, PAR); s = recordAttempt(s, DAY, 1, true, PAR);
  s = addSeconds(s, DAY, 2, 400); for (const hit of [false, false, true]) s = recordAttempt(s, DAY, 2, hit, PAR);
  s = addSeconds(s, DAY, 3, 30); for (let i = 0; i < 3; i++) s = recordAttempt(s, DAY, 3, false, PAR);
  const d = getDay(s, DAY);
  assert.deepEqual(d.puzzles.map((p) => p.points), [100, 46, 14, 0, 0]);
  assert.deepEqual(d.puzzles.map((p) => p.attempts), [1, 2, 3, 3, 0]);
  assert.deepEqual(d.puzzles.map((p) => p.seconds), [40, 225, 400, 30, 0]);
  assert.ok(!dayDone(d), 'the fifth puzzle is untouched');
  assert.equal(dayPoints(d), 160);
  assert.deepEqual(d.puzzles.map(square), ['🟩', '🟨', '🟧', '⬛', '⬛']);
});
test('a finished puzzle is never re-scored and its clock stops', () => {
  let s = emptyStore();
  s = addSeconds(s, DAY, 0, 12); s = recordAttempt(s, DAY, 0, true, PAR);
  assert.equal(recordAttempt(s, DAY, 0, false, PAR), s);
  assert.equal(addSeconds(s, DAY, 0, 50), s);
  assert.equal(getDay(s, DAY).puzzles[0].seconds, 12);
});
test('time only ever goes up, and nonsense is ignored', () => {
  let s = emptyStore();
  s = addSeconds(s, DAY, 1, 10);
  for (const bad of [-5, NaN, Infinity, 0]) assert.equal(addSeconds(s, DAY, 1, bad), s);
  s = addSeconds(s, DAY, 1, 2.5);
  assert.equal(getDay(s, DAY).puzzles[1].seconds, 12.5);
  assert.equal(addSeconds(s, DAY, 9, 3), s, 'no such puzzle');
});
test("a day's record is lined up with that day's puzzles by id", () => {
  const ids = pickDay(DAY);
  let s = emptyStore();
  assert.deepEqual(getDay(s, DAY).puzzles.map((p) => p.id), ids);
  s = recordAttempt(s, DAY, 2, true, PAR);
  assert.equal(getDay(s, DAY).puzzles[2].id, ids[2]);
  assert.equal(getDay(s, DAY).puzzles[2].solved, true);
  // if the day's set changes later (a puzzle added to the pool), progress follows the puzzle, not the position
  const moved = { ...s, days: { ...s.days, [DAY]: { puzzles: [...getDay(s, DAY).puzzles].reverse() } } };
  const back = getDay(moved, DAY);
  assert.deepEqual(back.puzzles.map((p) => p.id), ids);
  assert.equal(back.puzzles[2].solved, true);
});
test('streaks, totals and the share text', () => {
  let s = emptyStore();
  for (const k of ['2026-10-19', '2026-10-20', '2026-10-21']) for (let i = 0; i < 5; i++) s = recordAttempt(s, k, i, i !== 3 || k !== '2026-10-20', PAR);
  // day 2 puzzle 3 is only attempted once, so that day is not finished
  assert.equal(streak(s, '2026-10-21'), 1);
  for (let i = 0; i < 2; i++) s = recordAttempt(s, '2026-10-20', 3, false, PAR);
  assert.equal(streak(s, '2026-10-21'), 3);
  assert.equal(streak(s, '2026-10-22'), 3, "today still open keeps yesterday's run");
  assert.equal(streak(s, '2026-10-25'), 0);
  const t = totals(s);
  assert.equal(t.played, 3);
  assert.equal(t.perfect, 2);
  assert.equal(t.best, 500);
  const txt = shareText('2026-10-20', getDay(s, '2026-10-20'));
  assert.ok(txt.startsWith('Engineerle #2  400/500') && txt.includes('🟩🟩🟩⬛🟩'), txt);
});
test('saved data is cleaned on load: old versions, junk, odd numbers and unknown puzzles', () => {
  const ids = pickDay('2026-10-19');
  const par = byId(ids[0])!.parSeconds;
  const s = sanitise({ v: STORE_VERSION, days: { '2026-10-19': { puzzles: [{ id: ids[0], attempts: 99, solved: true, seconds: -5, points: 1e9 }, { attempts: 'x' }, null] }, junk: {}, '2026-13-45x': {} } });
  assert.equal(Object.keys(s.days).length, 1);
  const d = s.days['2026-10-19'];
  assert.equal(d.puzzles.length, 5);
  assert.equal(d.puzzles[0].attempts, 3);
  assert.equal(d.puzzles[0].seconds, 0);
  assert.equal(d.puzzles[0].points, puzzlePoints(3, 0, par), 'points are recomputed, never trusted');
  assert.equal(d.puzzles[1].attempts, 0);
  assert.deepEqual(d.puzzles.map((p) => p.id), ids, 'missing ids are filled in from the day');
  assert.equal(sanitise({ v: STORE_VERSION, days: { '2026-10-19': { puzzles: [{ seconds: 1e12 }] } } }).days['2026-10-19'].puzzles[0].seconds, 86400);
  assert.equal(sanitise({ v: STORE_VERSION, days: { '2026-10-19': { puzzles: [{ id: 'gone', attempts: 1, solved: true, points: 77 }] } } }).days['2026-10-19'].puzzles[0].points, 77, 'a retired puzzle keeps its recorded score');
  assert.equal(sanitise({ v: STORE_VERSION, days: { '2026-10-19': { puzzles: [{ id: 'gone', attempts: 1, solved: true, points: 500 }] } } }).days['2026-10-19'].puzzles[0].points, 100, 'but never more than 100');
});
test('version 1 saves, nothing, and non-objects all load as a clean slate; the store survives JSON', () => {
  for (const raw of [null, undefined, 'x', 5, [], {}, { v: 1, days: { '2026-10-19': { puzzles: [{ attempts: 1, solved: true }] } } }, { v: 2 }, { v: 2, days: 'no' }]) {
    const s = sanitise(raw);
    assert.equal(s.v, STORE_VERSION);
    assert.deepEqual(s.days, {});
  }
  let s = emptyStore();
  s = addSeconds(s, DAY, 0, 33.5); s = recordAttempt(s, DAY, 0, true, PAR);
  assert.deepEqual(sanitise(JSON.parse(JSON.stringify(s))), s);
  assert.deepEqual(sanitise(JSON.parse('{"v":2,"days":{"__proto__":{"puzzles":[]},"constructor":{}}}')).days, {});
});

console.log(`\n${passed} passed`);
