import assert from 'node:assert/strict';
import { E24, solveNetwork, branchCurrents, makeCircuit, evaluate, ladderValues, formatOhms, type CircuitSpec, type Resistor } from '@/engineerle/circuit';
import { rng } from '@/engineerle/rand';

let passed = 0;
const test = (name: string, fn: () => void) => {
  try { fn(); passed++; console.log('  ✓', name); } catch (e) { console.error('  ✗', name, '\n   ', (e as Error).message); process.exitCode = 1; }
};
const near = (a: number, b: number, tol: number, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} ${a} vs ${b}`);

console.log('Standard values');
test('E24 is the standard 24 values per decade', () => {
  assert.deepEqual(E24, [1.0, 1.1, 1.2, 1.3, 1.5, 1.6, 1.8, 2.0, 2.2, 2.4, 2.7, 3.0, 3.3, 3.6, 3.9, 4.3, 4.7, 5.1, 5.6, 6.2, 6.8, 7.5, 8.2, 9.1]);
  const l = ladderValues();
  assert.equal(l.length, 24 * 7);
  assert.equal(l[0], 1);
  assert.equal(l[l.length - 1], 9.1e6);
  assert.ok(l.every((v, i) => i === 0 || v > l[i - 1]), 'ascending');
});
test('values print the way they are marked on a resistor', () => {
  assert.equal(formatOhms(4.7), '4.7 Ω');
  assert.equal(formatOhms(470), '470 Ω');
  assert.equal(formatOhms(1000), '1 kΩ');
  assert.equal(formatOhms(4700), '4.7 kΩ');
  assert.equal(formatOhms(68000), '68 kΩ');
  assert.equal(formatOhms(2.2e6), '2.2 MΩ');
});

console.log('Nodal analysis against hand calculations');
test('9 V across 1 k and 2 k: 3 mA, and 6 V at the junction', () => {
  const R: Resistor[] = [{ a: 1, b: 2, ohms: 1000 }, { a: 2, b: 0, ohms: 2000 }];
  const v = solveNetwork(3, R, [{ node: 1, volts: 9 }]);
  near(v[2], 6, 1e-9);
  near(branchCurrents(R, v)[0], 0.003, 1e-12);
});
test('1 k in parallel with 1 k across 10 V draws 20 mA', () => {
  const R: Resistor[] = [{ a: 1, b: 0, ohms: 1000 }, { a: 1, b: 0, ohms: 1000 }];
  const v = solveNetwork(2, R, [{ node: 1, volts: 10 }]);
  near(branchCurrents(R, v).reduce((s, i) => s + i, 0), 0.02, 1e-12);
});
test('a balanced Wheatstone bridge has no voltage across its middle', () => {
  const R: Resistor[] = [{ a: 1, b: 2, ohms: 1000 }, { a: 2, b: 0, ohms: 1000 }, { a: 1, b: 3, ohms: 1000 }, { a: 3, b: 0, ohms: 1000 }, { a: 2, b: 3, ohms: 1000 }];
  const v = solveNetwork(4, R, [{ node: 1, volts: 10 }]);
  near(v[2] - v[3], 0, 1e-9);
  near(branchCurrents(R, v)[4], 0, 1e-12);
});
test('an unbalanced bridge agrees with the closed form (Thevenin) result', () => {
  // 10 V; arms R1 = 1 k, R2 = 2 k (left), R3 = 3 k, R4 = 4 k (right); detector 5 k between the midpoints
  const R: Resistor[] = [{ a: 1, b: 2, ohms: 1000 }, { a: 2, b: 0, ohms: 2000 }, { a: 1, b: 3, ohms: 3000 }, { a: 3, b: 0, ohms: 4000 }, { a: 2, b: 3, ohms: 5000 }];
  const v = solveNetwork(4, R, [{ node: 1, volts: 10 }]);
  const vth = 10 * (2000 / 3000 - 4000 / 7000);
  const rth = (1000 * 2000) / 3000 + (3000 * 4000) / 7000;
  near(branchCurrents(R, v)[4], vth / (rth + 5000), 1e-12, 'detector current');
  near(v[2] - v[3], (vth * 5000) / (rth + 5000), 1e-9, 'detector voltage');
});
test('a two-stage ladder agrees with working back from the far end', () => {
  const R: Resistor[] = [{ a: 1, b: 2, ohms: 1000 }, { a: 2, b: 0, ohms: 2000 }, { a: 2, b: 3, ohms: 3000 }, { a: 3, b: 0, ohms: 6000 }];
  const v = solveNetwork(4, R, [{ node: 1, volts: 12 }]);
  const far = 3000 + 6000, shunt = (2000 * far) / (2000 + far);
  const vA = (12 * shunt) / (1000 + shunt);
  near(v[2], vA, 1e-9);
  near(v[3], (vA * 6000) / 9000, 1e-9);
});

function randomNetwork(r: () => number) {
  const nodes = 4 + Math.floor(r() * 5);
  const R: Resistor[] = [];
  // a spanning chain keeps everything connected, then extra branches
  for (let i = 1; i < nodes; i++) R.push({ a: i, b: Math.floor(r() * i), ohms: 10 ** (1 + r() * 4) });
  for (let k = 0; k < nodes; k++) {
    const a = Math.floor(r() * nodes), b = Math.floor(r() * nodes);
    if (a !== b) R.push({ a, b, ohms: 10 ** (1 + r() * 4) });
  }
  return { nodes, R, sources: [{ node: 1, volts: 1 + r() * 20 }] };
}

console.log('Kirchhoff checks on random networks');
test('KCL: net current at every node that is not a source or ground is zero', () => {
  const r = rng(2024);
  for (let n = 0; n < 200; n++) {
    const { nodes, R, sources } = randomNetwork(r);
    const v = solveNetwork(nodes, R, sources);
    const I = branchCurrents(R, v);
    for (let k = 2; k < nodes; k++) {
      let net = 0;
      R.forEach((res, i) => { if (res.a === k) net -= I[i]; if (res.b === k) net += I[i]; });
      assert.ok(Math.abs(net) < 1e-9, `node ${k}: ${net}`);
    }
  }
});
test('KVL: the drops along any path from the source to ground add up to the source', () => {
  const r = rng(77);
  for (let n = 0; n < 200; n++) {
    const { nodes, R, sources } = randomNetwork(r);
    const v = solveNetwork(nodes, R, sources);
    const I = branchCurrents(R, v);
    // walk from the source node to ground along resistors, always to a lower-voltage neighbour
    let at = 1, sum = 0, guard = 0;
    while (at !== 0 && guard++ < 50) {
      let bestI = -1, bestDrop = 0;
      R.forEach((res, i) => {
        const to = res.a === at ? res.b : res.b === at ? res.a : -1;
        if (to < 0) return;
        const drop = (res.a === at ? 1 : -1) * I[i] * res.ohms; // Ohm's law on this branch
        if (drop > bestDrop + 1e-12) { bestDrop = drop; bestI = i; }
      });
      assert.ok(bestI >= 0, 'always a way downhill');
      const res = R[bestI];
      sum += bestDrop;
      at = res.a === at ? res.b : res.a;
    }
    near(sum, sources[0].volts, 1e-9, `path drops (${nodes} nodes)`);
  }
});
test('the elimination agrees with an independent iterative solution (Gauss-Seidel on the node equations)', () => {
  const r = rng(5);
  for (let n = 0; n < 60; n++) {
    const { nodes, R, sources } = randomNetwork(r);
    const v = solveNetwork(nodes, R, sources);
    const w = new Array(nodes).fill(0);
    w[1] = sources[0].volts;
    for (let it = 0; it < 20000; it++) {
      for (let k = 2; k < nodes; k++) {
        let g = 0, gv = 0;
        for (const res of R) {
          if (res.a === k) { g += 1 / res.ohms; gv += w[res.b] / res.ohms; }
          if (res.b === k) { g += 1 / res.ohms; gv += w[res.a] / res.ohms; }
        }
        if (g) w[k] = gv / g;
      }
    }
    for (let k = 0; k < nodes; k++) near(v[k], w[k], 1e-6, `node ${k}`);
  }
});
test('a node that connects to nothing is reported, not solved as zero', () => {
  assert.throws(() => solveNetwork(3, [{ a: 1, b: 0, ohms: 100 }], [{ node: 1, volts: 5 }]));
});

console.log('The puzzle');
const base = (): CircuitSpec => makeCircuit(11);
test('evaluate refuses anything that is not a usable resistance, so it costs no guess', () => {
  const s = base();
  for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY, 1.0000001e7, 1e9]) {
    const e = evaluate(s, bad);
    assert.equal(e.solved, false);
    assert.ok(typeof e.refused === 'string' && e.refused.length > 0, String(bad));
  }
  assert.equal(evaluate(s, 4700).refused, undefined);
  assert.equal(evaluate(s, 1e7).refused, undefined);
});
test('every generated circuit has exactly one E24 answer in 1 ohm to 9.1 megohm, and the starting value is not it', () => {
  const kinds = new Set<string>();
  for (let seed = 1; seed <= 1000; seed++) {
    const s = makeCircuit(seed * 2654435761 >>> 0);
    kinds.add(s.template);
    const hits = ladderValues().filter((v) => evaluate(s, v).solved);
    assert.equal(hits.length, 1, `seed ${seed} ${s.template}: ${hits.join(',')}`);
    assert.ok(!evaluate(s, s.initial).solved, `initial solves seed ${seed}`);
    assert.ok(ladderValues().includes(s.initial));
    assert.ok(Number.isFinite(s.target.value) && s.target.value > 0);
    assert.ok(s.tolerance === 0.02);
    // every fixed resistor is a standard value in a sensible range
    s.resistors.forEach((res, i) => { if (i !== s.free) assert.ok(ladderValues().includes(res.ohms) && res.ohms >= 100 && res.ohms <= 1e5, `R${i} ${res.ohms}`); });
  }
  assert.ok(['series', 'divider', 'bridge', 'ladder'].every((k) => kinds.has(k)), [...kinds].join());
});
test('evaluate reports the meter reading for the value tried, in the target units', () => {
  for (let seed = 1; seed <= 50; seed++) {
    const s = makeCircuit(seed * 977);
    const answer = ladderValues().find((v) => evaluate(s, v).solved)!;
    const e = evaluate(s, answer);
    near(e.measured, s.target.value, 0.02 * s.target.value, 'reading at the answer');
    // doubling the free resistor moves the reading by more than the tolerance
    assert.ok(Math.abs(evaluate(s, answer * 2).measured - e.measured) > 0.02 * s.target.value, 'sensitive to the free resistor');
  }
});
test('makeCircuit is deterministic', () => {
  assert.equal(JSON.stringify(makeCircuit(42)), JSON.stringify(makeCircuit(42)));
  assert.notEqual(JSON.stringify(makeCircuit(42)), JSON.stringify(makeCircuit(43)));
});

console.log(`\n${passed} passed`);
