'use client';

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { MAX_ATTEMPTS } from '@/engineerle/scoring';
import { byId } from '@/engineerle/registry';
import { MAX_TEETH, MIN_TEETH, centreDistance, evaluate, type Evaluation, type GearSpec, type Mesh } from '@/engineerle/gears';
import { useSettings } from '@/hooks/useSettings';
import { Board, Note, Unsupported, useStage, type PuzzleProps } from './Board';
import { box, cyl, steel } from './stage';

const INFO = byId('gears')!;
const plural = (k: number) => `${k} ${k === 1 ? 'guess' : 'guesses'} left`;
const COLORS = ['#e07b39', '#5aa9e6', '#9bd65e', '#d96ac7'];
const U = 0.1; // one scene unit is 10 mm
const THICK = 0.7;
const SLOW = 60; // the picture turns this many times slower than the real shaft
const fmtRpm = (v: number) => `${Number(Math.abs(v).toPrecision(4))} rpm`;
const dirText = (v: number) => (v >= 0 ? 'the same way as the input' : 'against the input');

/** A flat spur gear with `z` teeth at module `m` (mm), centred on the origin, tooth centred on +x. */
function gearGeometry(z: number, m: number): THREE.BufferGeometry {
  const rp = (m * z) / 2 * U, add = m * U, ded = 1.25 * m * U;
  const rr = rp - ded, ro = rp + add, p = (2 * Math.PI) / z;
  const sh = new THREE.Shape();
  const pt = (r: number, a: number) => new THREE.Vector2(r * Math.cos(a), r * Math.sin(a));
  for (let i = 0; i < z; i++) {
    const c = i * p;
    const pts = [pt(rr, c - 0.3 * p), pt(ro, c - 0.14 * p), pt(ro, c + 0.14 * p), pt(rr, c + 0.3 * p), pt(rr, c + 0.5 * p)];
    pts.forEach((q, k) => (i === 0 && k === 0 ? sh.moveTo(q.x, q.y) : sh.lineTo(q.x, q.y)));
  }
  sh.closePath();
  const hole = new THREE.Path();
  hole.absarc(0, 0, Math.max(0.18, rp * 0.14), 0, Math.PI * 2, true);
  sh.holes.push(hole);
  const g = new THREE.ExtrudeGeometry(sh, { depth: THICK, bevelEnabled: false });
  g.translate(0, 0, -THICK / 2);
  return g;
}

interface Api { setTeeth: (t: Mesh[]) => void; run: (ev: Evaluation) => void; phase: () => 'hold' | 'running' | 'resting' }

