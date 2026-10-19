'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { MAX_ATTEMPTS } from '@/engineerle/scoring';
import { byId } from '@/engineerle/registry';
import { bestResiduals, evaluate, shakeVectors, throwAngles, type CrankshaftSpec } from '@/engineerle/crankshaft';
import { sfx } from '@/lib/sfx';
import { useSettings } from '@/hooks/useSettings';
import { Board, Note, Unsupported, useStage, type PuzzleProps, guessesLeft } from './Board';
import { useClock } from './clock';
import { box, cyl, outline, setStrut, shadowFloor, steel } from './stage';

const INFO = byId('crankshaft');
const E = 0.55; // crank radius (world units)
const ROD = 1.75; // connecting rod length
const SPACING = 1.5; // distance between cylinders along the shaft
const COLORS = ['#37c2ff', '#7c8cff', '#d56cf5', '#ff7a8a', '#ffb347', '#5fe0a0'];
const RUN_SECONDS = 3.6;
const OMEGA = Math.PI * 2 * 3.2; // radians per second at full speed (slowed so the shake can be seen)

const rad = (d: number) => (d * Math.PI) / 180;
/** Makes small shaking visible without letting large shaking leave the screen. */
const visible = (a: number) => Math.min(1, Math.sqrt(Math.max(0, a)) * 1.1);

interface Api {
  setOrder: (order: number[]) => void;
  run: (order: number[]) => void;
  phase: () => 'idle' | 'running' | 'stopping';
}

/** The throws seen from the front of the engine: where each crank pin points, relative to cylinder 1. */
function EndView({ n, order }: { n: number; order: number[] }) {
  const angles = throwAngles(order.length === n ? order : [...order, ...Array.from({ length: n }, (_, i) => i + 1).filter((c) => !order.includes(c))]);
  return (
    <figure className="m-0 flex flex-col items-center gap-1" data-testid="crank-end">
      <svg width="148" height="148" viewBox="-74 -74 148 148" role="img" aria-label={`Crank throws seen from the front: ${order.map((c) => `cylinder ${c} at ${Math.round(angles[c - 1])} degrees`).join(', ') || 'none chosen yet'}`}>
        <circle r="60" fill="none" stroke="var(--en-line)" />
        <circle r="30" fill="none" stroke="var(--en-line)" strokeDasharray="2 3" />
        {[0, 90, 180, 270].map((a) => (
          <line key={a} x1="0" y1="0" x2={62 * Math.sin(rad(a))} y2={-62 * Math.cos(rad(a))} stroke="var(--en-line)" />
        ))}
        <text x="0" y="-64" textAnchor="middle" fontSize="8" fill="var(--en-faint)">TDC of 1</text>
        {order.map((c) => {
          const a = rad(angles[c - 1]);
          const x = 46 * Math.sin(a), y = -46 * Math.cos(a);
          return (
            <g key={c}>
              <line x1="0" y1="0" x2={x} y2={y} stroke={COLORS[(c - 1) % COLORS.length]} strokeWidth="2" strokeLinecap="round" opacity="0.7" />
              <circle cx={x} cy={y} r="8.5" fill={COLORS[(c - 1) % COLORS.length]} />
              <text x={x} y={y + 3.5} textAnchor="middle" fontSize="10" fontWeight="700" fill="#10243a">{c}</text>
            </g>
          );
        })}
        <circle r="3" fill="var(--en-ink)" />
      </svg>
      <figcaption className="text-center text-[0.7rem]" style={{ color: 'var(--en-mute)' }}>Crank throws, from the front</figcaption>
    </figure>
  );
}

