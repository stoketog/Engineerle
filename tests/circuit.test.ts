import assert from 'node:assert/strict';
import { E24, solveNetwork, makeCircuit, evaluate, measure, dialValues, type CircuitSpec } from '@/engineerle/circuit';

let passed = 0;
const test = (name: string, fn: () => void) => {
  try { fn(); passed++; console.log('  ✓', name); } catch (e) { console.error('  ✗', name, '\n   ', (e as Error).message.split('\n').slice(0, 3).join('\n    ')); process.exitCode = 1; }
};
const near = (a: number, b: number, tol = 1e-9, m = '') => assert.ok(Math.abs(a - b) <= tol, `${m} expected ${b} got ${a}`);

console.log('Resistor networks: nodal analysis against closed forms');
test('E24 is the 24 standard values, 1.0 to 9.1', () => {
  assert.equal(E24.length, 24);
  assert.deepEqual(E24.slice(0, 6), [1.0, 1.1, 1.2, 1.3, 1.5, 1.6]);
  assert.equal(E24[23], 9.1);
  assert.ok(E24.every((v, i) => i === 0 || v > E24[i - 1]));
});
test('9 V across 1 k + 2 k gives 3 mA and 6 V at the junction', () => {
  const v = solveNetwork(3, [{ a: 1, b: 2, ohms: 1000 }, { a: 2, b: 0, ohms: 2000 }], [{ node: 1, volts: 9 }]);
  near(v[0], 0); near(v[1], 9); near(v[2], 6);
  near((v[1] - v[2]) / 1000, 0.003);
});
test('1 k parallel 1 k across 10 V draws 20 mA', () => {
  const v = solveNetwork(2, [{ a: 1, b: 0, ohms: 1000 }, { a: 1, b: 0, ohms: 1000 }], [{ node: 1, volts: 10 }]);
  near(v[1] / 1000 + v[1] / 1000, 0.02);
});
test('a balanced Wheatstone bridge (all 1 k, 10 V) has 0 V across its middle', () => {
  // 1 = supply, 2 = left, 3 = right, ground 0; the bridge resistor joins 2 and 3
  const r = [{ a: 1, b: 2, ohms: 1000 }, { a: 1, b: 3, ohms: 1000 }, { a: 2, b: 0, ohms: 1000 }, { a: 3, b: 0, ohms: 1000 }, { a: 2, b: 3, ohms: 1000 }];
  const v = solveNetwork(4, r, [{ node: 1, volts: 10 }]);
  near(v[2] - v[3], 0); near(v[2], 5);
});
test('an unbalanced bridge matches the closed-form Thevenin result', () => {
  // R1=1k, R2=2k (top), R3=3k, R4=1k (bottom), bridge 10k, 12 V. Open-circuit midpoints: V2 = 12*3/4, V3 = 12*1/3.
  const r = [{ a: 1, b: 2, ohms: 1000 }, { a: 1, b: 3, ohms: 2000 }, { a: 2, b: 0, ohms: 3000 }, { a: 3, b: 0, ohms: 1000 }, { a: 2, b: 3, ohms: 1e12 }];
  const v = solveNetwork(4, r, [{ node: 1, volts: 12 }]);
  near(v[2], 9, 1e-6); near(v[3], 4, 1e-6);
});

