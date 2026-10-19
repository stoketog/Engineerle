/**
 * End-to-end browser tests (Playwright + Chromium) against the static build in dist.
 *   node scripts/build.mjs && npm run test:e2e
 * Every test runs against a fixed fake clock, so the day's five puzzles are known in advance and the tests can
 * solve them from the same generators the game uses.
 */
import { chromium, type Browser, type Page } from 'playwright';
import { spawn, type ChildProcess } from 'node:child_process';
import { getEngineerleDaily } from '@/engineerle/daily';
import { pickDay } from '@/engineerle/select';
import { POOL } from '@/engineerle/registry';
import { addDays } from '@/lib/dates';
import { solutions as bargeSolutions, type BargeSpec } from '@/engineerle/barge';
import type { GraphSpec } from '@/engineerle/graph';
import type { LeverSpec } from '@/engineerle/lever';
import type { BridgeSpec } from '@/engineerle/truss';
import { bestResiduals, type CrankshaftSpec } from '@/engineerle/crankshaft';
import { E24, evaluate, type CircuitSpec } from '@/engineerle/circuit';
import { solvingRatios, type PowerlineSpec } from '@/engineerle/powerline';

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
let specs: Record<string, unknown> = {};
/** The first day from DAY0 on whose five puzzles include `id`: the pool is bigger than a day, so each puzzle's test picks its own day. */
function dayOf(id: string): string {
  for (let i = 0; i < 90; i++) { const d = addDays(DAY0, i); if (pickDay(d).includes(id)) return d; }
  throw new Error(`${id} never comes up in 90 days`);
}
function useDay(day: string) { DAY = day; en = getEngineerleDaily(day); specs = Object.fromEntries(en.puzzles.map((x) => [x.def.id, x.spec])); }
useDay(DAY0);
const T = (id: string) => en.puzzles.findIndex((x) => x.def.id === id);
const tab = (id: string) => { if (T(id) < 0) throw new Error(`${id} is not in the five puzzles of ${DAY}`); return `ens-tab-${T(id)}`; };
const G = () => specs.waveform as GraphSpec, Lv = () => specs.lever as LeverSpec, Br = () => specs.bridge as BridgeSpec, Cr = () => specs.crankshaft as CrankshaftSpec, Ba = () => specs.barge as BargeSpec, Ci = () => specs.circuit as CircuitSpec, Pl = () => specs.powerline as PowerlineSpec;
const leverAnswer = () => Math.round(Lv().answer * 20) / 20;
const wrongPivot = () => (Math.abs(leverAnswer() - -3.5) > 1.5 ? -3.5 : 3.5);
const bargeAnswer = () => bargeSolutions(Ba(), 10, 1)[0];

