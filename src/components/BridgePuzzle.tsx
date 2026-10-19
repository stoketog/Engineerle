'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { MAX_ATTEMPTS } from '@/engineerle/scoring';
import { byId } from '@/engineerle/registry';
import { BridgeSim, UPGRADE, buildTruss, memberLength, toM2, type BridgeSpec } from '@/engineerle/truss';
import { useSettings } from '@/hooks/useSettings';
import { Board, Note, Unsupported, useStage, type PuzzleProps } from './Board';
import { box, cyl, outline, setStrut, shadowFloor, steel } from './stage';

const INFO = byId('bridge');
const SIDE = 1.6;
const SAG = 30; // displacements are drawn this many times larger than real
const WATER_Y = -9;

type Phase = 'idle' | 'running' | 'collapsing' | 'after';
/** How long after the failure the exaggerated sag is eased back to true scale (s). */
const EASE = 0.25;

interface Api {
  setSel: (s: number[]) => void;
  run: (sel: number[]) => void;
  phase: () => Phase;
}

const radiusFor = (areaCm2: number) => 0.05 + 0.02 * Math.sqrt(areaCm2);
const STEEL = new THREE.Color('#8fa6bb'), TEN = new THREE.Color('#3fa9ff'), COMP = new THREE.Color('#ffa03a'), RED = new THREE.Color('#ff3b3b'), UP = new THREE.Color('#ff8a3d');

export function memberName(spec: { panels: number }, i: number) {
  const n = spec.panels;
  if (i < n) return `B${i + 1}`;
  if (i < 2 * n - 1) return `T${i - n + 1}`;
  return `D${i - (2 * n - 1) + 1}`;
}
const kindOf = (spec: { panels: number }, i: number) => (i < spec.panels ? 'bottom chord' : i < 2 * spec.panels - 1 ? 'top chord' : 'diagonal');

