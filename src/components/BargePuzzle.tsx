'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { MAX_ATTEMPTS, PUZZLES } from '@/engineerle/daily';
import { LEVEL_HEEL, MIN_FREEBOARD, MIN_GM, RHO, bargeState, isSolved, solutions, withinLimits, PUMP_STEP, type BargeSpec } from '@/engineerle/barge';
import { sfx } from '@/lib/sfx';
import { useSettings } from '@/hooks/useSettings';
import { Board, Note, Unsupported, useStage, type PuzzleProps } from './Board';
import { box, outline, shadowFloor, steel } from './stage';

const INFO = PUZZLES[4];
const S = 0.5; // world units per metre
const FLOOR = -2.2;
const TANK_NAMES = ['Fore port', 'Fore starboard', 'Aft port', 'Aft starboard'];
const CARGO_COLORS = ['#ff8a3d', '#37c2ff', '#d56cf5', '#ffcf5c', '#5fe0a0'];

type Phase = 'plan' | 'flooding' | 'afloat' | 'draining';

interface Api {
  setW: (w: number[]) => void;
  flood: (w: number[]) => void;
  phase: () => Phase;
}

const sideWord = (v: number, pos: string, neg: string) => (v >= 0 ? pos : neg);

/* ───────────────────────────── the plan view ───────────────────────────── */

function Plan({ spec, w }: { spec: BargeSpec; w: number[] }) {
  const L = spec.L, B = spec.B;
  return (
    <svg viewBox={`${-L / 2 - 4} ${-B / 2 - 3.2} ${L + 8} ${B + 6.4}`} className="w-full" role="img" aria-label="Plan view of the barge showing each container's mass and position, and the four ballast tanks" data-testid="barge-plan" style={{ maxHeight: '15rem' }}>
      <rect x={-L / 2} y={-B / 2} width={L} height={B} fill="var(--en-panel2)" stroke="var(--en-line2)" strokeWidth="0.25" />
      {/* the grid the positions are read from */}
      {Array.from({ length: L / 4 + 1 }, (_, i) => -L / 2 + i * 4).map((x) => (
        <g key={x}>
          <line x1={x} y1={-B / 2} x2={x} y2={B / 2} stroke="var(--en-line)" strokeWidth={x === 0 ? 0.22 : 0.08} strokeDasharray={x === 0 ? undefined : '0.5 0.5'} />
          <text x={x} y={B / 2 + 1.6} textAnchor="middle" fontSize="1.25" fill="var(--en-mute)" fontFamily="var(--font-mono)">{x > 0 ? `+${x}` : x}</text>
        </g>
      ))}
      {[-4.5, -3, -1.5, 0, 1.5, 3, 4.5].map((y) => (
        <g key={y}>
          <line x1={-L / 2} y1={y} x2={L / 2} y2={y} stroke="var(--en-line)" strokeWidth={y === 0 ? 0.22 : 0.06} strokeDasharray={y === 0 ? undefined : '0.4 0.6'} />
          <text x={-L / 2 - 0.5} y={y + 0.45} textAnchor="end" fontSize="1.15" fill="var(--en-mute)" fontFamily="var(--font-mono)">{y > 0 ? `+${y}` : y}</text>
        </g>
      ))}
      <text x={L / 2 + 0.6} y={0.5} fontSize="1.4" fill="var(--en-accent)" fontFamily="var(--font-mono)">bow →</text>
      <text x={-L / 2 + 0.4} y={-B / 2 - 0.7} fontSize="1.2" fill="var(--en-mute)">port</text>
      <text x={-L / 2 + 0.4} y={B / 2 + 3} fontSize="1.2" fill="var(--en-mute)">starboard ↓ y</text>
      {spec.tanks.map((tk, i) => {
        const h = 4, wd = 8, fill = Math.min(1, w[i] / tk.cap);
        return (
          <g key={i}>
            <rect x={tk.x - wd / 2} y={tk.y - h / 2} width={wd} height={h} fill="none" stroke="var(--en-cool)" strokeWidth="0.2" strokeDasharray="0.8 0.5" />
            <rect x={tk.x - wd / 2} y={tk.y + h / 2 - h * fill} width={wd} height={h * fill} fill="var(--en-cool)" opacity="0.4" />
            <text x={tk.x} y={tk.y + 0.5} textAnchor="middle" fontSize="1.5" fontWeight="700" fill="var(--en-ink)" fontFamily="var(--font-mono)">{w[i]} t</text>
          </g>
        );
      })}
      {spec.cargo.map((c, i) => {
        const k = Math.cbrt(c.m / 100);
        const cw = 3.6 * k, ch = 2.6 * k;
        return (
          <g key={i}>
            <rect x={c.x - cw / 2} y={c.y - ch / 2} width={cw} height={ch} fill={CARGO_COLORS[i % CARGO_COLORS.length]} opacity="0.92" stroke="var(--en-bg)" strokeWidth="0.15" />
            <text x={c.x} y={c.y + 0.25} textAnchor="middle" fontSize="1.35" fontWeight="700" fill="#10243a" fontFamily="var(--font-mono)">{c.m}</text>
            <text x={c.x} y={c.y + ch / 2 + 1.25} textAnchor="middle" fontSize="1.0" fill="var(--en-ink)" fontFamily="var(--font-mono)">({c.x > 0 ? '+' : ''}{c.x}, {c.y > 0 ? '+' : ''}{c.y})</text>
          </g>
        );
      })}
    </svg>
  );
}

