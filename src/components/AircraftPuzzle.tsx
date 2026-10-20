'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { MAX_ATTEMPTS } from '@/engineerle/scoring';
import { byId } from '@/engineerle/registry';
import { G, SM_MAX, SM_MIN, STEP, cgPosition, evaluate, percentMac, solvePlacements, totalMass, type AircraftSpec, type Evaluation, type Outcome } from '@/engineerle/aircraft';
import { useSettings } from '@/hooks/useSettings';
import { Board, Note, Unsupported, useStage, type PuzzleProps } from './Board';
import { box, cyl, outline, shadowFloor, steel } from './stage';

const INFO = byId('aircraft')!;
const plural = (k: number) => `${k} ${k === 1 ? 'guess' : 'guesses'} left`;
const COLORS = ['#e07b39', '#5aa9e6', '#9bd65e', '#d96ac7'];
const fmtN = (n: number) => `${Math.round(Math.abs(n)).toLocaleString('en-US')} N`;
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

type Phase = 'hold' | 'flying' | 'resting' | 'resetting';
interface Api { setPlacements: (p: number[]) => void; fly: (ev: Evaluation) => void; phase: () => Phase }

const OUTCOME_TEXT: Record<Outcome, string> = {
  trims: 'She trims in level flight.',
  unstable: 'The CG is behind the neutral point: the aircraft is unstable and the nose runs away.',
  marginal: 'The CG is almost at the neutral point: she is barely stable and the nose wanders.',
  'too-stable': 'The CG is far forward: she is stable but so nose-heavy that the elevator cannot rotate her.',
  'nose-up': 'The tail cannot lift enough to hold the nose down: she pitches up.',
  'nose-down': 'The tail cannot push down enough to hold the nose up: she pitches down.',
};

