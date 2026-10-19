/**
 * End-to-end browser tests (Playwright + Chromium) against the static build in dist.
 *   node scripts/build.mjs && npm run test:e2e
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
let gSpec!: GraphSpec, lSpec!: LeverSpec, bSpec!: BridgeSpec, cSpec!: CrankshaftSpec, aSpec!: BargeSpec, rSpec!: CircuitSpec;
let cBest: number[] = [], cPoor: number[] = [], leverAnswer = 0, wrongPivot = 0, bargeAnswer: number[] = [];
function useDay(day: string) {
  DAY = day; en = getEngineerleDaily(day);
  gSpec = specOf('waveform') as GraphSpec; lSpec = specOf('lever') as LeverSpec; bSpec = specOf('bridge') as BridgeSpec;
  cSpec = specOf('crankshaft') as CrankshaftSpec; aSpec = specOf('barge') as BargeSpec; rSpec = specOf('resistor') as CircuitSpec;
  if (lSpec) { leverAnswer = Math.round(lSpec.answer * 20) / 20; wrongPivot = Math.abs(leverAnswer - -3.5) > 1.5 ? -3.5 : 3.5; }
  if (cSpec) { cBest = bestResiduals(cSpec).orders[0]; cPoor = Array.from({ length: cSpec.n }, (_, i) => i + 1); }
  if (aSpec) bargeAnswer = bargeSolutions(aSpec, 10, 1)[0];
}
useDay(DAY0);

async function openEn(b: Browser, opts: { mobile?: boolean; settings?: Record<string, unknown>; noGL?: boolean; url?: string; skipHelp?: boolean } = {}) {
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
async function solveLever(p: Page) { await q(p, 'lever-slider').fill(String(leverAnswer)); await q(p, 'lever-release').click(); await q(p, 'lever-final').waitFor(); }
async function solveBridge(p: Page) { for (const i of bSpec.weak) await q(p, `bridge-m-${i}`).click(); await q(p, 'bridge-test').click(); await q(p, 'bridge-final').waitFor(); }
async function pickOrder(p: Page, order: number[]) { for (const c of order) await q(p, `crank-cyl-${c}`).click(); }
async function solveCrank(p: Page) { await pickOrder(p, cBest); await q(p, 'crank-run').click(); await q(p, 'crank-final').waitFor(); }
async function solveResistor(p: Page) {
  const dial = dialValues(); const idx = dial.findIndex((o) => circuitEval(rSpec, o).solved);
  await q(p, 'circuit-dial').fill(String(idx)); await q(p, 'circuit-test').click(); await q(p, 'circuit-final').waitFor();
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
    const { ctx, page: p, errors } = await openEn(b);
    const solvers: Record<string, () => Promise<void>> = {
      waveform: async () => { await q(p, 'graph-input').fill(gSpec.answer); await q(p, 'graph-submit').click(); await q(p, 'graph-final').waitFor(); },
      lever: () => solveLever(p), bridge: () => solveBridge(p), crankshaft: () => solveCrank(p), barge: () => solveBarge(p), resistor: () => solveResistor(p),
    };
    for (const { def } of en.puzzles) { await solvers[def.id](); await q(p, 'ens-next').click(); }
    await q(p, 'ens-summary').waitFor(); ok(/^https?:\/\/[^/]+\/\?s=\d+\.[01]\.(auto|dark|light)\.[01]\.[01]$/.test((await q(p, 'ens-to-obscura').getAttribute('href')) ?? ''), 'results link to Obscura carries settings'); ok((await text(p, 'ens-points')).startsWith('500'), '500 points'); ok((await text(p, 'ens-squares')).includes('🟩🟩🟩🟩🟩') || (await text(p, 'ens-squares')).replace(/\s/g, '') === '🟩🟩🟩🟩🟩', 'all green');
    await q(p, 'ens-share').click(); await p.waitForTimeout(300);
    const clip = await p.evaluate(() => navigator.clipboard.readText()).catch(() => '');
    ok(clip === '' || (clip.startsWith(`Engineerle #${en.number}  500/500`) && clip.includes('🟩🟩🟩🟩🟩')), `share text: ${clip}`);
    await p.reload(); await q(p, 'ens-summary').waitFor(); ok((await text(p, 'ens-points')).startsWith('500'), 'kept after reload');
    await q(p, 'ens-stats-btn').click(); await q(p, 'ens-stats-modal').waitFor(); ok((await text(p, 'ens-stats-modal')).includes('Perfect days'), 'stats');
    eq(errors.length, 0, errors.join('|')); await ctx.close();
  });
  await t('Engineerle follows the settings: light theme and Low CPU draw every puzzle without errors', async () => {
    useDay(DAY0);
    const { ctx, page: p, errors } = await openEn(b, { settings: { volume: 70, muted: true, theme: 'light', lowCpu: true, reduceMotion: true } });
    eq(await p.evaluate(() => document.documentElement.dataset.theme), 'light', 'light');
    for (let i = 1; i < 5; i++) { await q(p, `ens-tab-${i}`).click(); await p.locator('.ens-view canvas').waitFor(); await p.waitForTimeout(250); }
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
