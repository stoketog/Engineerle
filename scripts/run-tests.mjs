/**
 * Runs every unit test file (tests/*.test.ts) with tsx, one after another, and stops at the first failure.
 *   node scripts/run-tests.mjs [name-fragment]
 */
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'tests');
const only = process.argv[2];
const files = readdirSync(dir)
  .filter((f) => f.endsWith('.test.ts') && (!only || f.includes(only)))
  .sort();
if (files.length === 0) {
  console.error('no test files found');
  process.exit(1);
}
let total = 0;
for (const f of files) {
  console.log(`\n== ${f}`);
  const r = spawnSync('npx', ['tsx', join('tests', f)], { cwd: root, stdio: 'inherit' });
  if (r.status !== 0) {
    console.error(`\nFAILED: ${f}`);
    process.exit(r.status ?? 1);
  }
  total++;
}
console.log(`\nall ${total} test files passed`);
