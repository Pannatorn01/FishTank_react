# Pixel editor tool architecture

Response to `.claude/prompt/edit-pixeleditor.md`: a from-scratch architecture for the drawing-tool
engine. **Ten tools are migrated and wired into the live `PixelEditorEngine`**: Pen/Eraser,
Rect/Ellipse/Line, Magic Wand, Move, Select, Lasso, Eyedropper, Fill, Gradient. Every other tool
(spray, curve) is untouched, still running on the original inline `if (this.tool === 'xxx')` handling
in `src/hooks/usePixelEditor.ts`.

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
    shapeTool.ts           Rect/Ellipse/Line
    magicWandTool.ts        Magic Wand
    moveTool.ts               Move
    selectTool.ts              Select (marquee)
    lassoTool.ts                Lasso
    eyedropperTool.ts            Eyedropper
    fillTool.ts                   Fill
    gradientTool.ts                Gradient
  __tests__/             vitest unit tests for all of the above (106 tests, no DOM)
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
  no changes for Pen or Rect/Ellipse/Line.
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

**shapeTool.ts covers three shapes now, not two.** Line joined Rect/Ellipse in the same file rather
than getting its own - it's the same `ShapeGesture` scaffolding (eraseOverride resolution,
mirrorExpand, DirtyRectTracker, overlay preview, commit, onCancel), just a different cell shape
(`thickenPath(bresenhamLine(...))`, its own local port - the engine's copy stays too, since curve still
uses it) and a different Shift-constrain rule: `constrainToAngle` (snap to the nearest 0/45/90°,
keeping the dragged distance) instead of `constrainToSquare`. **These two constrain rules are not
interchangeable** - don't be tempted to unify them, same reasoning as Magic Wand vs. Select/Lasso's
combine-mode rules above. `constrainToAngle` is now **exported** from `shapeTool.ts` and reused as-is by
`gradientTool.ts` - Line and Gradient are the two tools that shift-constrain to an angle rather than a
square, so this is one shared function now, not two copies. The engine's own `constrainShapeEnd` (the
original home of this logic, plus the square-constrain branch) has zero remaining callers after
Gradient's migration and was deleted outright - the last piece of the pre-migration shape-tool code
(`thickenPath` and `shapePreviewCells` on the engine still stay; curve still uses them).

**Eyedropper and Fill are both "instant action" gestures**, the same shape as Magic Wand: all the work
happens synchronously in `beginGesture` (which needs `ToolContext.getVisibleColor(x, y)` for
Eyedropper - the topmost visible layer's color across the *whole* layer stack, a real gap `getCell`
alone couldn't fill since that only reads the active layer), `onPointerMove` always returns `null`,
`onPointerUp` just replays the precomputed `GestureResult`. Eyedropper's result carries two new fields,
`pickedColor`/`switchToPen`, applied by `commitGestureResult` *before* its `if (!result.changed) return`
early-out (Eyedropper's `changed` is always `false` - picking a color isn't a pixel edit - so the
side effect has to land before that check, not after).

**Fill's one real subtlety**: a plain (non-Shift) click floods **once per mirrored start point**
(`mirrorPoints(...).forEach(m => floodFillOps(ctx, m.x, m.y, ...))`), each sampling *its own* target
color at that point and flooding independently - this is not the shared `withSymmetry` pipeline every
other tool uses (mirror one final color across copies), and must not be "simplified" into it. Global
replace (Shift+click) ignores symmetry entirely, matching the original. The selection also acts as a
**flood traversal barrier**, not just an output filter: `floodFillOps`'s `inSelection` check runs
inside the loop's continuation test, exactly like the color-match check, so two disjoint blobs inside a
selection connected only via a path *outside* it don't both fill from clicking one of them - a real
correctness case, covered by its own test (`fillTool.test.ts`).

**Gradient's live drag deliberately does *not* go through the generic per-cell `overlay` mechanism**
every shape tool uses. The original's `drawGradientPreviewOverlay()` paints the whole box directly with
the canvas's own native, GPU-composited `ctx.createLinearGradient` - a measured optimization (profiled
at ~2440ms/frame without it on a large canvas, see that method's own doc comment) because a gradient,
unlike a shape outline, repaints its *entire* box every frame, defeating the run-length-merged overlay
repaint every other tool benefits from. Forcing it through `overlay` would silently reintroduce that
regression, so instead `GradientGesture.onPointerMove` returns a new `ToolPreview.gradientPreview: {
start, end, eraseOverride }` field, and `applyToolPreview` mirrors it straight into the engine's own
pre-existing `gradientStart`/`gradientEnd`/`eraseOverride` fields and calls the existing, unchanged
`drawGradientPreviewOverlay()` - the same "mirror data into legacy fields for legacy rendering" trick
already established for Move's `movePreview`/`moveBuffer`. One consequence worth knowing: this is also
why `resetGestureState()`'s existing `if (this.gradientStart) { redrawRegions(...) }` cleanup (written
for the *original* gradient code, long before this migration) needed no changes at all - it already
repaints the live-drag box correctly on Escape/interrupt for the migrated tool too, since the mirrored
fields it reads are still being kept up to date.

