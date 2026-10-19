'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { MAX_ATTEMPTS } from '@/engineerle/scoring';
import { byId } from '@/engineerle/registry';
import { G0, bestSplit, evaluate, stageBreakdown, type Evaluation, type RocketSpec } from '@/engineerle/rocket';
import { useSettings } from '@/hooks/useSettings';
import { Board, Note, Unsupported, useStage, type PuzzleProps } from './Board';
import { box, cyl, outline, shadowFloor, steel } from './stage';

const INFO = byId('rocket')!;
const plural = (k: number) => `${k} ${k === 1 ? 'guess' : 'guesses'} left`;
const fmtMs = (v: number) => `${Math.round(v).toLocaleString('en-US')} m/s`;
const fmtKg = (m: number) => (m >= 1000 ? `${Number((m / 1000).toPrecision(3))} t` : `${Math.round(m)} kg`);

const H_TOTAL = 7; // drawn height of both tanks together
const R1 = 0.95, R2 = 0.68;
const ORBIT_Y = 38; // drawn altitude that stands for orbit; 1 unit is about 5 km
const T_BURN1 = 2.0, T_SEP = 0.6, T_BURN2 = 2.4, T_COAST = 1.5;

type Phase = 'hold' | 'burn1' | 'sep' | 'burn2' | 'coast' | 'resting' | 'resetting';
interface Api {
  setSplit: (s: number) => void;
  launch: () => void;
  phase: () => Phase;
}

/** Cumulative Δv (m/s) at time `t` of a burn that throws propellant at a constant rate, from the rocket equation. */
const burnV = (isp: number, m0: number, prop: number, frac: number) => isp * G0 * Math.log(m0 / (m0 - prop * frac));

