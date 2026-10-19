'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { MAX_ATTEMPTS, PUZZLES } from '@/engineerle/daily';
import { STEP, TOL, coupleSum, forceSum, isSmooth, unbalance, type CrankSpec } from '@/engineerle/crank';
import { sfx } from '@/lib/sfx';
import { useSettings } from '@/hooks/useSettings';
import { Board, Note, Unsupported, useStage, type PuzzleProps } from './Board';
import { box, cyl, outline, setStrut, shadowFloor, steel } from './stage';

const INFO = PUZZLES[3];
const E = 0.55; // crank radius
const ROD = 1.75; // connecting rod length
const SCALE = 1.7; // metres along the shaft to world units
const COLORS = ['#37c2ff', '#7c8cff', '#d56cf5', '#ff7a8a', '#ffb347', '#5fe0a0'];
const RUN_SECONDS = 3.6;
const OMEGA = Math.PI * 2 * 3.2; // radians per second at full speed (slowed so the shake can be seen)

const rad = (d: number) => (d * Math.PI) / 180;

interface Api {
  setAngles: (a: number[]) => void;
  run: () => void;
  phase: () => 'idle' | 'running' | 'stopping';
}

/* ───────────────────────────── the dial ───────────────────────────── */

function Dial({ index, angle, mass, color, fixed, disabled, onChange }: { index: number; angle: number; mass: number; color: string; fixed: boolean; disabled: boolean; onChange: (a: number) => void }) {
  const ref = useRef<SVGSVGElement>(null);
  const from = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
    const a = (Math.atan2(dx, -dy) * 180) / Math.PI;
    return ((Math.round((a + 360) / STEP) * STEP) % 360 + 360) % 360;
  };
  const hand = { x: 36 + 22 * Math.sin(rad(angle)), y: 36 - 22 * Math.cos(rad(angle)) };
  const locked = fixed || disabled;
  return (
    <figure className="m-0 flex w-[4.6rem] flex-col items-center gap-1" data-testid={`dial-${index}`}>
      <svg
        ref={ref}
        className="ens-dial"
        width="72"
        height="72"
        viewBox="0 0 72 72"
        role="slider"
        tabIndex={locked ? -1 : 0}
        aria-label={`Cylinder ${index + 1}, ${mass} kilograms`}
        aria-valuemin={0}
        aria-valuemax={360 - STEP}
        aria-valuenow={angle}
        aria-valuetext={`${angle} degrees${fixed ? ', reference' : ''}`}
        aria-disabled={locked}
        style={{ touchAction: 'none', cursor: locked ? 'default' : 'pointer' }}
        onPointerDown={(e) => {
          if (locked) return;
          (e.currentTarget as Element).setPointerCapture(e.pointerId);
          onChange(from(e));
        }}
        onPointerMove={(e) => {
          if (locked || !(e.buttons & 1)) return;
          const a = from(e);
          if (a !== angle) onChange(a);
        }}
        onKeyDown={(e) => {
          if (locked) return;
          if (e.key === 'ArrowRight' || e.key === 'ArrowUp') onChange((angle + STEP) % 360);
          else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') onChange((angle - STEP + 360) % 360);
          else return;
          e.preventDefault();
        }}
      >
        <circle className="face" cx="36" cy="36" r="30" />
        {Array.from({ length: 360 / STEP }, (_, i) => {
          const a = rad(i * STEP), major = i % 3 === 0;
          return <line key={i} className="tick" x1={36 + 26 * Math.sin(a)} y1={36 - 26 * Math.cos(a)} x2={36 + (major ? 21 : 23) * Math.sin(a)} y2={36 - (major ? 21 : 23) * Math.cos(a)} strokeWidth={major ? 1.6 : 1} />;
        })}
        <line className="hand" x1="36" y1="36" x2={hand.x} y2={hand.y} stroke={color} />
        <circle cx={hand.x} cy={hand.y} r="4.5" fill={color} />
        <circle cx="36" cy="36" r="3" fill={color} />
        <text x="36" y="10" textAnchor="middle">0°</text>
      </svg>
      <figcaption className="text-center text-[0.7rem] leading-tight text-mist-300" style={{ color: 'var(--en-mute)' }}>
        <b style={{ color }}>{index + 1}</b> · {mass} kg
        <br />
        <span className="font-mono" style={{ color: 'var(--en-ink)' }}>{angle}°</span>
        {fixed ? <span> ref</span> : null}
      </figcaption>
    </figure>
  );
}

