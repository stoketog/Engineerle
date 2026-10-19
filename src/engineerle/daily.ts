import { daysBetween } from '../lib/dates';
import { hashSeed } from './rand';
import { makeGraph, type GraphSpec } from './graph';
import { makeLever, type LeverSpec } from './lever';
import { makeBridge, type BridgeSpec } from './truss';
import { makeEngine, type CrankSpec } from './crank';
import { makeBarge, type BargeSpec } from './barge';

/** Day 1 of Engineerle. */
export const ENGINEERLE_EPOCH = '2026-10-19';
export const MAX_ATTEMPTS = 3;
export const ATTEMPT_POINTS = [100, 65, 35] as const;
export const MAX_DAY_POINTS = ATTEMPT_POINTS[0] * 5;

export type PuzzleSpec = GraphSpec | LeverSpec | BridgeSpec | CrankSpec | BargeSpec;
export type PuzzleKind = PuzzleSpec['kind'];

export interface PuzzleInfo {
  kind: PuzzleKind;
  title: string;
  /** One line shown above the puzzle. */
  brief: string;
  /** Short label for the tab. */
  tab: string;
}

export const PUZZLES: PuzzleInfo[] = [
  { kind: 'graph', tab: 'Curve', title: 'Name that curve', brief: 'Read the graph and write the equation that draws it.' },
  { kind: 'lever', tab: 'Lever', title: 'Find the pivot', brief: 'Slide the pivot under the beam until the loads hang level.' },
  { kind: 'bridge', tab: 'Bridge', title: 'The failing bridge', brief: 'Pick the members that buckle or snap, then test the truck.' },
  { kind: 'engine', tab: 'Engine', title: 'Smooth running', brief: 'Set the crank angles so the engine stops shaking.' },
  { kind: 'barge', tab: 'Barge', title: 'Level the barge', brief: 'Fill the ballast tanks until she floats upright and level.' },
];

export interface EngineerleDaily {
  dateKey: string;
  number: number;
  specs: [GraphSpec, LeverSpec, BridgeSpec, CrankSpec, BargeSpec];
}

export const engineerleNumber = (dateKey: string) => Math.max(1, daysBetween(ENGINEERLE_EPOCH, dateKey) + 1);

export function getEngineerleDaily(dateKey: string): EngineerleDaily {
  const base = hashSeed(`${dateKey}:engineerle`);
  const seed = (i: number) => (base ^ Math.imul(i + 1, 0x9e3779b1)) >>> 0;
  return {
    dateKey,
    number: engineerleNumber(dateKey),
    specs: [
      makeGraph(seed(0)),
      makeLever(seed(1)),
      makeBridge(seed(2)),
      makeEngine(seed(3)),
      makeBarge(seed(4)),
    ],
  };
}
