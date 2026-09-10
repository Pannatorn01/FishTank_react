# Pixel Fish Tank (React)

Draw a fish one pixel at a time, build the tank it lives in, then keep it alive.
Built with React, TypeScript, Vite, Tailwind and Pixi.js, in a hand-rolled 8-bit
style (thick square borders, pixel font, press-down buttons). Works fully
offline and without an account.

This is a React port of the original vanilla JS/CSS version (see the sibling
`FishTank` project), and has since grown well past it.

## The three modes

**Draw** — a pixel editor with pen, eraser, fill, eyedropper, line, curve, rect,
ellipse, spray, gradient, rectangle-select, lasso, magic wand and move tools.
Layers, animation frames with onion skin, undo/redo, drawing symmetry,
flip/rotate, adjustable grid size (8/16/24/32) with resampling, zoom, and PNG /
sprite-sheet export. Sprites are typed: fish, object, room or background.

**Build Tank** — drag sprites in from a palette. Fish swim on their own, school
with each other and bounce off the glass; decor sways in place. The tank's size,
shape (rect, rounded, oval) and background are yours to set, and you can keep
several tanks and switch between them. Export the running tank as a picture, a
GIF or a video.

**Life** — the same tank, placed in a room, with the care mechanics running.
Fish get hungry and will starve if nobody feeds them; water evaporates over real
days; algae grows on the glass, faster when fish waste is left lying around.
Arm the Feed or Scrub tool and use it on the tank, tap waste to collect it, and
refill the water when it drops. Three cats live in the room, and one of them
will occasionally climb the table and raid the tank.

The slow clocks take an elapsed duration rather than reading the wall clock, so
a tank reopened after three days away is exactly as hungry, evaporated and
algae-covered as if the app had been running the whole time.

## Data

Everything lives in this browser (IndexedDB, with a one-time migration from the
old `localStorage` data). Optional Supabase sync adds accounts, a gallery, and
share links for tanks and sprites: set `VITE_SUPABASE_URL` and
`VITE_SUPABASE_PUBLISHABLE_KEY` (see `.env.example`) and run
`supabase/schema.sql` in the project. With no credentials the app is local-only,
which is a supported mode, not a degraded one.

## Development

```bash
npm install
npm run dev      # dev server
npm run build    # typecheck + production build
npm run preview  # preview the production build
npm run test     # vitest (343 tests at time of writing)
npm run lint     # oxlint
```

`scripts/*-smoke.cjs` are Playwright smoke runs for the things unit tests can't
reach: auth, sync, sharing, the gallery. They need a running dev server, and the
Supabase ones need credentials.

## How it's put together

Canvas drawing stays imperative — a plain draw loop driven by refs, not React
state — since re-rendering the DOM per pixel would be slow and pointless. Only
state that has to reflect in the UI (tool, color, selection, sprite list) is
React state; high-frequency gesture bookkeeping lives in a plain class instance
held in a ref.

| Where | What lives there |
| --- | --- |
| `src/hooks/usePixelEditor.ts` | the editor engine |
| `src/lib/tools/` | one file per drawing tool, plus the paint pipeline |
| `src/hooks/useTank.ts` | the tank engine |
| `src/tank/sim/` | headless simulation: geometry, schooling, vitals, algae |
| `src/tank/render/` | Pixi scenes for the tank and the room |
| `src/lib/data/` | adapters, repositories, sync engine, sharing |

The tank simulation is deliberately renderer-free so both renderers read the
same numbers instead of each re-deriving them and drifting apart.

## More docs

- `LEARNING.md` — what to learn to work on this project (in Thai)
- `src/lib/tools/ARCHITECTURE.md` — the drawing-tool architecture
- `docs/PIXI_MIGRATION_PLAN.md` — the Pixi migration and Life mode plan
- `docs/STORAGE_DB_MIGRATION_PLAN.md` — storage and Supabase sync
- `docs/PIXEL_ART_PIPELINE.md` — how the generated pixel art is made
- `docs/EDITOR_IMPROVEMENTS.md` — editor backlog and history
