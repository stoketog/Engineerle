import { rng } from './rand';

/**
 * Puzzle: the gear train.
 *
 * A pair of spur gears meshes at the pitch circles, so the surface speeds agree and the speed ratio is the inverse of
 * the tooth ratio (Shigley's Mechanical Engineering Design, ch. 13; Norton, Design of Machinery). In a compound train
 * the driven gear of one mesh shares a shaft with the driver of the next, so
 *     train ratio  =  Π (z_driven / z_driver),      output speed = input speed / ratio,
 * and every external mesh reverses the direction of rotation, so n meshes give (−1)ⁿ. Power is conserved apart from the
 * friction in each mesh (about 2 %, so η = 0.98 per mesh), so torque rises by the ratio and falls by η per mesh:
 *     T_out = T_in · ratio · ηⁿ.
 * With module m (mm) the pitch diameter is m·z and the centre distance of a mesh is  a = m (z₁ + z₂) / 2.  A standard 20°
 * full-depth pinion needs at least 17 teeth to avoid undercutting. The direction is set by the number of meshes in the
 * train, which the puzzle fixes, so the target direction is a consequence of the train and not a choice.
 */

export const MIN_TEETH = 17;
export const MAX_TEETH = 80;
export const MESH_EFFICIENCY = 0.98;

export interface Mesh { driver: number; driven: number }

export const trainRatio = (teeth: Mesh[]) => teeth.reduce((r, m) => r * (m.driven / m.driver), 1);

/** Signed output speed: negative means opposite to the input. */
export const outputRpm = (input: number, teeth: Mesh[]) => ((teeth.length % 2 === 0 ? 1 : -1) * input) / trainRatio(teeth);

/** Output torque magnitude, with the loss of `efficiency` taken in each mesh. */
export const outputTorque = (inputTorque: number, teeth: Mesh[], efficiency = MESH_EFFICIENCY) => inputTorque * trainRatio(teeth) * Math.pow(efficiency, teeth.length);

export const centreDistance = (module: number, m: Mesh) => (module * (m.driver + m.driven)) / 2;

export interface GearSpec {
  kind: 'gears';
  inputRpm: number;
  /** Torque at the input shaft, N·m. */
  inputTorque: number;
  /** Required output speed; the sign is the direction relative to the input. */
  targetRpm: number;
  /** Allowed error of the output speed as a fraction of the target. */
  tolerance: number;
  module: number;
  /** The housing allows at most this centre distance (mm) for each mesh. */
  maxCentre: number[];
  start: Mesh[];
  /** A set of tooth counts that works, shown when the puzzle is over. */
  example: Mesh[];
}

export interface Evaluation {
  solved: boolean;
  ratio?: number;
  rpm?: number;
  torque?: number;
  centres?: number[];
  fits?: boolean[];
  directionOk?: boolean;
  speedOk?: boolean;
  /** Error of the output speed against the target, as a signed fraction. */
  error?: number;
  refused?: string;
}

const validCount = (z: unknown) => typeof z === 'number' && Number.isInteger(z) && z >= MIN_TEETH && z <= MAX_TEETH;

export function evaluate(spec: GearSpec, teeth: Mesh[]): Evaluation {
  if (!Array.isArray(teeth) || teeth.length !== spec.maxCentre.length) return { solved: false, refused: `Set the tooth counts of all ${spec.maxCentre.length} meshes.` };
  for (const m of teeth) {
    if (!m || !validCount(m.driver) || !validCount(m.driven)) return { solved: false, refused: `Every gear needs a whole number of teeth from ${MIN_TEETH} to ${MAX_TEETH}: fewer than ${MIN_TEETH} would undercut.` };
  }
  const ratio = trainRatio(teeth);
  const rpm = outputRpm(spec.inputRpm, teeth);
  const centres = teeth.map((m) => centreDistance(spec.module, m));
  const fits = centres.map((c, i) => c <= spec.maxCentre[i] + 1e-9);
  const directionOk = Math.sign(rpm) === Math.sign(spec.targetRpm);
  const error = (Math.abs(rpm) - Math.abs(spec.targetRpm)) / Math.abs(spec.targetRpm);
  const speedOk = Math.abs(error) <= spec.tolerance + 1e-12;
  return { solved: directionOk && speedOk && fits.every(Boolean), ratio, rpm, torque: outputTorque(spec.inputTorque, teeth), centres, fits, directionOk, speedOk, error };
}

const pick = <T,>(r: () => number, a: T[]) => a[Math.floor(r() * a.length)];
const sig3 = (x: number) => Number(x.toPrecision(3));

export function makeGears(seed: number): GearSpec {
  const r = rng(seed);
  for (let tries = 0; tries < 300; tries++) {
    const n = r() < 0.5 ? 2 : 3;
    const module = pick(r, [1.5, 2, 2.5, 3]);
    const inputRpm = 100 * (6 + Math.floor(r() * 25));
    const example: Mesh[] = [];
    for (let i = 0; i < n; i++) {
      const driver = MIN_TEETH + Math.floor(r() * 34);
      const ratio = Math.exp((r() * 2 - 1) * Math.log(3.5)) * (r() < 0.5 ? 1 : 1.3);
      const driven = Math.max(MIN_TEETH, Math.min(MAX_TEETH, Math.round(driver * ratio)));
      example.push({ driver, driven });
    }
    const rpm = outputRpm(inputRpm, example);
    if (Math.abs(rpm) < 20 || Math.abs(rpm) > 8000) continue;
    const spec: GearSpec = {
      kind: 'gears', inputRpm, inputTorque: pick(r, [10, 15, 20, 25, 30, 40, 50]), targetRpm: Math.sign(rpm) * sig3(Math.abs(rpm)), tolerance: 0.01, module,
      maxCentre: example.map((m) => Math.ceil(centreDistance(module, m) * (1.04 + r() * 0.2))), start: [], example,
    };
    if (!evaluate(spec, example).solved) continue;
    let start: Mesh[] | null = null;
    for (let s = 0; s < 60 && !start; s++) {
      const cand: Mesh[] = example.map(() => ({ driver: MIN_TEETH + Math.floor(r() * 30), driven: MIN_TEETH + Math.floor(r() * 50) }));
      const e = evaluate(spec, cand);
      if (!e.refused && !e.solved) start = cand;
    }
    if (!start) continue;
    spec.start = start;
    return spec;
  }
  const example: Mesh[] = [{ driver: 20, driven: 60 }, { driver: 20, driven: 40 }];
  return { kind: 'gears', inputRpm: 1500, inputTorque: 20, targetRpm: 250, tolerance: 0.01, module: 2, maxCentre: [84, 62], example, start: [{ driver: 20, driven: 20 }, { driver: 20, driven: 20 }] };
}