export function RocketPuzzle({ spec, record, onAttempt }: PuzzleProps<RocketSpec>) {
  const { play, settings } = useSettings();
  // the slider starts near the middle, but never on a winning split: the first press of Launch must be a real guess
  const start = useMemo(() => {
    for (const k of [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6, -6, 8, -8, 10, -10, 15, -15, 20, -20, 30, -30, 40, -40]) {
      const pct = 50 + k;
      if (pct >= 5 && pct <= 95 && !evaluate(spec, pct / 100).solved) return pct;
    }
    return 5;
  }, [spec]);
  const [pct, setPct] = useState(start);
  const [phase, setPhase] = useState<Phase>('hold');
  const [msg, setMsg] = useState<{ k: 'ok' | 'bad' | 'warn'; t: string } | null>(null);
  const [live, setLive] = useState<{ v: number; alt: number } | null>(null);
  const api = useRef<Api | null>(null);
  const done = record.done;
  const latest = useRef({ spec, record, onAttempt, play, pct, settings });
  latest.current = { spec, record, onAttempt, play, pct, settings };

  const { ref, failed } = useStage(
    (stage) => {
      const s = latest.current.spec;
      const root = stage.root;
      const white = steel('#e8eef4', { metal: 0.25, rough: 0.45 });
      const orange = steel('#d9732b', { metal: 0.2, rough: 0.55 });
      const iron = steel('#8aa0b5', { metal: 0.6, rough: 0.4 });
      const dark = steel('#2a3f55', { metal: 0.2, rough: 0.7 });

      // the pad, with a gantry beside the rocket and an altitude scale up its side
      const slab = box(10, 0.4, 5, steel('#16324f', { metal: 0.1, rough: 0.85 }), false);
      slab.position.y = -0.2;
      root.add(slab, shadowFloor(14, 8));
      outline(slab, stage.ink);
      const gantry = new THREE.Group();
      const mast = box(0.35, 9, 0.35, iron);
      mast.position.set(-2.6, 4.5, 0);
      gantry.add(mast);
      for (let i = 1; i <= 4; i++) {
        const arm = box(1.3, 0.12, 0.12, iron, false);
        arm.position.set(-1.95, 2 * i - 0.5, 0);
        gantry.add(arm);
      }
      root.add(gantry);
      const marks = new THREE.Group();
      for (let a = 0; a <= 8; a++) {
        const y = a * 5;
        const tick = box(0.9, 0.05, 0.05, steel('#cfe6f7', { metal: 0, rough: 1 }), false);
        tick.position.set(-4.6, y, 0);
        marks.add(tick);
        const lab = stage.label(a === 0 ? 'ground' : `${a * 25} km`, { size: 0.62, color: '#cfe6f7' });
        lab.position.set(-6.1, y + 0.1, 0);
        marks.add(lab);
      }
      const line = box(0.04, ORBIT_Y + 2, 0.04, steel('#cfe6f7', { metal: 0, rough: 1 }), false);
      line.position.set(-4.6, (ORBIT_Y + 2) / 2, 0);
      marks.add(line);
      const orbitLine = box(30, 0.05, 0.05, steel('#5dff9f', { metal: 0, rough: 1, flat: true }), false);
      orbitLine.position.set(10, ORBIT_Y, 0);
      marks.add(orbitLine);
      const orbitTag = stage.label('orbit', { size: 0.8, color: '#04140d', bg: '#5dff9f' });
      orbitTag.position.set(-3.2, ORBIT_Y + 1.1, 0);
      marks.add(orbitTag);
      root.add(marks);

      // the rocket: unit-height tanks, stretched to the split
      const rocket = new THREE.Group();
      root.add(rocket);
      const tank1 = new THREE.Group();
      const body1 = cyl(R1, R1, 1, white, 28);
      body1.position.y = 0.5;
      const band1 = cyl(R1 * 1.012, R1 * 1.012, 0.08, orange, 28, false);
      band1.position.y = 0.96;
      tank1.add(body1);
      outline(body1, stage.ink);
      const bell = cyl(0.55, 0.3, 0.55, dark, 18);
      bell.position.y = -0.2;
      rocket.add(bell);
      const tank2 = new THREE.Group();
      const body2 = cyl(R2, R2, 1, white, 28);
      body2.position.y = 0.5;
      tank2.add(body2);
      outline(body2, stage.ink);
      const bell2 = cyl(0.42, 0.22, 0.4, dark, 18);
      bell2.position.y = -0.15;
      tank2.add(bell2);
      const cone = new THREE.Mesh(new THREE.ConeGeometry(R2, 1.4, 28), steel('#cfdbe6', { metal: 0.3, rough: 0.4 }));
      cone.castShadow = true;
      const skirt = cyl(R1, R2, 0.3, white, 28);
      rocket.add(tank1, tank2, cone, skirt);
      tank1.add(band1);
      // flames
      const flameMat = new THREE.MeshBasicMaterial({ color: 0xffb454, transparent: true, opacity: 0.9 });
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1, 14), flameMat);
      flame.rotation.x = Math.PI;
      flame.visible = false;
      rocket.add(flame);
      // the dropped first stage
      const spent = new THREE.Group();
      const spentBody = cyl(R1, R1, 1, white, 24);
      spentBody.position.y = 0.5;
      const spentBell = cyl(0.55, 0.3, 0.55, dark, 14);
      spentBell.position.y = -0.2;
      spent.add(spentBody, spentBell);
      spent.visible = false;
      root.add(spent);
      // the puff when a short rocket lands
      const puff = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial({ color: 0xff8a3d, transparent: true, opacity: 0.8 }));
      puff.visible = false;
      root.add(puff);

      const sim = { split: latest.current.pct / 100, phase: 'hold' as Phase, t: 0, x: 0, y: 0, tilt: 0, vcum: 0, vyEnd: 0, apo: 0, fall: 0, spentY: 0, spentVy: 0, spentSpin: 0, fx: 0, ev: null as Evaluation | null };
      const h1 = () => Math.max(0.35, H_TOTAL * sim.split);
      const h2 = () => Math.max(0.35, H_TOTAL * (1 - sim.split));
      const coneH = 0.9 + Math.min(1.1, (s.payload / s.propellant) * 18);

      const layout = () => {
        const a = h1(), b = h2();
        tank1.scale.y = a;
        tank2.position.y = a + 0.3;
        tank2.scale.y = b;
        skirt.position.y = a + 0.15;
        cone.scale.set(1, coneH / 1.4, 1);
        cone.position.y = a + 0.3 + b + coneH / 2;
        rocket.position.set(sim.x, sim.y + 0.5, 0);
        rocket.rotation.z = -sim.tilt;
        tank1.visible = sim.phase !== 'burn2' && sim.phase !== 'coast';
        bell.visible = tank1.visible;
        skirt.visible = tank1.visible;
        spentBody.scale.y = a;
        const burning = sim.phase === 'burn1' || sim.phase === 'burn2';
        flame.visible = burning;
        if (burning) {
          const base = sim.phase === 'burn1' ? -0.45 : tank2.position.y - 0.2;
          const len = 1.6 + Math.sin(sim.t * 40) * 0.25 + (sim.phase === 'burn1' ? 1 : 0.2);
          flame.scale.set(sim.phase === 'burn1' ? 1.4 : 0.9, len, sim.phase === 'burn1' ? 1.4 : 0.9);
          flame.position.y = base - len / 2;
        }
      };
      const follow = () => {
        const cy = Math.max(4, sim.y + 4);
        stage.setView({ target: [Math.min(8, sim.x * 0.6), cy, 0], yaw: 0.16, pitch: 0.12, w: 16 + sim.y * 0.12, h: 12 + sim.y * 0.35, yawRange: [-0.4, 0.6], pitchRange: [0.04, 0.4] });
      };
      stage.setView({ target: [0, 4.2, 0], yaw: 0.16, pitch: 0.12, w: 16, h: 12, yawRange: [-0.4, 0.6], pitchRange: [0.04, 0.4] });
      layout();

      const setPhaseBoth = (p: Phase) => {
        sim.phase = p;
        sim.t = 0;
        setPhase(p);
      };
      const finish = (ev: Evaluation) => {
        const L = latest.current;
        const attempt = L.record.attempts + 1;
        const b = ev.breakdown!;
        const detail = `Stage 1 gave ${fmtMs(b.dv1)} and stage 2 ${fmtMs(b.dv2)}: burnout at ${fmtMs(ev.dv!)} against the ${fmtMs(L.spec.required)} needed.`;
        if (ev.solved) {
          setMsg({ k: 'ok', t: `Orbit reached. ${detail}` });
          L.play('correct');
        } else {
          const last = attempt >= MAX_ATTEMPTS;
          const short = `${Math.round(ev.shortfall!).toLocaleString('en-US')} m/s short of orbit`;
          setMsg({ k: last ? 'bad' : 'warn', t: last ? `${short}. ${detail}` : `${short}. ${detail} ${plural(MAX_ATTEMPTS - attempt)}.` });
          L.play('wrong');
        }
        L.onAttempt(ev.solved);
      };

      const launch = () => {
        if (sim.phase !== 'hold') return;
        const L = latest.current;
        const ev = evaluate(L.spec, L.pct / 100);
        if (ev.refused) {
          setMsg({ k: 'warn', t: ev.refused });
          L.play('wrong');
          return;
        }
        sim.split = L.pct / 100;
        sim.ev = ev;
        setMsg(null);
        sim.vyEnd = 0;
        if (L.settings.reduceMotion) {
          sim.y = ev.solved ? ORBIT_Y : 0;
          sim.x = ev.solved ? 14 : 0;
          sim.tilt = ev.solved ? 1.2 : 0;
          setPhaseBoth('resting');
          setLive({ v: ev.dv!, alt: sim.y });
          layout();
          finish(ev);
          return;
        }
        L.play('whoosh');
        setPhaseBoth('burn1');
      };

      api.current = {
        setSplit: (p) => {
          if (sim.phase !== 'hold') return;
          sim.split = p;
          layout();
        },
        launch,
        phase: () => sim.phase,
      };

      const traj = (v: number) => {
        const u = Math.min(1, v / s.required);
        sim.y = ORBIT_Y * u * u;
        sim.x = 26 * Math.max(0, u - 0.4) ** 2;
        const dy = 2 * ORBIT_Y * u, dx = 52 * Math.max(0, u - 0.4);
        sim.tilt = Math.atan2(dx, dy + 0.001);
      };

      stage.onFrame = (dt) => {
        const ev = sim.ev;
        const ph = sim.phase;
        if (ph === 'burn1' && ev) {
          sim.t += dt;
          const f = Math.min(1, sim.t / T_BURN1);
          const b = ev.breakdown!;
          sim.vcum = burnV(s.isp1, b.m0_1, sim.split * s.propellant, f);
          traj(sim.vcum);
          sim.fx += dt;
          layout();
          setLive({ v: sim.vcum, alt: sim.y });
          if (f >= 1) {
            sim.spentY = sim.y;
            sim.spentVy = 1;
            sim.spentSpin = 0;
            spent.visible = true;
            spentBody.scale.y = h1();
            setPhaseBoth('sep');
            latest.current.play('clunk', 0.6);
          }
        } else if (ph === 'sep' && ev) {
          sim.t += dt;
          sim.vcum = ev.breakdown!.dv1;
          traj(sim.vcum);
          sim.spentVy -= 18 * dt;
          sim.spentY += sim.spentVy * dt;
          sim.spentSpin += dt * 0.8;
          spent.position.set(sim.x + sim.spentSpin * 0.6, sim.spentY + 0.5, 0);
          spent.rotation.z = -sim.tilt - sim.spentSpin;
          layout();
          if (sim.t >= T_SEP) setPhaseBoth('burn2');
        } else if (ph === 'burn2' && ev) {
          sim.t += dt;
          const f = Math.min(1, sim.t / T_BURN2);
          const b = ev.breakdown!;
          sim.vcum = b.dv1 + burnV(s.isp2, b.m0_2, (1 - sim.split) * s.propellant, f);
          traj(sim.vcum);
          sim.spentVy -= 18 * dt;
          sim.spentY += sim.spentVy * dt;
          sim.spentSpin += dt * 0.8;
          spent.position.set(sim.x - 1.5 + sim.spentSpin * 0.9, sim.spentY + 0.5, 0);
          spent.rotation.z = -sim.tilt - sim.spentSpin;
          if (sim.spentY < -2) spent.visible = false;
          layout();
          follow();
          setLive({ v: sim.vcum, alt: sim.y });
          if (f >= 1) {
            spent.visible = false;
            sim.apo = sim.y;
            sim.vyEnd = ev.solved ? 0 : 7 + 14 * Math.min(1, (ev.dv! / s.required) ** 2);
            sim.fall = 0;
            setPhaseBoth('coast');
          }
        } else if (ph === 'coast' && ev) {
          sim.t += dt;
          follow();
          if (ev.solved) {
            // pitched over and level: it stays up and slides away along the orbit line
            sim.x += dt * 9;
            sim.tilt += (Math.PI / 2 - sim.tilt) * Math.min(1, dt * 4);
            sim.y = ORBIT_Y + Math.min(1, sim.t) * 0.2;
            layout();
            if (sim.t >= T_COAST) {
              setPhaseBoth('resting');
              finish(ev);
            }
          } else {
            sim.vyEnd -= 26 * dt;
            sim.y = Math.max(0, sim.y + sim.vyEnd * dt);
            sim.tilt *= 1 - Math.min(1, dt * 1.2);
            layout();
            setLive({ v: sim.vcum, alt: sim.y });
            if (sim.y <= 0 && sim.vyEnd < 0) {
              rocket.visible = false;
              puff.visible = true;
              puff.position.set(sim.x, 0.4, 0);
              sim.fx = 0;
              setPhaseBoth('resting');
              latest.current.play('clunk', 1);
              finish(ev);
            }
          }
        } else if (ph === 'resting') {
          sim.t += dt;
          if (puff.visible) {
            const u = Math.min(1, sim.t / 0.7);
            puff.scale.setScalar(0.5 + u * 2.4);
            (puff.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - u);
          }
          if (sim.t > 2.2 && !latest.current.record.done) {
            setPhaseBoth('resetting');
            latest.current.play('whoosh');
          }
        } else if (ph === 'resetting') {
          sim.t += dt;
          if (sim.t > 0.35) {
            sim.x = 0; sim.y = 0; sim.tilt = 0; sim.vcum = 0;
            rocket.visible = true; puff.visible = false; spent.visible = false;
            tank1.visible = true; bell.visible = true; skirt.visible = true;
            sim.split = latest.current.pct / 100;
            stage.setView({ target: [0, 4.2, 0], yaw: 0.16, pitch: 0.12, w: 16, h: 12 });
            setLive(null);
            layout();
            setPhaseBoth('hold');
          }
        }
      };
      return () => {
        api.current = null;
      };
    },
    [spec],
  );

  useEffect(() => api.current?.setSplit(pct / 100), [pct]);
  // a rocket that beat nobody shows the best split once the puzzle is over
  useEffect(() => {
    if (done && !record.solved) setPct(Math.round(bestSplit(spec).split * 100));
  }, [done, record.solved, spec]);

  const busy = phase !== 'hold';
  const b = useMemo(() => stageBreakdown(spec, pct / 100), [spec, pct]);
  const best = useMemo(() => bestSplit(spec), [spec]);
  return (
    <Board
      info={INFO}
      record={record}
      testId="puzzle-rocket"
      view={
        <div className="ens-view" data-testid="rocket-view">
          <canvas ref={ref} aria-label="A two-stage rocket on its launch pad beside an altitude scale" />
          {failed && <Unsupported />}
          <div className="ens-readout" data-testid="rocket-split-readout">
            stage 1: {pct}% of the propellant ({fmtKg((pct / 100) * spec.propellant)})
            <br />
            stage 2: {100 - pct}% ({fmtKg((1 - pct / 100) * spec.propellant)})
          </div>
          <div className="ens-readout r" data-testid="rocket-dv">
            {live ? `Δv ${fmtMs(live.v)}` : `needs ${fmtMs(spec.required)}`}
            <br />
            {live ? `alt ${Math.round(live.alt * 5)} km` : 'on the pad'}
          </div>
        </div>
      }
    >
      {done ? (
        <div className="ens-note" data-k={record.solved ? 'ok' : 'bad'} data-testid="rocket-final">
          {record.solved ? 'Orbit. ' : 'Out of guesses. '}
          Putting about <b className="font-mono">{Math.round(best.split * 100)}%</b> of the propellant in stage 1 gives the most Δv, <b className="font-mono">{fmtMs(best.dv)}</b>; anything that clears{' '}
          <b className="font-mono">{fmtMs(spec.required)}</b> reaches orbit.
        </div>
      ) : (
        <>
          <p className="ens-p">
            A two-stage rocket carries <b className="font-mono" style={{ color: 'var(--en-ink)' }}>{fmtKg(spec.propellant)}</b> of propellant in all and a <b className="font-mono" style={{ color: 'var(--en-ink)' }}>{fmtKg(spec.payload)}</b> payload. Stage 1 runs at{' '}
            {spec.isp1} s, stage 2 at {spec.isp2} s, and each stage&apos;s structure weighs {Math.round(spec.sigma1 * 100)}% and {Math.round(spec.sigma2 * 100)}% of its propellant. Orbit needs{' '}
            <b className="font-mono" style={{ color: 'var(--en-ink)' }}>{fmtMs(spec.required)}</b>, which counts gravity and drag losses. Stage 1 is dropped when it is empty. How much propellant goes in stage 1?
          </p>
          <label className="block">
            <span className="ens-label">Share of the propellant in stage 1</span>
            <input className="ens-range" type="range" min={5} max={95} step={1} value={pct} disabled={busy} onChange={(e) => setPct(Number(e.target.value))} aria-valuetext={`${pct}% in stage 1, ${100 - pct}% in stage 2`} data-testid="rocket-split" aria-label="Share of the propellant in stage 1" data-silent />
          </label>
          <div className="flex items-center justify-between gap-3">
            <p className="ens-p font-mono">
              stage 1 mass ratio {(b.m0_1 / b.mf_1).toFixed(2)} · stage 2 {(b.m0_2 / b.mf_2).toFixed(2)}
            </p>
            <button className="ens-btn" onClick={() => api.current?.launch()} disabled={busy} data-testid="rocket-launch">
              {busy ? 'Flying…' : 'Launch'}
            </button>
          </div>
        </>
      )}
      {msg && !done && <Note kind={msg.k} testId="rocket-msg">{msg.t}</Note>}
    </Board>
  );
}
