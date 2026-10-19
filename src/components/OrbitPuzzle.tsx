'use client';

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { MAX_ATTEMPTS } from '@/engineerle/scoring';
import { byId } from '@/engineerle/registry';
import { MU, evaluate, hohmann, leadAngle, trajectory, type Evaluation, type OrbitSpec } from '@/engineerle/orbit';
import { useSettings } from '@/hooks/useSettings';
import { Board, Note, Unsupported, useStage, type PuzzleProps } from './Board';

const INFO = byId('orbit')!;
const plural = (k: number) => `${k} ${k === 1 ? 'guess' : 'guesses'} left`;
const R_EARTH = 6378.137;
const km = (v: number) => `${Math.round(v).toLocaleString('en-US')} km`;
const T_FLIGHT = 5; // seconds on screen for the whole coast, however long it takes in life

type Phase = 'hold' | 'burn' | 'coast' | 'resting' | 'resetting';
interface Api { fire: (dv: number) => void; showAnswer: () => void; phase: () => Phase }

/** Digits with an optional decimal point (and thousands commas); anything else is not a burn. */
export function parseBurn(text: string): number | null {
  const t = text.trim().replace(/[, ]/g, '');
  if (!/^(\d+\.?\d*|\.\d+)$/.test(t)) return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}

