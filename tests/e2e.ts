/**
 * End-to-end browser tests (Playwright + Chromium) against the static build in dist.
 *   NEXT_PUBLIC_SUPABASE_URL=https://stats.test NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_test node scripts/build.mjs && npm run test:e2e
 * The daily-comparison service is mocked at that address, so no real project is ever called.
 * Every test runs against a fixed fake clock, so the day's five puzzles are known in advance and the tests can
 * solve them from the same generators the game uses.
 */
import { chromium, type Browser, type Page } from 'playwright';
import { spawn, type ChildProcess } from 'node:child_process';
import { getEngineerleDaily } from '@/engineerle/daily';
import { solutions as bargeSolutions, type BargeSpec } from '@/engineerle/barge';
import type { GraphSpec } from '@/engineerle/graph';
import type { LeverSpec } from '@/engineerle/lever';
import type { BridgeSpec } from '@/engineerle/truss';
import { bestResiduals, type CrankshaftSpec } from '@/engineerle/crankshaft';
import { dialValues, evaluate as circuitEval, type CircuitSpec } from '@/engineerle/circuit';
import { evaluate as powerEval, type PowerlineSpec } from '@/engineerle/powerline';
import { type GearSpec } from '@/engineerle/gears';
import { solvePlacements, type AircraftSpec } from '@/engineerle/aircraft';
import { hohmann, type OrbitSpec } from '@/engineerle/orbit';
import { evaluate as rkEval, bestSplit, type RocketSpec } from '@/engineerle/rocket';
import { evaluate as opEval, RF_VALUES, RG_VALUES, type OpampSpec } from '@/engineerle/opamp';
import { evaluate as rcEval, R_VALUES, C_VALUES, type FilterSpec } from '@/engineerle/rcfilter';

const PROD = 'http://localhost:4182/';
const servers: ChildProcess[] = [];
const serve = (out: string, port: number) => servers.push(spawn('node', ['scripts/serve.mjs'], { env: { ...process.env, ENGINEERLE_OUT: out, PORT: String(port) }, stdio: 'ignore' }));

let pass = 0, fail = 0;
async function t(name: string, fn: () => Promise<void>) {
  try { await fn(); pass++; console.log('  ✓', name); } catch (e) { fail++; console.error('  ✗', name, '\n     ', (e as Error).message.split('\n').slice(0, 5).join('\n      ')); }
}
const eq = (a: unknown, b: unknown, m = '') => { if (a !== b) throw new Error(`${m} expected ${JSON.stringify(b)} got ${JSON.stringify(a)}`); };
const ok = (c: unknown, m: string) => { if (!c) throw new Error(m); };
const q = (p: Page, id: string) => p.locator(`[data-testid=${id}]`);
const text = async (p: Page, id: string) => ((await q(p, id).textContent()) ?? '').trim();

const DAY0 = '2026-11-05';
let DAY = DAY0;
let en = getEngineerleDaily(DAY);
const tabOf = (id: string) => en.puzzles.findIndex((x) => x.def.id === id);
const tab = (id: string) => `ens-tab-${tabOf(id)}`;
const specOf = (id: string) => en.puzzles[tabOf(id)]?.spec;
// the pool is bigger than five, so each test picks a day on which the puzzle it needs is set
const dayWith = (id: string) => {
  for (let i = 0; i < 400; i++) { const d = new Date(Date.UTC(2026, 10, 5 + i)).toISOString().slice(0, 10); if (getEngineerleDaily(d).puzzles.some((x) => x.def.id === id)) return d; }
  throw new Error(`no day sets ${id}`);
};
let zSpec!: GearSpec, ySpec!: AircraftSpec, xSpec!: OrbitSpec, kSpec!: RocketSpec, oSpec!: OpampSpec, fSpec!: FilterSpec, pSpec!: PowerlineSpec, gSpec!: GraphSpec, lSpec!: LeverSpec, bSpec!: BridgeSpec, cSpec!: CrankshaftSpec, aSpec!: BargeSpec, rSpec!: CircuitSpec;
let cBest: number[] = [], cPoor: number[] = [], leverAnswer = 0, wrongPivot = 0, bargeAnswer: number[] = [];
function useDay(day: string) {
  DAY = day; en = getEngineerleDaily(day);
  gSpec = specOf('waveform') as GraphSpec; lSpec = specOf('lever') as LeverSpec; bSpec = specOf('bridge') as BridgeSpec;
  cSpec = specOf('crankshaft') as CrankshaftSpec; aSpec = specOf('barge') as BargeSpec; rSpec = specOf('resistor') as CircuitSpec; pSpec = specOf('powerline') as PowerlineSpec; fSpec = specOf('rcfilter') as FilterSpec; oSpec = specOf('opamp') as OpampSpec; kSpec = specOf('rocket') as RocketSpec; xSpec = specOf('orbit') as OrbitSpec; ySpec = specOf('aircraft') as AircraftSpec; zSpec = specOf('gears') as GearSpec;
  if (lSpec) { leverAnswer = Math.round(lSpec.answer * 20) / 20; wrongPivot = Math.abs(leverAnswer - -3.5) > 1.5 ? -3.5 : 3.5; }
  if (cSpec) { cBest = bestResiduals(cSpec).orders[0]; cPoor = Array.from({ length: cSpec.n }, (_, i) => i + 1); }
  if (aSpec) bargeAnswer = bargeSolutions(aSpec, 10, 1)[0];
}
useDay(DAY0);

