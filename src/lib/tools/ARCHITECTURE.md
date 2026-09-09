# Pixel editor tool architecture

Response to `.claude/prompt/edit-pixeleditor.md`: a from-scratch architecture for the drawing-tool
engine. **All fourteen tools are migrated and wired into the live `PixelEditorEngine`**: Pen/Eraser,
Rect/Ellipse/Line, Magic Wand, Move, Select, Lasso, Eyedropper, Fill, Gradient, Spray, Curve. None of
`usePixelEditor.ts`'s original inline `if (this.tool === 'xxx')` gesture handling remains - every tool
now runs through `src/lib/tools/`.

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
    sprayTool.ts                    Spray
    curveTool.ts                     Curve
  __tests__/             vitest unit tests for all of the above (127 tests, no DOM)
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
inline bbox math (the engine's old `strokeDirtyRects`/`cellsDirtyRects`; the latter is now gone).

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
(`thickenPath` on the engine still stays; curve still uses it. `shapePreviewCells` was removed - see
below).

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

**Spray needed the first real interface extension: `Gesture.onTick?(ctx): ToolPreview | null`.** Every
other tool so far is purely event-driven (a `Gesture` only ever hears about pointer events), but Spray
is *also* timer-driven - the original's `sprayTick()` scatters dots on a fixed 55ms interval
(`SPRAY_INTERVAL_MS`) for as long as the gesture is held, **independent of whether the pointer is
moving at all** (hold still and it keeps stippling). A pure event-driven `Gesture` has no way to express
"also do something on a wall-clock schedule," so the engine now owns a single generic timer:
`beginToolGesture` checks `if (gesture.onTick) this.startGestureTimer();` right after creating the
gesture, and the timer's own callback just calls `this.activeGesture?.onTick?.(ctx)` through the same
`applyToolPreview` every other preview goes through - no new rendering path, no tool-specific code on
the engine at all. This replaces the old spray-only `sprayTimer`/`sprayPointerCell`/`sprayTick` trio
1:1 with `gestureTimer`/`startGestureTimer`/`stopGestureTimer`, generic enough that a future
timer-driven tool needs zero engine changes, just an `onTick` implementation. One original subtlety
`SprayGesture` had to preserve: the original scatters dots on **every pointermove event too**, not only
on the timer - `onPointerMove` and `onTick` both call the same private `scatterOps` helper, they're not
"track position on move, only paint on tick." `stopGestureTimer()` is called from every place the old
`stopSprayTimer()` was (`onPointerUp`'s unconditional top-of-method call, `resetGestureState`,
`endResizeDrag`/`endRotateDrag`'s defensive cleanup) plus one new generic call in `setTool()`
(`if (this.activeGesture) this.stopGestureTimer();`, replacing the old `if (this.tool === 'spray')`
check - harmless for the ten other tools that never start a timer).

**Curve needed the second and largest interface extension: a gesture that spans *more than one*
pointerdown-to-pointerup cycle.** Every other tool - even Spray with its timer - is fundamentally one
drag: begin, maybe move, end. Curve is genuinely two: drag out a straight line, release (which is
*not* the gesture ending - it hands off to a live bezier preview with a draggable control handle, with
no pointer button held at all), then a **second, separate** pointerdown either grabs that handle or
commits the curve. Four additions made this possible without breaking every other tool's simpler
one-drag assumption:
- `GestureResult.keepActive?: boolean` - true on the drag-end→bend transition result: the engine must
  *not* clear `activeGesture`, must *not* resolve the undo entry (no rollback, no "kept" decision) -
  the gesture is still ongoing, just between phases.
- `GestureResult.overlay`/`curvePreview` (paired with `keepActive`) - what to show for the new phase
  immediately, since a phase transition can't wait for a move event the way an ordinary preview does.
- `Gesture.onResumeDown?(e, ctx, nearControlPoint)` - the second pointerdown while `keepActive` is
  still in effect. Returns `{ preview }` (grabbed the handle - gesture stays active, applied like any
  other live preview) or `{ result }` (clicked elsewhere - finalizes exactly like a normal
  `onPointerUp`). `nearControlPoint` is resolved by the **engine**, not the tool - `isNearCurveControl`
  needs screen-space, zoom-aware hit-testing against the canvas's on-screen geometry, which only the
  engine has; the tool only ever sees already-resolved cell coordinates, same as every other tool.
- `Gesture.onKeyDown?(key, ctx)` - a key pressed while the gesture is active but not painting (e.g.
  Enter to commit during bend-idle). Returns `null` to let normal key handling continue - the engine
  only calls this when `activeGesture` exists at all, which nothing but Curve ever leaves set while not
  painting.

The engine wiring this required, roughly in the order a click actually flows through it:
- `onPointerDown` checks `this.activeGesture?.onResumeDown` **before** every other routing check
  (Magic Wand/Select-Lasso's move-routing, `TOOL_REGISTRY` dispatch) - otherwise a second click during
  bend-idle would start a brand new curve gesture instead of resuming the pending one, since `this.tool`
  is still `'curve'` and curve is *also* in `TOOL_REGISTRY` for its first click.
- `onKeyDown`'s Escape branch generalizes from a curve-specific `if (this.curvePhase)` check to
  `if (this.activeGesture)` calling the ordinary `cancelGesture()` - no bespoke `cancelCurve()` needed
  anymore. A new generic block right after it calls `this.activeGesture?.onKeyDown(e.key, ctx)` and, if
  it returns non-null, commits the result - this is what makes Enter-to-commit work, and is a no-op for
  every tool but Curve since nothing else implements `onKeyDown`.
- `commitGestureResult` gains a `keepActive` branch at its very top: apply `ops` (curve has none at the
  transition, but the code stays generic), mirror `curvePreview` into `curvePhase`/`curveControl`, paint
  the new phase's `overlay` if given (or just `reactNotify()` if not - releasing a control-handle drag
  reuses the bezier already drawn by the last `onPointerMove`, so there's nothing new to repaint, but the
  DOM-drawn handle still needs a React render to pick up the mirrored fields) - then returns immediately,
  skipping the undo-resolution/cleanup the non-keepActive path does.
- `cancelGesture()`'s own guard generalizes from `!this.painting && !this.curvePhase` to
  `!this.painting && !this.activeGesture` - `resetGestureState()` (which it already calls) already knew
  how to call `activeGesture.onCancel()` + erase the leftover overlay + clear `activeGesture`, from the
  very first migration; it just needed to additionally null out `curvePhase`/`curveControl` when it does
  (added right next to clearing `activeGesture`, harmless for every other tool since they're already null).
- `setTool()`'s curve-specific auto-commit-on-tool-switch-away generalizes to
  `this.activeGesture?.onKeyDown?.('Enter', ctx)`, committing if it returns non-null - matches the
  original's `commitCurve()` call there exactly (switching tools away always commits a pending curve,
  never silently discards it), but expressed generically instead of name-checking `'curve'`.

**Curve is still the only tool with any of `onTick`/`onResumeDown`/`onKeyDown`/`keepActive` at all** -
these exist purely because Curve genuinely needs them, not because the architecture anticipated more
timer- or multi-cycle-driven tools. A future tool needing similar behavior can reuse them as-is.

### Integration into `PixelEditorEngine`

A module-level `TOOL_REGISTRY` maps **every** `ToolName` -
`pen`/`eraser`/`rect`/`ellipse`/`line`/`magicWand`/`move`/`select`/`lasso`/`eyedropper`/`fill`/
`gradient`/`spray`/`curve` - to its `Tool`. `NO_UNDO_TOOLS` (`magicWand`/`select`/`lasso`/`eyedropper`) skips `pushGestureUndo()` for
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
replays `lastToolPointerEvent`, the last position `onPointerMove` saw. `resetGestureState()` erases any left-over
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
removable), and the `shapeStart` field. **Not removed** at the time (gradient/curve still needed them):
`constrainShapeEnd` and `thickenPath` on the engine. `constrainShapeEnd` went with Gradient's
migration; `thickenPath` is still live for curve. `shapePreviewCells` (and `redrawShapePreview`) went
with Curve's migration - see the shape-tool section above.

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

Migrating Spray removed, after the same re-verification discipline: the `if (this.tool === 'spray')`
branches in `onPointerDown`/`onPointerMove` (the last two things reaching either method's old shared
trailing block - once they're gone the whole block was unreachable and was deleted too, leaving both
methods ending in a plain comment noting every `ToolName` returns earlier now); and the spray-only
`sprayTimer`/`sprayPointerCell` fields plus `startSprayTimer`/`stopSprayTimer`/`sprayTick` methods,
replaced by the generic `gestureTimer`/`startGestureTimer`/`stopGestureTimer` described above.

Migrating Curve - the last tool - removed the most of any single step: the `if (this.tool === 'curve')`
branches in `onPointerDown`/`onPointerMove`/`onPointerUp`; the curve-specific Escape/Enter checks in
`onKeyDown` (replaced by the generic `activeGesture.onKeyDown`/`cancelGesture()` calls described above);
`commitCurve`/`cancelCurve` in full; `curveStart`/`curveEnd`/`curveDraggingControl` fields (confirmed
zero external readers, unlike `curvePhase`/`curveControl` - see below); and, once curve stopped being
the last caller, the engine's own `quadraticBezierCells`/`mirroredExpand`/`thickenPath` methods (ported
into `curveTool.ts`/already duplicated in `shapeTool.ts`). `clearCurveState()` **stays**, but its body
changed completely: the 7 unrelated call sites that use it (switching frames, pushing a new undo step,
sprite load/resize/reset - places where a pending curve draft must be silently dropped, not committed)
didn't need to change at all, since they just call the same method name; only what happens *inside* it
did, now routing through the generic `activeGesture.onCancel()` + `rollbackGestureUndo()` instead of
resetting curve-specific fields by hand. `curvePhase`/`curveControl` **stay as engine fields** -
confirmed via `PixelSelectionOverlay.tsx:27-28`, which reads them directly (screen-space, DOM-rendered
bend handle) - mirrored from the active `CurveGesture`'s own internal state via the new
`ToolPreview.curvePreview`/`GestureResult.curvePreview` fields, the same "mirror into legacy fields"
trick as `movePreview`/`gradientPreview`. `isNearCurveControl` also stays on the engine (screen-space
hit-testing needs the canvas's on-screen geometry, which only the engine has) - called from the new
`onPointerDown` wiring, not from tool code.

`shapePreviewCells`/`redrawShapePreview()`/`cellsDirtyRects()` were **removed** (2026-09-08) once Curve
- their last writer - was migrated. `refresh()`/`attachCanvas()` now just call `drawGrid()` with no
overlay argument, and the no-op `redrawShapePreview(null)` in `resetGestureState()` is gone. A
cancelled overlay preview is erased via `lastGesturePreviewRects` instead.

### Deviations found during implementation (worth flagging for future migration steps)

- **Pen/Eraser, Move, Gradient, and Spray never roll back their undo entry on a no-op release** (a click
  outside the active selection, a zero-delta move, a gradient drag that lands fully outside the
  selection, or a spray gesture that happens to change no pixel) - matching the *original*, which only
  rolls back Fill's undo entry on a no-op, not these four. `GestureResult.changed` is `true`
  unconditionally for all of them.
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
- **Two real bugs found and fixed while migrating Curve, both because unifying its cancel/rollback
  paths onto the shared generic mechanism exposed them "for free" rather than by deliberate hunting:**
  1. `commitGestureResult`'s "nothing changed" early-out never repainted `dirtyRects`, only rolled back
     the undo entry - harmless for tools whose live preview is itself empty when nothing changed
     (Magic Wand/Eyedropper), but every shape-like tool's live overlay is drawn **unclipped** (only the
     final commit filters by selection - see `ShapeGesture.update`/`CurveGesture.setPreview`, neither
     calls `withSelectionClip` for the preview, only the commit does). A rect/line/curve dragged
     *entirely* outside an active selection ends with `ops: []`/`changed: false` but a fully-visible
     overlay already painted onto the canvas bitmap - which the early-out never erased, stranding it on
     screen. Confirmed via Playwright (drag a rect outside a selection, read the canvas back - pixels
     were still there after release). Fixed by repainting `dirtyRects` even on the `!changed` path
     (harmless when there's nothing to erase, or the repainted cells are unchanged, e.g. Fill's
     same-color no-op) - this was presumably already correct in whatever pre-migration code Rect/
     Ellipse/Line's own migration replaced, and quietly regressed there without a test catching it.
  2. The original's `cancelCurve()` (Escape during bend-idle) never rolled back the undo entry
     `pushGestureUndo()` pushed at drag-end's start - an abandoned curve draft never writes real pixels,
     so restoring that snapshot would be a visual no-op, but the entry stayed on the undo stack forever
     (an extra no-op Ctrl+Z), and `gestureUndoState`'s stale `dirty`/`redoStack` bookkeeping got silently
     overwritten by whatever gesture ran next rather than ever being resolved. Migrating Curve onto the
     same `cancelGesture()`/`resetGestureState()` path every other tool's Escape already uses fixes this
     for free - `cancelGesture()` unconditionally calls `rollbackGestureUndo()` at its top. Accepted as a
     deliberate, documented improvement (not literal-original-behavior-preservation) since it has no
     observable downside and emerges naturally from *correctly generalizing* the architecture, which is
     the whole point of unifying per-tool bespoke state handling in the first place.

