import { rng } from './rand';

/**
 * Puzzle: the power line and the transformer.
 *
 * A generator sends `power` watts down a line of resistance `lineOhms`. An ideal step-up transformer of ratio n
 * raises the voltage to n·vGen and so lowers the current to P/(n·vGen); the line then loses I²R as heat. Raising
 * the voltage cuts the loss with the square of the ratio, but the pylons' insulators only stand `maxVLine` volts.
 * Pick the ratio that keeps the loss under budget without flashing over.
 *
 *   V2/V1 = N2/N1,  I2/I1 = N1/N2  (ideal transformer)      I = P/V      loss = I²R      V_load = V_line − I R
 */

export const RATIOS = [1, 2, 5, 10, 20, 25, 50, 100];
export const MAX_RATIO = 1000;

export interface PowerlineSpec {
  kind: 'powerline';
  /** Power sent into the line (W). */
  power: number;
  /** Generator voltage (V). */
  vGen: number;
  /** Resistance of the whole line, out and back (ohms). */
  lineOhms: number;
  /** The most the line may lose, as a percentage of the power sent. */
  maxLossPct: number;
  /** The highest voltage the insulators stand (V). */
  maxVLine: number;
  /** The taps the transformer offers. */
  ratios: number[];
}

export interface LineState {
  vGen: number;
  iGen: number;
  vLine: number;
  iLine: number;
  lossW: number;
  lossPct: number;
  /** Voltage at the far end of the line, before the step-down transformer. */
  vLoad: number;
  /** Power delivered over power sent. */
  efficiency: number;
}

export function lineState(spec: Pick<PowerlineSpec, 'power' | 'vGen' | 'lineOhms'>, ratio: number): LineState {
  const vLine = spec.vGen * ratio;
  const iLine = spec.power / vLine;
  const lossW = iLine * iLine * spec.lineOhms;
  return {
    vGen: spec.vGen,
    iGen: spec.power / spec.vGen,
    vLine,
    iLine,
    lossW,
    lossPct: (lossW * 100) / spec.power,
    vLoad: vLine - iLine * spec.lineOhms,
    efficiency: (spec.power - lossW) / spec.power,
  };
}

export interface Evaluation {
  solved: boolean;
  state?: LineState;
  /** Loss over budget, and/or voltage over the insulator rating. */
  tooLossy?: boolean;
  flashover?: boolean;
  /** Set when the ratio cannot be built: nothing was tested, so it is not a guess. */
  refused?: string;
}

export function evaluate(spec: PowerlineSpec, ratio: number): Evaluation {
  if (typeof ratio !== 'number' || !Number.isFinite(ratio) || ratio <= 0 || ratio > MAX_RATIO) {
    return { solved: false, refused: `A transformer ratio must be above zero and at most ${MAX_RATIO}.` };
  }
  const state = lineState(spec, ratio);
  const tooLossy = state.lossPct > spec.maxLossPct + 1e-9;
  const flashover = state.vLine > spec.maxVLine + 1e-9;
  return { solved: !tooLossy && !flashover, state, tooLossy, flashover };
}

const pick = <T,>(r: () => number, a: T[]) => a[Math.floor(r() * a.length)];
const STANDARD_KV = [11_000, 22_000, 33_000, 66_000, 110_000, 132_000, 220_000, 275_000, 400_000, 500_000];

export function makePowerline(seed: number): PowerlineSpec {
  const r = rng(seed);
  for (let tries = 0; tries < 500; tries++) {
    const spec: PowerlineSpec = {
      kind: 'powerline',
      power: (2 + Math.floor(r() * 49)) * 10_000, // 20 to 500 kW
      vGen: pick(r, [400, 690, 1000, 2400, 3300, 4160, 6600, 11_000]),
      lineOhms: pick(r, [1, 1.5, 2, 2.5, 4, 5, 8, 10, 12, 16, 20]),
      maxLossPct: pick(r, [2, 3, 4, 5, 6, 8]),
      maxVLine: pick(r, STANDARD_KV),
      ratios: RATIOS,
    };
    const good = RATIOS.filter((x) => evaluate(spec, x).solved);
    if (good.length < 1 || good.length > 3 || good.includes(1)) continue;
    // no tap sits within 3% of either limit, so "2%" on the screen never means "just over 2%"
    const close = RATIOS.some((x) => {
      const st = lineState(spec, x);
      return Math.abs(st.lossPct - spec.maxLossPct) < 0.03 * spec.maxLossPct || Math.abs(st.vLine - spec.maxVLine) < 0.03 * spec.maxVLine;
    });
    if (close) continue;
    if (good.includes(100) && r() > 0.15) continue; // the top tap is the answer only now and then
    return spec;
  }
  return { kind: 'powerline', power: 200_000, vGen: 1000, lineOhms: 5, maxLossPct: 4, maxVLine: 30_000, ratios: RATIOS };
}