The **commit** (`onPointerUp`), unlike the live drag, is an ordinary portable pure function -
`gradientCellsPreviewOps` computes the exact per-cell blend array once, exactly like the original's
`gradientCellsPreview`, using `hexToRgb`/`rgbToHex`/`ditherColorAt`/`ditherGradientMix` from
`pixelMath.ts` and `withSelectionClip` for the mask check. Gradient still does **not** mirror through
symmetry at all (a pre-existing inconsistency in the original - commit only ever selection-clips, never
`mirrorPoints`s - not something this migration fixes). Two more original quirks preserved exactly:
right-click doesn't erase to `null` the way Pen/Fill do - it's a "reversed gradient" that swaps which
color is the start vs. the end, so every op still carries a real color; and the commit **never rolls
back its undo entry**, even for a fully-outside-selection drag that produces zero ops - there is no
rollback call anywhere in the original's gradient commit, so `GestureResult.changed` is hardcoded
`true` rather than derived from `ops.length`. A new `GestureResult.alsoSaveColor` field ports the
original's extra, unconditional `addSavedColor(this.gradientColor)` call (it saved *both* ends of the
gradient to the recent-colors swatch list, not just the primary color the engine already saves
generically) - applied by `commitGestureResult` before the `changed` early-out, same placement as
`pickedColor`.

### Integration into `PixelEditorEngine`

A module-level `TOOL_REGISTRY` maps
`pen`/`eraser`/`rect`/`ellipse`/`line`/`magicWand`/`move`/`select`/`lasso`/`eyedropper`/`fill`/`gradient`
to their `Tool`. `NO_UNDO_TOOLS` (`magicWand`/`select`/`lasso`/`eyedropper`) skips `pushGestureUndo()` for
gestures that never touch a pixel - `fill` is deliberately **not** in that set, since it pushes undo
and rolls it back on a no-op release instead, matching the original exactly (the *only* other tool with
that specific rollback rule besides Fill itself). `onPointerDown` dispatches to the registry, with two
routing checks ahead of it for the two tools that can instead start a Move:
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

Migrating Line similarly let three more things be removed for real, again only after re-verifying zero
remaining callers: the `if (this.tool === 'line')` branches in `onPointerDown`/`onPointerMove`/
`onPointerUp`, `computeShapeCells()` in full (its rect/ellipse branches had already been dead since
those two migrated earlier and were never cleaned up - line joining them made the whole method
removable), and the `shapeStart` field. **Not removed**, deliberately: `constrainShapeEnd` and
`thickenPath` on the engine (gradient and curve still call them respectively), and `shapePreviewCells`
(curve and `redrawShapePreview` both still depend on it).

Migrating Eyedropper and Fill removed, after the same re-verification discipline: the `if (this.tool
=== 'eyedropper')` and `if (this.tool === 'fill')` branches in `onPointerDown`, and the engine's own
`floodFill`/`globalReplace`/`colorsMatch` methods (all now dead - `colorsMatch` had no callers left
once `floodFill`/`globalReplace` were gone; it lives on as a pure function duplicated in both
`fillTool.ts` and `magicWandTool.ts` instead). `pickColor` itself stays on the engine - the separate
Alt-temporary-pick path still calls it directly, independent of the Eyedropper tool.

