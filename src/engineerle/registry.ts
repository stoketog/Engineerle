import { makeWaveform } from './graph';
import { makeLever } from './lever';
import { makeBridge } from './truss';
import { makeCrankshaft } from './crankshaft';
import { makeCircuit } from './circuit';
import { makeBarge } from './barge';
import { makePowerline } from './powerline';

export type Discipline = 'structures' | 'mechanical' | 'electrical' | 'electronics' | 'aerospace';

export const DISCIPLINE_LABEL: Record<Discipline, string> = {
  structures: 'Structures and fluids',
  mechanical: 'Mechanical',
  electrical: 'Electrical',
  electronics: 'Electronics',
  aerospace: 'Aerospace',
};

/** One puzzle in the pool. The app, store, scoring and results know nothing else about it. */
export interface PuzzleDef {
  id: string;
  discipline: Discipline;
  /** 1 approachable … 3 demanding; a day is shown in this order. */
  difficulty: 1 | 2 | 3;
  /** Short label for the tab. */
  tab: string;
  title: string;
  /** One line shown above the puzzle. */
  brief: string;
  /** Time a confident player needs; the time score starts to fall after it. */
  parSeconds: number;
  /** Builds a solvable spec from a seed. */
  make(seed: number): { kind: string };
}

export const POOL: PuzzleDef[] = [
  { id: 'waveform', discipline: 'electronics', difficulty: 1, tab: 'Scope', title: 'Read the scope', brief: 'Write the equation of the voltage on the screen: time t is in seconds.', parSeconds: 60, make: makeWaveform },
  { id: 'circuit', discipline: 'electrical', difficulty: 2, tab: 'Resistors', title: 'Pick the resistor', brief: 'Choose the standard resistor value that makes the meter read the target.', parSeconds: 120, make: makeCircuit },
  { id: 'powerline', discipline: 'electrical', difficulty: 1, tab: 'Power line', title: 'Send the power', brief: 'Pick the transformer ratio that gets the power to town without wasting it or flashing over.', parSeconds: 90, make: makePowerline },
  { id: 'lever', discipline: 'mechanical', difficulty: 1, tab: 'Lever', title: 'Find the pivot', brief: 'Slide the pivot under the beam until the loads hang level.', parSeconds: 90, make: makeLever },
  { id: 'barge', discipline: 'structures', difficulty: 2, tab: 'Barge', title: 'Level the barge', brief: 'Fill the ballast tanks until she floats upright and level.', parSeconds: 150, make: makeBarge },
  { id: 'bridge', discipline: 'structures', difficulty: 2, tab: 'Bridge', title: 'The failing bridge', brief: 'Pick the members that buckle or snap, then test the truck.', parSeconds: 150, make: makeBridge },
  { id: 'crankshaft', discipline: 'mechanical', difficulty: 3, tab: 'Crank', title: 'Firing order', brief: 'Choose the firing order that lets this four-stroke run as smooth as it can.', parSeconds: 150, make: makeCrankshaft },
];

export function byId(id: string): PuzzleDef {
  const d = POOL.find((p) => p.id === id);
  if (!d) throw new Error(`unknown puzzle ${id}`);
  return d;
}
