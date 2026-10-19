# Engineerle

Five engineering puzzles a day, the same for everyone, each with real physics behind it.

1. **Curve** – read the graph and type the equation.
2. **Lever** – slide the pivot under a loaded plank until it hangs level.
3. **Bridge** – find the members that are too thin, then send the truck over.
4. **Engine** – set the crank throws so the forces and couples cancel.
5. **Barge** – balance her with ballast so she floats upright and level.

Three guesses each: 100, 65 or 35 points for a solve on the first, second or third (500 a day at most).
Progress, streaks and settings are stored in the browser (`localStorage`); there is no server.

Sister site: **Obscura**, a daily game about the obscure. The side menu of each links to the other and carries the
player's settings across (`?s=` in the address, read once and removed).

## Run it

```bash
npm install
npm run dev            # Next.js dev server
npm run build          # static export (output: 'export')
npm test               # physics and generator tests
npm run build:static && npm run test:e2e   # browser tests (Playwright + Chromium)
```

`npm run build:static` is a Next-free esbuild + Tailwind build of the same components, used for fast local and CI
browser tests. Vercel uses the normal Next.js build.

Set `NEXT_PUBLIC_OBSCURA_URL` (build time) to point the Obscura links at its own domain.

## Layout

| Path | What |
| --- | --- |
| `src/engineerle/` | Pure physics and puzzle generators: expression parser, lever, truss FEM, crankshaft balance, hydrostatics, daily seed, saved progress |
| `src/components/` | The app, the five puzzle screens, the shared 3D `Stage`, sidebar, settings, modals |
| `src/lib/settings.ts` | Settings storage and the cross-site hand-off |
| `src/lib/sfx.ts` | Synthesised sound effects (no audio files) |
| `tests/` | `engineerle.test.ts` (physics), `e2e.ts` (browser) |

The 3D stage uses a perspective camera, and falls back to a fixed oblique 2.5D view in Low CPU mode or on software
renderers. With no WebGL at all the puzzles still run.