export function BridgePuzzle({ spec, record, onAttempt }: PuzzleProps<BridgeSpec>) {
  const { play, settings } = useSettings();
  const truss = useMemo(() => buildTruss(spec.panels), [spec.panels]);
  const lens = useMemo(() => truss.members.map((_, i) => memberLength(truss, i)), [truss]);
  const [sel, setSel] = useState<number[]>([]);
  const [info, setInfo] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [msg, setMsg] = useState<{ k: 'ok' | 'bad' | 'hint'; t: string } | null>(null);
  const [peak, setPeak] = useState(0);
  const api = useRef<Api | null>(null);
  const done = record.done;
  const latest = useRef({ spec, record, onAttempt, play, settings, sel, truss, lens });
  latest.current = { spec, record, onAttempt, play, settings, sel, truss, lens };

  const toggle = (i: number) => {
    if (done || phase !== 'idle') return;
    setSel((s) => {
      if (s.includes(i)) {
        play('snap');
        return s.filter((x) => x !== i);
      }
      if (s.length >= spec.budget) {
        play('wrong');
        setMsg({ k: 'hint', t: `You can only reinforce ${spec.budget} members. Tap one you picked to swap it.` });
        return s;
      }
      play('clunk', 0.6);
      return [...s, i];
    });
  };
  const toggleRef = useRef(toggle);
  toggleRef.current = toggle;

  const { ref, failed } = useStage(
    (stage) => {
      const L0 = latest.current;
      const t = L0.truss;
      const n = t.panels;
      const total = n * t.panel;
      const ox = -total / 2;
      const root = stage.root;
      const rock = steel('#3b546d', { metal: 0.05, rough: 0.9, flat: true });

      // gorge, abutments and river
      for (const sgn of [-1, 1]) {
        const cliff = box(12, 10.4, 9, rock);
        cliff.position.set(sgn * (total / 2 + 6), -5.2, 0);
        root.add(cliff);
        outline(cliff, stage.ink);
        const cap = box(2.2, 0.35, 4, steel('#4d6d8c', { metal: 0.1, rough: 0.8 }));
        cap.position.set(sgn * (total / 2 + 1.1), 0.025, 0);
        root.add(cap);
      }
      const waterGeo = new THREE.PlaneGeometry(total + 30, 18, Math.round((total + 30) / 1.4), 14);
      waterGeo.rotateX(-Math.PI / 2);
      const water = new THREE.Mesh(waterGeo, new THREE.MeshStandardMaterial({ color: '#1d6a99', metalness: 0.1, roughness: 0.35, flatShading: true, transparent: true, opacity: 0.88 }));
      water.position.y = WATER_Y;
      root.add(water);
      const wBase = Float32Array.from(waterGeo.attributes.position.array as Float32Array);
      root.add(shadowFloor(total + 30, 12, WATER_Y + 0.01));

      // the two trusses
      const mats: THREE.MeshStandardMaterial[] = [];
      const parts: THREE.Mesh[][] = []; // per member: 4 meshes (side × half)
      const radius: number[] = [];
      const areaNow: number[] = [...L0.spec.areas];
      t.members.forEach((_, i) => {
        const m = steel(STEEL, { metal: 0.55, rough: 0.4 });
        m.emissive = new THREE.Color(0x000000);
        mats.push(m);
        radius.push(radiusFor(areaNow[i]));
        const arr: THREE.Mesh[] = [];
        for (let k = 0; k < 4; k++) {
          const mesh = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 10), m);
          mesh.castShadow = true;
          mesh.userData.idx = i;
          root.add(mesh);
          arr.push(mesh);
        }
        parts.push(arr);
      });
      const nodeMat = steel('#53708c', { metal: 0.6, rough: 0.4 });
      const joints: THREE.Mesh[] = [];
      t.nodes.forEach(() => {
        for (const s of [-1, 1]) {
          const j = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 8), nodeMat);
          j.castShadow = true;
          j.userData.side = s;
          root.add(j);
          joints.push(j);
        }
      });
      const deckMat = steel('#6c7f92', { metal: 0.2, rough: 0.8 });
      const deck: THREE.Mesh[] = [];
      for (let i = 0; i < n; i++) {
        const d = box(t.panel, 0.2, SIDE * 2 + 0.4, deckMat);
        root.add(d);
        deck.push(d);
      }
      const crossMat = steel('#587791', { metal: 0.5, rough: 0.5 });
      const cross: THREE.Mesh[] = [];
      t.nodes.forEach(() => {
        const c = box(0.12, 0.12, SIDE * 2, crossMat);
        root.add(c);
        cross.push(c);
      });

      // the truck
      const truck = new THREE.Group();
      const bodyMat = steel('#e9eef3', { metal: 0.1, rough: 0.6 });
      const cab = box(1.4, 1.5, 1.9, steel('#ff8a3d', { metal: 0.2, rough: 0.5 }));
      cab.position.set(2.2, 1.05, 0);
      const bed = box(3.4, 1.9, 2.0, bodyMat);
      bed.position.set(-0.6, 1.25, 0);
      const chassis = box(4.9, 0.3, 1.5, steel('#243b52', { metal: 0.4, rough: 0.6 }));
      chassis.position.set(0.1, 0.4, 0);
      truck.add(cab, bed, chassis);
      outline(bed, stage.ink);
      const wheels: THREE.Mesh[] = [];
      for (const ax of [-1, 1.9]) for (const s of [-1, 1]) {
        const w = cyl(0.45, 0.45, 0.35, steel('#1a2530', { metal: 0.1, rough: 0.9 }), 14);
        w.rotation.x = Math.PI / 2;
        w.position.set(ax, 0.3, s * 0.95);
        truck.add(w);
        wheels.push(w);
      }
      const tl = stage.label(`${(L0.spec.truck.weight / 9810).toFixed(1)} t`, { size: 0.5, color: '#1a0b00', bg: '#ff8a3d' });
      tl.position.set(0, 3.3, 0);
      truck.add(tl);
      truck.visible = false;
      root.add(truck);

      const timers: number[] = [];
      const rest = t.nodes.map((p) => ({ x: p.x, y: p.y }));
      const sim = {
        mode: 'idle' as Phase,
        pos: rest.map((p) => ({ ...p })),
        u: 0,
        bs: null as BridgeSim | null,
        peak: new Array<number>(t.members.length).fill(0),
        broken: new Set<number>(),
        splashed: false,
        creakAt: 0,
        sel: [] as number[],
        reported: false,
        result: null as boolean | null,
        cracked: false,
      };

      const vec = (i: number, s: number) => new THREE.Vector3(ox + sim.pos[i].x, sim.pos[i].y, s * SIDE);
      const surface = (u: number) => {
        // where the road is at deck position u (in panels), along the current shape
        if (u <= 0) return { x: ox + sim.pos[0].x + u * t.panel, y: sim.pos[0].y };
        if (u >= n) return { x: ox + sim.pos[n].x + (u - n) * t.panel, y: sim.pos[n].y };
        const i = Math.min(n - 1, Math.floor(u)), a = u - i;
        return { x: ox + sim.pos[i].x * (1 - a) + sim.pos[i + 1].x * a, y: sim.pos[i].y * (1 - a) + sim.pos[i + 1].y * a };
      };
      const layout = () => {
        t.members.forEach((m, i) => {
          const broken = sim.broken.has(i) && sim.mode !== 'idle';
          const r = radius[i];
          [-1, 1].forEach((s, si) => {
            const a = vec(m.a, s), b = vec(m.b, s);
            const mid = a.clone().lerp(b, 0.5);
            if (broken) {
              const sa = a.clone().lerp(b, 0.36), sb = b.clone().lerp(a, 0.36);
              setStrut(parts[i][si * 2], a, sa, r);
              setStrut(parts[i][si * 2 + 1], b, sb, r);
            } else {
              setStrut(parts[i][si * 2], a, mid, r);
              setStrut(parts[i][si * 2 + 1], mid, b, r);
            }
          });
        });
        t.nodes.forEach((_, i) => {
          joints[i * 2].position.copy(vec(i, -1));
          joints[i * 2 + 1].position.copy(vec(i, 1));
          cross[i].position.set(ox + sim.pos[i].x, sim.pos[i].y, 0);
        });
        for (let i = 0; i < n; i++) {
          const a = sim.pos[i], b = sim.pos[i + 1];
          deck[i].position.set(ox + (a.x + b.x) / 2, (a.y + b.y) / 2 + 0.1, 0);
          deck[i].rotation.z = Math.atan2(b.y - a.y, b.x - a.x);
        }
        if (sim.mode === 'running' || sim.mode === 'collapsing') {
          const sp = L0.spec.truck.spacing;
          const f = surface(sim.u), r = surface(sim.u - sp);
          truck.visible = sim.u > -sp - 3 && sim.u < n + 6;
          truck.position.set((f.x + r.x) / 2 - 0.45 * Math.cos(0), (f.y + r.y) / 2 + 0.12, 0);
          truck.rotation.z = Math.atan2(f.y - r.y, f.x - r.x);
          wheels.forEach((w) => (w.rotation.y = 0));
        } else truck.visible = false;
      };
      const paint = (utils: number[] | null, force: number[] | null) => {
        t.members.forEach((_, i) => {
          const m = mats[i];
          const isUp = sim.sel.includes(i);
          let c = STEEL.clone();
          let e = 0;
          if (utils && force) {
            const u = utils[i];
            const hue = force[i] >= 0 ? TEN : COMP;
            c = STEEL.clone().lerp(hue, Math.min(1, u / 0.85));
            if (u > 0.85) c.lerp(RED, Math.min(1, (u - 0.85) / 0.2));
            e = u > 1 ? 0.7 : 0;
          } else if (isUp) {
            c = UP.clone();
            e = 0.35;
          }
          m.color.copy(c);
          m.emissive.copy(e ? c : new THREE.Color(0));
          m.emissiveIntensity = e;
        });
      };
      const applySel = (s: number[]) => {
        sim.sel = s;
        t.members.forEach((_, i) => {
          areaNow[i] = L0.spec.areas[i] * (s.includes(i) ? UPGRADE : 1);
          radius[i] = radiusFor(areaNow[i]);
        });
        if (sim.mode === 'idle') paint(null, null);
        layout();
      };

      const reset = () => {
        sim.mode = 'idle';
        sim.pos = rest.map((p) => ({ ...p }));
        sim.broken = new Set();
        sim.bs = null;
        sim.cracked = false;
        sim.splashed = false;
        sim.reported = false;
        sim.result = null;
        sim.peak.fill(0);
        paint(null, null);
        layout();
        setPhase('idle');
        setPeak(0);
      };

      const finish = (ok: boolean) => {
        if (sim.reported) return;
        sim.reported = true;
        const L = latest.current;
        if (ok) {
          const worst = Math.max(...sim.peak);
          setMsg({ k: 'ok', t: `It holds. At its busiest the bridge was working at ${Math.round(worst * 100)}% of its capacity.` });
          L.play('correct');
        } else {
          setMsg({ k: L.record.attempts + 1 >= MAX_ATTEMPTS ? 'bad' : 'hint', t: 'The span came down.' });
          L.play('wrong');
        }
        L.onAttempt(ok);
      };

      const endRun = (ok: boolean) => {
        sim.mode = 'after';
        sim.result = ok;
        setPhase('after');
        timers.push(
          window.setTimeout(() => {
            finish(ok);
            timers.push(window.setTimeout(reset, 1500));
          }, ok ? 900 : 700),
        );
      };

      const startRun = (s: number[]) => {
        if (sim.mode !== 'idle') return;
        setMsg(null);
        sim.sel = s;
        const areas = L0.spec.areas.map((a, i) => toM2(a * (s.includes(i) ? UPGRADE : 1)));
        const bs = new BridgeSim(t, areas, L0.spec.truck, { floor: WATER_Y + 0.3 });
        sim.bs = bs;
        sim.peak.fill(0);
        sim.cracked = false;
        sim.mode = 'running';
        setPhase('running');
        latest.current.play('rumble', 0.2);
        if (latest.current.settings.reduceMotion) {
          // no animation: run the whole crossing at once
          while (!bs.collapsed && bs.u <= n + 1.2) bs.advance(0.05);
          bs.peak.forEach((v, i) => (sim.peak[i] = v));
          bs.broken.forEach((_, i) => sim.broken.add(i));
          sim.mode = 'after';
          setPhase('after');
          setPeak(Math.max(...sim.peak));
          paint(null, null);
          finish(!bs.collapsed);
          timers.push(window.setTimeout(reset, 400));
        }
      };

      stage.setView({ target: [0, -1.5, 0], yaw: 0.5, pitch: 0.3, w: total + 6, h: 15, yawRange: [-0.1, 1.1], pitchRange: [0.1, 0.55] });
      applySel([]);
      paint(null, null);

      const allParts = parts.flat();
      stage.handlers = {
        click: (pt) => {
          const hit = stage.pick(pt, allParts);
          if (!hit) return;
          const i = hit.object.userData.idx as number;
          setInfo(`${memberName(L0.spec, i)} · ${kindOf(L0.spec, i)} · ${latest.current.spec.areas[i]} cm² · ${L0.lens[i].toFixed(1)} m`);
          toggleRef.current(i);
        },
      };

      api.current = {
        setSel: applySel,
        run: startRun,
        phase: () => sim.mode,
      };

      stage.onFrame = (dt, tt) => {
        // river
        if (!stage.lowCpu && !stage.soft) {
          const p = waterGeo.attributes.position;
          for (let i = 0; i < p.count; i++) {
            const x = wBase[i * 3], z = wBase[i * 3 + 2];
            p.setY(i, Math.sin(x * 0.5 + tt * 1.3) * 0.14 + Math.cos(z * 0.7 + tt * 1.1) * 0.12);
          }
          p.needsUpdate = true;
          waterGeo.computeVertexNormals();
        }
        const bs = sim.bs;
        if ((sim.mode === 'running' || sim.mode === 'collapsing') && bs) {
          bs.advance(Math.min(dt, 0.1));
          sim.u = bs.u;
          bs.peak.forEach((v, i) => (sim.peak[i] = Math.max(sim.peak[i], v)));
          // sag is drawn exaggerated until the bridge fails, then eased back to true scale so nothing jumps
          const mag = bs.collapsed ? 1 + (SAG - 1) * Math.exp(-(bs.time - bs.failedAt) / EASE) : SAG;
          const d = bs.displacement();
          sim.pos = rest.map((p, i) => ({ x: p.x + d[2 * i] * mag, y: p.y + d[2 * i + 1] * mag }));
          if (!bs.collapsed) paint(bs.util, bs.force);
          const worst = Math.max(...bs.util);
          if (worst > 0.88 && !bs.collapsed && tt - sim.creakAt > 0.9) {
            sim.creakAt = tt;
            latest.current.play('creak', Math.min(1, (worst - 0.88) / 0.2));
          }
          if (bs.collapsed && !sim.cracked) {
            sim.cracked = true;
            bs.broken.forEach((_, i) => sim.broken.add(i));
            latest.current.play('crack');
            sim.mode = 'collapsing';
            setPhase('collapsing');
            paint(null, null);
          }
          if (bs.collapsed) {
            bs.broken.forEach((_, i) => sim.broken.add(i));
            if (!sim.splashed && sim.pos.some((p) => p.y < WATER_Y + 1.2)) {
              sim.splashed = true;
              latest.current.play('splash');
            }
            if (bs.time - bs.failedAt > 3 && sim.mode === 'collapsing') endRun(false);
          } else if (bs.u > n + 1.2 && sim.mode === 'running') {
            paint(null, null);
            sim.pos = rest.map((p) => ({ ...p }));
            endRun(true);
          }
          setPeak(Math.max(...sim.peak));
        }
        layout();
      };

      return () => {
        timers.forEach((id) => window.clearTimeout(id));
        // a crossing that already had its outcome must still count if the player leaves
        if (sim.result !== null && !sim.reported) finish(sim.result);
        api.current = null;
      };
    },
    [spec],
  );

  useEffect(() => api.current?.setSel(sel), [sel]);

  const names = (list: number[]) => list.map((i) => memberName(spec, i)).join(', ');
  const busy = phase !== 'idle';
  const groups: Array<[string, number[]]> = [
    ['Bottom chord', truss.members.map((_, i) => i).filter((i) => i < spec.panels)],
    ['Top chord', truss.members.map((_, i) => i).filter((i) => i >= spec.panels && i < 2 * spec.panels - 1)],
    ['Diagonals', truss.members.map((_, i) => i).filter((i) => i >= 2 * spec.panels - 1)],
  ];

  return (
    <Board
      info={INFO}
      record={record}
      testId="puzzle-bridge"
      view={
        <div className="ens-view" data-testid="bridge-view">
          <canvas ref={ref} aria-label="A steel truss bridge over a river. Tap a member to reinforce it." />
          {failed && <Unsupported />}
          <div className="ens-readout" data-testid="bridge-info">{info ?? 'Tap a member to inspect it'}</div>
          <div className="ens-readout r">{busy ? `peak load ${Math.round(peak * 100)}%` : `sag shown ×${SAG}`}</div>
        </div>
      }
    >
      {!done ? (
        <>
          <p className="ens-p">
            A {(spec.truck.weight / 9810).toFixed(1)} t truck will cross. Choose <b>{spec.budget}</b> members to give the heavier section ({UPGRADE}× the area), then test it. Blue members are stretched, orange are squeezed, red are about to fail.
          </p>
          {groups.map(([title, ids]) => (
            <div key={title}>
              <p className="ens-label mb-1">{title}</p>
              <div className="flex flex-wrap gap-1.5">
                {ids.map((i) => (
                  <button
                    key={i}
                    className="ens-chip"
                    data-on={sel.includes(i)}
                    disabled={busy}
                    onClick={() => {
                      setInfo(`${memberName(spec, i)} · ${kindOf(spec, i)} · ${spec.areas[i]} cm² · ${lens[i].toFixed(1)} m`);
                      toggle(i);
                    }}
                    aria-pressed={sel.includes(i)}
                    aria-label={`${memberName(spec, i)}, ${kindOf(spec, i)}, ${spec.areas[i]} square centimetres`}
                    data-testid={`bridge-m-${i}`}
                    data-silent
                  >
                    {memberName(spec, i)}
                    <small className="opacity-70">{spec.areas[i]}</small>
                  </button>
                ))}
              </div>
            </div>
          ))}
          <div className="flex items-center justify-between gap-3">
            <p className="ens-p" data-testid="bridge-count">
              Reinforced {sel.length} of {spec.budget}
              {sel.length ? ` · ${names(sel)}` : ''}
            </p>
            <button className="ens-btn" onClick={() => api.current?.run(sel)} disabled={busy || sel.length === 0} data-testid="bridge-test">
              Test the truck
            </button>
          </div>
        </>
      ) : (
        <div className="ens-note" data-k={record.solved ? 'ok' : 'bad'} data-testid="bridge-final">
          {record.solved ? 'It holds. ' : 'Out of guesses. '}The weak members were <b>{names(spec.weak)}</b>
          {record.solved ? ', and you reinforced them.' : '.'}
        </div>
      )}
      {msg && !done && <Note kind={msg.k} testId="bridge-msg">{msg.t}</Note>}
    </Board>
  );
}