/* ───────────────────────────── the puzzle ───────────────────────────── */

export function BargePuzzle({ spec, record, onAttempt }: PuzzleProps<BargeSpec>) {
  const { play, settings } = useSettings();
  const [w, setW] = useState<number[]>([0, 0, 0, 0]);
  const [phase, setPhase] = useState<Phase>('plan');
  const [msg, setMsg] = useState<{ k: 'ok' | 'bad' | 'hint'; t: string } | null>(null);
  const [read, setRead] = useState<{ heel: number; trim: number } | null>(null);
  const api = useRef<Api | null>(null);
  const done = record.done;
  const latest = useRef({ spec, record, onAttempt, play, settings, w });
  latest.current = { spec, record, onAttempt, play, settings, w };
  const total = w.reduce((a, b) => a + b, 0);
  const over = total > spec.pumpMax || w.some((v, i) => v > spec.tanks[i].cap);

  const { ref, failed } = useStage(
    (stage) => {
      const L0 = latest.current;
      const sp = L0.spec;
      const root = stage.root;
      const Lw = sp.L * S, Bw = sp.B * S, Dw = sp.D * S;
      const stone = steel('#4a6a88', { metal: 0.05, rough: 0.9, flat: true });

      // the dry dock
      const bx = Lw / 2 + 2.6, bz = Bw / 2 + 2.4;
      const floor = box(bx * 2 + 4, 0.4, bz * 2, stone, false);
      floor.position.y = FLOOR - 0.2;
      root.add(floor);
      outline(floor, stage.ink);
      for (const sgn of [-1, 1]) {
        const wall = box(4, 2.6, bz * 2, stone);
        wall.position.set(sgn * (bx + 2), FLOOR + 1.1, 0);
        root.add(wall);
        outline(wall, stage.ink);
      }
      const back = box(bx * 2 + 8, 2.6, 2, stone);
      back.position.set(0, FLOOR + 1.1, -bz - 1);
      root.add(back);
      outline(back, stage.ink);
      root.add(shadowFloor(bx * 2, bz * 2, FLOOR + 0.02));

      // the water
      const basinW = bx * 2, basinD = bz * 2;
      const volume = new THREE.Mesh(
        new THREE.BoxGeometry(basinW, 1, basinD),
        new THREE.MeshStandardMaterial({ color: '#1a79ad', transparent: true, opacity: 0.55, roughness: 0.25, metalness: 0.1, depthWrite: false }),
      );
      root.add(volume);
      const surfGeo = new THREE.PlaneGeometry(basinW, basinD, 36, 12);
      surfGeo.rotateX(-Math.PI / 2);
      const surf = new THREE.Mesh(surfGeo, new THREE.MeshStandardMaterial({ color: '#52b8e6', transparent: true, opacity: 0.6, roughness: 0.2, metalness: 0.15, flatShading: true, depthWrite: false }));
      root.add(surf);
      const base = Float32Array.from(surfGeo.attributes.position.array as Float32Array);

      // the barge, hung from a pivot at the waterline
      const pivot = new THREE.Group();
      const hull = new THREE.Group();
      pivot.add(hull);
      root.add(pivot);
      const hullMat = steel('#86b4de', { metal: 0.1, rough: 0.55 });
      const bottom = box(Lw, 0.08, Bw, hullMat);
      bottom.position.y = 0.04;
      const sideA = box(Lw, Dw, 0.08, hullMat), sideB = sideA.clone();
      sideA.position.set(0, Dw / 2, Bw / 2);
      sideB.position.set(0, Dw / 2, -Bw / 2);
      const endA = box(0.08, Dw, Bw, hullMat), endB = endA.clone();
      endA.position.set(Lw / 2, Dw / 2, 0);
      endB.position.set(-Lw / 2, Dw / 2, 0);
      const deck = box(Lw, 0.05, Bw, steel('#7d9ab5', { metal: 0.2, rough: 0.6, opacity: 0.34 }), false);
      deck.position.y = Dw;
      hull.add(bottom, sideA, sideB, endA, endB, deck);
      [sideA, endA].forEach((m) => outline(m, stage.ink));
      // a bow marker so you can tell which way she faces
      const bow = box(0.5, 0.06, 0.9, steel('#ff8a3d'), false);
      bow.position.set(Lw / 2 - 0.7, Dw + 0.06, 0);
      hull.add(bow);
      // tank frames and their water
      const tankFill: THREE.Mesh[] = [];
      sp.tanks.forEach((tk) => {
        const tw = 8 * S, td = 4 * S, th = Dw - 0.2;
        const frame = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(tw, th, td)), stage.ink);
        frame.position.set(tk.x * S, 0.1 + th / 2, tk.y * S);
        hull.add(frame);
        const fill = new THREE.Mesh(new THREE.BoxGeometry(tw - 0.06, 1, td - 0.06), new THREE.MeshStandardMaterial({ color: '#2aa7e0', transparent: true, opacity: 0.8, roughness: 0.2 }));
        fill.position.set(tk.x * S, 0.1, tk.y * S);
        hull.add(fill);
        tankFill.push(fill);
      });
      // cargo
      sp.cargo.forEach((c, i) => {
        const k = Math.cbrt(c.m / 100);
        const stacked = c.kg > 6;
        const hgt = (stacked ? 3 : 1.5) * 1.0;
        const col = new THREE.Color(CARGO_COLORS[i % CARGO_COLORS.length]);
        const cont = box(3.6 * k * S * 0.98, hgt * 0.98, 2.6 * k * S * 0.98, steel(col, { metal: 0.25, rough: 0.55 }));
        cont.position.set(c.x * S, Dw + hgt / 2, c.y * S);
        outline(cont, stage.ink);
        hull.add(cont);
        if (stacked) {
          const seam = box(3.6 * k * S, 0.03, 2.6 * k * S, steel('#10243a'), false);
          seam.position.set(c.x * S, Dw + hgt / 2, c.y * S);
          hull.add(seam);
        }
        const lab = stage.label(`${c.m} t`, { size: 1.0, color: '#10243a', bg: 'rgba(240,248,255,0.92)' });
        lab.position.set(c.x * S, Dw + hgt + 0.55, c.y * S);
        hull.add(lab);
      });
      // keel blocks she sits on
      const blocks: THREE.Mesh[] = [];
      for (let i = -3; i <= 3; i++) {
        const b = box(0.7, 0.4, 1.4, steel('#9a7b52', { metal: 0.05, rough: 0.9 }));
        b.position.set(i * (Lw / 7.5), 0, 0);
        root.add(b);
        blocks.push(b);
      }

      const sim = {
        mode: 'plan' as Phase,
        t: 0,
        yw: FLOOR + 0.35,
        heel: 0,
        heelV: 0,
        trim: 0,
        trimV: 0,
        heave: 0,
        heaveV: 0,
        w: [0, 0, 0, 0],
        st: bargeState(sp, [0, 0, 0, 0]),
        floating: false,
        wave: 0,
        reported: false,
        splashed: false,
      };
      const draftW = () => sim.st.draft * S;
      const restKeel = () => -draftW() - 0.4; // keel height when she sits on the blocks
      const place = () => {
        if (sim.floating) {
          // she hangs a draft below the waterline, and rolls and pitches about it
          pivot.position.y = sim.yw + sim.heave;
          hull.position.y = -draftW();
          pivot.rotation.x = sim.heel;
          pivot.rotation.z = -sim.trim;
        } else {
          pivot.position.y = 0;
          hull.position.y = restKeel();
          pivot.rotation.set(0, 0, 0);
        }
        blocks.forEach((b, i) => {
          b.position.y = restKeel() - 0.2;
          b.position.x = (i - 3) * (Lw / 7.5);
        });
        const h = sim.yw - FLOOR;
        volume.scale.y = Math.max(0.001, h);
        volume.position.y = FLOOR + h / 2;
        surf.position.y = sim.yw;
        sp.tanks.forEach((tk, i) => {
          const hh = Math.max(0.001, (sim.w[i] / (RHO * tk.area)) * S);
          tankFill[i].scale.y = hh;
          tankFill[i].position.y = 0.1 + hh / 2;
        });
      };
      const setFills = (w: number[]) => {
        sim.w = w.slice();
        sim.st = bargeState(sp, w);
        place();
      };

      const verdict = () => {
        const L = latest.current;
        const attempt = L.record.attempts + 1;
        const st = bargeState(sp, sim.w);
        const ok = isSolved(sp, sim.w);
        const heel = `${Math.abs(st.heel).toFixed(1)}° ${sideWord(st.heel, 'to starboard', 'to port')}`;
        const trim = `${Math.abs(st.trim).toFixed(2)}° ${sideWord(st.trim, 'down by the bow', 'down by the stern')}`;
        setRead({ heel: st.heel, trim: st.trim });
        if (ok) {
          setMsg({ k: 'ok', t: `Afloat and level: ${Math.abs(st.heel).toFixed(1)}° of heel, ${Math.abs(st.trim).toFixed(2)}° of trim, GM ${st.gmT.toFixed(1)} m.` });
          L.play('correct');
        } else {
          let t = `She floats ${heel} and ${trim}.`;
          if (st.gmT < MIN_GM) t = `She is unstable: GM is only ${st.gmT.toFixed(2)} m.`;
          else if (st.freeboard < MIN_FREEBOARD && Math.abs(st.heel) <= LEVEL_HEEL) t = `She sits too low: only ${st.freeboard.toFixed(2)} m of freeboard, and the deck is awash.`;
          if (attempt === 1) t += ` Her centre of gravity is ${Math.abs(st.yg).toFixed(2)} m ${sideWord(st.yg, 'to starboard', 'to port')} of the centreline and ${Math.abs(st.xg).toFixed(2)} m ${sideWord(st.xg, 'forward of', 'aft of')} amidships.`;
          else if (attempt === 2) t += ` Hint: you need the total moment about each axis to cancel. About ${Math.round(Math.abs(st.yg) * st.mass / 4 / 5) * 5} t more ballast on the ${sideWord(st.yg, 'port', 'starboard')} side would right the heel.`;
          else {
            const sol = solutions(sp, 10, 1)[0];
            t = `Out of guesses. One level setting: ${sol ? sol.map((v, i) => `${TANK_NAMES[i]} ${v} t`).join(', ') : 'none found'}.`;
          }
          setMsg({ k: attempt >= MAX_ATTEMPTS ? 'bad' : 'hint', t });
          L.play('wrong');
        }
        L.onAttempt(ok);
        sim.reported = true;
      };

      stage.setView({ target: [0, 0.3, 0], yaw: 0.5, pitch: 0.5, w: Lw + 5, h: 8.2, yawRange: [0, 1.2], pitchRange: [0.25, 0.8] });
      setFills(L0.w);

      api.current = {
        setW: (w2) => {
          if (sim.mode === 'plan') setFills(w2);
        },
        flood: (w2) => {
          if (sim.mode !== 'plan') return;
          setFills(w2);
          setMsg(null);
          sim.reported = false;
          sim.t = 0;
          sim.splashed = false;
          if (latest.current.settings.reduceMotion) {
            sim.yw = 0;
            sim.floating = true;
            sim.heel = (sim.st.heel * Math.PI) / 180;
            sim.trim = (sim.st.trim * Math.PI) / 180;
            place();
            sim.mode = 'afloat';
            setPhase('afloat');
            sim.t = 99;
            return;
          }
          sim.mode = 'flooding';
          setPhase('flooding');
          sfx.play('whoosh');
        },
        phase: () => sim.mode,
      };

      const g = 9.81;
      stage.onFrame = (dt, tt) => {
        const m = sim.mode;
        const kRoll = 0.35 * sp.B, kPitch = 0.25 * sp.L;
        if (m === 'flooding' || m === 'afloat' || m === 'draining') {
          sim.t += dt;
          if (m === 'flooding') {
            const u = Math.min(1, sim.t / 3.6);
            sim.yw = FLOOR + 0.35 + (0 - (FLOOR + 0.35)) * (1 - (1 - u) * (1 - u));
            if (sim.yw > -0.4 && !sim.floating) {
              sim.floating = true;
              if (!sim.splashed) {
                sim.splashed = true;
                latest.current.play('splash');
              }
            }
            if (u >= 1) {
              sim.mode = 'afloat';
              sim.t = 0;
              setPhase('afloat');
            }
          } else if (m === 'afloat') {
            if (sim.t > 3.2 && !sim.reported) verdict();
            if (sim.reported && sim.t > 4.6 && !latest.current.record.done) {
              sim.mode = 'draining';
              sim.t = 0;
              setPhase('draining');
            }
          } else {
            const u = Math.min(1, sim.t / 2.4);
            sim.yw = (FLOOR + 0.35) * (u * u * (3 - 2 * u));
            if (sim.yw < -0.4) sim.floating = false;
            if (u >= 1) {
              sim.mode = 'plan';
              sim.floating = false;
              sim.heel = sim.trim = sim.heave = 0;
              sim.heelV = sim.trimV = sim.heaveV = 0;
              setPhase('plan');
            }
          }
          if (sim.floating) {
            // roll, pitch and heave as damped springs pulled toward the true equilibrium
            const st = sim.st;
            const wr = Math.sqrt(g * Math.max(0.3, st.gmT)) / kRoll, wp = Math.sqrt(g * Math.max(1, st.gmL)) / kPitch;
            const waveF = sim.mode === 'afloat' ? 1 : sim.mode === 'flooding' ? 0.4 : 0.2;
            // the list builds up as she comes off the blocks, and fades as the dock drains
            const engage = Math.min(1, Math.max(0, (sim.yw + 0.4) / 0.4));
            const targetHeel = ((st.heel * Math.PI) / 180 + Math.sin(tt * 1.4) * 0.007 * waveF) * engage;
            const targetTrim = ((st.trim * Math.PI) / 180 + Math.sin(tt * 1.1 + 1) * 0.0016 * waveF) * engage;
            const n = 4, h = dt / n;
            for (let i = 0; i < n; i++) {
              sim.heelV += (-wr * wr * (sim.heel - targetHeel) - 2 * 0.2 * wr * sim.heelV) * h;
              sim.heel += sim.heelV * h;
              sim.trimV += (-wp * wp * (sim.trim - targetTrim) - 2 * 0.25 * wp * sim.trimV) * h;
              sim.trim += sim.trimV * h;
              const wh = 2.4;
              sim.heaveV += (-wh * wh * sim.heave - 2 * 0.3 * wh * sim.heaveV) * h;
              sim.heave += sim.heaveV * h;
            }
          }
          place();
        }
        // ripples
        if (!stage.lowCpu && !stage.soft) {
          const p = surfGeo.attributes.position;
          const amp = sim.mode === 'afloat' ? 0.07 : sim.mode === 'flooding' ? 0.05 : 0.015;
          for (let i = 0; i < p.count; i++) {
            const x = base[i * 3], z = base[i * 3 + 2];
            p.setY(i, (Math.sin(x * 0.8 + tt * 1.6) * 0.5 + Math.cos(z * 1.1 + tt * 1.3) * 0.5) * amp);
          }
          p.needsUpdate = true;
        }
      };

      return () => {
        api.current = null;
      };
    },
    [spec],
  );

  useEffect(() => api.current?.setW(w), [w]);
  useEffect(() => {
    if (done && !record.solved) {
      const sol = solutions(spec, PUMP_STEP * 2, 1)[0];
      if (sol) setW(sol);
    }
  }, [done, record.solved, spec]);

  const plan = useMemo(() => <Plan spec={spec} w={w} />, [spec, w]);
  const busy = phase !== 'plan';
  const set = (i: number, v: number) => setW((p) => p.map((x, k) => (k === i ? v : x)));
  const flood = () => {
    if (over || !withinLimits(spec, w)) {
      play('wrong');
      setMsg({ k: 'bad', t: `That is over the pump limit (${spec.pumpMax} t in total) or a tank's capacity.` });
      return;
    }
    api.current?.flood(w);
  };

  return (
    <Board
      info={INFO}
      record={record}
      testId="puzzle-barge"
      view={
        <div className="ens-view" data-testid="barge-view">
          <canvas ref={ref} aria-label="A barge in a dry dock being flooded so she floats" />
          {failed && <Unsupported />}
          <div className="ens-readout">{spec.L} × {spec.B} m barge · lightship {spec.light.m} t</div>
          <div className="ens-readout r" data-testid="barge-state">
            {phase === 'plan' ? 'in dock' : phase === 'flooding' ? 'flooding…' : phase === 'afloat' ? 'afloat' : 'draining…'}
            {read && phase !== 'plan' ? ` · heel ${read.heel >= 0 ? '+' : '−'}${Math.abs(read.heel).toFixed(1)}°` : ''}
          </div>
        </div>
      }
    >
      {!done ? (
        <p className="ens-p">
          The containers were loaded off-centre. Fill the four ballast tanks (up to {spec.pumpMax} t in total, {spec.tanks[0].cap} t each) so that, once the dock is flooded, she floats upright and level.
          Positions are in metres from amidships (x, forward is +) and the centreline (y, starboard is +).
        </p>
      ) : (
        <div className="ens-note" data-k={record.solved ? 'ok' : 'bad'} data-testid="barge-final">
          {record.solved ? 'Afloat and level. ' : 'Out of guesses. '}
          Ballast: <b className="font-mono">{w.join(' / ')} t</b>
        </div>
      )}
      <div className="ens-card p-2" style={{ background: 'var(--en-panel2)' }}>{plan}</div>
      {!done && (
        <>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            {TANK_NAMES.map((name, i) => (
              <label key={name} className="block">
                <span className="ens-label flex justify-between">
                  <span>{name}</span>
                  <b className="font-mono" style={{ color: 'var(--en-ink)' }}>{w[i]} t</b>
                </span>
                <input
                  className="ens-range"
                  type="range"
                  min={0}
                  max={spec.tanks[i].cap}
                  step={PUMP_STEP}
                  value={w[i]}
                  disabled={busy}
                  onChange={(e) => set(i, Number(e.target.value))}
                  data-testid={`barge-tank-${i}`}
                  aria-label={`${name} tank ballast in tonnes`}
                  data-silent
                />
              </label>
            ))}
          </div>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="ens-label" data-testid="barge-total">
                Pumped <b style={{ color: over ? 'var(--en-bad)' : 'var(--en-ink)' }}>{total}</b> of {spec.pumpMax} t
              </p>
              <div className="ens-meter mt-1" aria-hidden><i style={{ width: `${Math.min(100, (total / spec.pumpMax) * 100)}%`, background: over ? 'var(--en-bad)' : 'var(--en-cool)' }} /></div>
            </div>
            <button className="ens-btn" onClick={flood} disabled={busy} data-testid="barge-flood">
              Flood the dock
            </button>
          </div>
        </>
      )}
      {msg && !done && <Note kind={msg.k} testId="barge-msg">{msg.t}</Note>}
    </Board>
  );
}
