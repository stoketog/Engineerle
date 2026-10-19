'use client';

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { BEAM_LEN, G, HOOK, LEVEL_DEG, hookStiffness, inertia, moment, type LeverSpec } from '@/engineerle/lever';
import { MAX_ATTEMPTS, PUZZLES } from '@/engineerle/daily';
import { useSettings } from '@/hooks/useSettings';
import { Board, Note, Unsupported, useStage, type PuzzleProps } from './Board';
import { box, outline, shadowFloor, steel } from './stage';

const INFO = PUZZLES[1];
const PIVOT_Y = 5.3;
const STOP = (30 * Math.PI) / 180;
const TIME_SCALE = 3; // the swing runs faster than real life so a try takes seconds, not half a minute

type Phase = 'hold' | 'dropping' | 'swinging' | 'resting' | 'resetting';

interface Api {
  setP: (p: number) => void;
  release: () => void;
  phase: () => Phase;
}

const massColor = (m: number) => new THREE.Color().setHSL((205 - Math.min(1, m / 65) * 190) / 360, 0.6, 0.5);

export function LeverPuzzle({ spec, record, onAttempt }: PuzzleProps<LeverSpec>) {
  const { play, settings } = useSettings();
  const [p, setP] = useState(0);
  const [phase, setPhase] = useState<Phase>('hold');
  const [msg, setMsg] = useState<{ k: 'ok' | 'bad' | 'hint'; t: string } | null>(null);
  const [live, setLive] = useState(0);
  const api = useRef<Api | null>(null);
  const done = record.done;
  const latest = useRef({ spec, record, onAttempt, play, p, settings });
  latest.current = { spec, record, onAttempt, play, p, settings };

  const { ref, failed } = useStage(
    (stage) => {
      const s = latest.current.spec;
      const root = stage.root;
      const timber = steel('#c9954f', { metal: 0.05, rough: 0.8 });
      const iron = steel('#8aa0b5', { metal: 0.6, rough: 0.4 });
      const dark = steel('#2a3f55', { metal: 0.2, rough: 0.7 });

      // the drawing board it all stands on, with a metre scale along the front
      const slab = box(16, 0.4, 4.2, steel('#16324f', { metal: 0.1, rough: 0.85 }), false);
      slab.position.y = -0.2;
      root.add(slab);
      outline(slab, stage.ink);
      root.add(shadowFloor(20, 8));
      for (let i = -5; i <= 5; i++) {
        const tick = box(0.04, 0.02, i % 5 === 0 ? 0.5 : 0.3, steel('#cfe6f7', { metal: 0, rough: 1 }), false);
        tick.position.set(i, 0.02, 1.7);
        root.add(tick);
        if (i % 1 === 0 && (i % 5 === 0 || Math.abs(i) <= 5)) {
          const t = stage.label(i === 0 ? '0' : String(i), { size: 0.5, color: '#cfe6f7' });
          t.position.set(i, 0.12, 2.15);
          root.add(t);
        }
      }

      // trestles that hold the plank level until it is released
      const props: THREE.Group[] = [];
      for (const sx of [-4.7, 4.7]) {
        const g = new THREE.Group();
        g.position.set(sx, 0, 0);
        const leg = box(0.28, PIVOT_Y - 0.2, 0.28, iron);
        leg.position.y = (PIVOT_Y - 0.2) / 2;
        const foot = box(0.9, 0.18, 0.9, dark);
        foot.position.y = 0.09;
        g.add(leg, foot);
        root.add(g);
        props.push(g);
      }

      // the fulcrum: a knife-edge wedge on a slider block
      const fulcrum = new THREE.Group();
      const wedgeShape = new THREE.Shape();
      wedgeShape.moveTo(-0.7, 0.2).lineTo(0.7, 0.2).lineTo(0.06, PIVOT_Y - 0.16).lineTo(-0.06, PIVOT_Y - 0.16).closePath();
      const wedge = new THREE.Mesh(new THREE.ExtrudeGeometry(wedgeShape, { depth: 0.9, bevelEnabled: false }), steel('#b8cde0', { metal: 0.7, rough: 0.35 }));
      wedge.geometry.translate(0, 0, -0.45);
      wedge.castShadow = true;
      const shoe = box(1.7, 0.22, 1.4, dark);
      shoe.position.y = 0.11;
      fulcrum.add(wedge, shoe);
      outline(wedge, stage.ink);
      const tag = stage.label('pivot', { size: 0.4, color: '#1a0b00', bg: '#ff8a3d' });
      tag.position.set(0, 0.7, 0.9);
      fulcrum.add(tag);
      root.add(fulcrum);

      // the plank and what hangs from it
      const pivot = new THREE.Group();
      pivot.position.y = PIVOT_Y;
      const content = new THREE.Group();
      pivot.add(content);
      root.add(pivot);
      const beam = box(BEAM_LEN, 0.22, 0.9, timber);
      content.add(beam);
      outline(beam, stage.ink);
      for (let i = -10; i <= 10; i++) {
        const n = box(0.03, 0.02, i % 2 === 0 ? 0.42 : 0.24, dark, false);
        n.position.set(i / 2, 0.115, 0.22);
        content.add(n);
      }
      for (let i = -5; i <= 5; i++) {
        const t = stage.label(String(i), { size: 0.42, color: '#3b2610' });
        t.position.set(i, 0.06, 0.62);
        content.add(t);
      }
      const centre = stage.label(`plank ${s.beam} kg`, { size: 0.6, color: '#f1f7fb', bg: 'rgba(10,30,56,0.78)' });
      centre.position.set(0, 0.62, 0);
      content.add(centre);
      for (const l of s.loads) {
        const side = 0.55 + 0.26 * Math.cbrt(l.m / 10);
        const col = massColor(l.m);
        const rod = box(0.07, HOOK, 0.07, iron, false);
        rod.position.set(l.x, -HOOK / 2, 0);
        const blk = box(side, side, side, steel(col, { metal: 0.25, rough: 0.5 }));
        blk.position.set(l.x, -HOOK, 0);
        outline(blk, stage.ink);
        const lab = stage.label(`${l.m} kg`, { size: 0.6, color: '#10243a', bg: 'rgba(240,248,255,0.92)' });
        lab.position.set(l.x, -HOOK - side / 2 - 0.35, 0.1);
        content.add(rod, blk, lab);
      }

      const sim = { a: 0, w: 0, phase: 'hold' as Phase, t: 0, p: 0, calm: 0, drop: 1, hitStop: false, resetFrom: 0 };
      const setPhaseBoth = (ph: Phase) => {
        sim.phase = ph;
        sim.t = 0;
        setPhase(ph);
      };
      const place = () => {
        pivot.position.x = sim.p;
        content.position.x = -sim.p;
        fulcrum.position.x = sim.p;
        pivot.rotation.z = -sim.a;
        props.forEach((g) => (g.scale.y = Math.max(0.001, sim.drop)));
      };
      const apply = (pv: number) => {
        sim.p = pv;
        place();
      };

      const verdict = (angleDeg: number) => {
        const L = latest.current;
        const ok = Math.abs(angleDeg) <= LEVEL_DEG;
        const attempt = L.record.attempts + 1;
        const side = angleDeg > 0 ? 'right' : 'left';
        const dir = angleDeg > 0 ? 'right' : 'left';
        if (ok) {
          setMsg({ k: 'ok', t: `Level. She settles within ${Math.abs(angleDeg).toFixed(1)}° of horizontal.` });
          L.play('correct');
        } else {
          let t = `The ${side} end drops, ${Math.abs(angleDeg).toFixed(0)}° down.`;
          if (attempt === 1) t += ` Hint: the pivot belongs nearer the heavier side, so slide it ${dir}.`;
          else if (attempt === 2) t += ` Hint: the balance point is between ${(Math.round((L.spec.answer - 0.8) * 2) / 2).toFixed(1)} and ${(Math.round((L.spec.answer + 0.8) * 2) / 2).toFixed(1)} m.`;
          else t += ` It balanced at ${L.spec.answer.toFixed(2)} m.`;
          setMsg({ k: attempt === 1 || attempt === 2 ? 'hint' : 'bad', t });
          L.play('wrong');
        }
        L.onAttempt(ok);
        if (!ok && attempt >= MAX_ATTEMPTS) apply(L.spec.answer);
      };

      const startRelease = () => {
        if (sim.phase !== 'hold') return;
        setMsg(null);
        if (latest.current.settings.reduceMotion) {
          const D = moment(s, sim.p), H = hookStiffness(s);
          sim.a = Math.max(-STOP, Math.min(STOP, Math.atan2(D, H)));
          sim.drop = 0;
          place();
          setPhaseBoth('resting');
          verdict((sim.a * 180) / Math.PI);
          return;
        }
        latest.current.play('clunk', 0.5);
        setPhaseBoth('dropping');
      };

      stage.setView({ target: [0, 2.7, 0], yaw: 0.22, pitch: 0.2, w: 13.2, h: 8.4, yawRange: [-0.5, 0.75], pitchRange: [0.08, 0.5] });
      apply(latest.current.p);

      stage.handlers = {
        down: (pt) => {
          if (sim.phase !== 'hold' || latest.current.record.done) return false;
          return !!stage.pick(pt, [fulcrum]);
        },
        move: (pt, dragging) => {
          if (!dragging) return;
          const hit = stage.onPlane(pt, new THREE.Plane(new THREE.Vector3(0, 0, 1), 0));
          if (!hit) return;
          const v = Math.max(s.min, Math.min(s.max, Math.round(hit.x * 20) / 20));
          if (v !== sim.p) {
            apply(v);
            setP(v);
          }
        },
      };

      api.current = { setP: apply, release: startRelease, phase: () => sim.phase };

      const D0 = () => moment(s, sim.p), H0 = () => hookStiffness(s);
      stage.onFrame = (dt) => {
        const ph = sim.phase;
        if (ph === 'dropping') {
          sim.drop = Math.max(0, sim.drop - dt * 6);
          if (sim.drop <= 0) {
            setPhaseBoth('swinging');
            sim.w = 0;
            sim.calm = 0;
            sim.hitStop = false;
          }
          place();
        } else if (ph === 'swinging') {
          sim.t += dt;
          const D = D0(), H = H0(), I = inertia(s, sim.p);
          const k = G * Math.hypot(D, H);
          const c = 2 * 0.22 * Math.sqrt(k * I);
          const n = 8, h = (dt * TIME_SCALE) / n;
          for (let i = 0; i < n; i++) {
            const tq = G * (D * Math.cos(sim.a) - H * Math.sin(sim.a)) - c * sim.w;
            sim.w += (tq / I) * h;
            sim.a += sim.w * h;
            if (Math.abs(sim.a) >= STOP) {
              const hard = Math.abs(sim.w);
              sim.a = Math.sign(sim.a) * STOP;
              if (sim.w * sim.a > 0) {
                sim.w = -sim.w * 0.28;
                if (hard > 0.25 && !sim.hitStop) latest.current.play('clunk', Math.min(1, hard));
                sim.hitStop = true;
              }
            }
          }
          if (Math.abs(sim.w) < 0.012 && Math.abs((G * (D * Math.cos(sim.a) - H * Math.sin(sim.a))) / I) < 0.02) sim.calm += dt;
          else sim.calm = 0;
          if (sim.calm > 0.5 || sim.t > 7) {
            setPhaseBoth('resting');
            verdict((sim.a * 180) / Math.PI);
          }
          place();
          setLive((sim.a * 180) / Math.PI);
        } else if (ph === 'resting') {
          sim.t += dt;
          if (sim.t > 1.5 && !latest.current.record.done) {
            sim.resetFrom = sim.a;
            setPhaseBoth('resetting');
            latest.current.play('whoosh');
          }
        } else if (ph === 'resetting') {
          sim.t += dt;
          const u = Math.min(1, sim.t / 0.7);
          const e = u * u * (3 - 2 * u);
          sim.a = sim.resetFrom * (1 - e);
          sim.drop = Math.min(1, e * 1.2);
          place();
          setLive((sim.a * 180) / Math.PI);
          if (u >= 1) setPhaseBoth('hold');
        }
      };
      return () => {
        api.current = null;
      };
    },
    [spec],
  );

  useEffect(() => api.current?.setP(p), [p]);
  // once the puzzle is finished the plank stays where it ended; a failed one shows the right pivot
  useEffect(() => {
    if (done && !record.solved) setP(spec.answer);
  }, [done, record.solved, spec.answer]);

  const busy = phase !== 'hold';
  const side = p === 0 ? 'at the centre' : `${Math.abs(p).toFixed(2)} m ${p > 0 ? 'right' : 'left'} of centre`;

  return (
    <Board
      info={INFO}
      record={record}
      testId="puzzle-lever"
      view={
        <div className="ens-view" data-testid="lever-view">
          <canvas ref={ref} aria-label="A plank on a sliding pivot with weights hanging from it" />
          {failed && <Unsupported />}
          <div className="ens-readout" data-testid="lever-readout">pivot {side}</div>
          <div className="ens-readout r" data-testid="lever-angle">{busy ? `${live >= 0 ? '+' : '−'}${Math.abs(live).toFixed(1)}°` : 'held level'}</div>
        </div>
      }
    >
      {!done ? (
        <>
          <label className="block">
            <span className="ens-label">Slide the pivot (metres from the plank&apos;s centre; right is positive)</span>
            <input
              className="ens-range"
              type="range"
              min={spec.min}
              max={spec.max}
              step={0.05}
              value={p}
              disabled={busy}
              onChange={(e) => setP(Number(e.target.value))}
              data-testid="lever-slider"
              aria-label="Pivot position"
              aria-valuetext={side}
              data-silent
            />
          </label>
          <div className="flex items-center justify-between gap-3">
            <p className="ens-p">The plank is uniform. Each weight hangs {HOOK} m below it.</p>
            <button className="ens-btn" onClick={() => api.current?.release()} disabled={busy} data-testid="lever-release">
              Release
            </button>
          </div>
        </>
      ) : (
        <div className="ens-note" data-k={record.solved ? 'ok' : 'bad'} data-testid="lever-final">
          {record.solved ? 'Balanced. ' : 'Out of guesses. '}The pivot belongs {spec.answer >= 0 ? `${spec.answer.toFixed(2)} m right` : `${(-spec.answer).toFixed(2)} m left`} of centre, the plank&apos;s centre of mass with its loads.
        </div>
      )}
      {msg && !done && <Note kind={msg.k} testId="lever-msg">{msg.t}</Note>}
    </Board>
  );
}