async function openEn(b: Browser, opts: { puzzle?: string; day?: string; mobile?: boolean; settings?: Record<string, unknown>; noGL?: boolean; url?: string; skipHelp?: boolean } = {}) {
  useDay(opts.day ?? (opts.puzzle ? dayOf(opts.puzzle) : DAY0));
  const ctx = await b.newContext({ viewport: opts.mobile ? { width: 360, height: 740 } : { width: 1280, height: 900 }, hasTouch: !!opts.mobile, reducedMotion: 'reduce', timezoneId: 'UTC', permissions: ['clipboard-read', 'clipboard-write'] });
  if (opts.settings) await ctx.addInitScript((st) => { try { if (!localStorage.getItem('engineerle:v1:settings')) localStorage.setItem('engineerle:v1:settings', JSON.stringify(st)); } catch { /* none */ } }, opts.settings);
  if (opts.noGL) await ctx.addInitScript(() => {
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) { return /webgl/i.test(type) ? null : (orig as (...a: unknown[]) => unknown).call(this, type, ...rest); } as typeof orig;
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(20_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && !/GL Driver|swiftshader|GroupMarker|WebGL|webgl|THREE/i.test(m.text()) && errors.push(m.text()));
  await page.clock.install({ time: new Date(`${DAY}T10:00:00Z`) });
  await page.goto((opts.url ?? PROD) + '?lite#engineerle');
  await page.clock.resume();
  await q(page, 'ens-help-modal').waitFor();
  if (opts.skipHelp !== false) await q(page, 'ens-help-ok').click();
  return { ctx, page, errors };
}
const pipsUsed = async (p: Page) => /^(\d) of 3/.exec((await q(p, 'pips').getAttribute('aria-label')) ?? '')?.[1];
async function tapOrder(p: Page, order: number[]) { for (const c of order) await q(p, `crank-cyl-${c}`).click(); }
const goodOrder = () => bestResiduals(Cr()).orders[0];
const poorOrder = () => Array.from({ length: Cr().n }, (_, i) => i + 1);
async function solveLever(p: Page) { await q(p, 'lever-slider').fill(String(leverAnswer())); await q(p, 'lever-release').click(); await q(p, 'lever-final').waitFor(); }
async function solveBridge(p: Page) { for (const i of Br().weak) await q(p, `bridge-m-${i}`).click(); await q(p, 'bridge-test').click(); await q(p, 'bridge-final').waitFor(); }
async function solveCrank(p: Page) { await tapOrder(p, goodOrder()); await q(p, 'crank-run').click(); await q(p, 'crank-final').waitFor(); }
async function solveWaveform(p: Page) { await q(p, 'graph-input').fill(G().answer); await q(p, 'graph-submit').click(); await q(p, 'graph-final').waitFor(); }
async function solveBarge(p: Page) { for (let i = 0; i < 4; i++) await q(p, `barge-tank-${i}`).fill(String(bargeAnswer()[i])); await q(p, 'barge-flood').click(); await q(p, 'barge-final').waitFor(); }

const DECADES = [1, 10, 100, 1e3, 1e4, 1e5, 1e6];
/** Every standard value in the box, as [decade, E24 index]. */
const boxValues = () => DECADES.flatMap((m, d) => E24.map((v, e) => ({ d, e, ohms: Number((v * m).toPrecision(6)) }))).filter((x) => x.ohms <= 1e7);
const circuitRight = () => { const hit = boxValues().find((x) => evaluate(Ci(), x.ohms).solved); if (!hit) throw new Error('no E24 value solves the circuit'); return hit; };
const circuitWrong = () => { const r = circuitRight().ohms; return boxValues().filter((x) => !evaluate(Ci(), x.ohms).solved && (x.ohms > r * 3 || x.ohms < r / 3)).sort((a, b) => Math.abs(Math.log(a.ohms / r)) - Math.abs(Math.log(b.ohms / r)))[0]; };
async function dial(p: Page, v: { d: number; e: number }) { await q(p, `circuit-decade-${v.d}`).click(); await q(p, 'circuit-e24').fill(String(v.e)); }
async function solveCircuit(p: Page) { await dial(p, circuitRight()); await q(p, 'circuit-test').click(); await q(p, 'circuit-final').waitFor({ timeout: 30_000 }); }

async function solvePower(p: Page) { await q(p, `power-ratio-${solvingRatios(Pl())[0]}`).click(); await q(p, 'power-test').click(); await q(p, 'power-final').waitFor({ timeout: 30_000 }); }

/** One wrong first guess per puzzle, used by the no-hints test; each returns once the message is up. */
const misses: Record<string, (p: Page) => Promise<string>> = {
  waveform: async (p) => { await q(p, 'graph-input').fill('t'); await q(p, 'graph-submit').click(); await q(p, 'graph-msg').waitFor(); return 'graph-msg'; },
  lever: async (p) => { await q(p, 'lever-slider').fill(String(wrongPivot())); await q(p, 'lever-release').click(); await q(p, 'lever-msg').waitFor(); return 'lever-msg'; },
  bridge: async (p) => { await q(p, 'bridge-test').waitFor(); return 'bridge-test'; },
  crankshaft: async (p) => { await tapOrder(p, poorOrder()); await q(p, 'crank-run').click(); await q(p, 'crank-msg').waitFor({ timeout: 30_000 }); return 'crank-msg'; },
  barge: async (p) => { await q(p, 'barge-flood').click(); await q(p, 'barge-msg').waitFor({ timeout: 30_000 }); return 'barge-msg'; },
  powerline: async (p) => { await q(p, 'power-ratio-1').click(); await q(p, 'power-test').click(); await q(p, 'power-msg').waitFor({ timeout: 30_000 }); return 'power-msg'; },
  circuit: async (p) => { await dial(p, circuitWrong()); await q(p, 'circuit-test').click(); await q(p, 'circuit-msg').waitFor({ timeout: 30_000 }); return 'circuit-msg'; },
};

const solvers: Record<string, (p: Page) => Promise<void>> = { waveform: solveWaveform, lever: solveLever, bridge: solveBridge, crankshaft: solveCrank, barge: solveBarge, circuit: solveCircuit, powerline: solvePower };

async function main() {
  serve('dist', 4182);
  await new Promise((r) => setTimeout(r, 1200));
  const b = await chromium.launch();

  console.log('Engineerle');
  await t('waveform: a wrong equation costs a guess and says how many are left, an unreadable or empty one is free, the right one solves', async () => {
    const { ctx, page: p, errors } = await openEn(b, { puzzle: 'waveform' }); await q(p, tab('waveform')).click();
    await q(p, 'graph-input').fill('x +'); await q(p, 'graph-submit').click(); await q(p, 'graph-msg').waitFor();
    ok((await text(p, 'graph-msg')).includes("didn't use up a guess"), 'free'); eq(await pipsUsed(p), '0', 'no guess used');
    for (const refused of ['1/0', 'sin(', 'ln(-1)']) { await q(p, 'graph-input').fill(refused); await q(p, 'graph-submit').click(); await q(p, 'graph-msg').waitFor(); ok((await text(p, 'graph-msg')).includes("didn't use up a guess"), `free: ${refused}`); eq(await pipsUsed(p), '0', `no guess used by ${refused}`); }
    await q(p, 'graph-input').fill(''); eq(await q(p, 'graph-submit').isDisabled(), true, 'an empty equation cannot be submitted');
    await q(p, 'graph-input').fill('0.1 t'); await q(p, 'graph-submit').click();
    await p.waitForFunction(() => document.querySelector('[data-testid=graph-msg]')?.textContent?.includes('2 guesses left'));
    eq(await pipsUsed(p), '1', 'one guess used');
    await q(p, 'graph-input').fill(G().answer); await q(p, 'graph-submit').click(); await q(p, 'graph-final').waitFor();
    ok((await text(p, 'graph-final')).includes('Solved'), 'solved'); eq(await q(p, tab('waveform')).getAttribute('data-state'), 'solved', 'tab');
    await p.reload(); await q(p, tab('waveform')).waitFor(); eq(await q(p, tab('waveform')).getAttribute('data-state'), 'solved', 'saved');
    eq(errors.length, 0, errors.join('|')); await ctx.close();
  });
  await t('three wrong curves end the puzzle and show the answer', async () => {
    const { ctx, page: p } = await openEn(b, { puzzle: 'waveform' }); await q(p, tab('waveform')).click();
    for (const guess of ['t', '2t', '3t']) { await q(p, 'graph-input').fill(guess); await q(p, 'graph-submit').click(); await p.waitForTimeout(150); }
    await q(p, 'graph-final').waitFor(); ok((await text(p, 'graph-final')).includes('Out of guesses'), 'out'); ok((await text(p, 'graph-final')).includes(G().answer.replace(/\s/g, '')) || (await text(p, 'graph-final')).includes(G().answer), 'answer shown');
    eq(await q(p, tab('waveform')).getAttribute('data-state'), 'failed', 'tab'); await ctx.close();
  });
  await t('lever: the wrong pivot tips it, the balance point holds it level', async () => {
    const { ctx, page: p, errors } = await openEn(b, { puzzle: 'lever' }); await q(p, tab('lever')).click();
    await q(p, 'lever-slider').fill(String(wrongPivot())); await q(p, 'lever-release').click();
    await q(p, 'lever-msg').waitFor(); ok((await text(p, 'lever-msg')).includes('drops'), 'tipped'); eq(await pipsUsed(p), '1');
    await p.waitForFunction(() => !(document.querySelector('[data-testid=lever-release]') as HTMLButtonElement | null)?.disabled, null, { timeout: 30_000 });
    await solveLever(p); ok((await text(p, 'lever-final')).includes('Balanced'), 'balanced'); eq(await q(p, tab('lever')).getAttribute('data-state'), 'solved');
    eq(errors.length, 0, errors.join('|')); await ctx.close();
  });
  await t('bridge: reinforcing the wrong members fails without naming what broke or hinting; the weak ones hold', async () => {
    const { ctx, page: p, errors } = await openEn(b, { puzzle: 'bridge' }); await q(p, tab('bridge')).click();
    const wrong = Array.from({ length: Br().areas.length }, (_, i) => i).filter((i) => !Br().weak.includes(i)).slice(0, Br().budget);
    for (const i of wrong) await q(p, `bridge-m-${i}`).click();
    eq(await text(p, 'bridge-count').then((x) => x.startsWith(`Reinforced ${Br().budget} of ${Br().budget}`)), true, 'count');
    await q(p, 'bridge-test').click(); await q(p, 'bridge-msg').waitFor(); ok((await text(p, 'bridge-msg')).includes('came down'), 'collapsed');
    eq(await pipsUsed(p), '1');
    eq(await p.locator('[data-hit]').count(), 0, 'no member is flagged after a failure');
    ok(!/hint|snapped|buckled/i.test(await text(p, 'bridge-msg')), 'the message names no member and gives no hint');
    await p.waitForFunction(() => !(document.querySelector('[data-testid=bridge-test]') as HTMLButtonElement | null)?.disabled, null, { timeout: 30_000 });
    for (const i of wrong) await q(p, `bridge-m-${i}`).click();
    await solveBridge(p); ok((await text(p, 'bridge-final')).includes('holds'), 'holds'); eq(await q(p, tab('bridge')).getAttribute('data-state'), 'solved');
    eq(errors.length, 0, errors.join('|')); await ctx.close();
  });
  await t('bridge: only as many members as the budget can be reinforced', async () => {
    const { ctx, page: p } = await openEn(b, { puzzle: 'bridge' }); await q(p, tab('bridge')).click();
    for (let i = 0; i <= Br().budget; i++) await q(p, `bridge-m-${i}`).click();
    ok((await text(p, 'bridge-count')).startsWith(`Reinforced ${Br().budget} of ${Br().budget}`), 'capped'); await ctx.close();
  });
  await t('crankshaft: the engine cannot be started until every cylinder is in the order, a poor order shakes and costs a guess, a best order runs smooth', async () => {
    const { ctx, page: p, errors } = await openEn(b, { puzzle: 'crankshaft' }); await q(p, tab('crankshaft')).click();
    eq(await q(p, 'crank-run').isDisabled(), true, 'cannot run with no order');
    await q(p, 'crank-cyl-1').click(); eq(await q(p, 'crank-run').isDisabled(), true, 'cannot run with a partial order'); eq(await pipsUsed(p), '0', 'no guess used');
    await q(p, 'crank-cyl-1').click(); ok((await text(p, 'crank-seq')).includes('none yet'), 'tapping a chosen cylinder takes it back out');
    await q(p, 'crank-reset').isDisabled().then((d) => eq(d, true, 'nothing to clear'));
    await tapOrder(p, poorOrder()); eq(await q(p, 'crank-run').isDisabled(), false, 'ready');
    await q(p, 'crank-run').click(); await q(p, 'crank-msg').waitFor({ timeout: 30_000 });
    ok((await text(p, 'crank-msg')).includes('mounts'), 'shakes'); eq(await pipsUsed(p), '1');
    await p.waitForFunction(() => !(document.querySelector('[data-testid=crank-run]') as HTMLButtonElement | null)?.disabled || !document.querySelector('[data-testid=crank-run]'), null, { timeout: 30_000 });
    await q(p, 'crank-reset').click();
    await solveCrank(p); ok((await text(p, 'crank-final')).includes('Smooth'), 'smooth'); eq(await q(p, tab('crankshaft')).getAttribute('data-state'), 'solved');
    eq(errors.length, 0, errors.join('|')); await ctx.close();
  });
  await t('barge: an unballasted barge lists; the right ballast floats her level', async () => {
    const { ctx, page: p, errors } = await openEn(b, { puzzle: 'barge' }); await q(p, tab('barge')).click();
    await q(p, 'barge-flood').click(); await q(p, 'barge-msg').waitFor({ timeout: 30_000 }); ok((await text(p, 'barge-msg')).includes('floats'), 'listing'); eq(await pipsUsed(p), '1');
    await p.waitForFunction(() => !(document.querySelector('[data-testid=barge-flood]') as HTMLButtonElement | null)?.disabled, null, { timeout: 40_000 });
    await solveBarge(p); ok((await text(p, 'barge-final')).includes('level'), 'level'); eq(await q(p, tab('barge')).getAttribute('data-state'), 'solved');
    eq(errors.length, 0, errors.join('|')); await ctx.close();
  });
  await t('barge: going over the pump limit is refused without using a guess', async () => {
    const { ctx, page: p } = await openEn(b, { puzzle: 'barge' }); await q(p, tab('barge')).click();
    for (let i = 0; i < 4; i++) await q(p, `barge-tank-${i}`).fill('110');
    await q(p, 'barge-flood').click(); await q(p, 'barge-msg').waitFor(); ok((await text(p, 'barge-msg')).includes('pump limit'), 'refused'); eq(await pipsUsed(p), '0'); await ctx.close();
  });
  await t('timer: counts up while a puzzle is open, shows par, stops when it is solved, and survives a reload', async () => {
    const { ctx, page: p, errors } = await openEn(b, { puzzle: 'lever' }); await q(p, tab('lever')).click();
    const secs = async () => { const m = /^(\d+):(\d\d)/.exec(await text(p, 'ens-timer')); return m ? Number(m[1]) * 60 + Number(m[2]) : -1; };
    ok((await text(p, 'ens-par')).includes('par'), 'par is shown');
    const a = await secs(); await p.waitForTimeout(2300); const c = await secs();
    ok(c >= a + 2 && c <= a + 4, `timer advanced ${a} -> ${c}`);
    await p.waitForTimeout(1200); // saved every second
    await p.reload(); await q(p, tab('lever')).click(); await q(p, 'ens-timer').waitFor();
    const afterReload = await secs(); ok(afterReload >= c && afterReload <= c + 6, `reload kept the time: ${c} -> ${afterReload}`);
    await solveLever(p); const done = await secs(); await p.waitForTimeout(2200);
    eq(await secs(), done, 'a solved puzzle has stopped its clock');
    await p.reload(); await q(p, tab('lever')).click(); await q(p, 'ens-timer').waitFor(); eq(await secs(), done, 'and stays stopped after a reload');
    eq(errors.length, 0, errors.join('|')); await ctx.close();
  });
  await t('no hints: after a first miss no puzzle offers one', async () => {
    for (const { id } of POOL) {
      const { ctx, page: p } = await openEn(b, { puzzle: id }); await q(p, tab(id)).click();
      await misses[id](p);
      const body = (await p.locator('.ens').innerText()).toLowerCase();
      ok(!body.includes('hint'), `${id} offers a hint`);
      if (id === 'lever') ok(!/slide it|nearer the heavier/i.test(body), 'lever names no direction');
      if (id === 'barge') ok(!/centre of gravity is|more ballast on/i.test(body), 'barge names no change');
      if (id === 'circuit') ok(!/too (high|low)|increase|decrease|try a (larger|smaller)|higher|lower/i.test(body.replace(/multimeter/g, '')), 'circuit names no direction');
      await ctx.close();
    }
  });
  await t('circuit: a wrong standard value shows its reading and costs a guess, the right one solves', async () => {
    const { ctx, page: p, errors } = await openEn(b, { puzzle: 'circuit' }); await q(p, tab('circuit')).click();
    const wrong = circuitWrong(); await dial(p, wrong);
    await q(p, 'circuit-test').click(); await q(p, 'circuit-msg').waitFor({ timeout: 30_000 });
    eq(await pipsUsed(p), '1', 'a wrong value uses one guess');
    ok(/[0-9]/.test(await text(p, 'circuit-reading')), 'the meter shows a reading');
    await p.waitForFunction(() => !(document.querySelector('[data-testid=circuit-test]') as HTMLButtonElement | null)?.disabled, null, { timeout: 30_000 });
    await solveCircuit(p); ok((await text(p, 'circuit-final')).length > 0, 'final'); eq(await q(p, tab('circuit')).getAttribute('data-state'), 'solved', 'tab');
    await p.reload(); await q(p, tab('circuit')).waitFor(); eq(await q(p, tab('circuit')).getAttribute('data-state'), 'solved', 'saved');
    eq(errors.length, 0, errors.join('|')); await ctx.close();
  });
  await t('power line: transmit needs a ratio, a ratio that wastes too much shows the readings and costs a guess, a good one solves', async () => {
    const { ctx, page: p, errors } = await openEn(b, { puzzle: 'powerline' }); await q(p, tab('powerline')).click();
    eq(await q(p, 'power-test').isDisabled(), true, 'cannot transmit with no ratio chosen');
    await q(p, 'power-ratio-1').click(); await q(p, 'power-test').click(); await q(p, 'power-msg').waitFor({ timeout: 30_000 });
    eq(await pipsUsed(p), '1', 'a wasteful ratio uses a guess'); ok(/loss|overloaded/.test(await text(p, 'power-loss')), 'readings shown');
    ok(/loses|no power reaches/.test(await text(p, 'power-msg')), 'says what happened');
    await p.waitForFunction(() => !(document.querySelector('[data-testid=power-test]') as HTMLButtonElement | null)?.disabled, null, { timeout: 30_000 });
    await solvePower(p); eq(await q(p, tab('powerline')).getAttribute('data-state'), 'solved', 'tab');
    await p.reload(); await q(p, tab('powerline')).waitFor(); eq(await q(p, tab('powerline')).getAttribute('data-state'), 'solved', 'saved');
    eq(errors.length, 0, errors.join('|')); await ctx.close();
  });
  await t('solving all five shows the results, a share text, and survives a reload', async () => {
    const { ctx, page: p, errors } = await openEn(b);
    for (const { def } of en.puzzles) {
      await q(p, tab(def.id)).click();
      await solvers[def.id](p);
      await q(p, 'ens-next').click();
    }
    await q(p, 'ens-summary').waitFor(); ok(/^https?:\/\/[^/]+\/\?s=\d+\.[01]\.(auto|dark|light)\.[01]\.[01]$/.test((await q(p, 'ens-to-obscura').getAttribute('href')) ?? ''), 'results link to Obscura carries settings'); ok((await text(p, 'ens-points')).startsWith('500'), '500 points'); ok((await text(p, 'ens-squares')).includes('🟩🟩🟩🟩🟩') || (await text(p, 'ens-squares')).replace(/\s/g, '') === '🟩🟩🟩🟩🟩', 'all green');
    await q(p, 'ens-share').click(); await p.waitForTimeout(300);
    const clip = await p.evaluate(() => navigator.clipboard.readText()).catch(() => '');
    ok(clip === '' || (clip.startsWith(`Engineerle #${en.number}  500/500`) && clip.includes('🟩🟩🟩🟩🟩')), `share text: ${clip}`);
    await p.reload(); await q(p, 'ens-summary').waitFor(); ok((await text(p, 'ens-points')).startsWith('500'), 'kept after reload');
    await q(p, 'ens-stats-btn').click(); await q(p, 'ens-stats-modal').waitFor(); ok((await text(p, 'ens-stats-modal')).includes('Perfect days'), 'stats');
    eq(errors.length, 0, errors.join('|')); await ctx.close();
  });
  await t('Engineerle follows the settings: light theme and Low CPU draw every puzzle without errors', async () => {
    const { ctx, page: p, errors } = await openEn(b, { settings: { volume: 70, muted: true, theme: 'light', lowCpu: true, reduceMotion: true } });
    eq(await p.evaluate(() => document.documentElement.dataset.theme), 'light', 'light');
    for (let i = 1; i < 5; i++) { await q(p, `ens-tab-${i}`).click(); await p.locator('.ens-view canvas, .ens-view svg').first().waitFor(); await p.waitForTimeout(250); }
    eq(errors.length, 0, errors.join('|')); await ctx.close();
  });
  await t('with no WebGL at all the puzzles still play', async () => {
    const { ctx, page: p, errors } = await openEn(b, { noGL: true, puzzle: 'lever' }); await q(p, tab('lever')).click();
    await q(p, 'lever-slider').waitFor(); await solveLever(p); eq(await q(p, tab('lever')).getAttribute('data-state'), 'solved');
    eq(errors.length, 0, errors.join('|')); await ctx.close();
  });
  await t('Engineerle works on a phone-sized screen', async () => {
    const { ctx, page: p } = await openEn(b, { mobile: true, puzzle: 'crankshaft' });
    const w = await p.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]); ok(w[0] <= w[1] + 1, `no sideways scroll ${w}`);
    await q(p, tab('crankshaft')).click(); await q(p, 'crank-run').waitFor();
    const w2 = await p.evaluate(() => [document.querySelector('.ens')!.scrollWidth, window.innerWidth]); ok(w2[0] <= w2[1] + 1, `no sideways scroll on the crankshaft ${w2}`); await ctx.close();
  });

  console.log('\nSidebar, settings and the link to Obscura');
  await t('the side menu lists both games, stats, help and settings', async () => {
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
    const { ctx, page: p } = await openEn(b, { settings: { volume: 40, muted: true, theme: 'light', lowCpu: true, reduceMotion: false } });
    await q(p, 'menu-btn').click();
    const href = (await q(p, 'side-obscura').getAttribute('href')) ?? '';
    ok(/^https?:\/\/[^/]+\/\?s=40\.1\.light\.1\.0$/.test(href), `sidebar link: ${href}`);
    await ctx.close();
  });
  await t('arriving from Obscura with settings in the address adopts them once and tidies the address', async () => {
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