## Undo/redo is diff-based (2026-09-08)

`pushUndo()` no longer stores a full `structuredClone` of the frame stack per step. `undoStack`/
`redoStack` hold `HistoryEntry`s (see `src/lib/undoHistory.ts`) - a `'cells'` entry is just the
changed rectangle of the changed frame (both directions), `'full'` a snapshot pair for structural
changes. The single full snapshot taken at `pushUndo()` lives in `historyPending` and is compacted
into an entry lazily (`finalizeHistoryPending`, called from `pushUndo`/`undo`/`redo`).

For the gesture machinery this changes one thing: **`rollbackGestureUndo()` drops `historyPending`
instead of popping `undoStack`** - a gesture's baseline is never compacted onto the stack while the
gesture is in flight (nothing calls `pushUndo` between a gesture's `pushGestureUndo` and its
rollback/commit; curve bend-idle's only interposer, `clearCurveState`, routes through
`rollbackGestureUndo` itself). `cancelGesture()` still restores the returned snapshot via
`applyHistoryEntry` exactly as before.

## Migration plan - complete

All fourteen tools are migrated: **pen, eraser, rect, ellipse, line, magicWand, move, select, lasso,
eyedropper, fill, gradient, spray, curve.** Nothing remains on the legacy inline `if (this.tool ===
'xxx')` architecture. The points below are kept as historical context for whoever extends this
architecture next (a new tool, or a deeper refactor of what's here) - they were written while curve was
still the only tool left, and turned out to matter exactly as described:
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

`npm test` (`vitest run`) - 127 tests, all pure logic, no DOM/canvas:
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
- **SprayTool**: `onPointerMove` scatters dots immediately, not just on a timer tick (`Math.random`
  mocked to make dot placement deterministic); dot count scales with brush size and density exactly as
  `dots = round((brushSize + 1) * density)`; right-click erases; dither mode picks only the literal
  primary/secondary hex, never a blend; a selection restricts dots to inside it; symmetry mirrors each
  dot with one shared color (not Fill's independent-per-mirror sampling); `onTick` scatters around the
  *last* position `onPointerMove` reported, not the original `beginGesture` cell; `onPointerUp` paints
  nothing further and always reports `changed: true`; `onCancel`.
- **CurveTool**: drag-end phase previews a straight bresenham line and mirrors `{phase:'drag-end',
  control:null}` into `curvePreview`; a zero-length drag cancels instead of transitioning to bend; a
  real drag transitions to bend on release (`keepActive`, correct midpoint control, bezier overlay, no
  `ops` yet); `onPointerMove` returns `null` during bend-idle (hovering with no button held paints
  nothing); `onResumeDown` near the control point starts dragging it (returns `{preview}`, gesture stays
  active); `onResumeDown` away from the control point commits (`{result}`, exact bezier cells, real
  `changed:true`); Enter commits during bend-idle the same as clicking away; `onKeyDown` returns `null`
  outside bend-idle or for keys it doesn't handle; right-click erases on commit without ever setting a
  null color mid-drag; a selection restricts only the final commit (the live preview itself is
  unclipped); symmetry mirrors the live preview; `onCancel`.
- Pure functions moved into `selectionMask.ts` are exercised indirectly through Magic Wand/Select/
  Lasso's own tests (all pre-existing Magic Wand tests still pass unchanged, confirming the move was
  behavior-preserving).

## Verification performed

- `npx tsc -b --noEmit` - clean.
- `npx vitest run` - 127/127 passing.
- `npm run build` - production build succeeds.
- Manual Playwright smoke test against the running dev server, eight rounds:
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
  - *Spray round*: painted-pixel count kept growing while the pointer held perfectly still (proving the
    wall-clock timer paints on its own, not only in response to pointermove), a drag scattered dots
    along the whole path, a right-click-held drag over the same area reduced the count (erase works),
    Escape mid-drag rolled the count back to exactly 0 and the timer stopped (no further growth
    afterward), and switching tools mid-drag via a toolbar click also stopped the timer cleanly (count
    unchanged 300ms later) - confirmed a keyboard tool-shortcut mid-drag does *not* switch tools at all
    (a separate, pre-existing, intentional guard: only Escape is let through while `painting` is true),
    so that path had to be tested via a toolbar click instead, not treated as a bug.
  - *Curve round*: the full sequence end-to-end - drag the initial line, confirm the control handle
    (`.pixel-curve-handle`) appears, drag it to bow the curve, release (handle stays visible - still
    bend phase, not done), click away to commit, confirmed the committed pixel count matches what the
    live overlay already showed (14 painted cells both before and after commit - the overlay was an
    accurate preview) and the handle disappears; Undo removed it cleanly. Separately: Enter-to-commit
    produces the same shape of result as click-away; Escape mid-initial-drag (button still held)
    cancels with nothing painted and no handle ever appearing; Escape during bend-idle makes the handle
    disappear with nothing painted (confirmed this also exercises the fixed orphaned-undo-entry
    behavior, not just a visual check); switching tools away mid-bend via a toolbar click auto-commits
    (painted count > 0, handle gone) - all via raw canvas pixel readback, not just screenshots.
  - *Regression round (this batch touched `onKeyDown`/`setTool`/`cancelGesture`/`commitGestureResult`,
    shared code every tool goes through)*: Pen Escape mid-stroke still cancels cleanly; Rect drag +
    undo still works; Select Escape mid-marquee-drag still leaves no leftover dashed box (after
    correctly distinguishing "no leftover draft" from "an earlier, unrelated settled selection is still
    there" - selections aren't part of pixel undo history, so a prior `Ctrl+Z` doesn't clear one);
    and the specific scenario the `commitGestureResult` dirty-rect fix targets - a Rect dragged
    *entirely* outside an active selection - confirmed via pixel readback that no stray overlay pixels
    are left on screen after release (before the fix, this exact scenario reproduced the bug).
  - No console/runtime errors in any run.

## Follow-up cleanup: the engine's leftover copies removed (2026-09-09)

The tool migration left `PixelEditorEngine` holding its own private, byte-for-byte identical copies of
seven functions this directory already owned: `maskFromSelection`, `boundingBoxOfMask`,
`maskBoundaryEdges`, `chainBoundaryEdges`, `traceMaskOutline`, `masksEqual` and `polygonMask` (plus
`boundingBoxOfPoints`, only ever called by that `polygonMask`). The tools ran on the shared versions,
the engine ran on its own - two implementations of the same tricky grid-line/even-odd geometry that
could silently drift apart. All eight are gone; the engine imports from `selectionMask.ts` now.

To make that possible, `maskFromSelection` and `settleSelection` take a new `SelectionState` interface
(just `selection` + `selectionMask`) instead of a full `ToolContext`, which both a `ToolContext` and the
engine itself satisfy structurally - so the engine no longer has to build a whole ToolContext just to
settle a selection. The engine's `applySelectionMask` survives as a four-line wrapper that writes
`settleSelection`'s result into engine fields; its one remaining caller is `commitRotate`.

Two more consolidations in the same pass, both outside this directory:

- **`translateSelectionBy(dx, dy)`** on the engine. The "shift the selection box, the lasso outline and
  the mask by a delta" block was copy-pasted verbatim in three places (`commitMove`, `nudgeSelection`,
  and `commitGestureResult`'s `moveSelectionBy` branch) - three chances for a Move-tool drag, an
  arrow-key nudge and a legacy drag-commit to settle selection geometry differently. `shiftMask` moved
  into `selectionMask.ts` alongside the rest of the mask machinery.
- **`src/lib/download.ts` and `src/lib/spriteExport.ts`.** `downloadBlob` existed three times (both
  engines and `data/backup.ts`, the last of which revoked its object URL synchronously rather than on
  a timer - now it does not). The frame/sheet/JSON exports moved out of the engine wholesale: they
  read nothing but the sprite and the frame index, and each had its own copy of the export-scale
  formula and the "name or 'sprite'" filename fallback.

`usePixelEditor.ts`: 3972 -> 3728 lines. Verified with `tsc -b` (`noUnusedLocals` on, so a missed
caller or a dead import fails the build), the full 273-test suite, `oxlint` (warning count unchanged),
and `npm run build`.

## Two bugs the duplicated-block pattern was hiding (2026-09-09)

Both found by looking for repeated blocks, not by looking for bugs - which is the point: each was a
long list of field assignments copy-pasted between code paths that have to end up in the same state,
where one copy had quietly fallen behind the other.

**Switching tanks carried the previous tank's water level and algae over** (`useTank.ts`).
`refresh()` - which is how `switchTank`, `createTank` and the remote-sync reload all land a tank -
copied `loadEverything`'s "apply TankState to engine fields" block but stopped three fields short:
`waterLevel`, `algae` and `lastTickAt`. Because `snapshotForStorage()` reads those same fields straight
back out, this was not just a display bug: the next save wrote the *old* tank's water level and algae
onto the tank that had been switched to, and a brand new tank inherited whatever algae the previous one
had grown. Now one `applyTankState(tankId, state)` that both paths call, with the catch-up replay
(`catchUpSince`) alongside it - so switching to a tank untouched for three days replays those three
days exactly as opening the app on it would. The predator roll deliberately stays in `loadEverything`
only: it is once per app load, not once per tank switch.

**Deleting the sprite you were editing could crash the canvas** (`usePixelEditor.ts`). The
`deleteSprite` branch that swaps in a blank sprite was a third partial copy of the swap block, missing
`frameIndex`/`previewFrame`, the zoom reset and the undo stacks. `blankSprite()` has exactly one frame,
so deleting while on frame 3 left `frameIndex` at 3 and the next `drawGrid()` called
`paintLayers(ctx, frames[3])` - `undefined.forEach`, a hard TypeError - and an undo afterwards could
pull the deleted sprite's pixels back onto the blank one. `newSprite` had separately drifted too
(missing `previewFrame`). All four paths (new / load / import / delete-the-open-one) now go through one
`adoptSprite(sprite, dirty)`; `dirty` is the only thing that legitimately differed between them.

`src/hooks/__tests__/usePixelEditor.test.ts` is new (6 tests) and `PixelEditorEngine` is now a value
export to make it possible, the same way `TankEngine` already was - every DOM-touching method already
guarded on a null canvas, so a bare `new PixelEditorEngine()` is a working headless engine. The
repository seam it needed already existed (`setRepos`), so `deleteSprite` is tested without mocking a
module. Both fixes were confirmed to be real by reverting each one and watching the new tests fail
(the frame-index one fails with `expected 3 to be +0`), then restoring it.

## Third pass: the copies outside the engine classes (2026-09-09)

**`cellGeometry.ts` is new** and holds the four helpers this directory had been carrying multiple
byte-identical copies of: `brushCellsAt` (three copies - Pen, Line/Rect/Ellipse, Curve), `thickenPath`
and `mirrorExpand` (two each - shapeTool and curveTool), and `inBounds` (two - Select and Lasso). Each
copy carried a comment explaining why it was a copy ("small and stable enough that a shared import
isn't worth it for two callers"), and those comments had gone stale in both directions: `brushCellsAt`
had grown to three callers, and `thickenPath`'s said the engine still used it, which stopped being true
when Curve was migrated. `colorsMatch` (Fill and Magic Wand) went to `pixelMath.ts` instead - it is
plain color math sitting directly next to the `hexToRgb` it calls, with nothing tool-specific about it.

**What was NOT unified, deliberately:** `constrainToAngle` vs `constrainToSquare`, and
`resolveMarqueeMode` vs `resolveWandCombine`. Both pairs look similar and mean different things; the
warnings against merging them are above and still stand. Identical bodies were the bar for this pass.

**`ptr()` in the tool tests** existed eleven times, once per test file, identical every time. It now
lives in `__tests__/testUtils.ts` next to `makeFrame`/`makeContext`.

**`PixelThumb.tsx` is new** (`src/components/`). Five components were drawing the same
clear/scale-to-fit/center/paint sequence into a square canvas at five different sizes: `LibraryThumb`
(48), `GalleryThumb` (64), `PaletteThumb` (32, the only parametrized one), `FrameThumb` (52) and
`LayerThumb` (26). `paint` stayed a callback because the three things being drawn are genuinely
different - a sprite's first frame, one frame's layer stack, and a single layer's cells *ignoring* its
visibility (a hidden layer still has to be identifiable in the layer list, so that one cannot go through
`paintLayers`). The `deps` prop preserves a real difference the copies had: the sprite thumbnails
repaint when the sprite changes, while the frame strip and layer list repaint on **every** render,
because the engine mutates those cells in place and there is no value React could compare. Omitting
`deps` gives the every-render behavior. `SpriteThumb` wraps the common case.

**`components/gallery/`** holds what `GalleryDialog` and `TankGalleryDialog` had in common: cursor
pagination (`useGalleryPage` - reset on open, append on page, the short-page-means-no-more rule, and
turning a failed request into an error plus an empty list rather than a dialog stuck on "loading"), the
report flow (`useContentReport`), the modal chrome and report form (`GalleryFrame`), and the flag
button (`ReportButton`). The two dialogs keep only what actually differs: a grid of sprite cards with a
copy button, and a list of tank rows with an open button. This also collapsed a duplicated
`set-state-in-effect` lint warning into one.

Verified with `tsc -b`, 282 tests, `npm run build`, and - because most of this is UI that no unit test
covers - the three existing Playwright smoke scripts against a real dev server: `gallery-ui-smoke`
(14/14), `tank-gallery-ui-smoke` (10/10) and `tanks-ui-smoke` (20/20, which exercises the tank-switching
path the `applyTankState` fix above landed in). Note those scripts hardcode port 5173; a second dev
server on 5174 needs the URL overridden or it silently tests whatever is on 5173.

## Fourth pass: a comment turned into a constraint (2026-09-09)

`src/lib/selectionTransform.ts` is new and holds the resize/rotate geometry that was four private
methods on the engine: `buildResizePreview` -> `scaledRegionCells`, `computeResizedBox` -> `resizedBox`,
`computeRotatePreview` -> `rotatedRegionCells`, and `rotatedSelectionMask` -> `rotatedMask`. All four
are pure functions of a box, a captured region and an angle, and none of them could be tested where they
were: reaching them meant a live engine and a DOM canvas.

The reason for doing it, though, was not testability. `rotatedSelectionMask`'s doc comment said the
mask had to reuse "the exact mapping computeRotatePreview used for the pixels" because "any independent
derivation drifts from where the pixels actually went" - and then, directly underneath, re-derived that
mapping: its own `cx`/`cy`/`cos`/`sin`, its own inverse-rotate expression. The two happened to agree
(confirmed algebraically: one floors into region-local coordinates and the other into canvas
coordinates, and `origin.x0` is an integer, so `floor(v - x0) === floor(v) - x0`), but nothing except
that comment was keeping them agreeing. They are now one `inverseRotation(origin, angle)` object that
both functions call, so the promise is structural.

`src/lib/__tests__/selectionTransform.test.ts` (12 tests) covers it, including that property directly:
for six different angles, the cells `rotatedMask` marks are exactly the cells `rotatedRegionCells`
painted. Also covered: that a resize duplicates whole cells rather than blending two colors into a
third (it is pixel art - an interpolated resize would invent colors that are not in the palette), that
the corners of a rotated bounding box stay empty rather than smearing edge pixels into them (the
regression the "skipped, not clamped" comment describes), and the off-canvas case.

`MoveBufferCell` and the new `ColoredCell` were the same interface; the engine now uses `ColoredCell`.

**One lint warning was a real (small) bug.** `TankCanvas`'s two tank-size fields synced themselves from
the engine in an effect, so a size the engine set itself - a preset, a reset, switching to a
differently-sized tank - painted one frame showing the *previous* tank's numbers before correcting
itself. They now catch up during render, compared against the size the fields were last filled from.

**Three `set-state-in-effect` warnings were left alone deliberately**, in `useGallery`, `SharedTankView`
and `TankSharePanel`. All three are the same shape: reset to a loading state, then start a network
request. That is an effect synchronizing with an external system, which is what the rule's own help
text says effects are for; the warning is aimed at the reset line, and the contortion needed to silence
it would make the code worse, not better. The three `only-export-components` warnings are in
shadcn-generated `components/ui/` files and would be undone by the generator.

Verified with `tsc -b`, 294 tests, `npm run build`, `oxlint` (7 -> 6 warnings), and against a real dev
server: `tanks-ui-smoke` 20/20, `gallery-ui-smoke` 14/14, plus a throwaway 8-check script for the size
fields specifically - that a half-typed number stays in the field without resizing the tank, that
committing applies it, and that a size the engine chose shows up in the field and matches what is drawn.