console.log('Resistor networks: Kirchhoff on random networks');
let seed = 12345;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const randomNet = () => {
  const n = 3 + Math.floor(rnd() * 6);
  const res: Array<{ a: number; b: number; ohms: number }> = [];
  const ohms = () => E24[Math.floor(rnd() * 24)] * 10 ** (2 + Math.floor(rnd() * 3));
  for (let i = 1; i < n; i++) res.push({ a: i, b: Math.floor(rnd() * i), ohms: ohms() }); // a tree keeps it connected
  for (let k = 0; k < n; k++) { const a = 1 + Math.floor(rnd() * (n - 1)), b = Math.floor(rnd() * n); if (a !== b) res.push({ a, b, ohms: ohms() }); }
  return { n, res, volts: 3 + Math.floor(rnd() * 22) };
};
test('KCL: net current at every node that is not the source or ground is zero (200 networks)', () => {
  for (let k = 0; k < 200; k++) {
    const { n, res, volts } = randomNet();
    const v = solveNetwork(n, res, [{ node: 1, volts }]);
    for (let node = 2; node < n; node++) {
      let net = 0;
      for (const r of res) { if (r.a === node) net += (v[node] - v[r.b]) / r.ohms; else if (r.b === node) net += (v[node] - v[r.a]) / r.ohms; }
      near(net, 0, 1e-9, `node ${node} of net ${k}`);
    }
    assert.ok(v.every((x) => Number.isFinite(x) && x >= -1e-9 && x <= volts + 1e-9), 'voltages stay between ground and the supply');
  }
});
test('KVL: drops around the outer loop add up to the source', () => {
  for (let k = 0; k < 50; k++) {
    const n = 3 + Math.floor(rnd() * 5);
    const res = Array.from({ length: n - 1 }, (_, i) => ({ a: i + 1, b: i + 2 === n ? 0 : i + 2, ohms: E24[Math.floor(rnd() * 24)] * 1000 }));
    const volts = 5 + Math.floor(rnd() * 20);
    const v = solveNetwork(n, res, [{ node: 1, volts }]);
    const i = (v[1] - v[2]) / res[0].ohms;
    near(res.reduce((s, r) => s + i * r.ohms, 0), volts, 1e-9);
  }
});
test('a node with no path to a source or ground is refused, not guessed', () => {
  assert.throws(() => solveNetwork(4, [{ a: 1, b: 0, ohms: 100 }, { a: 2, b: 3, ohms: 100 }], [{ node: 1, volts: 5 }]), /float|connect/i);
});

console.log('Resistor networks: checking a guess');
test('evaluate refuses zero, negative, NaN, infinite and over-10-megohm values, and scores nothing for them', () => {
  const spec = makeCircuit(3);
  for (const bad of [0, -100, NaN, Infinity, -Infinity, 10_000_001, 1e12]) {
    const e = evaluate(spec, bad);
    assert.equal(e.solved, false, String(bad));
    assert.ok(typeof e.refused === 'string' && e.refused.length > 0, `refused ${bad}`);
  }
  assert.equal(evaluate(spec, 1000).refused, undefined);
  assert.equal(evaluate(spec, 10_000_000).refused, undefined);
});
test('every seed gives a puzzle that some E24 value solves, the starting value does not, and few values do', () => {
  const dial = dialValues();
  assert.equal(dial.length, 5 * 24 + 1, 'ten ohms to one megohm');
  assert.equal(dial[0], 10); assert.equal(dial[dial.length - 1], 1_000_000);
  for (let s = 1; s <= 1000; s++) {
    const sp: CircuitSpec = makeCircuit(s * 7919);
    const good = dial.filter((o) => evaluate(sp, o).solved);
    assert.ok(good.length >= 1 && good.length <= 3, `seed ${s}: ${good.length} solutions on ${sp.topology}`);
    assert.equal(evaluate(sp, sp.initial).solved, false, `seed ${s}: the starting value already solves it`);
    assert.ok(sp.target.value > 0, 'a positive target');
    assert.ok(dial.includes(sp.initial), 'the start is on the dial');
  }
});
test('the meter reads what a hand calculation gives, for a divider and for a branch current', () => {
  const div: CircuitSpec = { kind: 'circuit', topology: 'divider', nodes: 3, resistors: [{ a: 1, b: 2, ohms: 2000 }, { a: 2, b: 0, ohms: 1000 }], free: 1, source: { node: 1, volts: 9 }, target: { kind: 'voltage', node: 2, value: 3 }, tolerance: 0.02, initial: 10000 };
  for (const x of [330, 1000, 4700, 22000]) near(measure(div, x), (9 * x) / (2000 + x), 1e-9, `X=${x}`);
  assert.equal(evaluate(div, 1000).solved, true); assert.equal(evaluate(div, 1100).solved, false, '10% high on the resistor is about 2.4% on the output');
  const cur: CircuitSpec = { ...div, target: { kind: 'current', resistor: 0, value: 3 } };
  for (const x of [330, 1000, 4700]) near(measure(cur, x), (9 / (2000 + x)) * 1000, 1e-9, `I at X=${x}`);
  assert.equal(evaluate(cur, 1000).solved, true);
});

console.log(`\n${passed} passed`);
