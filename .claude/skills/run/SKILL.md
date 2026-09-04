---
name: run
description: Launch and drive Pixel Fish Tank (React) - a pixel-art fish/decoration editor plus animated tank simulator built with Vite + React + TypeScript + Tailwind + 8bitcn/ui.
---

# Running Pixel Fish Tank (React)

Static SPA, no backend, no auth, no env vars. Everything persists to
`localStorage` (per-origin - the dev port and the `preview` port are
different origins, so they don't share saved sprites/tank state).

## Dev server

```bash
npm install               # first time only
npm run dev -- --port 5199 --strictPort
```

Wait for the port instead of a fixed sleep:

```bash
timeout 30 bash -c 'until curl -sf http://localhost:5199/ >/dev/null; do sleep 1; done'
```

Stop by killing the port's listener (Windows):

```bash
pid=$(netstat -ano | grep ':5199' | grep LISTENING | awk '{print $5}' | head -1)
[ -n "$pid" ] && powershell.exe -NoProfile -Command "Stop-Process -Id $pid -Force"
```

## Build / typecheck / lint

```bash
npm run build     # tsc -b && vite build -> dist/
npm run lint       # oxlint
npm run preview -- --port 5200 --strictPort   # serve the built dist/ to sanity-check it
```

`tsc -b` runs first and will fail the whole build on any type error - a
clean `npm run build` is a real correctness signal here, not just a bundle
step.

## After a UI/frontend change, prefer the tank-ui-tester agent

For any change under `src/components/tank/`, `src/components/editor/`,
`src/hooks/usePixelEditor.ts`, `src/hooks/useTank.ts`, `src/lib/*`, or
`src/index.css`, dispatch the **tank-ui-tester** agent instead of
hand-rolling a Playwright script - it already knows how to boot the dev
server, drive the editor/tank panels, and report PASS/FAIL with
screenshots and console errors. Reach for the manual steps below only when
driving the app yourself outside that agent (e.g. one-off exploration).

For a change focused on layout, labels, or interaction flow (not correctness),
also dispatch **ux-ui-reviewer** for a design-quality pass with screenshots.
For feature/content brainstorming (new fish, decor, mechanics), dispatch
**game-design-ideator** instead of answering ad hoc - it checks the current
engine first so ideas fit `useTank`/`usePixelEditor` as they exist today.
Before merging any non-trivial code change, dispatch **code-reviewer** for a
quality pass (hook cleanup, dependency arrays, error paths). If the change
touches the shape of anything persisted by `usePixelEditor.ts` or
`useTank.ts`, dispatch **storage-migration-guardian** as well - see the
storage note under "Project layout" below for why this matters.

## Drive it manually (no chromium-cli in this sandbox - use local Playwright)

`chromium-cli` was not available in the container this project was built
in. Fallback that worked (Chromium ~200MB, only needs to happen once,
install it in the scratchpad dir, not the repo):

```bash
cd <scratchpad-dir>
npm init -y && npm install playwright
npx playwright install chromium
```

Then drive with a plain Node script (`node script.js`) using
`chromium.launch()` / `page.goto('http://localhost:5199/')` /
`page.screenshot(...)`. See "Gotchas" below for interacting with the UI.

One representative interaction: load the editor tab, pick the pen tool,
drag a stroke on `.pixel-canvas`, confirm a pixel's alpha changed via
`ctx.getImageData(...)`, screenshot. Confirms the canvas engine, pointer
capture, and Tailwind/8bitcn theme all loaded correctly in one shot.

## Project layout (editor vs tank)

Two independent imperative engines, each with its own panel tree:

- **Editor** (`src/hooks/usePixelEditor.ts`) - pixel sprite editing.
  Panels live in `src/components/editor/` (`CanvasMetaBar.tsx`,
  `SpriteLibrary.tsx`, ...).
- **Tank** (`src/hooks/useTank.ts`) - animated tank simulator. Panels live
  in `src/components/tank/`: `TankPanel.tsx` (host), `TankCanvas.tsx`
  (render loop), `TankPalette.tsx` (place fish/decor), `TankLayers.tsx`
  (layer list/reorder), `TankBackgroundPanel.tsx` (background/room decor +
  tank shape config), `RoomLayer.tsx`.

Both engines persist to `localStorage` and both stay mounted at once (see
gotcha below) - a change to one hook's state shape usually needs a
`storage.ts` migration to avoid breaking existing saved data. Dispatch
**storage-migration-guardian** to verify this before merging.

## Gotchas hit while building this project

- **Radix `Select` is not a native `<select>`.** `page.selectOption()`
  will silently no-op. Click the trigger (`[role="combobox"]`), wait for
  the popover, then click the option (`[role="option"]:has-text("...")`).
- **Both tab panels stay mounted.** `App.tsx` toggles the editor/tank
  panels with the `hidden` attribute, never conditional unmount - the
  imperative engines (`usePixelEditor`, `useTank`) hold an undo stack, a
  running `requestAnimationFrame` loop, and tank instances that must
  survive switching tabs. If you refactor this to Radix `Tabs` with
  default unmount-on-switch, you will silently lose that state.
- **Engine `init()` must call its own `reactNotify()` at the end.** Sprites
  are loaded from `localStorage` synchronously inside the mount `useEffect`,
  which runs *after* React's first paint (which sees the class field
  defaults, i.e. empty). Forgetting the trailing notify call means the
  sprite library renders empty until some *other* state change happens to
  trigger a re-render - easy to miss because it "looks fine" once you
  interact with anything.
- **The 8bitcn retro font (Press Start 2P) is wide.** Default component
  sizing truncates/overlaps Thai + English button and `Select` labels
  (e.g. grid-size showed "16×1", "Export Sprite Sheet" got clipped, and
  two button rows visually overlapped because 2-line wrapped retro text is
  taller than the row height the decorative pixel-corner spans expect).
  Fix pattern: smaller `font-size` overrides on dense controls (status
  bar, frame controls, sprite-meta buttons), `white-space: nowrap` +
  `text-overflow: ellipsis` instead of wrapping, wider `Select` triggers,
  and shorter labels where reasonable (`title` attribute for the full
  text). See `src/index.css` for the actual rules.
- **`tsconfig.app.json`/`tsconfig.json`: don't set `baseUrl`.** Newer
  TypeScript (used here) deprecates it; `"paths": { "@/*": ["./src/*"] }`
  alone is sufficient with `moduleResolution: "bundler"`.
- **shadcn CLI flags changed from older tutorials.** This project's CLI
  version uses `-t vite -b radix --preset <name> --css-variables`, not the
  old `-b <color-name>` (that flag now selects the primitive library:
  `base`/`radix`/`aria`). If `npx shadcn@latest init` hangs, it's waiting
  on an interactive preset prompt - pass `--preset nova` (or another
  listed preset) to skip it.