export function GearPuzzle({ spec, record, onAttempt }: PuzzleProps<GearSpec>) {
  const { play, settings } = useSettings();
  const [teeth, setTeeth] = useState<Mesh[]>(() => spec.start.map((m) => ({ ...m })));
  const [phase, setPhase] = useState<'hold' | 'running' | 'resting'>('hold');
  const [msg, setMsg] = useState<{ k: 'ok' | 'bad' | 'warn'; t: string } | null>(null);
  const [shown, setShown] = useState<Evaluation | null>(null);
  const api = useRef<Api | null>(null);
  const done = record.done;
  const latest = useRef({ spec, record, onAttempt, play, teeth, settings });
  latest.current = { spec, record, onAttempt, play, teeth, settings };

  const { ref, failed } = useStage(
    (stage) => {
      const s = latest.current.spec;
      const root = stage.root;
      const n = s.maxCentre.length;
      const iron = steel('#8aa0b5', { metal: 0.6, rough: 0.4 });
      const plate = steel('#16324f', { metal: 0.1, rough: 0.85 });
      const base = box(40, 0.3, 6, plate, false);
      base.position.y = -0.2;
      root.add(base);

      const sim = { phase: 'hold' as 'hold' | 'running' | 'resting', t: 0, angle: 0, ev: null as Evaluation | null, teeth: latest.current.teeth.map((m) => ({ ...m })) };
      let built: THREE.Group | null = null;
      const shafts: Array<{ group: THREE.Object3D[]; ratio: number }> = [];
      const gearObjs: Array<{ obj: THREE.Mesh; shaft: number; phase: number }> = [];
      let shaftRatios: number[] = [];

      const rebuild = () => {
        if (built) {
          root.remove(built);
          built.traverse((o) => { const m = o as THREE.Mesh; if (m.geometry) m.geometry.dispose(); });
        }
        built = new THREE.Group();
        root.add(built);
        gearObjs.length = 0;
        shafts.length = 0;
        const T = sim.teeth;
        const xs: number[] = [0];
        for (let k = 0; k < n; k++) xs.push(xs[k] + centreDistance(s.module, T[k]) * U);
        shaftRatios = [1];
        for (let k = 0; k < n; k++) shaftRatios.push(shaftRatios[k] * -(T[k].driver / T[k].driven));
        const planeZ = (k: number) => (k % 2 === 0 ? -THICK * 0.6 : THICK * 0.6);
        let maxR = 0;
        for (let k = 0; k < n; k++) {
          const dr = (s.module * T[k].driver) / 2 * U, dn = (s.module * T[k].driven) / 2 * U;
          maxR = Math.max(maxR, dr, dn);
          const mk = (z: number, x: number, zpos: number, col: string, shaft: number, phase: number, label: string) => {
            const mesh = new THREE.Mesh(gearGeometry(z, s.module), steel(col, { metal: 0.45, rough: 0.5 }));
            mesh.castShadow = true;
            mesh.position.set(x, 0, zpos);
            built!.add(mesh);
            gearObjs.push({ obj: mesh, shaft, phase });
            const lab = stage.label(label, { size: 1.0, color: '#10243a', bg: 'rgba(240,248,255,0.92)' });
            lab.position.set(x, 0, zpos + THICK * 0.9 * (zpos < 0 ? -1 : 1));
            built!.add(lab);
          };
          mk(T[k].driver, xs[k], planeZ(k), COLORS[k % COLORS.length], k, 0, `${T[k].driver}T`);
          mk(T[k].driven, xs[k + 1], planeZ(k), COLORS[(k + 1) % COLORS.length], k + 1, Math.PI - Math.PI / T[k].driven, `${T[k].driven}T`);
        }
        // shafts, long enough to span both planes where a compound pair sits
        for (let j = 0; j <= n; j++) {
          const sh = cyl(0.12, 0.12, THICK * 2.4, iron, 14, false);
          sh.rotation.x = Math.PI / 2;
          sh.position.set(xs[j], 0, 0);
          built.add(sh);
        }
        const inTag = stage.label(`in ${s.inputRpm} rpm`, { size: 0.7, color: '#ffb454' });
        inTag.position.set(xs[0], -maxR - 1, 0);
        const outTag = stage.label('out', { size: 0.7, color: '#5dff9f' });
        outTag.position.set(xs[n], -maxR - 1, 0);
        built.add(inTag, outTag);
        const left = -(Math.max(dr0(T[0]), 1)) - 0.6, right = xs[n] + Math.max(dn1(T[n - 1]), 1) + 0.6;
        const w = right - left + 2, h = maxR * 2 + 4;
        stage.setView({ target: [(left + right) / 2, 0, 0], yaw: 0.12, pitch: 0.08, w: Math.max(w, h * 1.5), h: Math.max(h, w / 1.5), yawRange: [-0.4, 0.5], pitchRange: [0.0, 0.35] });
        base.scale.x = Math.max(1, w / 40);
        base.position.set((left + right) / 2, -maxR - 0.3, 0);
        pose();
      };
      const dr0 = (m: Mesh) => (s.module * m.driver) / 2 * U;
      const dn1 = (m: Mesh) => (s.module * m.driven) / 2 * U;
      const pose = () => {
        for (const g of gearObjs) g.obj.rotation.z = sim.angle * shaftRatios[g.shaft] + g.phase;
      };
      rebuild();

      const verdict = (ev: Evaluation) => {
        const L = latest.current;
        const attempt = L.record.attempts + 1;
        setShown(ev);
        const facts: string[] = [`The output turns at ${fmtRpm(ev.rpm!)}, ${dirText(ev.rpm!)}; the target is ${fmtRpm(L.spec.targetRpm)}.`];
        ev.fits!.forEach((f, i) => { if (!f) facts.push(`Mesh ${i + 1} needs a centre distance of ${ev.centres![i].toFixed(1)} mm but its slot in the housing is ${L.spec.maxCentre[i]} mm, so the case will not close.`); });
        if (ev.solved) {
          setMsg({ k: 'ok', t: `${facts[0]} Output torque ${Number(ev.torque!.toPrecision(3))} N·m. Right on speed and everything fits.` });
          L.play('correct');
        } else {
          const last = attempt >= MAX_ATTEMPTS;
          setMsg({ k: last ? 'bad' : 'warn', t: `${facts.join(' ')} ${last ? 'Out of guesses.' : plural(MAX_ATTEMPTS - attempt) + '.'}` });
          L.play('wrong');
        }
        L.onAttempt(ev.solved);
      };

      api.current = {
        setTeeth: (t) => {
          if (sim.phase === 'running') return;
          sim.teeth = t.map((m) => ({ ...m }));
          rebuild();
        },
        run: (ev) => {
          if (sim.phase !== 'hold') return;
          sim.teeth = latest.current.teeth.map((m) => ({ ...m }));
          sim.ev = ev;
          if (latest.current.settings.reduceMotion) {
            sim.angle = 0.6;
            pose();
            sim.phase = 'resting';
            setPhase('resting');
            verdict(ev);
            return;
          }
          latest.current.play('whoosh', 0.4);
          sim.phase = 'running';
          sim.t = 0;
          setPhase('running');
        },
        phase: () => sim.phase,
      };

      stage.onFrame = (dt) => {
        if (sim.phase === 'running' && sim.ev) {
          sim.t += dt;
          sim.angle += ((2 * Math.PI * s.inputRpm) / 60 / SLOW) * dt;
          pose();
          if (sim.t >= 4) { sim.phase = 'resting'; sim.t = 0; setPhase('resting'); verdict(sim.ev); }
        } else if (sim.phase === 'resting') {
          sim.t += dt;
          if (sim.t > 2.2 && !latest.current.record.done) { sim.phase = 'hold'; setPhase('hold'); setShown(null); }
        }
      };
      return () => { api.current = null; };
    },
    [spec],
  );

  useEffect(() => api.current?.setTeeth(teeth), [teeth]);
  useEffect(() => {
    if (done && !record.solved) setTeeth(spec.example.map((m) => ({ ...m })));
  }, [done, record.solved, spec.example]);

  const busy = phase !== 'hold' && !done;
  const run = () => {
    const ev = evaluate(spec, teeth);
    if (ev.refused) { setMsg({ k: 'warn', t: ev.refused }); play('wrong'); return; }
    setMsg(null);
    api.current?.run(ev);
  };
  const setZ = (k: number, which: 'driver' | 'driven', v: number) => setTeeth((t) => t.map((m, i) => (i === k ? { ...m, [which]: v } : m)));
  const dir = spec.targetRpm >= 0 ? 'the same way as the input' : 'the opposite way to the input';

  return (
    <Board
      info={INFO}
      record={record}
      testId="puzzle-gears"
      view={
        <div className="ens-view" data-testid="gear-view">
          <canvas ref={ref} aria-label="A compound gear train: each pair meshes, and the second gear of one pair shares a shaft with the first of the next" />
          {failed && <Unsupported />}
          <div className="ens-readout" data-testid="gear-readout">input {spec.inputRpm.toLocaleString('en-US')} rpm, {spec.inputTorque} N·m</div>
          <div className="ens-readout r" data-testid="gear-result">{shown && !done ? `out ${shown.rpm! < 0 ? '−' : '+'}${Number(Math.abs(shown.rpm!).toPrecision(4))} rpm` : `want ${fmtRpm(spec.targetRpm)}`}</div>
        </div>
      }
    >
      {done ? (
        <div className="ens-note" data-k={record.solved ? 'ok' : 'bad'} data-testid="gear-final">
          {record.solved ? 'Right speed. ' : 'Out of guesses. '}
          {record.solved ? 'Your train' : 'One train that works'} is{' '}
          <b className="font-mono">{(record.solved ? teeth : spec.example).map((m) => `${m.driver}→${m.driven}`).join(', ')}</b>
          {' '}teeth: a ratio of <b className="font-mono">{Number((evaluate(spec, record.solved ? teeth : spec.example).ratio ?? 0).toPrecision(4))}</b> and an output torque of{' '}
          <b className="font-mono">{Number((evaluate(spec, record.solved ? teeth : spec.example).torque ?? 0).toPrecision(3))} N·m</b> after the 2% loss in each mesh.
        </div>
      ) : (
        <>
          <p className="ens-p">
            The input shaft turns at <b className="font-mono" style={{ color: 'var(--en-ink)' }}>{spec.inputRpm.toLocaleString('en-US')} rpm</b>. The output must turn at <b className="font-mono" style={{ color: 'var(--en-ink)' }}>{fmtRpm(spec.targetRpm)}</b> within {Math.round(spec.tolerance * 100)}%, {dir}. The train has {spec.maxCentre.length} meshes; the driven gear of each shares a shaft with the driver of the next.
            Module {spec.module} mm, so a mesh sits at a centre distance of m(z₁+z₂)/2. Slots in the housing allow at most {spec.maxCentre.map((c, i) => `${c} mm (mesh ${i + 1})`).join(', ')}. Teeth from {MIN_TEETH} to {MAX_TEETH}.
          </p>
          <div className="flex flex-col gap-2">
            {teeth.map((m, k) => (
              <div key={k} className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-4">
                <b className="w-14 shrink-0 font-mono text-xs" style={{ color: COLORS[k % COLORS.length] }}>mesh {k + 1}</b>
                {(['driver', 'driven'] as const).map((which) => (
                  <div key={which} className="flex flex-1 items-center gap-2">
                    <span className="w-12 shrink-0 text-xs" style={{ color: 'var(--en-mute)' }}>{which}</span>
                    <label className="flex-1">
                      <span className="sr-only">Mesh {k + 1} {which} teeth</span>
                      <input className="ens-range" type="range" min={MIN_TEETH} max={MAX_TEETH} step={1} value={m[which]} disabled={busy} onChange={(e) => setZ(k, which, Number(e.target.value))} aria-valuetext={`${m[which]} teeth`} data-testid={`gear-${which === 'driver' ? 'd' : 'n'}-${k}`} data-silent />
                    </label>
                    <b className="w-8 text-right font-mono text-sm" style={{ color: 'var(--en-ink)' }}>{m[which]}</b>
                  </div>
                ))}
              </div>
            ))}
          </div>
          <div className="flex justify-end">
            <button className="ens-btn" onClick={run} disabled={busy} data-testid="gear-run">
              {busy ? 'Running…' : 'Run the train'}
            </button>
          </div>
        </>
      )}
      {msg && !done && <Note kind={msg.k} testId="gear-msg">{msg.t}</Note>}
    </Board>
  );
}