/* ───────────────────────────── phasor polygons ───────────────────────────── */

function Polygon({ title, weights, angles, tol, testId }: { title: string; weights: number[]; angles: number[]; tol: number; testId: string }) {
  const total = weights.reduce((s, w) => s + Math.abs(w), 0) || 1;
  const k = 56 / total;
  let x = 0, y = 0;
  const pts: Array<{ x: number; y: number; c: string }> = [];
  const segs = weights.map((w, i) => {
    const nx = x + w * k * Math.sin(rad(angles[i])), ny = y - w * k * Math.cos(rad(angles[i]));
    const s = { x1: x, y1: y, x2: nx, y2: ny, c: COLORS[i % COLORS.length] };
    x = nx;
    y = ny;
    pts.push({ x, y, c: s.c });
    return s;
  });
  const gap = Math.hypot(x, y) / k / total;
  const closed = gap <= tol;
  return (
    <figure className="m-0 flex flex-col items-center gap-1" data-testid={testId} data-closed={closed}>
      <svg width="132" height="132" viewBox="-66 -66 132 132" role="img" aria-label={`${title}: ${closed ? 'closed' : `open by ${Math.round(gap * 100)} percent`}`}>
        <circle r={tol * total * k} fill="none" stroke={closed ? 'var(--en-ok)' : 'var(--en-line2)'} strokeDasharray="2 2" />
        <circle r="62" fill="none" stroke="var(--en-line)" />
        {segs.map((s, i) => (
          <line key={i} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke={s.c} strokeWidth="3" strokeLinecap="round" />
        ))}
        {pts.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r="2.2" fill={p.c} />
        ))}
        {!closed && <line x1={x} y1={y} x2={0} y2={0} stroke="var(--en-bad)" strokeWidth="1.6" strokeDasharray="4 3" />}
        <circle r="3" fill={closed ? 'var(--en-ok)' : 'var(--en-ink)'} />
      </svg>
      <figcaption className="text-center text-[0.7rem]" style={{ color: 'var(--en-mute)' }}>
        {title}: <b style={{ color: closed ? 'var(--en-ok)' : 'var(--en-bad)' }}>{closed ? 'closed' : `open ${Math.round(gap * 100)}%`}</b>
      </figcaption>
    </figure>
  );
}

/* ───────────────────────────── the puzzle ───────────────────────────── */