export function OrbitPuzzle({ spec, record, onAttempt }: PuzzleProps<OrbitSpec>) {
  const { play, settings } = useSettings();
  const [text, setText] = useState('');
  const [phase, setPhase] = useState<Phase>('hold');
  const [msg, setMsg] = useState<{ k: 'ok' | 'bad' | 'warn'; t: string } | null>(null);
  const [live, setLive] = useState<{ r: number; v: number } | null>(null);
  const api = useRef<Api | null>(null);
  const done = record.done;
  const latest = useRef({ spec, record, onAttempt, play, settings });
  latest.current = { spec, record, onAttempt, play, settings };
  const h = hohmann(spec.r1, spec.r2);

  const { ref, failed } = useStage(
    (stage) => {
      const s = latest.current.spec;
      const root = stage.root;
      const U = 1 / 1000; // one scene unit is 1000 km
      const rk = s.r2 * U;
      const mk = Math.max(0.3, rk / 24); // marker size that stays readable at any zoom

      // Earth with a graticule so its turning (and the plane) reads
      const earth = new THREE.Mesh(new THREE.SphereGeometry(R_EARTH * U, 40, 24), new THREE.MeshStandardMaterial({ color: 0x2a6fb0, roughness: 0.7, metalness: 0.05 }));
      earth.castShadow = false;
      root.add(earth);
      const grat = new THREE.Group();
      for (let i = 1; i < 6; i++) {
        const lat = (i / 6) * Math.PI - Math.PI / 2;
        const pts: THREE.Vector3[] = [];
        for (let k = 0; k <= 48; k++) pts.push(new THREE.Vector3(R_EARTH * U * 1.002 * Math.cos(lat) * Math.cos((k / 48) * Math.PI * 2), R_EARTH * U * 1.002 * Math.sin(lat), R_EARTH * U * 1.002 * Math.cos(lat) * Math.sin((k / 48) * Math.PI * 2)));
        grat.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x9fd0ff, transparent: true, opacity: 0.22 })));
      }
      root.add(grat);

      const ring = (r: number, color: number, opacity: number, dash = false) => {
        const pts: THREE.Vector3[] = [];
        for (let k = 0; k <= 180; k++) pts.push(new THREE.Vector3(r * U * Math.cos((k / 180) * Math.PI * 2), 0, -r * U * Math.sin((k / 180) * Math.PI * 2)));
        const g = new THREE.BufferGeometry().setFromPoints(pts);
        const m = dash ? new THREE.LineDashedMaterial({ color, transparent: true, opacity, dashSize: rk * 0.03, gapSize: rk * 0.02 }) : new THREE.LineBasicMaterial({ color, transparent: true, opacity });
        const l = new THREE.Line(g, m);
        if (dash) l.computeLineDistances();
        return l;
      };
      root.add(ring(s.r1, 0xcfe6f7, 0.8));
      root.add(ring(s.r2, 0xffb454, 0.9, true));
      const tagStart = stage.label('start orbit', { size: mk * 4.2, color: '#cfe6f7' });
      const ds = (s.r1 * U + mk * 5) * Math.SQRT1_2;
      tagStart.position.set(-ds, 0.05, ds);
      const tagTarget = stage.label('target orbit', { size: mk * 4.2, color: '#ffb454' });
      const dt2 = (s.r2 * U + mk * 5) * Math.SQRT1_2;
      tagTarget.position.set(-dt2, 0.05, -dt2);
      root.add(tagStart, tagTarget);

      // the craft, the burn point, and the path it flies
      const craft = new THREE.Mesh(new THREE.ConeGeometry(mk * 0.34, mk * 0.9, 12), new THREE.MeshStandardMaterial({ color: 0xf1f7fb, emissive: 0x335577, roughness: 0.4 }));
      craft.rotation.x = Math.PI / 2;
      const craftG = new THREE.Group();
      craftG.add(craft);
      root.add(craftG);
      const burnMark = new THREE.Mesh(new THREE.SphereGeometry(mk * 0.2, 12, 8), new THREE.MeshBasicMaterial({ color: 0xff8a3d }));
      burnMark.position.set(s.r1 * U, 0, 0);
      root.add(burnMark);
      const pathMat = new THREE.LineBasicMaterial({ color: 0x5dff9f });
      let pathLine: THREE.Line | null = null;
      let apoMark: THREE.Mesh | null = null;
      const clearPath = () => {
        if (pathLine) { root.remove(pathLine); pathLine.geometry.dispose(); pathLine = null; }
        if (apoMark) { root.remove(apoMark); apoMark = null; }
      };
      const setPath = (pts: Array<{ x: number; y: number }>, upto: number) => {
        const n = Math.max(1, Math.min(pts.length, Math.floor(upto) + 1));
        const g = new THREE.BufferGeometry().setFromPoints(pts.slice(0, n).map((p) => new THREE.Vector3(p.x * U, 0, -p.y * U)));
        if (pathLine) { pathLine.geometry.dispose(); pathLine.geometry = g; } else { pathLine = new THREE.Line(g, pathMat); root.add(pathLine); }
      };
      const place = (p: { x: number; y: number }, q: { x: number; y: number }) => {
        craftG.position.set(p.x * U, 0, -p.y * U);
        craftG.rotation.y = Math.atan2(q.x - p.x, -(q.y - p.y)); // face along the path
      };
      const home = () => {
        craftG.position.set(s.r1 * U, 0, 0);
        craftG.rotation.y = 0; // prograde here is -z
      };
      home();
      stage.setView({ target: [0, 0, 0], yaw: 0, pitch: 1.1, w: rk * 2.6, h: rk * 2.2, yawRange: [-0.4, 0.4], pitchRange: [0.5, 1.35] });

      const sim = { phase: 'hold' as Phase, t: 0, pts: [] as Array<{ x: number; y: number }>, ev: null as Evaluation | null, dv: 0 };
      const setPhaseBoth = (p: Phase) => { sim.phase = p; sim.t = 0; setPhase(p); };

      const verdict = (ev: Evaluation) => {
        const L = latest.current;
        const attempt = L.record.attempts + 1;
        let facts: string;
        if (ev.escapes) facts = 'That burn is past escape speed: the craft leaves the Earth on a hyperbola and never comes back to an apoapsis.';
        else {
          const err = ((ev.apoapsis! - L.spec.r2) / L.spec.r2) * 100;
          facts = `The apoapsis is at ${km(ev.apoapsis!)} from the Earth's centre, ${Math.abs(err).toFixed(1)}% ${err < 0 ? 'below' : 'above'} the target of ${km(L.spec.r2)}.`;
        }
        if (ev.solved) {
          setMsg({ k: 'ok', t: `${facts} On the target orbit.` });
          L.play('correct');
        } else {
          const last = attempt >= MAX_ATTEMPTS;
          setMsg({ k: last ? 'bad' : 'warn', t: last ? `${facts} Out of guesses.` : `${facts} ${plural(MAX_ATTEMPTS - attempt)}.` });
          L.play('wrong');
        }
        L.onAttempt(ev.solved);
      };

      api.current = {
        fire: (dv) => {
          if (sim.phase !== 'hold') return;
          const ev = evaluate(latest.current.spec, dv);
          if (ev.refused) { setMsg({ k: 'warn', t: ev.refused }); latest.current.play('wrong'); return; }
          setMsg(null);
          sim.ev = ev;
          sim.dv = dv;
          sim.pts = trajectory(latest.current.spec, dv, 240);
          if (latest.current.settings.reduceMotion) {
            setPath(sim.pts, sim.pts.length);
            const a = sim.pts[sim.pts.length - 2], b = sim.pts[sim.pts.length - 1];
            place(b, { x: b.x + (b.x - a.x), y: b.y + (b.y - a.y) });
            setPhaseBoth('resting');
            setLive(null);
            verdict(ev);
            return;
          }
          latest.current.play('whoosh');
          setPhaseBoth('burn');
        },
        showAnswer: () => {
          clearPath();
          const pts = trajectory(latest.current.spec, h.dv1 * 1000, 240);
          setPath(pts, pts.length);
          const a = pts[pts.length - 2], b = pts[pts.length - 1];
          place(b, { x: b.x + (b.x - a.x), y: b.y + (b.y - a.y) });
        },
        phase: () => sim.phase,
      };

      stage.onFrame = (dt) => {
        const ph = sim.phase;
        if (ph === 'burn') {
          sim.t += dt;
          setPath(sim.pts, 1);
          burnMark.scale.setScalar(1 + 0.6 * Math.sin(sim.t * 24));
          if (sim.t > 0.5) { burnMark.scale.setScalar(1); setPhaseBoth('coast'); }
        } else if (ph === 'coast') {
          sim.t += dt;
          const f = Math.min(1, sim.t / T_FLIGHT);
          const idx = f * (sim.pts.length - 1);
          setPath(sim.pts, idx);
          const i = Math.min(sim.pts.length - 2, Math.floor(idx));
          const u = idx - i;
          const p = { x: sim.pts[i].x + (sim.pts[i + 1].x - sim.pts[i].x) * u, y: sim.pts[i].y + (sim.pts[i + 1].y - sim.pts[i].y) * u };
          place(p, sim.pts[i + 1]);
          const r = Math.hypot(p.x, p.y);
          const vis = Math.sqrt(MU * (2 / r - 1 / (sim.ev!.apoapsis !== undefined ? (latest.current.spec.r1 + sim.ev!.apoapsis) / 2 : -1e9)));
          setLive({ r, v: Number.isFinite(vis) ? vis : 0 });
          if (f >= 1) {
            if (sim.ev!.apoapsis !== undefined) {
              apoMark = new THREE.Mesh(new THREE.SphereGeometry(mk * 0.22, 12, 8), new THREE.MeshBasicMaterial({ color: 0x5dff9f }));
              apoMark.position.copy(craftG.position);
              root.add(apoMark);
            }
            setPhaseBoth('resting');
            verdict(sim.ev!);
          }
        } else if (ph === 'resting') {
          sim.t += dt;
          if (sim.t > 2.6 && !latest.current.record.done) setPhaseBoth('resetting');
        } else if (ph === 'resetting') {
          clearPath();
          home();
          setLive(null);
          setPhaseBoth('hold');
        }
      };
      return () => { api.current = null; };
    },
    [spec],
  );

  // a finished puzzle that was not solved shows the textbook path
  useEffect(() => {
    if (done && !record.solved) {
      const id = window.setTimeout(() => api.current?.showAnswer(), 3000);
      return () => window.clearTimeout(id);
    }
  }, [done, record.solved]);

  const busy = phase !== 'hold' && !done;
  const fire = () => {
    const v = parseBurn(text);
    if (v === null) {
      setMsg({ k: 'warn', t: text.trim() === '' ? 'Enter the burn in m/s first.' : 'A burn is a number of m/s: digits only, no minus sign.' });
      play('wrong');
      return;
    }
    api.current?.fire(v);
  };

  return (
    <Board
      info={INFO}
      record={record}
      testId="puzzle-orbit"
      view={
        <div className="ens-view" data-testid="orbit-view">
          <canvas ref={ref} aria-label="The Earth, the circular start orbit, the dashed target orbit and the path the burn sends the craft on" />
          {failed && <Unsupported />}
          <div className="ens-readout" data-testid="orbit-readout">start r = {km(spec.r1)} · target r = {km(spec.r2)}</div>
          <div className="ens-readout r" data-testid="orbit-live">{live ? `r ${km(live.r)}` : 'on the start orbit'}{live ? <><br />v {live.v.toFixed(2)} km/s</> : null}</div>
        </div>
      }
    >
      {done ? (
        <div className="ens-note" data-k={record.solved ? 'ok' : 'bad'} data-testid="orbit-final">
          {record.solved ? 'On the target orbit. ' : 'Out of guesses. '}
          The Hohmann burn is <b className="font-mono">{Math.round(h.dv1 * 1000).toLocaleString('en-US')} m/s</b> at the start, coasting <b className="font-mono">{(h.time / 3600).toFixed(2)} h</b>, then <b className="font-mono">{Math.round(h.dv2 * 1000).toLocaleString('en-US')} m/s</b> at the top to circularise.
          To rendezvous, a target there has to start <b className="font-mono">{((leadAngle(spec.r1, spec.r2) * 180) / Math.PI).toFixed(1)}°</b> ahead.
        </div>
      ) : (
        <>
          <p className="ens-p">
            A craft is in a circular orbit {km(spec.r1)} from the Earth&apos;s centre (μ = 398,600 km³/s²). One prograde burn at this point must send it to an apoapsis of{' '}
            <b className="font-mono" style={{ color: 'var(--en-ink)' }}>{km(spec.r2)}</b>, within {Math.round(spec.tolerance * 100)}%. How big is the burn?
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <label className="min-w-0 flex-1">
              <span className="ens-label">Burn (m/s)</span>
              <input
                className="ens-input"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={text}
                disabled={busy}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') fire(); }}
                placeholder="e.g. 2400"
                aria-label="Burn in metres per second"
                data-testid="orbit-dv"
              />
            </label>
            <button className="ens-btn" onClick={fire} disabled={busy} data-testid="orbit-fire">
              {busy ? 'Coasting…' : 'Fire'}
            </button>
          </div>
        </>
      )}
      {msg && !done && <Note kind={msg.k} testId="orbit-msg">{msg.t}</Note>}
    </Board>
  );
}
