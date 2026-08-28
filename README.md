# Pixel Fish Tank (React)

A pixel-art fish/decoration editor and animated aquarium simulator, built with
React, TypeScript, Vite, Tailwind CSS, and [8bitcn/ui](https://8bitcn.com) for
the retro component styling.

This is a React port of the original vanilla JS/CSS version (see the sibling
`FishTank` project). It carries over the full feature set:

- Pixel editor: pen, eraser, bucket fill, eyedropper, line, rectangle, ellipse,
  rectangle select, and move tools; undo/redo; drawing symmetry (mirror
  vertical/horizontal/both); flip/rotate transforms; adjustable grid size
  (8/16/24/32) with resampling; zoom; onion skin; PNG and sprite-sheet export.
- Animated tank: drag sprites in from a palette, fish swim autonomously and
  bounce off walls, drag to reposition or delete, decorations sway in place.
- Everything persists to `localStorage` (per-browser, not shared with the
  vanilla version - different origin).

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
