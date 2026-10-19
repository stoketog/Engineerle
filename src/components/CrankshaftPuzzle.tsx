'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { MAX_ATTEMPTS } from '@/engineerle/scoring';
import { byId } from '@/engineerle/registry';
import { bestResiduals, evaluate, throwAngles, type CrankshaftSpec, type Evaluation } from '@/engineerle/crankshaft';
import { sfx } from '@/lib/sfx';
import { useSettings } from '@/hooks/useSettings';
import { Board, Note, Unsupported, useStage, type PuzzleProps } from './Board';
import { box, cyl, outline, setStrut, shadowFloor, steel } from './stage';

const INFO = byId('crankshaft')!;
const ROD = 1.9; // connecting rod length (world units); the crank radius follows from the spec's rod ratio
const SCALE = 1.7; // one pitch along the shaft in world units
const COLORS = ['#37c2ff', '#7c8cff', '#d56cf5', '#ff7a8a', '#ffb347', '#5fe0a0'];
const RUN_SECONDS = 2.6;
const OMEGA = Math.PI * 2 * 3.2; // rad/s at full speed, slowed so the shake can be seen
const SHAKE_Y = 3.2; // world units of heave per unit of normalised force
const SHAKE_ROT = 0.55; // radians of rock per unit of normalised couple

const rad = (d: number) => (d * Math.PI) / 180;
const zOf = (n: number, i: number) => i - (n + 1) / 2;
const plural = (k: number) => `${k} ${k === 1 ? 'guess' : 'guesses'} left`;

interface Api {
  setOrder: (order: number[]) => void;
  run: (order: number[], ev: Evaluation) => void;
  busy: () => boolean;
}

/** What the engine does, in the words of someone standing next to it. Physical outcome only: no gauges, no numbers. */
function describe(spec: CrankshaftSpec, ev: Evaluation): string {
  const b = bestResiduals(spec);
  const r = ev.residuals;
  const excess = (k: keyof typeof r) => r[k] - b[k] > Math.max(0.02, 0.02 * b[k] + 0.02);
  const bits: string[] = [];
  if (excess('primaryForce')) bits.push('thumps up and down once every turn');
  if (excess('primaryCouple')) bits.push('rocks end to end once every turn');
  if (excess('secondaryForce')) bits.push('buzzes up and down twice every turn');
  if (excess('secondaryCouple')) bits.push('rocks end to end twice every turn');
  return bits.length ? `She ${bits.join(' and ')}.` : 'She shakes.';
}

