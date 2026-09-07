# Pixel editor tool architecture

Response to `.claude/prompt/edit-pixeleditor.md`: a from-scratch architecture for the drawing-tool
engine. **Six tools are migrated and wired into the live `PixelEditorEngine`**: Pen/Eraser,
Rect/Ellipse, Magic Wand, Move, Select, Lasso. Every other tool (line, curve, fill, gradient,
eyedropper, spray) is untouched, still running on the original inline `if (this.tool === 'xxx')`
handling in `src/hooks/usePixelEditor.ts`.

## Why

`usePixelEditor.ts` grew into a single 4500+ line class handling every tool's pointer/keyboard
gestures through long `if (this.tool === 'xxx')` chains inside three giant methods, with ~30
gesture-state fields as loose class fields reset by hand in one `resetGestureState()`. That made it
easy for one tool's gesture state to leak into another's, hard to add a tool without touching many
scattered call sites, and impossible to unit test without a live DOM canvas. There was zero test
coverage.

## Architecture

```
src/lib/tools/
  types.ts             Tool, Gesture, ToolContext, ToolPointerEvent, PaintOp, GestureResult, ToolPreview
  paintPipeline.ts      withSelectionClip, withSymmetry - composable CellWriter stages
  dirtyRect.ts          DirtyRectTracker - shared bounding-box accumulator
  selectionMask.ts       shared mask/outline machinery (polygonMask, traceMaskOutline, settleSelection,
                         rectMask, resolveMarqueeMode) - used by Magic Wand, Select and Lasso
  tools/
    penTool.ts            Pen/Eraser
    shapeTool.ts           Rect/Ellipse
    magicWandTool.ts        Magic Wand
    moveTool.ts               Move
    selectTool.ts              Select (marquee)
    lassoTool.ts                Lasso
  __tests__/             vitest unit tests for all of the above (76 tests, no DOM)
```

**Tool** is a stateless factory: given a `ToolPointerEvent` (a pointer event already resolved to a
canvas cell) and a `ToolContext` (a read-only snapshot of engine state - color, brush size, symmetry,
selection, etc., plus a `getCell` reader), it returns a **Gesture** or `null`.

**Gesture** is the stateful object for one drag: `onPointerMove`, `onPointerUp`, `onCancel`. Cancel is
first-class - every gesture must implement it, not rely on a central `resetGestureState()` that has to
know each tool's internal fields.

**ToolPreview** (what `onPointerMove` returns) and **GestureResult** (what `onPointerUp`/`onCancel`
return) separate *what to paint* from *how to repaint the canvas*:
- `ops: PaintOp[]` - already pipeline-composed (mirrored, selection-clipped) cell writes.
- `overlay` (shapes only) - tentative preview cells drawn on top without touching the frame yet, in
  the exact shape `redrawRegions(rects, overlay)` already expected, so the engine's repaint code needed
  no changes for Pen or Rect/Ellipse.
