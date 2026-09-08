# Pixel Fish Tank (React)

A pixel-art fish/decoration editor and animated aquarium simulator, built with
React, TypeScript, Vite, and Tailwind CSS, with a minimal hand-rolled 8-bit
component style (thick square borders, pixel font, press-down buttons).

This is a React port of the original vanilla JS/CSS version (see the sibling
`FishTank` project). It carries over the full feature set:

- Pixel editor: pen, eraser, bucket fill, eyedropper, line, rectangle, ellipse,
  rectangle select, and move tools; undo/redo; drawing symmetry (mirror
  vertical/horizontal/both); flip/rotate transforms; adjustable grid size
  (8/16/24/32) with resampling; zoom; onion skin; PNG and sprite-sheet export.
- Animated tank: drag sprites in from a palette, fish swim autonomously and
  bounce off walls, drag to reposition or delete, decorations sway in place.
- Everything persists in this browser (IndexedDB, with a one-time migration
  from the old `localStorage` data). Works fully offline and without an
  account.
- Optional Supabase sync: set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
  (see `.env.example`) and run `supabase/schema.sql` in the project. With no
  credentials the app is local-only, which is a supported mode, not a degraded
  one. See `docs/STORAGE_DB_MIGRATION_PLAN.md`.

## Development

```bash
npm install
npm run dev      # dev server
npm run build    # typecheck + production build
npm run preview  # preview the production build
```

## Stack notes

Canvas drawing (both the pixel editor and the tank) stays imperative - a plain
2D-context draw loop driven by refs, not React state - since re-rendering the
DOM per pixel would be slow and pointless. Only the state that actually needs
to reflect in the UI (tool, color, selection, sprite list, etc.) is React
state; high-frequency gesture bookkeeping lives in a plain class instance held
in a ref. See `src/hooks/usePixelEditor.ts` and `src/hooks/useTank.ts`.