Migrating Gradient removed, after the same re-verification discipline: the `if (this.tool ===
'gradient')` branches in `onPointerDown` (the shared push-undo block it used to sit in alongside spray),
`onPointerMove`, and `onPointerUp`; the engine's own `gradientCellsPreview()` method (ported as
`gradientCellsPreviewOps` in `gradientTool.ts`); and `constrainShapeEnd()` in full (see the
`shapeTool.ts` paragraph above - Line had already stopped calling it, so Gradient was its last caller).
`drawGradientPreviewOverlay()` stays on the engine, deliberately - its call site just moved from
`onPointerDown`/`onPointerMove` to `applyToolPreview`'s new `gradientPreview` branch. The pre-existing
`gradientPreview: MoveBufferCell[] | null` engine *field* (a different thing from the new
`ToolPreview.gradientPreview` type, despite the name collision) was already dead before this migration
- grepping for assignments found it's only ever set to `null`, never populated - and is out of scope
here since removing it isn't something Gradient's migration needs; noted in `EDITOR_IMPROVEMENTS.md`
instead.

### Deviations found during implementation (worth flagging for future migration steps)

- **Pen/Eraser, Move, and Gradient never roll back their undo entry on a no-op release** (a click
  outside the active selection, a zero-delta move, or a gradient drag that lands fully outside the
  selection) - matching the *original*, which only rolls back Fill's undo entry on a no-op, not these
  three. `GestureResult.changed` is `true` unconditionally for all three.
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

Already migrated: **pen, eraser, rect, ellipse, line, magicWand, move, select, lasso, eyedropper, fill,
gradient.**

Proposed order for the rest, each independently swappable behind the same `TOOL_REGISTRY` pattern:

1. **spray** - timer-driven (`sprayTimer`/`sprayTick`), needs an optional `Gesture.onTick?()` hook added
   to the interface - the first required interface extension.
2. **curve** - 2-phase drag (`drag-end` → `bend`), the most stateful remaining tool; do last, after the
   simpler ones establish the pattern. Once curve is the only caller left, `thickenPath` and
   `shapePreviewCells`/`redrawShapePreview` can finally move too (or be retired if curve absorbs them).

**Highest-risk points for whoever does steps 1-2:**
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
  (resize/rotate - not yet migrated) needs the same bitmap-cache carve-out Move gets
  (`ToolPreview.movePreview`), not a forced fit into the overlay path. Gradient turned out **not** to
  need this - its native-canvas-gradient trick is a different, dedicated `ToolPreview.gradientPreview`
  mirror, not `gestureBaseBitmap` - so don't assume every "paints its own thing outside the overlay
  path" tool wants the same mechanism; check what it actually optimizes for first.
- Selection-shape tools sharing `selectionMask`/`lassoPoints` state (now: Magic Wand, Select, and
  Lasso, all migrated) mean the next tool to touch selection state should double-check nothing here
  assumed a specific one of the three.

## Test coverage

`npm test` (`vitest run`) - 106 tests, all pure logic, no DOM/canvas:
- **paintPipeline**: selection-clip inside/outside a rect and a sparse mask; symmetry mirroring
  on-axis (no duplicate) and off-axis, composed with selection-clip.
- **DirtyRectTracker**: single cell, disjoint-cell union, canvas-edge clamping, empty input.
- **PenTool**: zero-length stroke, fast-drag gap-filling via bresenham, Pixel-Perfect corner trim (and
  that a brush size > 1 skips it), erase mode, right-click-erases (`eraseOverride`), `onCancel`, and
  that a release always keeps the undo entry even when nothing painted.
- **ShapeTool (rect/ellipse)**: zero-size drag, shift-constrain to a square, filled vs. outline cell
  counts, brush thickness, out-of-canvas bounds-checking.
- **ShapeTool (line)**: matches `bresenhamLine`'s own output for a plain drag; zero-length drag paints
  one cell; Shift snaps to the nearest 45° keeping the dragged distance (not a square); a thicker brush
  produces more cells with no duplicates; out-of-canvas bounds-checking.
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
- **EyedropperTool**: picks a color and sets `switchToPen`; samples the topmost *visible* layer via
  `getVisibleColor` rather than just the active layer; a no-op (`changed: false`, no `pickedColor`) on
  an empty cell; never emits a paint op and never reports `changed`; `onCancel`.
