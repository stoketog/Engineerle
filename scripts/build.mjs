/**
 * Local static build (no Next.js required).
 *
 * The product is a standard Next.js App Router project (see /app). This script
 * produces an equivalent static bundle from the SAME components so the site can
 * be built, served and browser-tested where `next` can't be installed.
 *
 */
import { build } from 'esbuild';
import { compile } from 'tailwindcss';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, rmSync, cpSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, process.env.ENGINEERLE_OUT || 'dist');

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

// 1) JS bundle
await build({
  entryPoints: [join(root, 'src/harness/main.tsx')],
  bundle: true,
  minify: true,
  sourcemap: false,
  format: 'esm',
  target: 'es2022',
  outfile: join(dist, 'app.js'),
  jsx: 'automatic',
  define: {
    'process.env.NODE_ENV': '"production"',
    'process.env.NEXT_PUBLIC_OBSCURA_URL': JSON.stringify(process.env.NEXT_PUBLIC_OBSCURA_URL || ''),
  },
  logLevel: 'info',
});

// 2) Tailwind v4 (compile API + simple class-candidate scanner)
function walk(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|css|html)$/.test(f)) out.push(p);
  }
  return out;
}
const files = [...walk(join(root, 'src')), ...walk(join(root, 'app'))];
const candidates = new Set();
for (const f of files) {
  const text = readFileSync(f, 'utf8');
  for (const m of text.matchAll(/[^\s"'`<>{}()=,;]+/g)) candidates.add(m[0]);
}
const css = readFileSync(join(root, 'app/globals.css'), 'utf8');
const twDir = join(root, 'node_modules/tailwindcss');
const compiler = await compile(css, {
  base: root,
  onDependency: () => {},
  loadStylesheet: async (id, base) => {
    let path;
    if (id === 'tailwindcss') path = join(twDir, 'index.css');
    else if (id.startsWith('tailwindcss/')) path = join(twDir, id.slice('tailwindcss/'.length) + (id.endsWith('.css') ? '' : '.css'));
    else path = resolve(base, id);
    return { path, base: dirname(path), content: readFileSync(path, 'utf8') };
  },
});
writeFileSync(join(dist, 'styles.css'), compiler.build([...candidates]));

// 3) HTML shell + public assets
if (existsSync(join(root, 'public'))) cpSync(join(root, 'public'), dist, { recursive: true });
writeFileSync(
  join(dist, 'index.html'),
  `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="theme-color" content="#06131f" />
<title>Engineerle — five daily engineering puzzles</title>
<meta name="description" content="Read the graph, find the fulcrum, save the bridge, balance the engine, trim the barge. Five new engineering puzzles every day." />
<link rel="icon" href="/icon.svg" type="image/svg+xml" />
<link rel="stylesheet" href="/styles.css" />
</head>
<body>
<div id="root"></div>
<script type="module" src="/app.js"></script>
</body>
</html>
`,
);
console.log(`built -> ${dist}`);