// The daily-comparison service is mocked at https://stats.test (the e2e build must be made with that address, see the header).
type StatsMode = 'good' | 'few' | 'http500' | 'abort' | 'garbage' | 'slow' | 'submit500';
const STATS_ORIGIN = 'https://stats.test';
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' };
const GOOD_BUCKETS = [0, 0, 0, 1, 1, 2, 2, 3, 4, 5, 5, 4, 4, 3, 2, 0, 0, 0, 4, 0];
const FEW_BUCKETS = [0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0];
const statsBody = (buckets: number[], mean: number) => JSON.stringify({ n: buckets.reduce((a, c) => a + c, 0), mean, buckets, perPuzzle: Object.fromEntries(en.puzzles.map((x, i) => [x.def.id, { n: 40, mean: 40 + i * 10 }])) });
/** Marks the day as finished before the page loads: guesses per puzzle, 20 s each, so the points are known (100 on guess 1, 65 on guess 2). */
const seedDay = (guesses: number[]) => ({ v: 2, days: { [DAY]: { puzzles: en.puzzles.map((x, i) => ({ id: x.def.id, attempts: guesses[i], solved: true, done: true, points: 0, seconds: 20 })) } } });
async function openEn(b: Browser, opts: { mobile?: boolean; settings?: Record<string, unknown>; noGL?: boolean; url?: string; skipHelp?: boolean; stats?: StatsMode; seed?: number[] } = {}) {
  const ctx = await b.newContext({ viewport: opts.mobile ? { width: 360, height: 740 } : { width: 1280, height: 900 }, hasTouch: !!opts.mobile, reducedMotion: 'reduce', timezoneId: 'UTC', permissions: ['clipboard-read', 'clipboard-write'] });
  if (opts.settings) await ctx.addInitScript((st) => { try { if (!localStorage.getItem('engineerle:v1:settings')) localStorage.setItem('engineerle:v1:settings', JSON.stringify(st)); } catch { /* none */ } }, opts.settings);
  if (opts.noGL) await ctx.addInitScript(() => {
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) { return /webgl/i.test(type) ? null : (orig as (...a: unknown[]) => unknown).call(this, type, ...rest); } as typeof orig;
  });
  if (opts.seed) await ctx.addInitScript((st) => { try { if (!localStorage.getItem('engineerle:v2:progress')) localStorage.setItem('engineerle:v2:progress', JSON.stringify(st)); } catch { /* none */ } }, seedDay(opts.seed));
  const mode = opts.stats ?? 'good';
  const posts: Record<string, unknown>[] = [];
  await ctx.route(`${STATS_ORIGIN}/**`, async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const submit = req.url().endsWith('engineerle_submit');
    if (submit) posts.push(JSON.parse(req.postData() ?? '{}'));
    if (mode === 'abort') return route.abort('failed');
    if (mode === 'slow' && !submit) return; // never answers: the page must give up by itself
    if (submit) return mode === 'submit500' ? route.fulfill({ status: 500, headers: CORS, body: 'oops' }) : route.fulfill({ status: 204, headers: CORS });
    if (mode === 'http500') return route.fulfill({ status: 500, headers: CORS, body: 'oops' });
    if (mode === 'garbage') return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/json' }, body: '{"n": 40, "buckets": [' });
    return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/json' }, body: mode === 'few' ? statsBody(FEW_BUCKETS, 200) : statsBody(GOOD_BUCKETS, 270) });
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(20_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  // a refused or blocked call to the (mocked) stats service is expected in the failure tests; the browser logs it as a console error
  page.on('console', (m) => m.type() === 'error' && !/GL Driver|swiftshader|GroupMarker|WebGL|webgl|THREE/i.test(m.text()) && !(m.location().url ?? '').includes('stats.test') && !/stats\.test/.test(m.text()) && errors.push(m.text()));
  await page.clock.install({ time: new Date(`${DAY}T10:00:00Z`) });
  await page.goto((opts.url ?? PROD) + '?lite#engineerle');
  await page.clock.resume();
  await q(page, 'ens-help-modal').waitFor();
  if (opts.skipHelp !== false) await q(page, 'ens-help-ok').click();
  return { ctx, page, errors, posts };
}
const pipsUsed = async (p: Page) => /^(\d) of 3/.exec((await q(p, 'pips').getAttribute('aria-label')) ?? '')?.[1];
async function solveLever(p: Page) { await q(p, 'lever-slider').fill(String(leverAnswer)); await q(p, 'lever-release').click(); await q(p, 'lever-final').waitFor(); }
async function solveBridge(p: Page) { for (const i of bSpec.weak) await q(p, `bridge-m-${i}`).click(); await q(p, 'bridge-test').click(); await q(p, 'bridge-final').waitFor(); }
async function pickOrder(p: Page, order: number[]) { for (const c of order) await q(p, `crank-cyl-${c}`).click(); }
async function solveCrank(p: Page) { await pickOrder(p, cBest); await q(p, 'crank-run').click(); await q(p, 'crank-final').waitFor(); }
async function solveResistor(p: Page) {
  const dial = dialValues(); const idx = dial.findIndex((o) => circuitEval(rSpec, o).solved);
  await q(p, 'circuit-dial').fill(String(idx)); await q(p, 'circuit-test').click(); await q(p, 'circuit-final').waitFor();
}
async function solvePower(p: Page) {
  const r = pSpec.ratios.find((x) => powerEval(pSpec, x).solved)!;
  await q(p, `power-ratio-${r}`).click(); await q(p, 'power-run').click(); await q(p, 'power-final').waitFor();
}
function rcSolution(): [number, number] {
  for (let i = 0; i < R_VALUES.length; i++) for (let j = 0; j < C_VALUES.length; j++) if (rcEval(fSpec, R_VALUES[i], C_VALUES[j]).solved) return [i, j];
  throw new Error('no RC solution');
}
async function solveRc(p: Page) {
  const [i, j] = rcSolution();
  await q(p, 'rc-r').fill(String(i)); await q(p, 'rc-c').fill(String(j)); await q(p, 'rc-run').click(); await q(p, 'rc-final').waitFor();
}
function opSolution(): [number, number] {
  for (let i = 0; i < RF_VALUES.length; i++) for (let j = 0; j < RG_VALUES.length; j++) if (opEval(oSpec, RF_VALUES[i], RG_VALUES[j]).solved) return [i, j];
  throw new Error('no op-amp solution');
}
async function solveOp(p: Page) {
  const [i, j] = opSolution();
  await q(p, 'op-rf').fill(String(i)); await q(p, 'op-rg').fill(String(j)); await q(p, 'op-run').click(); await q(p, 'op-final').waitFor();
}
async function solveRocket(p: Page) {
  const pct = Math.round(bestSplit(kSpec).split * 100);
  await q(p, 'rocket-split').fill(String(pct)); await q(p, 'rocket-launch').click(); await q(p, 'rocket-final').waitFor({ timeout: 30000 });
}
async function solveOrbit(p: Page) {
  await q(p, 'orbit-dv').fill(String(Math.round(hohmann(xSpec.r1, xSpec.r2).dv1 * 1000))); await q(p, 'orbit-fire').click(); await q(p, 'orbit-final').waitFor({ timeout: 30000 });
}
async function solveAircraft(p: Page) {
  const sol = solvePlacements(ySpec)!;
  for (let i = 0; i < sol.length; i++) await q(p, `air-slider-${i}`).fill(String(Number(sol[i].toFixed(2))));
  await q(p, 'air-fly').click(); await q(p, 'air-final').waitFor({ timeout: 30000 });
}
async function solveGears(p: Page) {
  for (let k = 0; k < zSpec.example.length; k++) { await q(p, `gear-d-${k}`).fill(String(zSpec.example[k].driver)); await q(p, `gear-n-${k}`).fill(String(zSpec.example[k].driven)); }
  await q(p, 'gear-run').click(); await q(p, 'gear-final').waitFor({ timeout: 30000 });
}
async function solveBarge(p: Page) { for (let i = 0; i < 4; i++) await q(p, `barge-tank-${i}`).fill(String(bargeAnswer[i])); await q(p, 'barge-flood').click(); await q(p, 'barge-final').waitFor(); }

async function main() {
  serve('dist', 4182);
  await new Promise((r) => setTimeout(r, 1200));
  const b = await chromium.launch();

  console.log('Engineerle');
  await t('scope: a wrong equation costs a guess and says only how many are left, an unreadable one is free, the right one solves', async () => {
    useDay(dayWith('waveform'));
    const { ctx, page: p, errors } = await openEn(b); await q(p, tab('waveform')).click();
    ok(/V\/div/.test(await text(p, 'scope-scales')) && /s\/div/.test(await text(p, 'scope-scales')), 'scope scales shown');
    await q(p, 'graph-input').fill('1/0'); await q(p, 'graph-submit').click(); await q(p, 'graph-msg').waitFor(); eq(await pipsUsed(p), '0', '1/0 is refused');
    await q(p, 'graph-input').fill('t +'); await q(p, 'graph-submit').click(); await p.waitForFunction(() => document.querySelector('[data-testid=graph-msg]')?.textContent?.includes('guess'));
    ok((await text(p, 'graph-msg')).includes("didn't use up a guess"), 'free'); eq(await pipsUsed(p), '0', 'no guess used');
    await q(p, 'graph-input').fill('2*sin(2*pi*100*t)'); await q(p, 'graph-submit').click();
    await p.waitForFunction(() => document.querySelector('[data-testid=graph-msg]')?.textContent?.includes('guesses left'));
    ok(!/hint/i.test(await text(p, 'graph-msg')), 'no hint');
    eq(await pipsUsed(p), '1', 'one guess used');
    await q(p, 'graph-input').fill(gSpec.answer); await q(p, 'graph-submit').click(); await q(p, 'graph-final').waitFor();
    ok((await text(p, 'graph-final')).includes('Solved'), 'solved'); eq(await q(p, tab('waveform')).getAttribute('data-state'), 'solved', 'tab');
    await p.reload(); await q(p, tab('waveform')).waitFor(); eq(await q(p, tab('waveform')).getAttribute('data-state'), 'solved', 'saved');
    eq(errors.length, 0, errors.join('|')); await ctx.close();
  });
  await t('three wrong signals end the puzzle and show the answer', async () => {
    useDay(dayWith('waveform'));
    const { ctx, page: p } = await openEn(b); await q(p, tab('waveform')).click();
    for (const guess of ['1', '2', '3']) { await q(p, 'graph-input').fill(guess); await q(p, 'graph-submit').click(); await p.waitForTimeout(150); }
    await q(p, 'graph-final').waitFor(); ok((await text(p, 'graph-final')).includes('Out of guesses'), 'out'); ok((await text(p, 'graph-final')).includes(gSpec.answer.replace(/\s/g, '')) || (await text(p, 'graph-final')).includes(gSpec.answer), 'answer shown');
    eq(await q(p, tab('waveform')).getAttribute('data-state'), 'failed', 'tab'); await ctx.close();
  });
  await t('lever: the wrong pivot tips it, the balance point holds it level', async () => {
    useDay(dayWith('lever'));
    const { ctx, page: p, errors } = await openEn(b); await q(p, tab('lever')).click();
    await q(p, 'lever-slider').fill(String(wrongPivot)); await q(p, 'lever-release').click();
    await q(p, 'lever-msg').waitFor(); ok((await text(p, 'lever-msg')).includes('drops'), 'tipped'); eq(await pipsUsed(p), '1');
    await p.waitForFunction(() => !(document.querySelector('[data-testid=lever-release]') as HTMLButtonElement | null)?.disabled, null, { timeout: 30_000 });
    await solveLever(p); ok((await text(p, 'lever-final')).includes('Balanced'), 'balanced'); eq(await q(p, tab('lever')).getAttribute('data-state'), 'solved');
    eq(errors.length, 0, errors.join('|')); await ctx.close();
  });
  await t('bridge: reinforcing the wrong members fails without saying what broke; the weak ones hold', async () => {
    useDay(dayWith('bridge'));
    const { ctx, page: p, errors } = await openEn(b); await q(p, tab('bridge')).click();
    const wrong = Array.from({ length: bSpec.areas.length }, (_, i) => i).filter((i) => !bSpec.weak.includes(i)).slice(0, bSpec.budget);
    for (const i of wrong) await q(p, `bridge-m-${i}`).click();
    eq(await text(p, 'bridge-count').then((x) => x.startsWith(`Reinforced ${bSpec.budget} of ${bSpec.budget}`)), true, 'count');
    await q(p, 'bridge-test').click(); await q(p, 'bridge-msg').waitFor(); { const m = await text(p, 'bridge-msg'); ok(m.includes('could not carry it'), 'collapsed'); ok(!/hint/i.test(m) && !/\b[BTD]\d+\b/.test(m), `the message names no member and gives no hint: ${m}`); }
    eq(await pipsUsed(p), '1');
    eq(await p.locator('[data-testid^=bridge-m-][data-hit=true]').count(), 0, 'nothing is flagged as the weak member while the puzzle is still open');
    await p.waitForFunction(() => !(document.querySelector('[data-testid=bridge-test]') as HTMLButtonElement | null)?.disabled, null, { timeout: 30_000 });
    for (const i of wrong) await q(p, `bridge-m-${i}`).click();
    await solveBridge(p); ok((await text(p, 'bridge-final')).includes('holds'), 'holds'); eq(await q(p, tab('bridge')).getAttribute('data-state'), 'solved');
    eq(errors.length, 0, errors.join('|')); await ctx.close();
  });
  await t('bridge: only as many members as the budget can be reinforced', async () => {
    useDay(dayWith('bridge'));
    const { ctx, page: p } = await openEn(b); await q(p, tab('bridge')).click();
    for (let i = 0; i <= bSpec.budget; i++) await q(p, `bridge-m-${i}`).click();
    ok((await text(p, 'bridge-count')).startsWith(`Reinforced ${bSpec.budget} of ${bSpec.budget}`), 'capped'); await ctx.close();
  });
  await t('crankshaft: an incomplete order is refused without using a guess; the naive order shakes; a balanced order runs smooth', async () => {
    useDay(dayWith('crankshaft'));
    const { ctx, page: p, errors } = await openEn(b); await q(p, tab('crankshaft')).click();
    await q(p, 'crank-cyl-1').click(); await q(p, 'crank-run').click(); await q(p, 'crank-msg').waitFor();
    eq(await pipsUsed(p), '0', 'a refused order is not a guess'); ok(!/hint/i.test(await text(p, 'crank-msg')), 'no hint');
    await q(p, 'crank-reset').click(); eq(await text(p, 'crank-order'), 'Firing order: —', 'cleared');
    await pickOrder(p, cPoor); await q(p, 'crank-run').click(); await q(p, 'crank-msg').waitFor();
    ok(/shakes|thumps|buzzes|rocks/.test(await text(p, 'crank-msg')), 'physical outcome'); ok(/guess/.test(await text(p, 'crank-msg')), 'guesses left'); eq(await pipsUsed(p), '1', 'one guess used');
    await p.waitForFunction(() => !(document.querySelector('[data-testid=crank-run]') as HTMLButtonElement | null)?.disabled, null, { timeout: 30_000 });
    await q(p, 'crank-reset').click(); await solveCrank(p); ok((await text(p, 'crank-final')).includes('Smooth'), 'smooth'); eq(await q(p, tab('crankshaft')).getAttribute('data-state'), 'solved');
    eq(errors.length, 0, errors.join('|')); await ctx.close();
  });
  await t('resistor: the start value reads wrong on the meter and uses a guess; the right standard value solves it', async () => {
    useDay(dayWith('resistor'));
    const { ctx, page: p, errors } = await openEn(b); await q(p, tab('resistor')).click();
    await q(p, 'circuit-schematic').waitFor(); eq(await text(p, 'circuit-reading'), `-.-- ${rSpec.target.kind === 'voltage' ? 'V' : 'mA'}`, 'meter is blank before the test');
    await q(p, 'circuit-test').click(); await q(p, 'circuit-msg').waitFor();
    ok(/meter reads/.test(await text(p, 'circuit-msg')) && /guess/.test(await text(p, 'circuit-msg')), 'reading and guesses left'); ok(!/hint/i.test(await text(p, 'circuit-msg')), 'no hint');
    eq(await pipsUsed(p), '1', 'one guess used'); ok(/\d/.test(await text(p, 'circuit-reading')), 'the meter shows a reading');
    const dial = dialValues(); const good = dial.findIndex((o) => circuitEval(rSpec, o).solved);
    await q(p, 'circuit-dial').fill(String(good)); await q(p, 'circuit-test').click(); await q(p, 'circuit-final').waitFor();
    ok((await text(p, 'circuit-final')).includes('Solved'), 'solved'); eq(await q(p, tab('resistor')).getAttribute('data-state'), 'solved');
    eq(errors.length, 0, errors.join('|')); await ctx.close();
  });
  await t('power line: a low ratio overheats the line, a too-high one flashes over, the window solves', async () => {
    useDay(dayWith('powerline'));
    const { ctx, page: p, errors } = await openEn(b); await q(p, tab('powerline')).click();
    await q(p, 'power-diagram').waitFor();
    const bad = pSpec.ratios.find((x) => !powerEval(pSpec, x).solved)!;
    await q(p, `power-ratio-${bad}`).click(); await q(p, 'power-run').click(); await q(p, 'power-msg').waitFor();
    ok(/heat|flash/.test(await text(p, 'power-msg')) && /guess/.test(await text(p, 'power-msg')), 'physical outcome and guesses left'); ok(!/hint/i.test(await text(p, 'power-msg')), 'no hint');
    eq(await pipsUsed(p), '1', 'one guess used'); ok((await text(p, 'power-result')).includes('lost'), 'the loss is shown after the run');
    await solvePower(p); ok((await text(p, 'power-final')).includes('Solved'), 'solved'); eq(await q(p, tab('powerline')).getAttribute('data-state'), 'solved');
    eq(errors.length, 0, errors.join('|')); await ctx.close();
  });
  await t('RC filter: the first dial position fails and reports the dB, the right pair solves', async () => {
    useDay(dayWith('rcfilter'));
    const { ctx, page: p, errors } = await openEn(b); await q(p, tab('rcfilter')).click();
    await q(p, 'rc-scope').waitFor(); await q(p, 'rc-mini').waitFor();
    await q(p, 'rc-r').fill('0'); await q(p, 'rc-c').fill('0'); await q(p, 'rc-run').click(); await q(p, 'rc-msg').waitFor();
    ok(/dB/.test(await text(p, 'rc-msg')) && /guess/.test(await text(p, 'rc-msg')), 'dB and guesses left'); ok(!/hint/i.test(await text(p, 'rc-msg')), 'no hint');
    eq(await pipsUsed(p), '1', 'one guess used'); ok((await text(p, 'rc-result')).includes('dB'), 'result readout');
    await solveRc(p); ok((await text(p, 'rc-final')).includes('Solved'), 'solved'); eq(await q(p, tab('rcfilter')).getAttribute('data-state'), 'solved');
    eq(errors.length, 0, errors.join('|')); await ctx.close();
  });
  await t('op-amp: the first position misses, a huge gain clips or rolls off, the right pair solves', async () => {
    useDay(dayWith('opamp'));
    const { ctx, page: p, errors } = await openEn(b); await q(p, tab('opamp')).click();
    await q(p, 'op-scope').waitFor(); await q(p, 'op-schematic').waitFor();
    await q(p, 'op-rf').fill('0'); await q(p, 'op-rg').fill('0'); await q(p, 'op-run').click(); await q(p, 'op-msg').waitFor();
    ok(/Gain/.test(await text(p, 'op-msg')) && /guess/.test(await text(p, 'op-msg')), 'gain and guesses left'); ok(!/hint/i.test(await text(p, 'op-msg')), 'no hint');
    eq(await pipsUsed(p), '1', 'one guess used');
    await q(p, 'op-rf').fill(String(RF_VALUES.length - 1)); await q(p, 'op-rg').fill('0'); await q(p, 'op-run').click();
    await p.waitForFunction(() => /clipped|rolled off/.test(document.querySelector('[data-testid=op-msg]')?.textContent ?? '') && /1 guess left/.test(document.querySelector('[data-testid=op-msg]')?.textContent ?? ''));
    eq(await pipsUsed(p), '2', 'two guesses used');
    await solveOp(p); ok((await text(p, 'op-final')).includes('Solved'), 'solved'); eq(await q(p, tab('opamp')).getAttribute('data-state'), 'solved');
    eq(errors.length, 0, errors.join('|')); await ctx.close();
  });
  await t('rocket: a bad split falls short by a stated number of m/s, the best split reaches orbit', async () => {
    useDay(dayWith('rocket'));
    const { ctx, page: p, errors } = await openEn(b); await q(p, tab('rocket')).click();
    await q(p, 'rocket-view').waitFor();
    await q(p, 'rocket-split').fill('5'); await q(p, 'rocket-launch').click(); await q(p, 'rocket-msg').waitFor();
    ok(/short of orbit/.test(await text(p, 'rocket-msg')) && /m\/s/.test(await text(p, 'rocket-msg')), 'shortfall in m/s'); ok(/guess/.test(await text(p, 'rocket-msg')), 'guesses left'); ok(!/hint/i.test(await text(p, 'rocket-msg')), 'no hint');
    eq(await pipsUsed(p), '1', 'one guess used');
    await solveRocket(p); ok((await text(p, 'rocket-final')).includes('Orbit'), 'solved'); eq(await q(p, tab('rocket')).getAttribute('data-state'), 'solved');
    ok(rkEval(kSpec, bestSplit(kSpec).split).solved, 'model agrees');
    eq(errors.length, 0, errors.join('|')); await ctx.close();
  });
  await t('rocket: the ascent animation plays through staging to the verdict', async () => {
    useDay(dayWith('rocket'));
    const { ctx, page: p, errors } = await openEn(b, { settings: { volume: 40, muted: true, lowCpu: true, reduceMotion: false } }); await q(p, tab('rocket')).click();
    await q(p, 'rocket-split').fill('5'); await q(p, 'rocket-launch').click();
    ok(await q(p, 'rocket-launch').isDisabled(), 'busy while flying');
    await q(p, 'rocket-msg').waitFor({ timeout: 30000 }); ok(/short of orbit/.test(await text(p, 'rocket-msg')), 'verdict after the flight');
    await p.waitForFunction(() => !(document.querySelector('[data-testid=rocket-launch]') as HTMLButtonElement | null)?.disabled, null, { timeout: 15000 });
    eq(errors.length, 0, errors.join('|')); await ctx.close();
  });
  await t('orbit: unusable burns are refused without a guess, a wrong burn reports the apoapsis it reached, the Hohmann burn solves', async () => {
    useDay(dayWith('orbit'));
    const { ctx, page: p, errors } = await openEn(b); await q(p, tab('orbit')).click();
    await q(p, 'orbit-view').waitFor();
    for (const bad of ['', '   ', '-300', 'abc', '1e9', '0x10', '2,4,0,0x', '99999']) {
      await q(p, 'orbit-dv').fill(bad); await q(p, 'orbit-fire').click(); await q(p, 'orbit-msg').waitFor();
      eq(await pipsUsed(p), '0', `no guess used for "${bad}"`);
    }
    await q(p, 'orbit-dv').fill('0'); await q(p, 'orbit-fire').click(); await p.waitForFunction(() => /apoapsis/.test(document.querySelector('[data-testid=orbit-msg]')?.textContent ?? ''));
    ok(/guess/.test(await text(p, 'orbit-msg')) && !/hint/i.test(await text(p, 'orbit-msg')), 'physical result, guesses left, no hint');
    eq(await pipsUsed(p), '1', 'a zero burn is a real guess');
    await solveOrbit(p); ok((await text(p, 'orbit-final')).includes('target orbit'), 'solved'); eq(await q(p, tab('orbit')).getAttribute('data-state'), 'solved');
    eq(errors.length, 0, errors.join('|')); await ctx.close();
  });
  await t('orbit: the coast animation plays and ends with the verdict', async () => {
    useDay(dayWith('orbit'));
    const { ctx, page: p, errors } = await openEn(b, { settings: { volume: 40, muted: true, lowCpu: true, reduceMotion: false } }); await q(p, tab('orbit')).click();
    await q(p, 'orbit-dv').fill('1000'); await q(p, 'orbit-fire').click();
    ok(await q(p, 'orbit-fire').isDisabled(), 'busy while coasting');
    await q(p, 'orbit-msg').waitFor({ timeout: 30000 }); ok(/apoapsis/.test(await text(p, 'orbit-msg')), 'verdict after the coast');
    eq(errors.length, 0, errors.join('|')); await ctx.close();
  });
  await t('aircraft: the starting loading does not balance and reports the CG, margin and tail load; the worked loading solves', async () => {
    useDay(dayWith('aircraft'));
    const { ctx, page: p, errors } = await openEn(b); await q(p, tab('aircraft')).click();
    await q(p, 'air-view').waitFor();
    ok(!(await p.locator('[data-testid=air-diagram]').count()), 'no loading diagram before the first guess');
    await q(p, 'air-fly').click(); await q(p, 'air-msg').waitFor();
    const m = await text(p, 'air-msg');
    ok(/static margin/.test(m) && /tail load/.test(m) && /guess/.test(m), 'CG, margin, tail load, guesses left'); ok(!/hint/i.test(m), 'no hint');
    eq(await pipsUsed(p), '1', 'one guess used'); await q(p, 'air-diagram').waitFor();
    await solveAircraft(p); ok((await text(p, 'air-final')).includes('Balanced'), 'solved'); eq(await q(p, tab('aircraft')).getAttribute('data-state'), 'solved');
    eq(errors.length, 0, errors.join('|')); await ctx.close();
  });
  await t('aircraft: the pitching animation plays and ends with the verdict', async () => {
    useDay(dayWith('aircraft'));
    const { ctx, page: p, errors } = await openEn(b, { settings: { volume: 40, muted: true, lowCpu: true, reduceMotion: false } }); await q(p, tab('aircraft')).click();
    await q(p, 'air-fly').click(); ok(await q(p, 'air-fly').isDisabled(), 'busy while flying');
    await q(p, 'air-msg').waitFor({ timeout: 30000 }); ok(/guess/.test(await text(p, 'air-msg')), 'verdict after the flight');
    eq(errors.length, 0, errors.join('|')); await ctx.close();
  });
  await t('gears: the starting train misses and reports the output speed, the worked train solves', async () => {
    useDay(dayWith('gears'));
    const { ctx, page: p, errors } = await openEn(b); await q(p, tab('gears')).click();
    await q(p, 'gear-view').waitFor();
    await q(p, 'gear-run').click(); await q(p, 'gear-msg').waitFor();
    const m = await text(p, 'gear-msg');
    ok(/rpm/.test(m) && /guess/.test(m), 'speed and guesses left'); ok(!/hint/i.test(m), 'no hint');
    eq(await pipsUsed(p), '1', 'one guess used'); ok((await text(p, 'gear-result')).includes('rpm'), 'result readout');
    await solveGears(p); ok((await text(p, 'gear-final')).includes('Right speed'), 'solved'); eq(await q(p, tab('gears')).getAttribute('data-state'), 'solved');
    eq(errors.length, 0, errors.join('|')); await ctx.close();
  });
  await t('gears: the train turns when run and ends with the verdict', async () => {
    useDay(dayWith('gears'));
    const { ctx, page: p, errors } = await openEn(b, { settings: { volume: 40, muted: true, lowCpu: true, reduceMotion: false } }); await q(p, tab('gears')).click();
    await q(p, 'gear-run').click(); ok(await q(p, 'gear-run').isDisabled(), 'busy while running');
    await q(p, 'gear-msg').waitFor({ timeout: 30000 }); ok(/rpm/.test(await text(p, 'gear-msg')), 'verdict after the run');
    eq(errors.length, 0, errors.join('|')); await ctx.close();
  });
  await t('barge: an unballasted barge lists; the right ballast floats her level', async () => {
    useDay(dayWith('barge'));
    const { ctx, page: p, errors } = await openEn(b); await q(p, tab('barge')).click();
    await q(p, 'barge-flood').click(); await q(p, 'barge-msg').waitFor({ timeout: 30_000 }); ok((await text(p, 'barge-msg')).includes('floats'), 'listing'); eq(await pipsUsed(p), '1');
    await p.waitForFunction(() => !(document.querySelector('[data-testid=barge-flood]') as HTMLButtonElement | null)?.disabled, null, { timeout: 40_000 });
    await solveBarge(p); ok((await text(p, 'barge-final')).includes('level'), 'level'); eq(await q(p, tab('barge')).getAttribute('data-state'), 'solved');
    eq(errors.length, 0, errors.join('|')); await ctx.close();
  });
  await t('barge: going over the pump limit is refused without using a guess', async () => {
    useDay(dayWith('barge'));
    const { ctx, page: p } = await openEn(b); await q(p, tab('barge')).click();
    for (let i = 0; i < 4; i++) await q(p, `barge-tank-${i}`).fill('110');
    await q(p, 'barge-flood').click(); await q(p, 'barge-msg').waitFor(); ok((await text(p, 'barge-msg')).includes('pump limit'), 'refused'); eq(await pipsUsed(p), '0'); await ctx.close();
  });
  await t('the timer runs while a puzzle is open, stops when it is solved, and survives a reload', async () => {
    useDay(dayWith('lever'));
    const { ctx, page: p, errors } = await openEn(b); await q(p, tab('lever')).click();
    const secs = async () => Number(await q(p, 'ens-timer').getAttribute('data-seconds'));
    ok((await text(p, 'ens-par')).startsWith('Par '), 'par shown');
    const t0 = await secs(); await p.waitForTimeout(2600); const t1 = await secs();
    ok(t1 >= t0 + 2, `timer advances (${t0} -> ${t1})`);
    await p.reload(); await q(p, tab('lever')).click(); const t2 = await secs();
    ok(Math.abs(t2 - t1) <= 4 && t2 >= t1 - 1, `kept across a reload (${t1} -> ${t2})`);
    await solveLever(p); await p.waitForTimeout(300); const t3 = await secs(); eq(await q(p, 'ens-clock').getAttribute('data-state'), 'done', 'clock done');
    await p.waitForTimeout(1500); eq(await secs(), t3, 'stopped once solved');
    eq(errors.length, 0, errors.join('|')); await ctx.close();
  });
  await t('the timer waits while a dialog is open', async () => {
    useDay(DAY0);
    const { ctx, page: p } = await openEn(b, { skipHelp: false });
    await p.waitForTimeout(1500); eq(await q(p, 'ens-clock').getAttribute('data-state'), 'paused', 'paused behind the dialog');
    eq(await q(p, 'ens-timer').getAttribute('data-seconds'), '0', 'no time counted'); await ctx.close();
  });
  await t('no puzzle page shows a hint', async () => {
    useDay(DAY0);
    const { ctx, page: p } = await openEn(b);
    for (let i = 0; i < 5; i++) { await q(p, `ens-tab-${i}`).click(); await p.waitForTimeout(150); ok(!/hint/i.test((await p.locator('.ens').innerText())), `hint text on tab ${i}`); }
    await ctx.close();
  });
  await t('solving all five shows the results, a share text, and survives a reload', async () => {
    useDay(DAY0);
    const { ctx, page: p, errors, posts } = await openEn(b);
    const solvers: Record<string, () => Promise<void>> = {
      waveform: async () => { await q(p, 'graph-input').fill(gSpec.answer); await q(p, 'graph-submit').click(); await q(p, 'graph-final').waitFor(); },
      lever: () => solveLever(p), bridge: () => solveBridge(p), crankshaft: () => solveCrank(p), barge: () => solveBarge(p), resistor: () => solveResistor(p), powerline: () => solvePower(p), rcfilter: () => solveRc(p), opamp: () => solveOp(p), rocket: () => solveRocket(p), orbit: () => solveOrbit(p), aircraft: () => solveAircraft(p), gears: () => solveGears(p),
    };
    for (const { def } of en.puzzles) { await solvers[def.id](); if (def.id !== en.puzzles[4].def.id) eq(posts.length, 0, 'nothing is sent before the fifth puzzle is done'); await q(p, 'ens-next').click(); }
    await q(p, 'ens-summary').waitFor(); await p.waitForFunction(() => document.querySelector('[data-testid=ens-compare]')?.getAttribute('data-state') === 'ready');
    eq(posts.length, 1, 'one result sent'); { const b0 = posts[0] as { p_day: number; p_device: string; p_ids: string[]; p_points: number[]; p_guesses: number[]; p_seconds: number[]; p_total: number };
      eq(b0.p_day, en.number, 'day number'); eq(b0.p_total, 500, 'total'); eq(b0.p_ids.join(), en.puzzles.map((x) => x.def.id).join(), 'ids in order'); eq(b0.p_points.join(), '100,100,100,100,100', 'points'); eq(b0.p_guesses.join(), '1,1,1,1,1', 'guesses'); ok(b0.p_seconds.every((x) => Number.isInteger(x) && x >= 0 && x <= 86400), 'seconds are whole and in range'); ok(/^[0-9a-f-]{36}$/.test(b0.p_device), 'device id is a uuid'); } ok(/^https?:\/\/[^/]+\/\?s=\d+\.[01]\.(auto|dark|light)\.[01]\.[01]$/.test((await q(p, 'ens-to-obscura').getAttribute('href')) ?? ''), 'results link to Obscura carries settings'); ok((await text(p, 'ens-points')).startsWith('500'), '500 points'); ok((await text(p, 'ens-squares')).includes('🟩🟩🟩🟩🟩') || (await text(p, 'ens-squares')).replace(/\s/g, '') === '🟩🟩🟩🟩🟩', 'all green');
    await q(p, 'ens-share').click(); await p.waitForTimeout(300);
    const clip = await p.evaluate(() => navigator.clipboard.readText()).catch(() => '');
    ok(clip === '' || (clip.startsWith(`Engineerle #${en.number}  500/500`) && clip.includes('🟩🟩🟩🟩🟩')), `share text: ${clip}`);
    await p.reload(); await q(p, 'ens-summary').waitFor(); ok((await text(p, 'ens-points')).startsWith('500'), 'kept after reload');
    await p.waitForFunction(() => document.querySelector('[data-testid=ens-compare]')?.getAttribute('data-state') === 'ready'); eq(posts.length, 1, 'a reload does not send the day again');
    await q(p, 'ens-stats-btn').click(); await q(p, 'ens-stats-modal').waitFor(); ok((await text(p, 'ens-stats-modal')).includes('Perfect days'), 'stats');
    eq(errors.length, 0, errors.join('|')); await ctx.close();
  });
  console.log('\nDaily comparison');
  const finishedDay = async (b0: Browser, o: Parameters<typeof openEn>[1] = {}) => { useDay(DAY0); const r = await openEn(b0, { seed: [1, 1, 2, 1, 1], ...o }); await q(r.page, 'ens-summary').waitFor(); return r; };
  await t('comparison: the chart shows the player in their own bar, the average of the other players, the percentile and the per-puzzle bars', async () => {
    const { ctx, page: p, errors, posts } = await finishedDay(b);
    await p.waitForFunction(() => document.querySelector('[data-testid=ens-compare]')?.getAttribute('data-state') === 'ready');
    eq(posts.length, 1, 'sent once'); eq((posts[0] as { p_total: number }).p_total, 465, 'total sent'); eq((posts[0] as { p_guesses: number[] }).p_guesses.join(), '1,1,2,1,1', 'guesses sent');
    eq(await p.locator('[data-testid^=ens-bucket-]').count(), 20, 'twenty bars'); eq(await p.locator('[data-testid^=ens-bucket-][data-you=true]').count(), 1, 'exactly one is the player');
    eq(await q(p, 'ens-bucket-18').getAttribute('data-you'), 'true', '465 points sits in the 450-474 bar');
    eq(await q(p, 'ens-compare-mean').getAttribute('data-mean'), '265', 'average of the other players (their own score taken out)');
    const msg = await text(p, 'ens-compare-text'); ok(/higher than 95% of 40 players/.test(msg), msg);
    eq(await p.locator('[data-testid^=ens-pp-]').count(), 5, 'one pair of bars per puzzle');
    for (const { def } of en.puzzles) ok((await q(p, `ens-pp-${def.id}`).textContent())?.includes(def.title), `${def.id} labelled with its title`);
    ok((await text(p, 'ens-points')).startsWith('465'), 'score still shown'); await q(p, 'ens-share').click();
    eq(errors.length, 0, errors.join('|')); await ctx.close();
  });
  await t('comparison: with only a few players the count is shown and nobody is ranked', async () => {
    const { ctx, page: p, errors } = await finishedDay(b, { stats: 'few' });
    await p.waitForFunction(() => document.querySelector('[data-testid=ens-compare]')?.getAttribute('data-state') === 'ready');
    const msg = await text(p, 'ens-compare-text'); ok(/3 players/.test(msg), msg); ok(msg.includes('Not enough players yet to rank you'), msg); ok(!/higher than/.test(msg), msg);
    eq(await p.locator('[data-testid^=ens-bucket-]').count(), 20, 'chart still drawn'); eq(errors.length, 0, errors.join('|')); await ctx.close();
  });
  for (const mode of ['http500', 'abort', 'garbage', 'slow'] as const) {
    await t(`comparison: when the service answers ${mode} the page says so and the results still work`, async () => {
      const { ctx, page: p, errors } = await finishedDay(b, { stats: mode });
      await p.waitForFunction(() => document.querySelector('[data-testid=ens-compare]')?.getAttribute('data-state') === 'unavailable', null, { timeout: 15_000 });
      eq(await text(p, 'ens-compare-fallback'), 'The daily comparison is unavailable right now.', 'fallback text');
      eq(await p.locator('[data-testid^=ens-bucket-]').count(), 0, 'no chart'); eq(await p.locator('[data-testid^=ens-pp-]').count(), 0, 'no bars');
      ok((await text(p, 'ens-points')).startsWith('465'), 'score'); ok((await text(p, 'ens-squares')).includes('🟩'), 'squares'); eq(await q(p, 'ens-share').isDisabled(), false, 'share works');
      await q(p, 'ens-share').click(); await p.waitForTimeout(200);
      eq(errors.length, 0, errors.join('|')); await ctx.close();
    });
  }
  await t('comparison: a result that did not get through is tried again later and never sent twice once it has', async () => {
    const first = await finishedDay(b, { stats: 'submit500' });
    await first.page.waitForFunction(() => document.querySelector('[data-testid=ens-compare]')?.getAttribute('data-state') !== 'loading');
    ok(first.posts.length >= 1, 'tried'); const tried = first.posts.length;
    const state = await first.page.evaluate(() => ({ pending: localStorage.getItem('engineerle:v2:pending'), sent: localStorage.getItem('engineerle:v2:sent') }));
    ok(!!state.pending && !(state.sent ?? '').length, `kept for later: ${JSON.stringify(state)}`);
    // the service recovers: same browser storage, new page
    await first.ctx.unroute(`${STATS_ORIGIN}/**`); const posts2: unknown[] = [];
    await first.ctx.route(`${STATS_ORIGIN}/**`, async (route) => { const req = route.request(); if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS }); if (req.url().endsWith('engineerle_submit')) { posts2.push(JSON.parse(req.postData() ?? '{}')); return route.fulfill({ status: 204, headers: CORS }); } return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/json' }, body: statsBody(GOOD_BUCKETS, 270) }); });
    await first.page.reload(); await q(first.page, 'ens-summary').waitFor(); await first.page.waitForFunction(() => document.querySelector('[data-testid=ens-compare]')?.getAttribute('data-state') === 'ready');
    eq(posts2.length, 1, 'sent on the next visit'); eq(JSON.stringify(posts2[0]).includes(`"p_day":${en.number}`), true, 'same day');
    const sent = await first.page.evaluate(() => localStorage.getItem('engineerle:v2:pending')); eq(sent, null, 'queue emptied');
    await first.page.reload(); await q(first.page, 'ens-summary').waitFor(); await first.page.waitForFunction(() => document.querySelector('[data-testid=ens-compare]')?.getAttribute('data-state') === 'ready');
    eq(posts2.length, 1, 'and not again'); eq(first.errors.length, 0, first.errors.join('|')); void tried; await first.ctx.close();
  });
  await t('comparison: damaged saved queue and device id are ignored', async () => {
    useDay(DAY0);
    const r = await openEn(b, { seed: [1, 1, 1, 1, 1] });
    await r.page.evaluate(() => { localStorage.setItem('engineerle:v2:pending', '{{{ nope'); localStorage.setItem('engineerle:v2:device', '12'); localStorage.setItem('engineerle:v2:sent', '"x"'); });
    await r.page.reload(); await q(r.page, 'ens-summary').waitFor(); await r.page.waitForFunction(() => document.querySelector('[data-testid=ens-compare]')?.getAttribute('data-state') === 'ready');
    eq(r.errors.length, 0, r.errors.join('|')); await r.ctx.close();
  });
  await t('comparison: draws in dark and light at phone width with no sideways scroll', async () => {
    for (const theme of ['dark', 'light']) {
      const { ctx, page: p, errors } = await finishedDay(b, { mobile: true, settings: { volume: 40, muted: true, theme, lowCpu: true, reduceMotion: true } });
      await p.waitForFunction(() => document.querySelector('[data-testid=ens-compare]')?.getAttribute('data-state') === 'ready');
      const w = await p.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth, document.querySelector('[data-testid=ens-compare]')!.scrollWidth, document.querySelector('[data-testid=ens-compare]')!.clientWidth]);
      ok(w[0] <= w[1] + 1 && w[2] <= w[3] + 1, `${theme}: no sideways scroll ${w}`);
      eq(await p.evaluate(() => document.documentElement.dataset.theme), theme, 'theme'); eq(errors.length, 0, errors.join('|')); await ctx.close();
    }
  });

  console.log('\nRevisiting a solved puzzle');
  const num = (txt: string, re: RegExp) => { const m = re.exec(txt); if (!m) throw new Error(`no match for ${re} in: ${txt}`); return m; };
  const ohms = (v: string, u: string) => Number(v) * (u === 'MΩ' ? 1e6 : u === 'kΩ' ? 1e3 : 1);
  const farads = (v: string, u: string) => Number(v) * (u === 'µF' ? 1e-6 : 1e-9);
  const reopened = async (id: string) => { useDay(dayWith(id)); const r = await openEn(b, { seed: [1, 1, 1, 1, 1] }); await q(r.page, tab(id)).click(); return r; };
  await t('a solved puzzle opened again (or after a reload) shows a setting that really works, never the starting dial', async () => {
    let r = await reopened('resistor'); let tx = await text(r.page, 'circuit-final');
    { const m = num(tx, /resistor of ([\d.]+) (MΩ|kΩ|Ω)/); ok(circuitEval(rSpec, ohms(m[1], m[2])).solved, `resistor: ${tx}`); } await r.ctx.close();
    r = await reopened('powerline'); tx = await text(r.page, 'power-final');
    { const m = num(tx, /1 : (\d+)/); ok(powerEval(pSpec, Number(m[1])).solved, `power line: ${tx}`); } await r.ctx.close();
    r = await reopened('rcfilter'); tx = await text(r.page, 'rc-final');
    { const m = num(tx, /R = ([\d.]+) (MΩ|kΩ|Ω) and C = ([\d.]+) (µF|nF)/); ok(rcEval(fSpec, ohms(m[1], m[2]), farads(m[3], m[4])).solved, `RC: ${tx}`); } await r.ctx.close();
    r = await reopened('opamp'); tx = await text(r.page, 'op-final');
    { const m = num(tx, /Rf = ([\d.]+) (MΩ|kΩ|Ω) and Rg = ([\d.]+) (MΩ|kΩ|Ω)/); ok(opEval(oSpec, ohms(m[1], m[2]), ohms(m[3], m[4])).solved, `op-amp: ${tx}`); } await r.ctx.close();
    r = await reopened('aircraft'); tx = await text(r.page, 'air-final'); ok(tx.includes('A loading that works'), `aircraft: ${tx}`); await r.ctx.close();
    r = await reopened('gears'); tx = await text(r.page, 'gear-final'); ok(tx.includes('One train that works'), `gears: ${tx}`); await r.ctx.close();
  });

  await t('Engineerle follows the settings: light theme and Low CPU draw every puzzle without errors', async () => {
    useDay(DAY0);
    const { ctx, page: p, errors } = await openEn(b, { settings: { volume: 70, muted: true, theme: 'light', lowCpu: true, reduceMotion: true } });
    eq(await p.evaluate(() => document.documentElement.dataset.theme), 'light', 'light');
    for (let i = 1; i < 5; i++) { await q(p, `ens-tab-${i}`).click(); await p.locator('.ens-view canvas, .ens-view svg').first().waitFor(); await p.waitForTimeout(250); }
    eq(errors.length, 0, errors.join('|')); await ctx.close();
  });
  await t('with no WebGL at all the puzzles still play', async () => {
    useDay(dayWith('lever'));
    const { ctx, page: p, errors } = await openEn(b, { noGL: true }); await q(p, tab('lever')).click();
    await q(p, 'lever-slider').waitFor(); await solveLever(p); eq(await q(p, tab('lever')).getAttribute('data-state'), 'solved');
    eq(errors.length, 0, errors.join('|')); await ctx.close();
  });
  await t('Engineerle works on a phone-sized screen', async () => {
    useDay(dayWith('crankshaft'));
    const { ctx, page: p } = await openEn(b, { mobile: true });
    const w = await p.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]); ok(w[0] <= w[1] + 1, `no sideways scroll ${w}`);
    await q(p, tab('crankshaft')).click(); await q(p, 'crank-run').waitFor();
    const w2 = await p.evaluate(() => [document.querySelector('.ens')!.scrollWidth, window.innerWidth]); ok(w2[0] <= w2[1] + 1, `no sideways scroll on the crankshaft ${w2}`); await ctx.close();
  });

  console.log('\nSidebar, settings and the link to Obscura');
  await t('the side menu lists both games, stats, help and settings', async () => {
    useDay(DAY0);
    const { ctx, page: p, errors } = await openEn(b);
    await q(p, 'menu-btn').click(); await q(p, 'sidebar').waitFor();
    eq(await q(p, 'side-engineerle').getAttribute('aria-current'), 'page', 'current game');
    for (const id of ['side-obscura', 'side-stats', 'side-help', 'side-settings']) await q(p, id).waitFor();
    await q(p, 'side-stats').click(); await q(p, 'ens-stats-modal').waitFor(); await p.keyboard.press('Escape');
    await q(p, 'menu-btn').click(); await q(p, 'side-help').click(); await q(p, 'ens-help-modal').waitFor(); await q(p, 'ens-help-ok').click();
    await q(p, 'menu-btn').click(); await q(p, 'sidebar-scrim').click({ position: { x: 1000, y: 400 } }); await q(p, 'sidebar').waitFor({ state: 'detached' });
    eq(errors.length, 0, errors.join('|')); await ctx.close();
  });
  await t('settings: volume, sound, theme, low CPU and reduce motion are saved on this device', async () => {
    useDay(dayWith('waveform'));
    const { ctx, page: p, errors } = await openEn(b);
    await q(p, 'menu-btn').click(); await q(p, 'side-settings').click(); await q(p, 'settings-modal').waitFor();
    await q(p, 'set-volume').fill('35'); eq(await text(p, 'set-volume-label'), '35%', 'volume label');
    await q(p, 'set-sound').click(); await q(p, 'set-theme-light').click(); await q(p, 'set-lowcpu').click(); await q(p, 'set-motion').click();
    eq(await p.evaluate(() => document.documentElement.dataset.theme), 'light', 'light now');
    eq(await p.evaluate(() => document.documentElement.dataset.perf), 'low', 'low cpu now');
    await q(p, 'settings-close').click();
    await p.reload(); await q(p, tab('waveform')).waitFor();
    const saved = await p.evaluate(() => JSON.parse(localStorage.getItem('engineerle:v1:settings') ?? '{}'));
    eq(saved.volume, 35, 'volume saved'); eq(saved.muted, true, 'muted saved'); eq(saved.theme, 'light', 'theme saved'); eq(saved.lowCpu, true, 'low cpu saved'); eq(saved.reduceMotion, false, 'motion saved (it started on, following the device, and was switched off)');
    eq(await p.evaluate(() => document.documentElement.dataset.theme), 'light', 'theme kept after reload');
    eq(errors.length, 0, errors.join('|')); await ctx.close();
  });
  await t('the Obscura links carry the player\'s settings in the address', async () => {
    useDay(DAY0);
    const { ctx, page: p } = await openEn(b, { settings: { volume: 40, muted: true, theme: 'light', lowCpu: true, reduceMotion: false } });
    await q(p, 'menu-btn').click();
    const href = (await q(p, 'side-obscura').getAttribute('href')) ?? '';
    ok(/^https?:\/\/[^/]+\/\?s=40\.1\.light\.1\.0$/.test(href), `sidebar link: ${href}`);
    await ctx.close();
  });
  await t('arriving from Obscura with settings in the address adopts them once and tidies the address', async () => {
    useDay(DAY0);
    const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce', timezoneId: 'UTC' });
    const p = await ctx.newPage(); p.setDefaultTimeout(20_000);
    await p.goto(PROD + '?lite&s=20.1.light.1.1');
    await q(p, 'ens-help-modal').waitFor();
    eq(await p.evaluate(() => document.documentElement.dataset.theme), 'light', 'theme adopted');
    eq(await p.evaluate(() => document.documentElement.dataset.perf), 'low', 'low cpu adopted');
    const saved = await p.evaluate(() => JSON.parse(localStorage.getItem('engineerle:v1:settings') ?? '{}'));
    eq(saved.volume, 20, 'volume adopted'); eq(saved.muted, true, 'muted adopted');
    ok(!(await p.evaluate(() => location.search)).includes('s='), 'address tidied');
    await ctx.close();
  });
  await t('a damaged settings link is ignored', async () => {
    useDay(DAY0);
    const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce', timezoneId: 'UTC' });
    const p = await ctx.newPage(); p.setDefaultTimeout(20_000);
    await p.goto(PROD + '?lite&s=999.9.pink.x.y');
    await q(p, 'ens-help-modal').waitFor();
    const saved = await p.evaluate(() => localStorage.getItem('engineerle:v1:settings'));
    ok(saved === null || JSON.parse(saved).theme !== 'pink', 'bad value not stored');
    ok(!(await p.evaluate(() => location.search)).includes('s='), 'address tidied');
    await ctx.close();
  });

  await b.close(); servers.forEach((s) => s.kill());
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); servers.forEach((s) => s.kill()); process.exit(1); });