export function CrankshaftPuzzle({ spec, record, onAttempt }: PuzzleProps<CrankshaftSpec>) {
  const clock = useClock();
  const { play, settings } = useSettings();
  const n = spec.n;
  const [order, setOrder] = useState<number[]>([]);
  const [msg, setMsg] = useState<{ k: 'ok' | 'bad' | 'hint'; t: string } | null>(null);
  const [phase, setPhase] = useState<'idle' | 'running' | 'stopping'>('idle');
  const api = useRef<Api | null>(null);
  const done = record.done;
  const latest = useRef({ spec, record, onAttempt, play, settings, order });
  latest.current = { spec, record, onAttempt, play, settings, order };
  const best = useMemo(() => bestResiduals(spec), [spec]);

  /** Throw angles for the 3D model: chosen cylinders at their real angles, the rest waiting at 0. */
  const modelAngles = (o: number[]) => {
    const a = new Array<number>(n).fill(0);
    o.forEach((c, slot) => {
      a[c - 1] = ((720 * slot) / n) % 360;
    });
    return a;
  };

  const { ref, failed } = useStage(
    (stage) => {
      const s = latest.current.spec;
      const root = stage.root;
      const iron = steel('#8aa0b5', { metal: 0.65, rough: 0.35 });
      const dark = steel('#223a52', { metal: 0.3, rough: 0.6 });
      const xs = Array.from({ length: n }, (_, i) => (i - (n - 1) / 2) * SPACING);
      const width = xs[n - 1] - xs[0];

      // the bed it sits on, with springs so the shake can show
      const bed = box(width + 4.6, 0.4, 3.2, steel('#16324f', { metal: 0.1, rough: 0.85 }), false);
      bed.position.y = -2.3;
      root.add(bed);
      outline(bed, stage.ink);
      root.add(shadowFloor(width + 12, 10, -2.5));
      const springMat = steel('#ff8a3d', { metal: 0.4, rough: 0.4 });
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        for (let k = 0; k < 4; k++) {
          const ring = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.05, 6, 14), springMat);
          ring.rotation.x = Math.PI / 2;
          ring.position.set(sx * (width / 2 + 1.5), -2.0 + k * 0.17, sz * 1.1);
          root.add(ring);
        }
      }

      // everything that shakes
      const rig = new THREE.Group();
      root.add(rig);
      const shaft = cyl(0.2, 0.2, width + 3.4, iron, 16);
      shaft.rotation.z = Math.PI / 2;
      rig.add(shaft);
      const cradle = box(width + 3.6, 0.35, 2.4, dark);
      cradle.position.y = -1.35;
      rig.add(cradle);
      outline(cradle, stage.ink);
      const fly = cyl(1.15, 1.15, 0.38, steel('#51708d', { metal: 0.6, rough: 0.4 }), 28);
      fly.rotation.z = Math.PI / 2;
      fly.position.x = width / 2 + 1.55;
      rig.add(fly);
      const flyMark = box(0.42, 0.2, 0.3, steel('#ff8a3d'));
      fly.add(flyMark);
      flyMark.position.set(0.9, 0.1, 0);
      const flyDot = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), steel('#ff8a3d'));
      flyDot.position.set(0, 0.2, 0.95);
      fly.add(flyDot);

      const throws: THREE.Group[] = [];
      const rods: THREE.Mesh[] = [];
      const pistons: THREE.Mesh[] = [];
      xs.forEach((x, i) => {
        const col = new THREE.Color(COLORS[i % COLORS.length]);
        const rb = 0.42;
        const g = new THREE.Group();
        g.position.x = x;
        const web = box(0.16, E + 0.4, 0.55, iron);
        web.position.set(0, (E + 0.4) / 2 - 0.2, 0);
        const web2 = web.clone();
        web2.position.x = 0.42;
        const web3 = web.clone();
        web3.position.x = -0.42;
        const pin = cyl(0.17, 0.17, 0.96, steel(col, { metal: 0.4, rough: 0.4 }), 14);
        pin.rotation.z = Math.PI / 2;
        pin.position.set(0, E, 0);
        g.add(web2, web3, pin);
        const tail = box(0.16, 0.5, 0.7, iron);
        tail.position.set(0.42, -0.5, 0);
        const tail2 = tail.clone();
        tail2.position.x = -0.42;
        g.add(tail, tail2);
        rig.add(g);
        throws.push(g);

        const rod = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 8), steel('#c8d6e3', { metal: 0.6, rough: 0.35 }));
        rod.castShadow = true;
        rig.add(rod);
        rods.push(rod);
        const piston = cyl(rb * 0.9, rb * 0.9, 0.55, steel(col, { metal: 0.5, rough: 0.35 }), 20);
        rig.add(piston);
        pistons.push(piston);
        outline(piston, stage.ink);

        const liner = new THREE.Mesh(
          new THREE.CylinderGeometry(rb, rb, 1.9, 24, 1, true),
          new THREE.MeshStandardMaterial({ color: col, transparent: true, opacity: 0.2, roughness: 0.15, metalness: 0.2, side: THREE.DoubleSide, depthWrite: false }),
        );
        liner.position.set(x, 2.15, 0);
        rig.add(liner);
        const head = cyl(rb * 1.12, rb * 1.12, 0.3, steel('#41607e', { metal: 0.6, rough: 0.4 }), 20);
        head.position.set(x, 3.25, 0);
        rig.add(head);
        const num = stage.label(`${i + 1}`, { size: 0.55, color: '#10243a', bg: COLORS[i % COLORS.length] });
        num.position.set(x, 4.05, 0);
        rig.add(num);
      });

      const sim = {
        theta: 0,
        speed: 0,
        mode: 'idle' as 'idle' | 'running' | 'stopping',
        t: 0,
        order: [] as number[],
        angles: modelAngles(latest.current.order),
        lastSoundAt: 0,
        // the four shaking terms for the current order: amplitude (0..1, made visible) and phase
        terms: { f1: { a: 0, p: 0 }, f2: { a: 0, p: 0 }, c1: { a: 0, p: 0 }, c2: { a: 0, p: 0 } },
        level: 0,
      };

      const pose = () => {
        xs.forEach((x, i) => {
          const psi = sim.theta + rad(sim.angles[i]);
          throws[i].rotation.x = psi;
          const py = E * Math.cos(psi), pz = E * Math.sin(psi);
          const top = py + Math.sqrt(ROD * ROD - pz * pz);
          setStrut(rods[i], new THREE.Vector3(x, py, pz), new THREE.Vector3(x, top, 0), 0.07);
          pistons[i].position.set(x, top + 0.2, 0);
        });
        fly.rotation.x = sim.theta;
      };

      // Normalise by the worst case (every throw in line) so a term of 1 is as bad as it gets.
      let zsum = 0;
      for (let i = 0; i < n; i++) zsum += Math.abs(i - (n - 1) / 2);
      const measure = (full: number[]) => {
        sim.order = full;
        const v = shakeVectors(s, full);
        const term = (vec: { x: number; y: number }, denom: number) => ({ a: visible(Math.hypot(vec.x, vec.y) / denom), p: Math.atan2(vec.y, vec.x) });
        sim.terms = { f1: term(v.f1, n), f2: term(v.f2, n), c1: term(v.c1, zsum * s.pitch), c2: term(v.c2, zsum * s.pitch) };
        sim.level = Math.max(sim.terms.f1.a, sim.terms.f2.a, sim.terms.c1.a, sim.terms.c2.a);
      };
      measure(latest.current.order.length === n ? latest.current.order : Array.from({ length: n }, (_, i) => i + 1));

      const verdict = () => {
        const L = latest.current;
        const attempt = L.record.attempts + 1;
        const ev = evaluate(L.spec, sim.order);
        if (ev.refused) return; // the buttons never allow this; a refused order is not a guess
        if (ev.solved) {
          const left = ev.shake.amp2 > 0.05 ? ' An in-line four cannot cancel the twice-engine-speed shake, and this is as little as any order leaves.' : '';
          setMsg({ k: 'ok', t: `Smooth running: no other firing order does better.${left}` });
          L.play('correct');
        } else {
          let t = ev.shake.amp1 > 0.1 ? 'The engine rocks and shudders on its mounts.' : 'The engine buzzes on its mounts.';
          if (attempt < MAX_ATTEMPTS) t += ` ${guessesLeft(attempt)}`;
          else t = `Out of guesses. A firing order that runs as smooth as this engine can: ${best.orders[0].join('-')}.`;
          setMsg({ k: attempt >= MAX_ATTEMPTS ? 'bad' : 'hint', t });
          L.play('wrong');
        }
        L.onAttempt(ev.solved);
      };

      stage.setView({ target: [0, 0.75, 0], yaw: 0.62, pitch: 0.3, w: width + 6.5, h: 8.2, yawRange: [0.05, 1.2], pitchRange: [0.1, 0.55] });

      api.current = {
        setOrder: (o) => {
          sim.angles = modelAngles(o);
          if (o.length === n) measure(o);
          if (sim.mode === 'idle') pose();
        },
        run: (o) => {
          if (sim.mode !== 'idle' || o.length !== n) return;
          measure(o);
          sim.angles = modelAngles(o);
          setMsg(null);
          if (latest.current.settings.reduceMotion) {
            verdict();
            return;
          }
          sim.mode = 'running';
          sim.t = 0;
          sim.speed = 0;
          setPhase('running');
          sfx.engineOn();
        },
        phase: () => sim.mode,
      };
      pose();

      stage.onFrame = (dt, tt) => {
        if (sim.mode === 'running' || sim.mode === 'stopping') {
          sim.t += dt;
          const target = sim.mode === 'running' ? 1 : 0;
          const k = Math.min(1, dt * (sim.mode === 'running' ? 2.2 : 3.5));
          sim.speed += (target - sim.speed) * k;
          sim.theta += OMEGA * sim.speed * dt;
          if (sim.mode === 'running' && sim.t > RUN_SECONDS) {
            sim.mode = 'stopping';
            sim.t = 0;
            setPhase('stopping');
            verdict();
          } else if (sim.mode === 'stopping' && sim.speed < 0.03) {
            sim.mode = 'idle';
            sim.speed = 0;
            sim.theta = 0;
            sfx.engineOff();
            setPhase('idle');
            rig.position.set(0, 0, 0);
            rig.rotation.z = 0;
          }
          // the unbalanced forces move the whole engine on its springs: one term turning at engine speed, one at twice
          const a = sim.speed * sim.speed, th = sim.theta, T = sim.terms;
          rig.position.y = (T.f1.a * Math.cos(th + T.f1.p) + T.f2.a * Math.cos(2 * th + T.f2.p)) * 0.3 * a;
          rig.rotation.z = (T.c1.a * Math.cos(th + T.c1.p) + T.c2.a * Math.cos(2 * th + T.c2.p)) * 0.07 * a;
          if (tt - sim.lastSoundAt > 0.05) {
            sim.lastSoundAt = tt;
            sfx.engineSet(sim.speed, sim.level * sim.speed);
          }
          pose();
        }
      };

      return () => {
        sfx.engineOff();
        api.current = null;
      };
    },
    [spec],
  );

  useEffect(() => api.current?.setOrder(order), [order]);
  useEffect(() => {
    if (done && !record.solved) setOrder(best.orders[0]);
  }, [done, record.solved, best]);
  useEffect(() => () => sfx.engineOff(), []);

  const busy = phase !== 'idle';
  const complete = order.length === n;
  const angles = useMemo(() => {
    const a = new Array<number | null>(n).fill(null);
    order.forEach((c, slot) => {
      a[c - 1] = ((720 * slot) / n) % 360;
    });
    return a;
  }, [order, n]);
  const tap = (c: number) => {
    if (busy || done) return;
    const at = order.indexOf(c);
    play('snap');
    setMsg(null);
    // tapping a cylinder already in the order takes it, and everything after it, back out
    setOrder((prev) => (at >= 0 ? prev.slice(0, at) : [...prev, c]));
  };
  const OrdinalLabels = ['1st', '2nd', '3rd', '4th', '5th', '6th'];

  return (
    <Board
      info={INFO}
      record={record}
      testId="puzzle-crankshaft"
      view={
        <div className="ens-view" data-testid="crank-view">
          <canvas ref={ref} aria-label={`An in-line ${n}-cylinder four-stroke engine on springs. The crank throws follow the firing order chosen below.`} />
          {failed && <Unsupported />}
          <div className="ens-readout">{n} in line · r/l {spec.lambda.toFixed(2)} · {spec.mass.toFixed(2)} kg pistons</div>
        </div>
      }
    >
      {!done ? (
        <p className="ens-p">
          A four-stroke fires each cylinder once every two turns, and an even-firing engine spaces its {n} power strokes {720 / n}° apart. Tap the cylinders in the order they should fire. Each one&apos;s
          crank throw follows from its place in the order. Run it and watch how it shakes on its mounts.
        </p>
      ) : (
        <div className="ens-note" data-k={record.solved ? 'ok' : 'bad'} data-testid="crank-final">
          {record.solved ? 'Smooth running. ' : 'Out of guesses. '}Firing order: <b className="font-mono">{(record.solved ? order : best.orders[0]).join('-')}</b>
        </div>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Cylinders. Tap in firing order">
            {Array.from({ length: n }, (_, i) => i + 1).map((c) => {
              const at = order.indexOf(c);
              return (
                <button
                  key={c}
                  type="button"
                  className="ens-chip"
                  data-on={at >= 0}
                  disabled={busy || done}
                  onClick={() => tap(c)}
                  aria-pressed={at >= 0}
                  aria-label={`Cylinder ${c}${at >= 0 ? `, fires ${OrdinalLabels[at]}, crank throw at ${Math.round(angles[c - 1] ?? 0)} degrees` : ''}`}
                  data-testid={`crank-cyl-${c}`}
                  style={{ borderLeft: `4px solid ${COLORS[(c - 1) % COLORS.length]}` }}
                >
                  <b>{c}</b>
                  <small>{at >= 0 ? `${OrdinalLabels[at]} · ${Math.round(angles[c - 1] ?? 0)}°` : 'tap'}</small>
                </button>
              );
            })}
          </div>
          <p className="ens-label" data-testid="crank-seq">
            Firing order: <b className="font-mono" style={{ color: 'var(--en-ink)' }}>{order.length ? order.join(' → ') : 'none yet'}</b>
          </p>
        </div>
        <EndView n={n} order={order} />
      </div>
      {!done && (
        <div className="flex items-center justify-between gap-3">
          <button className="ens-ghost" onClick={() => { setOrder([]); setMsg(null); }} disabled={busy || order.length === 0} data-testid="crank-reset">
            Clear order
          </button>
          <button className="ens-btn" onClick={() => { clock.hold(); api.current?.run(order); }} disabled={busy || !complete} data-testid="crank-run">
            {busy ? 'Running…' : complete ? 'Start the engine' : `Choose all ${n} cylinders`}
          </button>
        </div>
      )}
      {msg && !done && <Note kind={msg.k} testId="crank-msg">{msg.t}</Note>}
    </Board>
  );
}
