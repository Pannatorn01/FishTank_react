import type { Cell, Frame, SelectionBox, SelectionMode, SymmetryMode, ToolName } from '../types';

/** A pointer event already resolved to canvas cell coordinates - the engine converts raw DOM pointer
 *  events into this before handing them to a Tool/Gesture, so tool logic never touches the DOM. */
export interface ToolPointerEvent {
  cell: Cell;
  shiftKey: boolean;
  altKey: boolean;
  /** ctrlKey || metaKey, pre-resolved by the engine (matches every call site's own `e.ctrlKey ||
   *  e.metaKey` check). */
  ctrlKey: boolean;
  /** 0 = left, 2 = right. */
  button: number;
  /** Pen/Eraser only: when Shift is held on the initial click and a valid last-stroke-end cell exists
   *  (see `strokeChainAnchor`, usePixelEditor.ts:2619-2624), the engine resolves and passes it here so
   *  the new stroke starts as a bresenham-interpolated line from that anchor instead of a single dot. */
  chainFrom?: Cell | null;
}

/** Read-only engine state a tool needs to decide what to paint/select - deliberately a plain data
 *  bag + one reader function, not the engine instance itself, so tool logic is unit-testable without
 *  a live PixelEditorEngine or DOM canvas. */
export interface ToolContext {
  width: number;
  height: number;
  /** Reads the active layer's current frame. Reflects any writes already committed earlier in the
   *  same gesture (e.g. a freehand stroke's own progressive paints), matching how the original
   *  engine's `activeCells()` array read/write in place. */
  getCell(x: number, y: number): string | null;
  color: string;
  secondaryColor: string;
  brushSize: number;
  ditherEnabled: boolean;
  pixelPerfect: boolean;
  shapeFilled: boolean;
  symmetry: SymmetryMode;
  symmetryAxisX: number;
  symmetryAxisY: number;
  selection: SelectionBox | null;
  selectionMask: ReadonlySet<string> | null;
  fillTolerance: number;
  /** Magic Wand only: the sticky "every matching pixel in the layer" toggle (see `wandContiguous`,
   *  usePixelEditor.ts) - Shift always forces global-select on top of this regardless of its value. */
  wandContiguous: boolean;
  /** What a new selection-producing click/drag does to the existing selection when no modifier key
   *  overrides it (see SelectionMode's own doc comment in ../types.ts). */
  selectionMode: SelectionMode;
}

/** One cell write. `color: null` erases. */
export interface PaintOp {
  x: number;
  y: number;
  color: string | null;
}

/** What a settled selection-producing gesture (Magic Wand) hands back - mirrors the engine's own
 *  selection/selectionMask/lassoPoints trio (see applySelectionMask in usePixelEditor.ts) so the
 *  engine can assign them directly. `box: null` means "selection cleared". */
export interface SelectionResult {
  box: SelectionBox | null;
  mask: ReadonlySet<string> | null;
  outline: Cell[] | null;
}

export interface GestureResult {
  /** Cells to commit now (on top of anything already committed progressively via ToolPreview.ops
   *  during the drag - see Gesture's own doc comment). Already pipeline-composed (symmetry +
   *  selection-clip applied). */
  ops: PaintOp[];
  /** Canvas-clamped regions the engine should repaint for this final commit. */
  dirtyRects: SelectionBox[];
  /** Whether this gesture actually changed anything - drives whether the engine keeps or rolls back
   *  the undo entry it pushed at gesture start. Defaults to `ops.length > 0` at call sites that don't
   *  need progressive commits; tools that paint progressively during onPointerMove (Pen/Eraser) must
   *  set this explicitly since their final `ops` array is often empty. */
  changed: boolean;
  /** Set by `onCancel` - tells the engine to ignore `ops`/`dirtyRects` entirely and roll back to its
   *  pre-gesture undo snapshot instead (which also undoes any progressive ToolPreview.ops writes). */
  cancelled?: boolean;
  /** Magic Wand only: the new selection state to assign. */
  selection?: SelectionResult;
  /** Move only: shift the existing selection/mask/lassoPoints by this delta instead of via `ops`
   *  (matches commitMove, usePixelEditor.ts:1696-1701 - selection geometry isn't a paint op). */
  moveSelectionBy?: { dx: number; dy: number };
  /** Pen/Eraser only: where the stroke ended, so the engine can update `lastStrokeEndCell` for the
   *  next stroke's Shift-chain (see ToolPointerEvent.chainFrom and usePixelEditor.ts:2898-2900). */
  finalCell?: Cell;
}

/** What a gesture wants drawn while it's still in progress. Exactly one of `ops`/`overlay` is set:
 *  - `ops` (Pen/Eraser): cells the engine should write into the real frame *immediately* - freehand
 *    strokes have always painted progressively as you drag, not just on release.
 *  - `overlay` (shapes, curve): cells to draw on top of the existing repaint *without* touching the
 *    frame yet - a tentative preview, committed only via GestureResult.ops on release. Mirrors
 *    `redrawRegions(rects, overlay)`'s existing single-color-cells signature exactly
 *    (usePixelEditor.ts:3462), so the engine's repaint code needs no changes for these two tools.
 */
export interface ToolPreview {
  ops?: PaintOp[];
  overlay?: { cells: Cell[]; color: string } | null;
  dirtyRects: SelectionBox[];
  /** Move only: floating-buffer live-drag state. Ported as data, not rendering - the engine mirrors
   *  this straight into its own pre-existing `moveBuffer`/`moveDelta` fields so the unchanged legacy
   *  `gestureBaseBitmap`/`drawGrid` fast path (usePixelEditor.ts:1919-1933, kept exactly as-is per its
   *  own doc comment at :3459 explaining why it deliberately isn't dirty-rect-scoped) keeps rendering
   *  it, instead of this new architecture reinventing that optimization. */
  movePreview?: { cells: { x: number; y: number; color: string }[]; dx: number; dy: number };
  /** Select only: live marquee box while dragging - metadata mirrored straight into the engine's own
   *  `selectionDraft` field for `PixelSelectionOverlay.tsx` to read (a DOM-drawn dashed rect, not
   *  canvas). `null` while a drag is active but produces no box yet is distinct from "not this tool" -
   *  use `undefined` for the latter (see applyToolPreview's own doc comment on how these are told
   *  apart). Never touches the canvas bitmap - a marquee drag doesn't paint anything. */
  selectionDraft?: SelectionBox | null;
  /** Lasso only: live freeform path while dragging - mirrored into `lassoDraftPoints` the same way. */
  lassoDraftPoints?: Cell[] | null;
}

export interface Gesture {
  readonly kind: string;
  onPointerMove(e: ToolPointerEvent, ctx: ToolContext): ToolPreview | null;
  onPointerUp(e: ToolPointerEvent, ctx: ToolContext): GestureResult;
  /** Esc / window blur / two-button abort. Must never leave a half-applied edit - any cells already
   *  committed progressively (via ToolPreview.ops) are rolled back by the engine re-restoring its
   *  pre-gesture undo snapshot, not by this method. */
  onCancel(ctx: ToolContext): GestureResult;
}

export interface Tool {
  readonly name: ToolName;
  /** Returns null for a click this tool doesn't turn into a drag gesture at all (reserved for tools
   *  migrated later that have instant, non-drag click behavior alongside a real gesture). */
  beginGesture(e: ToolPointerEvent, ctx: ToolContext): Gesture | null;
}

export type { Cell, Frame, SelectionBox, SelectionMode, SymmetryMode, ToolName };