- `movePreview` (Move only) - an explicit exception: Move's live-drag preview stays on the existing
  `gestureBaseBitmap`/`drawGrid` fast path (a deliberate, previously-existing optimization, see that
  code's own comments) instead of forcing it through the dirty-rect/overlay path the other tools use.
- `selectionDraft`/`lassoDraftPoints` (Select/Lasso only) - metadata-only, mirrored straight into the
  engine's own same-named fields for `PixelSelectionOverlay.tsx` (a DOM layer) to read. Neither ever
  touches the canvas bitmap or `redrawRegions` - dragging a marquee/lasso never paints anything.

**paintPipeline.ts**'s `withSymmetry`/`withSelectionClip` are composable `CellWriter` stages ported
from `mirrorCells`/`paintAllowed` - `withSymmetry(..., withSelectionClip(..., sink))` mirrors a cell
first, then selection-clips each mirrored copy, matching the original `applyBrushAt`'s order exactly.

**dirtyRect.ts**'s `DirtyRectTracker` is a shared bounding-box accumulator replacing each tool's own
inline bbox math (`cellsDirtyRects`/`strokeDirtyRects`).

**selectionMask.ts** holds the mask/outline machinery three tools need: `polygonMask`,
`traceMaskOutline` (+ its `chainBoundaryEdges`/`maskBoundaryEdges` helpers), `settleSelection` (merge
+ collapse-to-rectangle), `maskFromSelection`, `rectMask`, and `resolveMarqueeMode` (the
`altKey ? 'subtract' : shiftKey ? 'add' : selectionMode` rule Select and Lasso share - **not** the same
rule as Magic Wand's own `resolveWandCombine`, which additionally treats Ctrl as 'add' and gives the
sticky 'subtract' mode priority; kept deliberately separate, don't unify them).

### Integration into `PixelEditorEngine`

A module-level `TOOL_REGISTRY` maps `pen`/`eraser`/`rect`/`ellipse`/`magicWand`/`move`/`select`/`lasso`
to their `Tool`. `NO_UNDO_TOOLS` (`magicWand`/`select`/`lasso`) skips `pushGestureUndo()` for gestures
that never touch a pixel. `onPointerDown` dispatches to the registry, with two routing checks ahead of
it for the two tools that can instead start a Move:
- **Magic Wand**: a click that resolves (`resolveWandCombine`) to `'subtract'` always subtracts even
  inside the existing selection; any other click inside it starts Move instead.
- **Select/Lasso**: a *different* rule (`resolveMarqueeMode`) - only a click that resolves to `'new'`
  AND lands inside the existing selection starts Move; `'add'`/`'subtract'` always start a fresh
  marquee/lasso drag instead, even from inside the selection. Don't unify this with Magic Wand's rule.

`onPointerMove` replays coalesced events only for Pen/Eraser (matching the original's own
coalesced-event handling). `onPointerUp` has no event of its own (see its empty signature) - it
replays `lastToolPointerEvent`, the last position `onPointerMove` saw, same as the legacy shape commit
reading whatever `shapePreviewCells` was last set to. `resetGestureState()` erases any left-over
overlay (`lastGesturePreviewRects`) and calls `onCancel` before dropping `activeGesture`.

Migrating Select/Lasso removed the *last* caller of the legacy `startMoveGesture()`/`moveStartCell`/
the `onPointerMove` `if (this.moveBuffer)` branch (both tools now route into `TOOL_REGISTRY.move`
instead) - all three were deleted, along with the engine's own now-unused `rectMask` (Magic Wand never
used it; only Select did, and only via the shared `selectionMask.ts` copy now) and `draftSelectionMode`
(now held inside each gesture instance instead of one shared engine field). Each removal was verified
with a fresh grep for remaining callers first - see the Correction entry below for why that step isn't
optional.

### Deviations found during implementation (worth flagging for future migration steps)

- **Pen/Eraser and Move never roll back their undo entry on a no-op release** (a click outside the
  active selection, or a zero-delta move) - matching the *original*, which only rolls back Fill's undo
  entry on a no-op, not Pen's or Move's. `GestureResult.changed` is `true` unconditionally for both.
- **Magic Wand skips `pushGestureUndo()` entirely** (it never touches a pixel), matching
  `applyMagicWandAt`'s own doc comment - `rollbackGestureUndo()` already no-ops safely when nothing was
  pushed, so this needed no special-casing in `commitGestureResult`.
- Dithering (the "dither brush") resolves its stipple color from the *mirrored* cell's own coordinates.
  `withSymmetry` only mirrors coordinates; a caller needing per-mirrored-cell dithering (Pen) resolves
  color itself in its own final sink stage, after mirroring - see `paintPipeline.ts`'s own doc comment.
- **Correction, since resolved:** an earlier version of this doc claimed the `if (this.moveBuffer)`
  branches in `onPointerMove`/`onPointerUp` were dead code. They weren't yet, at the time - `select`/
  `lasso`'s own "click inside the selection" path still called the legacy `startMoveGesture()` directly,
  independent of `activeGesture`. Deleting the branch was tried and reverted after realizing dragging a
  select/lasso-triggered move would silently stop updating mid-drag. Migrating Select/Lasso (this
  session) made the claim true for real - both tools now route through `TOOL_REGISTRY.move` instead -
  and the branches, `startMoveGesture`, and `moveStartCell` were removed, this time after actually
  re-verifying every caller was gone first (see the Integration section above). The lesson stands for
  whoever migrates the remaining tools: never delete something because it "should" be unreachable -
  grep every caller, every time.

## Migration plan

Already migrated: **pen, eraser, rect, ellipse, magicWand, move, select, lasso.**

Proposed order for the rest, each independently swappable behind the same `TOOL_REGISTRY` pattern:

1. **line** - near-identical to `shapeTool.ts` (shares shift-constrain + brush thickness), low risk.
2. **spray** - timer-driven (`sprayTimer`/`sprayTick`), needs an optional `Gesture.onTick?()` hook added
   to the interface - the first required interface extension.
3. **fill** - flood fill + tolerance + global replace; single-click commit, no live preview, moderate
   risk around the global-replace mode.
4. **curve** - 2-phase drag (`drag-end` → `bend`), the most stateful remaining tool; do after the
   simpler ones establish the pattern.
5. **gradient** - needs `ToolPreview`'s native-canvas-gradient fast path preserved as an escape hatch
   (see the original's own perf rationale) or accept per-cell dither-preview cost, already the status
   quo when dither is on.
6. **eyedropper** - arguably not a gesture at all today (instant Alt-shortcut); likely stays a
   special-cased instant action outside the registry.

**Highest-risk points for whoever does steps 2-6:**
- **Never spread a native DOM event** (`{ ...pointerEvent }`) when building a `ToolPointerEvent`. On a
  native event - which is what `getCoalescedEvents()` returns, unlike React's synthetic event -
  `clientX`/`clientY` are prototype getters, not own enumerable properties, so a spread silently drops
  them and the position math yields `NaN` cells. This shipped as a real bug: it hung
  `bresenhamLine`'s loop (tab freeze, then an out-of-memory crash), and once that was guarded it turned
  into dropped stroke segments plus a stray pixel at (0,0). Read the coordinates explicitly. It is also
  invisible to Playwright-driven tests, whose synthetic input never produces more than one coalesced
  sample - see `usePixelEditor.ts`'s own comment at the coalesced-replay loop.
- Blur/visibility-forced gesture-end and two-button-abort must route through `Gesture.onCancel` for
  every migrated tool - easy to silently miss for a new tool and leave a stuck gesture.
- Any tool whose live-drag preview currently uses `gestureBaseBitmap` instead of dirty-rect repaint
  (resize/rotate - not yet migrated, gradient's live drag) needs the same bitmap-cache carve-out Move
  gets (`ToolPreview.movePreview`), not a forced fit into the overlay path.
- Selection-shape tools sharing `selectionMask`/`lassoPoints` state (now: Magic Wand, Select, and
  Lasso, all migrated) mean the next tool to touch selection state should double-check nothing here
  assumed a specific one of the three.

## Test coverage

`npm test` (`vitest run`) - 76 tests, all pure logic, no DOM/canvas:
- **paintPipeline**: selection-clip inside/outside a rect and a sparse mask; symmetry mirroring
  on-axis (no duplicate) and off-axis, composed with selection-clip.
- **DirtyRectTracker**: single cell, disjoint-cell union, canvas-edge clamping, empty input.
- **PenTool**: zero-length stroke, fast-drag gap-filling via bresenham, Pixel-Perfect corner trim (and
  that a brush size > 1 skips it), erase mode, right-click-erases (`eraseOverride`), `onCancel`, and
  that a release always keeps the undo entry even when nothing painted.
- **ShapeTool**: zero-size drag, shift-constrain to a square, filled vs. outline cell counts, brush
  thickness, out-of-canvas bounds-checking.
- **MagicWandTool**: contiguous vs. global select, tolerance, add/subtract combine (including the
  mask-collapses-to-a-plain-rectangle case), and that it never emits paint ops or a "changed" gesture.
- **MoveTool**: source-clear-on-lift (skipped when copying), unclamped drag tracking, clamped
  write-back, that a zero-delta release still keeps the undo entry, `onCancel`.
- **SelectTool**: `resolveMarqueeMode`'s three branches; a real drag settles a rectangle; a plain click
  with mode `'new'` clears the selection; shift/alt-drag add/subtract; a plain click in add/subtract
  mode omits `selection` entirely (leaves it untouched); freezes (`onPointerMove` returns `null`) once
  the pointer leaves canvas bounds; never touches a pixel; `onCancel`.
- **LassoTool**: same shape of coverage as Select, plus that a too-short path (a click, not a drag)
  behaves the same as Select's plain-click cases even though Lasso always goes through mask machinery.
- Pure functions moved into `selectionMask.ts` are exercised indirectly through Magic Wand/Select/
  Lasso's own tests (all pre-existing Magic Wand tests still pass unchanged, confirming the move was
  behavior-preserving).

## Verification performed

- `npx tsc -b --noEmit` - clean.
- `npx vitest run` - 76/76 passing.
- `npm run build` - production build succeeds.
- Manual Playwright smoke test against the running dev server, two rounds:
  - *Pen/Rect/MagicWand/Move round*: Pen L-stroke with corner trim, undo/redo across two strokes,
    filled and outline Rect, Magic Wand select-then-drag-to-move (both the outline-only and filled
    cases, including the click-inside-selection → Move routing), and Escape mid-Pen-stroke fully
    cancelling with no artifact left on canvas.
  - *Select/Lasso round*: marquee drag, shift-drag to add a second (disjoint) region, alt-drag to
    subtract a corner (confirmed the traced outline renders as two loops via one bridged path, per
    `traceMaskOutline`'s own doc comment), a fresh marquee selection then drag-from-inside routing to
    Move and actually relocating the pixels (confirmed via raw canvas pixel readback, not just a
    screenshot), undo correctly reverting the move, Escape mid-marquee-drag cancelling with no leftover
    dashed box, and a freeform Lasso drag tracing a closed pentagon selection.
  - No console/runtime errors in any run.
