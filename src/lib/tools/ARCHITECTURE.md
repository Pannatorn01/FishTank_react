# Pixel editor tool architecture

Response to `.claude/prompt/edit-pixeleditor.md`: a from-scratch architecture for the drawing-tool
engine, plus a reference implementation of four tools (Pen/Eraser, Rect/Ellipse, Magic Wand, Move)
wired into the live `PixelEditorEngine`. Every other tool (line, curve, fill, gradient, eyedropper,
spray, select, lasso) is untouched, still running on the original inline `if (this.tool === 'xxx')`
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
  tools/
    penTool.ts            Pen/Eraser
    shapeTool.ts           Rect/Ellipse
    magicWandTool.ts        Magic Wand
    moveTool.ts               Move
  __tests__/             vitest unit tests for all of the above (39 tests, no DOM)
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

**paintPipeline.ts**'s `withSymmetry`/`withSelectionClip` are composable `CellWriter` stages ported
from `mirrorCells`/`paintAllowed` - `withSymmetry(..., withSelectionClip(..., sink))` mirrors a cell
first, then selection-clips each mirrored copy, matching the original `applyBrushAt`'s order exactly.

**dirtyRect.ts**'s `DirtyRectTracker` is a shared bounding-box accumulator replacing each tool's own
inline bbox math (`cellsDirtyRects`/`strokeDirtyRects`).

### Integration into `PixelEditorEngine`

A module-level `TOOL_REGISTRY` maps `pen`/`eraser`/`rect`/`ellipse`/`magicWand`/`move` to their `Tool`.
`onPointerDown` dispatches to it (preserving Magic Wand's routing quirk: a click that resolves to
`'subtract'` always subtracts even inside the existing selection, but any other click inside it starts
a Move instead - `resolveWandCombine`, shared between the tool and this routing check). `onPointerMove`
replays coalesced events only for Pen/Eraser (matching the original's own coalesced-event handling).
`onPointerUp` has no event of its own (see its empty signature) - it replays `lastToolPointerEvent`,
the last position `onPointerMove` saw, same as the legacy shape commit reading whatever
`shapePreviewCells` was last set to. `resetGestureState()` erases any left-over overlay
(`lastGesturePreviewRects`) and calls `onCancel` before dropping `activeGesture`.

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
- **Correction (this was wrong when first written):** the `if (this.moveBuffer)` branches in
  `onPointerMove`/`onPointerUp` are *not* dead code - `select`/`lasso`'s own "click inside the
  selection" path (usePixelEditor.ts:2716, 2731) still calls the legacy `startMoveGesture()` directly,
  which sets `this.moveBuffer` without ever going through `activeGesture`. Deleting that branch was
  tried and reverted after realizing dragging a select/lasso-triggered move would silently stop
  updating mid-drag. Those two tools' own pen/shape-specific tails were *not* re-verified after this
  mistake and should be checked the same careful way (trace every remaining caller, not just grep for
  the tool name) before assuming they're removable.

## Migration plan

Already migrated: **pen, eraser, rect, ellipse, magicWand, move.**

Proposed order for the rest, each independently swappable behind the same `TOOL_REGISTRY` pattern:

1. **line** - near-identical to `shapeTool.ts` (shares shift-constrain + brush thickness), low risk.
2. **spray** - timer-driven (`sprayTimer`/`sprayTick`), needs an optional `Gesture.onTick?()` hook added
   to the interface - the first required interface extension.
3. **select** (marquee) + **lasso** - lasso shares outline-tracing/mask logic with the now-ported Magic
   Wand; do together.
4. **fill** - flood fill + tolerance + global replace; single-click commit, no live preview, moderate
   risk around the global-replace mode.
5. **curve** - 2-phase drag (`drag-end` → `bend`), the most stateful remaining tool; do after the
   simpler ones establish the pattern.
6. **gradient** - needs `ToolPreview`'s native-canvas-gradient fast path preserved as an escape hatch
   (see the original's own perf rationale) or accept per-cell dither-preview cost, already the status
   quo when dither is on.
7. **eyedropper** - arguably not a gesture at all today (instant Alt-shortcut); likely stays a
   special-cased instant action outside the registry.

**Highest-risk points for whoever does steps 2-7:**
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
- Selection-shape tools (select/lasso) sharing `selectionMask`/`lassoPoints` state with Magic Wand and
  Move mean step 3 must double-check nothing assumed lasso specifically.

## Test coverage

`npm test` (`vitest run`) - 39 tests, all pure logic, no DOM/canvas:
- **paintPipeline**: selection-clip inside/outside a rect and a sparse mask; symmetry mirroring
  on-axis (no duplicate) and off-axis, composed with selection-clip.
- **DirtyRectTracker**: single cell, disjoint-cell union, canvas-edge clamping, empty input.
- **PenTool**: zero-length stroke, fast-drag gap-filling via bresenham, Pixel-Perfect corner trim (and
  that a brush size > 1 skips it), erase mode, `onCancel`, and that a release always keeps the undo
  entry even when nothing painted.
- **ShapeTool**: zero-size drag, shift-constrain to a square, filled vs. outline cell counts, brush
  thickness, out-of-canvas bounds-checking.
- **MagicWandTool**: contiguous vs. global select, tolerance, add/subtract combine (including the
  mask-collapses-to-a-plain-rectangle case), and that it never emits paint ops or a "changed" gesture.
- **MoveTool**: source-clear-on-lift (skipped when copying), unclamped drag tracking, clamped
  write-back, that a zero-delta release still keeps the undo entry, `onCancel`.

## Verification performed

- `npx tsc -b --noEmit` - clean.
- `npx vitest run` - 39/39 passing.
- Manual Playwright smoke test against the running dev server: Pen L-stroke with corner trim, undo/redo
  across two strokes, filled and outline Rect, Magic Wand select-then-drag-to-move (both the
  outline-only and filled cases, including the click-inside-selection → Move routing), and Escape
  mid-Pen-stroke fully cancelling with no artifact left on canvas. No console/runtime errors in any run.
