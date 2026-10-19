import { makeGraph } from './graph';
import { makeLever } from './lever';
import { makeBridge } from './truss';
import { makeCrankshaft } from './crankshaft';
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
  { id: 'waveform', discipline: 'electronics', difficulty: 1, tab: 'Curve', title: 'Name that curve', brief: 'Read the graph and write the equation that draws it.', parSeconds: 60, make: makeGraph },
  { id: 'lever', discipline: 'mechanical', difficulty: 1, tab: 'Lever', title: 'Find the pivot', brief: 'Slide the pivot under the beam until the loads hang level.', parSeconds: 90, make: makeLever },
  { id: 'barge', discipline: 'structures', difficulty: 2, tab: 'Barge', title: 'Level the barge', brief: 'Fill the ballast tanks until she floats upright and level.', parSeconds: 150, make: makeBarge },
  { id: 'bridge', discipline: 'structures', difficulty: 3, tab: 'Bridge', title: 'The failing bridge', brief: 'Pick the members that buckle or snap, then test the truck.', parSeconds: 150, make: makeBridge },
  { id: 'crankshaft', discipline: 'mechanical', difficulty: 3, tab: 'Firing order', title: 'Smooth running', brief: 'A four-stroke fires each cylinder once every two turns. Pick the firing order that cancels the shaking.', parSeconds: 150, make: makeCrankshaft },
];

export const byId = (id: string): PuzzleDef | undefined => POOL.find((p) => p.id === id);