export function CrankshaftPuzzle({ spec, record, onAttempt }: PuzzleProps<CrankshaftSpec>) {
  const { play, settings } = useSettings();
  const n = spec.n;
  const [order, setOrder] = useState<number[]>([]);
  const [msg, setMsg] = useState<{ k: 'ok' | 'bad' | 'warn'; t: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const api = useRef<Api | null>(null);
  const done = record.done;
  const latest = useRef({ spec, record, onAttempt, play, settings });
  latest.current = { spec, record, onAttempt, play, settings };
  const best = useMemo(() => bestResiduals(spec).orders[0], [spec]);

  const verdict = (ev: Evaluation, played: number[]) => {
    const L = latest.current;
    const attempt = L.record.attempts + 1;
    if (ev.solved) {
      setMsg({ k: 'ok', t: 'Smooth. Everything that can cancel in this layout does, so the mounts barely move.' });
      L.play('correct');
    } else {
      let t = describe(L.spec, ev);
      if (attempt >= MAX_ATTEMPTS) t = `Out of guesses. A smooth firing order is ${best.join('-')}.`;
      else t += ` ${plural(MAX_ATTEMPTS - attempt)}.`;
      setMsg({ k: attempt >= MAX_ATTEMPTS ? 'bad' : 'warn', t });
      L.play('wrong');
    }
    void played;
    L.onAttempt(ev.solved);
  };

  const { ref, failed } = useStage(
    (stage) => {
      const s = latest.current.spec;
      const root = stage.root;
      const E = ROD * s.lambda; // crank radius
      const iron = steel('#8aa0b5', { metal: 0.65, rough: 0.35 });
      const dark = steel('#223a52', { metal: 0.3, rough: 0.6 });
      const half = ((s.n - 1) / 2) * s.pitch * SCALE;
      const width = half * 2;
      const xAt = (i: number) => zOf(s.n, i) * s.pitch * SCALE;

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

      const throws: THREE.Group[] = [];
      const rods: THREE.Mesh[] = [];
      const pistons: THREE.Mesh[] = [];
      for (let i = 1; i <= s.n; i++) {
        const x = xAt(i);
        const col = new THREE.Color(COLORS[(i - 1) % COLORS.length]);
        const rb = 0.42;
        const g = new THREE.Group();
        g.position.x = x;
        const web = box(0.16, E + 0.4, 0.55, iron);
        web.position.set(0.42, (E + 0.4) / 2 - 0.2, 0);
        const web2 = web.clone();
        web2.position.x = -0.42;
        const pin = cyl(0.17, 0.17, 0.96, steel(col, { metal: 0.4, rough: 0.4 }), 14);
        pin.rotation.z = Math.PI / 2;
        pin.position.set(0, E, 0);
        const tail = box(0.16, 0.5, 0.7, iron);
        tail.position.set(0.42, -0.5, 0);
        const tail2 = tail.clone();
        tail2.position.x = -0.42;
        g.add(web, web2, pin, tail, tail2);
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
        const num = stage.label(`${i}`, { size: 0.55, color: '#10243a', bg: COLORS[(i - 1) % COLORS.length] });
        num.position.set(x, 4.05, 0);
        rig.add(num);
      }

      const sim = {
        theta: 0,
        speed: 0,
        mode: 'idle' as 'idle' | 'running' | 'stopping',
        t: 0,
        angles: throwAngles([], s.n),
        amp: { f1: 0, c1: 0, f2: 0, c2: 0 },
        lastSoundAt: 0,
        verdict: null as null | (() => void),
      };

      const pose = () => {
        for (let i = 0; i < s.n; i++) {
          const psi = sim.theta + rad(sim.angles[i]);
          const x = xAt(i + 1);
          throws[i].rotation.x = psi;
          const py = E * Math.cos(psi), pz = E * Math.sin(psi);
          const top = py + Math.sqrt(ROD * ROD - pz * pz);
          setStrut(rods[i], new THREE.Vector3(x, py, pz), new THREE.Vector3(x, top, 0), 0.07);
          pistons[i].position.set(x, top + 0.2, 0);
        }
        fly.rotation.x = sim.theta;
      };
      pose();

      stage.setView({ target: [0, 0.5, 0], yaw: 0.62, pitch: 0.3, w: width + 6.5, h: 7.2, yawRange: [0.05, 1.2], pitchRange: [0.1, 0.55] });

      api.current = {
        setOrder: (o) => {
          sim.angles = throwAngles(o, s.n);
          if (sim.mode === 'idle') pose();
        },
        run: (o, ev) => {
          if (sim.mode !== 'idle') return;
          sim.angles = throwAngles(o, s.n);
          const cMax = Array.from({ length: s.n }, (_, i) => Math.abs(zOf(s.n, i + 1)) * s.pitch).reduce((a, b) => a + b, 0);
          const r = ev.residuals;
          sim.amp = { f1: r.primaryForce / s.n, c1: r.primaryCouple / cMax, f2: r.secondaryForce / s.n, c2: r.secondaryCouple / cMax };
          if (latest.current.settings.reduceMotion) {
            verdict(ev, o);
            return;
          }
          sim.mode = 'running';
          sim.t = 0;
          sim.speed = 0;
          setBusy(true);
          sfx.engineOn();
          sim.verdict = () => verdict(ev, o);
        },
        busy: () => sim.mode !== 'idle',
      };

      stage.onFrame = (dt, tt) => {
        if (sim.mode === 'idle') {
          if (!latest.current.settings.reduceMotion) {
            sim.theta += 0.5 * dt;
            pose();
          }
          return;
        }
        sim.t += dt;
        const target = sim.mode === 'running' ? 1 : 0;
        const k = Math.min(1, dt * (sim.mode === 'running' ? 2.2 : 3.5));
        sim.speed += (target - sim.speed) * k;
        sim.theta += OMEGA * sim.speed * dt;
        if (sim.mode === 'running' && sim.t > RUN_SECONDS) {
          sim.mode = 'stopping';
          sim.t = 0;
          sim.verdict?.();
        } else if (sim.mode === 'stopping' && sim.speed < 0.03) {
          sim.mode = 'idle';
          sim.speed = 0;
          sfx.engineOff();
          setBusy(false);
          rig.position.set(0, 0, 0);
          rig.rotation.z = 0;
        }
        // the unbalanced forces and couples move the whole engine on its springs, at once and twice engine speed
        const a = sim.speed * sim.speed, th = sim.theta;
        rig.position.y = SHAKE_Y * a * (sim.amp.f1 * Math.cos(th) + sim.amp.f2 * 4 * Math.cos(2 * th + 0.6));
        rig.rotation.z = SHAKE_ROT * a * (sim.amp.c1 * Math.cos(th + 1.1) + sim.amp.c2 * 4 * Math.cos(2 * th + 2.0));
        const level = Math.min(1, (sim.amp.f1 + sim.amp.c1 + 4 * (sim.amp.f2 + sim.amp.c2)) * 0.9);
        if (tt - sim.lastSoundAt > 0.05) {
          sim.lastSoundAt = tt;
          sfx.engineSet(sim.speed, level * sim.speed);
        }
        pose();
      };

      return () => {
        sfx.engineOff();
        api.current = null;
      };
    },
    [spec],
  );

  const shown = done ? (record.solved && order.length === n ? order : best) : order;
  useEffect(() => api.current?.setOrder(shown), [shown]);
  useEffect(() => () => sfx.engineOff(), []);

  const picked = (c: number) => order.indexOf(c);
  const tap = (c: number) => {
    if (busy || done) return;
    play('snap');
    setMsg(null);
    setOrder((prev) => {
      const at = prev.indexOf(c);
      if (at === -1) return [...prev, c];
      return at === prev.length - 1 ? prev.slice(0, -1) : prev; // only the last choice can be taken back
    });
  };
  const run = () => {
    if (busy || done) return;
    const ev = evaluate(spec, order);
    if (ev.refused) {
      setMsg({ k: 'warn', t: ev.refused });
      play('wrong');
      return;
    }
    setMsg(null);
    api.current?.run(order, ev);
  };

  return (
    <Board
      info={INFO}
      record={record}
      testId="puzzle-crankshaft"
      view={
        <div className="ens-view" data-testid="crank-view">
          <canvas ref={ref} aria-label={`An in-line ${n} cylinder engine on springs. Its crank throws sit where the firing order puts them.`} />
          {failed && <Unsupported />}
          <div className="ens-readout">{n} cylinders · four-stroke</div>
        </div>
      }
    >
      {!done ? (
        <p className="ens-p">
          One cylinder fires every {720 / n}° of crank, so the whole cycle takes two turns (720°). Tap the cylinders in the order they should fire; the crank throws turn to where that order puts them.
          Cylinder 1 is the one furthest from the flywheel.
        </p>
      ) : (
        <div className="ens-note" data-k={record.solved ? 'ok' : 'bad'} data-testid="crank-final">
          {record.solved ? 'Smooth running. ' : 'Out of guesses. '}A smooth firing order: <b className="font-mono">{shown.join('-')}</b>
        </div>
      )}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Cylinders, in the order along the engine">
          {Array.from({ length: n }, (_, i) => i + 1).map((c) => {
            const at = picked(c);
            return (
              <button
                key={c}
                className="ens-cyl"
                data-testid={`crank-cyl-${c}`}
                data-slot={at >= 0 ? at + 1 : undefined}
                style={{ ['--cyl' as string]: COLORS[(c - 1) % COLORS.length] }}
                disabled={busy || done}
                aria-pressed={at >= 0}
                aria-label={`Cylinder ${c}${at >= 0 ? `, fires number ${at + 1}` : ''}`}
                onClick={() => tap(c)}
              >
                <b>{c}</b>
                <small>{at >= 0 ? `fires ${at + 1}${at + 1 === 1 ? 'st' : at + 1 === 2 ? 'nd' : at + 1 === 3 ? 'rd' : 'th'}` : 'tap'}</small>
              </button>
            );
          })}
        </div>
        {!done && (
          <div className="flex items-center gap-2">
            <button className="ens-ghost" onClick={() => { setOrder([]); setMsg(null); }} disabled={busy || order.length === 0} data-testid="crank-reset">
              Clear
            </button>
            <button className="ens-btn" onClick={run} disabled={busy} data-testid="crank-run">
              {busy ? 'Running…' : 'Start the engine'}
            </button>
          </div>
        )}
      </div>
      <p className="ens-label" data-testid="crank-order">
        Firing order: <b className="font-mono" style={{ color: 'var(--en-ink)' }}>{shown.length ? shown.join(' – ') : '—'}</b>
      </p>
      {msg && !done && <Note kind={msg.k} testId="crank-msg">{msg.t}</Note>}
    </Board>
  );
}