function Diagram({ spec, ev }: { spec: AircraftSpec; ev: Evaluation }) {
  const lo = Math.min(spec.xAc - 0.25 * spec.mac, ev.xcg! - 0.1) - 0.15, hi = Math.max(spec.xNp, ev.xcg!) + 0.35 * spec.mac;
  const W = 320, H = 70, X = (x: number) => 14 + ((x - lo) / (hi - lo)) * (W - 28);
  const le = spec.xAc - 0.25 * spec.mac;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Loading diagram: the centre of gravity at ${ev.xcg!.toFixed(2)} metres, ${percentMac(spec, ev.xcg!).toFixed(0)} percent of the mean chord`} data-testid="air-diagram" style={{ maxHeight: 96 }}>
      <rect x={X(le)} y="30" width={X(le + spec.mac) - X(le)} height="12" fill="rgba(90,169,230,0.25)" stroke="var(--en-line2)" />
      <text x={X(le)} y="26" fontSize="7" fontFamily="var(--font-mono)" fill="var(--en-mute)">mean chord</text>
      <g fontFamily="var(--font-mono)" fontSize="7.5" fontWeight="700">
        <line x1={X(spec.xAc)} y1="22" x2={X(spec.xAc)} y2="50" stroke="var(--en-mute)" strokeWidth="1" strokeDasharray="2 2" />
        <text x={X(spec.xAc)} y="60" textAnchor="middle" fill="var(--en-mute)">wing AC</text>
        <line x1={X(spec.xNp)} y1="22" x2={X(spec.xNp)} y2="50" stroke="#5dff9f" strokeWidth="1.4" />
        <text x={X(spec.xNp)} y="18" textAnchor="middle" fill="#5dff9f">neutral point</text>
        <path d={`M${X(ev.xcg!)},44 l-5,10 l10,0 z`} fill="var(--en-accent)" />
        <text x={X(ev.xcg!)} y="66" textAnchor="middle" fill="var(--en-accent)">CG</text>
      </g>
    </svg>
  );
}

export function AircraftPuzzle({ spec, record, onAttempt }: PuzzleProps<AircraftSpec>) {
  const { play, settings } = useSettings();
  const [pos, setPos] = useState<number[]>(() => spec.items.map((i) => i.start));
  const [phase, setPhase] = useState<Phase>('hold');
  const [msg, setMsg] = useState<{ k: 'ok' | 'bad' | 'warn'; t: string } | null>(null);
  const [shown, setShown] = useState<Evaluation | null>(null);
  const api = useRef<Api | null>(null);
  const done = record.done;
  const mountedSolved = useRef(record.solved);
  // Mounted already solved (opened again, or after a reload)? Then the dial is back at its start and the only honest thing to show is a setting that works.
  const mine = record.solved && !mountedSolved.current;
  const latest = useRef({ spec, record, onAttempt, play, pos, settings });
  latest.current = { spec, record, onAttempt, play, pos, settings };
  const example = useMemo(() => solvePlacements(spec), [spec]);

  const { ref, failed } = useStage(
    (stage) => {
      const s = latest.current.spec;
      const root = stage.root;
      const skin = steel('#e8eef4', { metal: 0.2, rough: 0.5 });
      const trim = steel('#d9732b', { metal: 0.2, rough: 0.55 });
      const dark = steel('#2a3f55', { metal: 0.2, rough: 0.7 });
      const iron = steel('#8aa0b5', { metal: 0.6, rough: 0.4 });
      const length = s.xTail + 1.6;

      // the ground it stands on, with a station scale from the nose datum
      const slab = box(length + 3, 0.3, 4.6, steel('#16324f', { metal: 0.1, rough: 0.85 }), false);
      slab.position.set(length / 2 - 0.5, -1.15, 0);
      root.add(slab, shadowFloor(length + 5, 8, -1));
      outline(slab, stage.ink);
      for (let m = 0; m <= Math.floor(length); m++) {
        const tick = box(0.04, 0.03, m % 5 === 0 ? 0.6 : 0.34, steel('#cfe6f7', { metal: 0, rough: 1 }), false);
        tick.position.set(m, -0.98, 1.7);
        root.add(tick);
        if (m % 1 === 0) {
          const lab = stage.label(String(m), { size: 0.46, color: '#cfe6f7' });
          lab.position.set(m, -0.9, 2.15);
          root.add(lab);
        }
      }
      const dat = stage.label('nose datum (m)', { size: 0.5, color: '#ffb454' });
      dat.position.set(-0.4, -0.9, 2.15);
      root.add(dat);

      // the aircraft, drawn about its own centre of gravity so it can pitch there
      const pivot = new THREE.Group();
      const body = new THREE.Group();
      pivot.add(body);
      root.add(pivot);
      const fus = cyl(0.42, 0.42, s.xTail - 0.2, skin, 24);
      fus.rotation.z = Math.PI / 2;
      fus.position.set((s.xTail - 0.2) / 2 + 0.2, 0, 0);
      const nose = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.9, 24), skin);
      nose.rotation.z = Math.PI / 2;
      nose.position.set(-0.25, 0, 0);
      nose.castShadow = true;
      const boom = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.8, 24), skin);
      boom.rotation.z = -Math.PI / 2;
      boom.position.set(s.xTail + 0.7, 0, 0);
      boom.scale.set(0.45, 1, 0.45);
      boom.castShadow = true;
      const span = s.mac * 6.2;
      const wing = box(s.mac, 0.1, span, trim);
      wing.position.set(s.xAc + 0.25 * s.mac, 0.1, 0);
      const tailplane = box(s.mac * 0.5, 0.07, span * 0.38, trim);
      tailplane.position.set(s.xTail + 0.15, 0.12, 0);
      const fin = box(s.mac * 0.5, s.mac * 0.7, 0.07, trim);
      fin.position.set(s.xTail + 0.25, 0.55, 0);
      const cab = box(s.mac * 0.9, 0.38, 0.5, dark);
      cab.position.set(s.xAc - 0.5 * s.mac, 0.5, 0);
      body.add(fus, nose, boom, wing, tailplane, fin, cab);
      outline(fus, stage.ink);
      outline(wing, stage.ink);

      // the movable items on their rails
      const blocks: THREE.Mesh[] = [];
      s.items.forEach((it, i) => {
        const y = 1.05 + i * 0.85;
        const rail = box(it.max - it.min, 0.05, 0.05, iron, false);
        rail.position.set((it.min + it.max) / 2, y, 0);
        const size = 0.32 + 0.22 * Math.cbrt(it.mass / 100);
        const blk = box(size, size * 0.7, size, steel(COLORS[i % COLORS.length], { metal: 0.25, rough: 0.5 }));
        outline(blk, stage.ink);
        const lab = stage.label(`${it.name} · ${it.mass} kg`, { size: 0.42, color: '#f1f7fb', bg: 'rgba(10,30,56,0.78)' });
        lab.position.set(0, size * 0.7 + 0.2, 0);
        blk.add(lab);
        const post = box(0.03, y + 0.2, 0.03, iron, false);
        blk.userData.post = post;
        body.add(rail, blk, post);
        blocks.push(blk);
        const endA = box(0.05, 0.22, 0.05, iron, false), endB = box(0.05, 0.22, 0.05, iron, false);
        endA.position.set(it.min, y, 0);
        endB.position.set(it.max, y, 0);
        body.add(endA, endB);
      });

      const sim = { phase: 'hold' as Phase, t: 0, ev: null as Evaluation | null, p: latest.current.pos.slice(), pitch: 0 };
      const layout = () => {
        const xcg = cgPosition(s, sim.p);
        body.position.set(-xcg, 0, 0);
        pivot.position.set(xcg, 0.2, 0);
        // when the aircraft pitches about its CG the body keeps the CG at the pivot: pivot sits at the CG's world station
        pivot.rotation.z = -sim.pitch;
        s.items.forEach((it, i) => {
          const y = 1.05 + i * 0.85;
          blocks[i].position.set(sim.p[i], y + 0.2, 0);
          const post = blocks[i].userData.post as THREE.Mesh;
          post.position.set(sim.p[i], (y + 0.2) / 2 - 0.02, 0);
          post.scale.y = 1;
        });
      };
      stage.setView({ target: [length / 2 - 0.3, 1.1, 0], yaw: 0.22, pitch: 0.2, w: length + 3.4, h: 5.8 + s.items.length * 0.75, yawRange: [-0.5, 0.8], pitchRange: [0.05, 0.5] });
      layout();

      const setPhaseBoth = (p: Phase) => { sim.phase = p; sim.t = 0; setPhase(p); };
      const verdict = (ev: Evaluation) => {
        const L = latest.current;
        const attempt = L.record.attempts + 1;
        setShown(ev);
        const facts = `CG ${ev.xcg!.toFixed(2)} m (${percentMac(L.spec, ev.xcg!).toFixed(0)}% of the mean chord), static margin ${pct(ev.sm!)}, tail load ${ev.tail! >= 0 ? 'up' : 'down'} ${fmtN(ev.tail!)} of ${fmtN(L.spec.tailLimit)}.`;
        if (ev.solved) {
          setMsg({ k: 'ok', t: `${facts} ${OUTCOME_TEXT.trims}` });
          L.play('correct');
        } else {
          const last = attempt >= MAX_ATTEMPTS;
          setMsg({ k: last ? 'bad' : 'warn', t: last ? `${OUTCOME_TEXT[ev.outcome!]} ${facts} Out of guesses.` : `${OUTCOME_TEXT[ev.outcome!]} ${facts} ${plural(MAX_ATTEMPTS - attempt)}.` });
          L.play('wrong');
        }
        L.onAttempt(ev.solved);
      };
      const finalPitch = (o: Outcome) => (o === 'nose-up' ? 0.5 : o === 'nose-down' ? -0.5 : o === 'too-stable' ? -0.05 : 0);

      api.current = {
        setPlacements: (p) => { if (sim.phase !== 'hold') return; sim.p = p.slice(); layout(); },
        fly: (ev) => {
          if (sim.phase !== 'hold') return;
          sim.ev = ev;
          sim.p = latest.current.pos.slice();
          layout();
          if (latest.current.settings.reduceMotion) {
            sim.pitch = finalPitch(ev.outcome!);
            layout();
            setPhaseBoth('resting');
            verdict(ev);
            return;
          }
          latest.current.play('whoosh', 0.5);
          setPhaseBoth('flying');
        },
        phase: () => sim.phase,
      };

      stage.onFrame = (dt) => {
        const ev = sim.ev, ph = sim.phase;
        if (ph === 'flying' && ev) {
          sim.t += dt;
          const u = Math.min(1, sim.t / 3);
          const o = ev.outcome!;
          if (o === 'trims') sim.pitch = 0.03 * Math.sin(sim.t * 5) * (1 - u);
          else if (o === 'unstable') sim.pitch = 0.55 * u * u * Math.sin(sim.t * 4.5);
          else if (o === 'marginal') sim.pitch = 0.16 * Math.sin(sim.t * 3.2) * (0.4 + 0.6 * u);
          else sim.pitch = finalPitch(o) * (1 - Math.exp(-sim.t * 1.8));
          layout();
          if (u >= 1) { setPhaseBoth('resting'); verdict(ev); }
        } else if (ph === 'resting') {
          sim.t += dt;
          if (sim.t > 2.2 && !latest.current.record.done) setPhaseBoth('resetting');
        } else if (ph === 'resetting') {
          sim.t += dt;
          sim.pitch *= Math.max(0, 1 - dt * 6);
          layout();
          if (sim.t > 0.5) { sim.pitch = 0; layout(); setPhaseBoth('hold'); setShown(null); }
        }
      };
      return () => { api.current = null; };
    },
    [spec],
  );

  useEffect(() => api.current?.setPlacements(pos), [pos]);
  // a puzzle lost shows a loading that works
  useEffect(() => {
    if (done && !mine && example) setPos(example);
  }, [done, mine, example]);

  const busy = phase !== 'hold' && !done;
  const total = totalMass(spec);
  const fly = () => {
    const ev = evaluate(spec, pos);
    if (ev.refused) { setMsg({ k: 'warn', t: ev.refused }); play('wrong'); return; }
    setMsg(null);
    api.current?.fly(ev);
  };

  return (
    <Board
      info={INFO}
      record={record}
      testId="puzzle-aircraft"
      view={
        <div className="ens-view" data-testid="air-view">
          <canvas ref={ref} aria-label="A light aircraft with movable cargo and fuel on rails, and a station scale from the nose" />
          {failed && <Unsupported />}
          <div className="ens-readout" data-testid="air-readout">
            empty {spec.emptyMass.toLocaleString('en-US')} kg, CG {spec.emptyCg.toFixed(2)} m
            <br />
            loaded {total.toLocaleString('en-US')} kg ({Math.round((total * G) / 100) / 10} kN)
          </div>
        </div>
      }
    >
      {done ? (
        <div className="ens-note" data-k={record.solved ? 'ok' : 'bad'} data-testid="air-final">
          {record.solved ? 'Balanced. ' : 'Out of guesses. '}
          {mine ? 'This loading' : 'A loading that works'} puts the CG at <b className="font-mono">{cgPosition(spec, pos).toFixed(2)} m</b> ({percentMac(spec, cgPosition(spec, pos)).toFixed(0)}% of the mean chord): a static margin of{' '}
          <b className="font-mono">{pct(evaluate(spec, pos).sm ?? 0)}</b> and a tail load of <b className="font-mono">{fmtN(evaluate(spec, pos).tail ?? 0)}</b>.
        </div>
      ) : (
        <>
          <p className="ens-p">
            Datum at the nose, stations in metres aft. Neutral point <b className="font-mono" style={{ color: 'var(--en-ink)' }}>{spec.xNp.toFixed(2)} m</b>, wing aerodynamic centre{' '}
            <b className="font-mono" style={{ color: 'var(--en-ink)' }}>{spec.xAc.toFixed(2)} m</b>, tail <b className="font-mono" style={{ color: 'var(--en-ink)' }}>{spec.xTail.toFixed(2)} m</b>, mean chord{' '}
            <b className="font-mono" style={{ color: 'var(--en-ink)' }}>{spec.mac.toFixed(2)} m</b>. Keep the static margin between {Math.round(SM_MIN * 100)}% and {Math.round(SM_MAX * 100)}% of the chord, with the tail load in level flight within{' '}
            <b className="font-mono" style={{ color: 'var(--en-ink)' }}>±{spec.tailLimit.toLocaleString('en-US')} N</b>. Place every item.
          </p>
          <div className="flex flex-col gap-1">
            {spec.items.map((it, i) => (
              <div key={it.name} className="flex items-center gap-2">
                <span className="w-24 shrink-0 text-xs leading-tight sm:w-40" style={{ color: 'var(--en-ink)' }}>
                  <b>{it.name}</b>
                  <br />
                  <span className="font-mono" style={{ color: 'var(--en-mute)' }}>{it.mass} kg · {it.min.toFixed(2)}–{it.max.toFixed(2)} m</span>
                </span>
                <label className="flex-1">
                  <span className="sr-only">{it.name} station</span>
                  <input className="ens-range" type="range" min={it.min} max={it.max} step={STEP} value={pos[i]} disabled={busy} onChange={(e) => setPos((p) => p.map((v, j) => (j === i ? Number(e.target.value) : v)))} aria-valuetext={`station ${pos[i].toFixed(2)} metres`} data-testid={`air-slider-${i}`} data-silent />
                </label>
                <b className="w-16 text-right font-mono text-sm" style={{ color: COLORS[i % COLORS.length] }} data-testid={`air-station-${i}`}>{pos[i].toFixed(2)} m</b>
              </div>
            ))}
          </div>
          <div className="flex justify-end">
            <button className="ens-btn" onClick={fly} disabled={busy} data-testid="air-fly">
              {busy ? 'Flying…' : 'Weigh and fly'}
            </button>
          </div>
        </>
      )}
      {shown && !done && <Diagram spec={spec} ev={shown} />}
      {msg && !done && <Note kind={msg.k} testId="air-msg">{msg.t}</Note>}
    </Board>
  );
}