export function EnginePuzzle({ spec, record, onAttempt }: PuzzleProps<CrankSpec>) {
  const { play, settings } = useSettings();
  const n = spec.m.length;
  const [angles, setAngles] = useState<number[]>(() => spec.m.map(() => 0));
  const [msg, setMsg] = useState<{ k: 'ok' | 'bad' | 'hint'; t: string } | null>(null);
  const [phase, setPhase] = useState<'idle' | 'running' | 'stopping'>('idle');
  const [vib, setVib] = useState(0);
  const api = useRef<Api | null>(null);
  const done = record.done;
  const latest = useRef({ spec, record, onAttempt, play, settings, angles });
  latest.current = { spec, record, onAttempt, play, settings, angles };

  const { ref, failed } = useStage(
    (stage) => {
      const L0 = latest.current;
      const s = L0.spec;
      const root = stage.root;
      const iron = steel('#8aa0b5', { metal: 0.65, rough: 0.35 });
      const dark = steel('#223a52', { metal: 0.3, rough: 0.6 });
      const width = (s.z[n - 1] - s.z[0]) * SCALE;

      // the bed it sits on, with four springs so the shake can show
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
      const pins: THREE.Mesh[] = [];
      const rods: THREE.Mesh[] = [];
      const pistons: THREE.Mesh[] = [];
      s.m.forEach((m, i) => {
        const x = s.z[i] * SCALE;
        const col = new THREE.Color(COLORS[i % COLORS.length]);
        const rb = 0.3 + 0.1 * m;
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
        // a counter-balancing tail so each throw reads as a crank web
        const tail = box(0.16, 0.5, 0.7, iron);
        tail.position.set(0.42, -0.5, 0);
        const tail2 = tail.clone();
        tail2.position.x = -0.42;
        g.add(tail, tail2);
        rig.add(g);
        throws.push(g);
        pins.push(pin);

        const rod = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 8), steel('#c8d6e3', { metal: 0.6, rough: 0.35 }));
        rod.castShadow = true;
        rig.add(rod);
        rods.push(rod);
        const piston = cyl(rb * 0.9, rb * 0.9, 0.55, steel(col, { metal: 0.5, rough: 0.35 }), 20);
        rig.add(piston);
        pistons.push(piston);
        outline(piston, stage.ink);

        // the cylinder: a glass sleeve with a head on top
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
        const ml = stage.label(`${m} kg`, { size: 0.36, color: '#cfe6f7' });
        ml.position.set(x, 3.7, 0);
        rig.add(ml);
      });

      const sim = { theta: 0, speed: 0, mode: 'idle' as 'idle' | 'running' | 'stopping', t: 0, angles: L0.angles.slice(), shake: { f: 0, c: 0, fa: 0, ca: 0 }, ok: false, lastSoundAt: 0 };

      const pose = () => {
        s.m.forEach((_, i) => {
          const psi = sim.theta + rad(sim.angles[i]);
          const x = s.z[i] * SCALE;
          throws[i].rotation.x = psi;
          const py = E * Math.cos(psi), pz = E * Math.sin(psi);
          const top = py + Math.sqrt(ROD * ROD - pz * pz);
          setStrut(rods[i], new THREE.Vector3(x, py, pz), new THREE.Vector3(x, top, 0), 0.07);
          pistons[i].position.set(x, top + 0.2, 0);
        });
        fly.rotation.x = sim.theta;
      };
      const measure = () => {
        const f = forceSum(s, sim.angles), c = coupleSum(s, sim.angles);
        const u = unbalance(s, sim.angles);
        sim.shake.f = u.force;
        sim.shake.c = u.couple;
        sim.shake.fa = Math.atan2(f.y, f.x); // F e^{jθ}: real part is the vertical force
        sim.shake.ca = Math.atan2(c.y, c.x);
      };
      measure();
      pose();

      const verdict = () => {
        const L = latest.current;
        const attempt = L.record.attempts + 1;
        const u = unbalance(s, sim.angles);
        const ok = isSmooth(s, sim.angles);
        if (ok) {
          setMsg({ k: 'ok', t: 'Smooth. The forces and the rocking couples all cancel, so nothing shakes the mounts.' });
          L.play('correct');
        } else {
          const bits = [] as string[];
          if (u.force > TOL) bits.push(`the up-and-down force is ${Math.round(u.force * 100)}% of the worst case`);
          if (u.couple > TOL) bits.push(`the rocking couple is ${Math.round(u.couple * 100)}%`);
          let t = `She shakes: ${bits.join(' and ')}.`;
          if (attempt === 1) t += ' Both polygons must close. The couple polygon is now unlocked.';
          else if (attempt === 2) {
            const j = 1 + Math.floor(((L.spec.m.length - 1) * 0.5));
            t += ` Hint: in one balanced setting, cylinder ${j + 1} sits at ${L.spec.answer[j]}°.`;
          } else t = `Out of guesses. One balanced setting is ${L.spec.answer.map((a) => `${a}°`).join(', ')}.`;
          setMsg({ k: attempt >= MAX_ATTEMPTS ? 'bad' : 'hint', t });
          L.play('wrong');
        }
        L.onAttempt(ok);
      };

      stage.setView({ target: [0, 0.5, 0], yaw: 0.62, pitch: 0.3, w: width + 6.5, h: 7.2, yawRange: [0.05, 1.2], pitchRange: [0.1, 0.55] });

      api.current = {
        setAngles: (a) => {
          sim.angles = a.slice();
          measure();
          if (sim.mode === 'idle') pose();
        },
        run: () => {
          if (sim.mode !== 'idle') return;
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
            setVib(0);
            rig.position.set(0, 0, 0);
            rig.rotation.z = 0;
          }
          // the unbalanced forces move the whole engine on its springs
          const a = sim.speed * sim.speed;
          const fAmp = Math.min(1, Math.sqrt(sim.shake.f) * 1.1), cAmp = Math.min(1, Math.sqrt(sim.shake.c) * 1.1);
          rig.position.y = Math.cos(sim.theta + sim.shake.fa) * fAmp * 0.34 * a;
          rig.position.x = Math.cos(sim.theta * 0.5) * 0.0;
          rig.rotation.z = Math.cos(sim.theta + sim.shake.ca) * cAmp * 0.075 * a;
          const level = Math.max(fAmp, cAmp);
          if (tt - sim.lastSoundAt > 0.05) {
            sim.lastSoundAt = tt;
            sfx.engineSet(sim.speed, level * sim.speed);
            setVib(level * sim.speed);
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

  useEffect(() => api.current?.setAngles(angles), [angles]);
  useEffect(() => {
    if (done && !record.solved) setAngles(spec.answer);
  }, [done, record.solved, spec.answer]);
  useEffect(() => () => sfx.engineOff(), []);

  const busy = phase !== 'idle';
  const showCouple = record.attempts >= 1 || done;
  const zw = useMemo(() => spec.m.map((m, i) => m * spec.z[i]), [spec]);
  const set = (i: number, a: number) => {
    play('snap');
    setAngles((prev) => prev.map((v, k) => (k === i ? a : v)));
  };

  return (
    <Board
      info={INFO}
      record={record}
      testId="puzzle-engine"
      view={
        <div className="ens-view" data-testid="engine-view">
          <canvas ref={ref} aria-label="An in-line engine on springs. The crank throws are set by the dials below." />
          {failed && <Unsupported />}
          <div className="ens-readout">{n} cylinders</div>
          <div className="ens-readout r" style={{ minWidth: '7.5rem' }}>
            vibration
            <div className="ens-meter mt-1" aria-hidden><i style={{ width: `${Math.round(vib * 100)}%`, background: vib > 0.2 ? 'var(--en-bad)' : 'var(--en-ok)' }} /></div>
          </div>
        </div>
      }
    >
      {!done ? (
        <p className="ens-p">
          Each cylinder&apos;s crank throw can sit at any 30° step round the shaft (cylinder 1 is the reference). Choose angles so the engine runs smoothly: the forces must cancel, and so must the rocking
          couples, which count each mass by how far it sits from the middle.
        </p>
      ) : (
        <div className="ens-note" data-k={record.solved ? 'ok' : 'bad'} data-testid="engine-final">
          {record.solved ? 'Smooth running. ' : 'Out of guesses. '}Settings: <b className="font-mono">{(record.solved ? angles : spec.answer).map((a) => `${a}°`).join(' ')}</b>
        </div>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Crank angles">
          {spec.m.map((m, i) => (
            <Dial key={i} index={i} angle={angles[i]} mass={m} color={COLORS[i % COLORS.length]} fixed={i === 0} disabled={busy || done} onChange={(a) => set(i, a)} />
          ))}
        </div>
        <div className="flex gap-2">
          <Polygon title="Forces" weights={spec.m} angles={angles} tol={TOL} testId="poly-force" />
          {showCouple ? (
            <Polygon title="Couples" weights={zw} angles={angles} tol={TOL} testId="poly-couple" />
          ) : (
            <figure className="m-0 grid h-[9.3rem] w-[8.25rem] place-items-center text-center text-[0.7rem]" style={{ color: 'var(--en-faint)', border: '1px dashed var(--en-line)', borderRadius: 4 }} data-testid="poly-couple-locked">
              Couple polygon
              <br />
              unlocks after a try
            </figure>
          )}
        </div>
      </div>
      {!done && (
        <div className="flex items-center justify-between gap-3">
          <p className="ens-label">The engine is only tested when you start it.</p>
          <button className="ens-btn" onClick={() => api.current?.run()} disabled={busy} data-testid="engine-start">
            {busy ? 'Running…' : 'Start the engine'}
          </button>
        </div>
      )}
      {msg && !done && <Note kind={msg.k} testId="engine-msg">{msg.t}</Note>}
    </Board>
  );
}
