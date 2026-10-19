import { rng } from './rand';

/**
 * Power transmission: a generator feeds `power` watts into a line through a step-up transformer, and the line wastes
 * some of it as heat. Single-phase, unity power factor, so P = V·I; the transformer is ideal, so it multiplies the
 * voltage by its turns ratio and divides the current by the same factor. The line (out and back) has one resistance,
 * so the loss is I²R. (Hambley, Electrical Engineering: Principles and Applications; Glover, Power System Analysis.)
 */

/** The turns ratios the transformer is available in. */
export const RATIOS = [1, 2, 5, 10, 20, 25, 50, 100];

export interface PowerlineSpec {
  kind: 'powerline';
  /** Power sent into the line, W. */
  power: number;
  /** Generator voltage, V. */
  vGen: number;
  /** Resistance of the whole line, out and back, Ω. */
  lineOhms: number;
  /** The most the line may waste, as a percentage of the power sent. */
  maxLossPct: number;
  /** What the insulators on the pylons are rated for, V. */
  vMax: number;
  ratios: number[];
}

export interface LineState {
  /** Voltage on the line, V. */
  vLine: number;
  /** Current in the line, A. */
  iLine: number;
  /** Power lost as heat in the line, W. */
  lossW: number;
  lossPct: number;
  /** Voltage left at the far end of the line, V (zero or below means the line cannot carry the load). */
  vLoad: number;
  /** Delivered power as a fraction of the power sent, (P − loss)/P. */
  efficiency: number;
}

export function lineState(spec: PowerlineSpec, ratio: number): LineState {
  const vLine = spec.vGen * ratio;
  const iLine = spec.power / vLine;
  const lossW = iLine * iLine * spec.lineOhms;
  return { vLine, iLine, lossW, lossPct: (lossW * 100) / spec.power, vLoad: vLine - iLine * spec.lineOhms, efficiency: (spec.power - lossW) / spec.power };
}

export interface PowerEvaluation {
  solved: boolean;
  state: LineState;
  /** Why a ratio fails: it wastes too much, flashes over the insulators, or (never both for a valid puzzle) neither. */
  reason?: 'loss' | 'voltage' | 'both';
  /** Set when the ratio is not a usable transformer; the guess must not be counted. */
  refused?: string;
}

export function evaluate(spec: PowerlineSpec, ratio: number): PowerEvaluation {
  if (typeof ratio !== 'number' || !Number.isFinite(ratio) || ratio <= 0) {
    return { solved: false, state: { vLine: 0, iLine: 0, lossW: 0, lossPct: 0, vLoad: 0, efficiency: 0 }, refused: 'A transformer needs a positive turns ratio.' };
  }
  const state = lineState(spec, ratio);
  const lossBad = state.lossPct > spec.maxLossPct;
  const voltBad = state.vLine > spec.vMax;
  return { solved: !lossBad && !voltBad, state, reason: lossBad && voltBad ? 'both' : lossBad ? 'loss' : voltBad ? 'voltage' : undefined };
}

export const solvingRatios = (spec: PowerlineSpec) => spec.ratios.filter((r) => evaluate(spec, r).solved);

/** Used only if the generator somehow finds nothing; checked by the tests. */
export const FALLBACK: PowerlineSpec = { kind: 'powerline', power: 100_000, vGen: 1_000, lineOhms: 5, maxLossPct: 3, vMax: 22_000, ratios: RATIOS };

export function makePowerline(seed: number): PowerlineSpec {
  const r = rng(seed);
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const powers = [20, 30, 40, 50, 60, 75, 80, 100, 120, 150, 200, 250, 300, 400, 500].map((k) => k * 1000);
  const gens = [400, 690, 1000, 2400, 3300, 4160, 6600, 11000];
  const ohms = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 12, 15, 20];
  const budgets = [2, 3, 4, 5, 6, 8];
  const ratings = [11, 22, 33, 66, 110, 132, 220].map((k) => k * 1000);
  for (let attempt = 0; attempt < 4000; attempt++) {
    const spec: PowerlineSpec = { kind: 'powerline', power: pick(powers), vGen: pick(gens), lineOhms: pick(ohms), maxLossPct: pick(budgets), vMax: pick(ratings), ratios: [...RATIOS] };
    const good = solvingRatios(spec);
    if (good.length < 1 || good.length > 3 || evaluate(spec, 1).solved) continue;
    const why = spec.ratios.map((x) => evaluate(spec, x).reason);
    if (!why.includes('loss') || !why.includes('voltage')) continue;
    const clear = spec.ratios.every((x) => {
      const s = lineState(spec, x);
      return Math.abs(s.lossPct / spec.maxLossPct - 1) > 0.05 && Math.abs(s.vLine / spec.vMax - 1) > 0.05;
    });
    if (clear) return spec;
  }
  return { ...FALLBACK, ratios: [...RATIOS] };
}
