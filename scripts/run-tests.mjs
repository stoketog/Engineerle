/** Runs every tests/*.test.ts with tsx, one after another; stops at the first failure. */
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const files = readdirSync(join(root, 'tests')).filter((f) => f.endsWith('.test.ts')).sort();
if (files.length === 0) {
  console.error('no tests/*.test.ts files found');
  process.exit(1);
}
for (const f of files) {
  console.log(`\n== ${f}`);
  const r = spawnSync('npx', ['tsx', join('tests', f)], { cwd: root, stdio: 'inherit' });
  if (r.status !== 0) {
    console.error(`\nFAILED: ${f}`);
    process.exit(r.status ?? 1);
  }
}
console.log(`\nall ${files.length} test file(s) passed`);