- **FillTool**: floods a contiguous same-color region; stops at a color boundary; a selection blocks the
  flood from leaking through a path that runs outside it (two disjoint in-selection regions joined only
  by an out-of-selection cell); Shift+click global replace reaches every matching pixel regardless of
  adjacency; symmetry runs as N independent per-mirror-point floods (each sampling its own target color)
  rather than one mirrored result; right-click erases; `changed: false` when the clicked pixel already
  matches the fill color; `onCancel`.
- **GradientTool**: the exact per-cell linear blend, hand-computed against known start/end colors (not
  re-derived from the implementation's own formula); right-click reverses which color is the start vs.
  the end without ever erasing to `null`; Shift-drag snaps to the nearest 45° increment; the live
  `onPointerMove` preview returns `gradientPreview` (never `ops`/`overlay`); a selection restricts the
  affected cells to its bounding box, and a non-rectangular mask further excludes cells inside that box;
  a zero-length drag paints the whole box with the exact midpoint blend; dither mode picks only the
  literal start/end hex for every cell, never a blended third color; `changed` is always `true` even
  when a selection excludes every cell; `alsoSaveColor` always reports the secondary color; symmetry is
  ignored entirely; `onCancel`.
- Pure functions moved into `selectionMask.ts` are exercised indirectly through Magic Wand/Select/
  Lasso's own tests (all pre-existing Magic Wand tests still pass unchanged, confirming the move was
  behavior-preserving).

## Verification performed

- `npx tsc -b --noEmit` - clean.
- `npx vitest run` - 106/106 passing.
- `npm run build` - production build succeeds.
- Manual Playwright smoke test against the running dev server, five rounds:
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
  - *Line round*: a plain diagonal drag (confirmed pixel-exact against the expected path), a Shift-held
    drag confirmed to snap to horizontal at the correct length (not the square-constrain result a
    copy-paste mistake would have produced), a brush-size-3 thick line with no gaps, right-click
    erasing a previously drawn line back to nothing, Escape mid-drag cancelling with nothing painted,
    and - since this migration touched shared code - re-confirmed Curve (bent bezier still draws
    correctly) and Gradient (Shift-snap axis still works) both still work unchanged.
  - *Eyedropper/Fill round*: picking a color from a freshly painted, distinctively-colored pixel and
    confirming both the hex readout and the toolbar's `aria-pressed` state switched to Pen; a rect
    outline drawn with Rect, then Fill clicked inside it flooding only the enclosed interior; a
    click *outside* the rect confirmed it stops at the border instead of leaking through; a
    Shift+click on the border recoloring every matching border pixel globally (not just the
    contiguous run under the cursor); three successive Undo presses unwinding all three paint
    operations cleanly back to the blank canvas - all confirmed via raw canvas pixel readback
    (`getImageData`), not just screenshots. (One early run of this round hit a false alarm: after
    switching tools via the toolbar, a stale pre-switch canvas coordinate missed the canvas because
    the options-bar height differs between tools and shifted the canvas's on-screen position - fixed
    by always recomputing `boundingBox()` immediately before each click, not a product-code bug.)
  - *Gradient round*: a plain horizontal drag across the whole canvas producing a smooth red→white
    blend confirmed via raw per-cell pixel readback; a Shift-held drag from a slightly diagonal raw
    target snapping to a byte-for-byte identical result as the plain horizontal drag (proving the angle
    snapped to exactly 0°, not just approximately); a right-click drag producing the color-reversed
    blend (still fully opaque - a "reversed gradient", not a real erase); enabling Dither mode and
    confirming the row collapsed to exactly two distinct hex values (the literal start/end colors) in a
    solid/stipple/solid band pattern, never a smooth blend. (Toggling the Dither checkbox by clicking
    its **text label** silently did nothing - a real, pre-existing UI bug unrelated to this migration,
    logged in `EDITOR_IMPROVEMENTS.md`: the checkbox's wrapping `<label>` contains a second, *nested*
    `<label>` around just the text, and a browser suppresses label-click-forwarding when the click
    target is itself a label. Worked around in the test by clicking the `[role="checkbox"]` element
    directly; confirmed via `aria-checked`/`data-state` before/after.)
  - No console/runtime errors in any run.
