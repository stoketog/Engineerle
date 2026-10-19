import { makeWaveform } from './graph';
import { makeLever } from './lever';
import { makeBridge } from './truss';
import { makeCrankshaft } from './crankshaft';
import { makeCircuit } from './circuit';
import { makePowerline } from './powerline';
import { makeFilter } from './rcfilter';
import { makeOpamp } from './opamp';
import { makeRocket } from './rocket';
import { makeBarge } from './barge';

/**
 * Every puzzle Engineerle can serve. A puzzle is one model file (its physics and its generator), one component
 * and one entry here. Each day five different ones are drawn from the pool (see select.ts).
 */

export type Discipline = 'structures' | 'mechanical' | 'electrical' | 'electronics' | 'aerospace';

export const DISCIPLINE_NAMES: Record<Discipline, string> = {
  structures: 'Structures and fluids',
  mechanical: 'Mechanical',
  electrical: 'Electrical',
  electronics: 'Electronics',
  aerospace: 'Aerospace',
};

export interface PuzzleDef {
  /** Lower-case letters only: it is saved on the device and sent with the day's results. */
  id: string;
  discipline: Discipline;
  /** 1 approachable, 2 medium, 3 demanding. The day runs from low to high. */
  difficulty: 1 | 2 | 3;
  /** Short label for the tab. */
  tab: string;
  title: string;
  /** One line shown above the puzzle. */
  brief: string;
  /** Time (s) up to which a solve keeps its full time factor. */
  parSeconds: number;
  /** Build the day's puzzle from a seed. Must be pure: the same seed always gives the same puzzle. */
  make(seed: number): { kind: string };
}

export const POOL: PuzzleDef[] = [
  { id: 'waveform', discipline: 'electronics', difficulty: 1, tab: 'Scope', title: 'Read the scope', brief: 'Read the trace and write the equation v(t) of the signal on the oscilloscope.', parSeconds: 60, make: makeWaveform },
  { id: 'lever', discipline: 'mechanical', difficulty: 1, tab: 'Lever', title: 'Find the pivot', brief: 'Slide the pivot under the beam until the loads hang level.', parSeconds: 90, make: makeLever },
  { id: 'resistor', discipline: 'electrical', difficulty: 1, tab: 'Circuit', title: 'Pick the resistor', brief: 'Choose the standard resistor that makes the meter read the target.', parSeconds: 90, make: makeCircuit },
  { id: 'powerline', discipline: 'electrical', difficulty: 1, tab: 'Power line', title: 'Send it down the line', brief: 'Choose the transformer ratio that keeps the line loss low without flashing over.', parSeconds: 90, make: makePowerline },
  { id: 'rcfilter', discipline: 'electronics', difficulty: 2, tab: 'RC filter', title: 'Tame the noise', brief: 'Choose R and C so the tone you want gets through and the noise does not.', parSeconds: 90, make: makeFilter },
  { id: 'opamp', discipline: 'electronics', difficulty: 2, tab: 'Op-amp', title: 'Set the gain', brief: 'Pick the feedback resistors so the output reaches the target without clipping.', parSeconds: 90, make: makeOpamp },
  { id: 'rocket', discipline: 'aerospace', difficulty: 2, tab: 'Staging', title: 'Split the stages', brief: 'Divide the propellant between two stages so the rocket reaches orbit.', parSeconds: 120, make: makeRocket },
  { id: 'barge', discipline: 'structures', difficulty: 2, tab: 'Barge', title: 'Level the barge', brief: 'Fill the ballast tanks until she floats upright and level.', parSeconds: 150, make: makeBarge },
  { id: 'bridge', discipline: 'structures', difficulty: 3, tab: 'Bridge', title: 'The failing bridge', brief: 'Pick the members that buckle or snap, then test the truck.', parSeconds: 150, make: makeBridge },
  { id: 'crankshaft', discipline: 'mechanical', difficulty: 3, tab: 'Firing order', title: 'Smooth running', brief: 'A four-stroke fires each cylinder once every two turns. Pick the firing order that cancels the shaking.', parSeconds: 150, make: makeCrankshaft },
];

export const byId = (id: string): PuzzleDef | undefined => POOL.find((p) => p.id === id);
