import { bresenhamLine, ditherColorAt } from '../../pixelMath';
import type { Cell } from '../../types';
import { withSelectionClip, withSymmetry, type CellWriter } from '../paintPipeline';
import { DirtyRectTracker } from '../dirtyRect';
import type { Gesture, GestureResult, PaintOp, Tool, ToolContext, ToolPointerEvent, ToolPreview } from '../types';

/** Top-left-anchored square of side `brushSize` centered as closely as possible on (x, y) - ports
 *  `brushCellsAt` (usePixelEditor.ts:3276-3286). */
function brushCellsAt(x: number, y: number, brushSize: number): Cell[] {
  if (brushSize <= 1) return [{ x, y }];
  const off = Math.floor((brushSize - 1) / 2);
  const cells: Cell[] = [];
  for (let dy = 0; dy < brushSize; dy++) {
    for (let dx = 0; dx < brushSize; dx++) cells.push({ x: x - off + dx, y: y - off + dy });
  }
  return cells;
}

/** Freehand pen/eraser gesture. Paints progressively as the pointer moves (ToolPreview.ops, applied
 *  to the real frame immediately by the engine) rather than deferring everything to release - matches
 *  the original `paintCell`/`strokeStep` (usePixelEditor.ts:3358-3372, 3526-3551) exactly, including:
 *  bresenham-interpolating between coalesced move points so a fast drag doesn't skip cells, brush
 *  footprint + symmetry + selection-clip per point, the "dither brush" stipple, and Pixel-Perfect
 *  corner trimming (only for brush size 1, only while painting - never erasing). */
class PenGesture implements Gesture {
  readonly kind = 'pen';
  private lastCell: Cell;
  private strokePoints: Cell[] = [];
  private strokeVisits = new Map<string, number>();
  /** Pre-stroke value of every cell touched so far, captured lazily on first touch - lets corner-trim
   *  restore exactly what `restoreCellFromSnapshot` restored, without needing a whole-frame copy. */
  private original = new Map<string, string | null>();
  private erase: boolean;

  constructor(erase: boolean, start: Cell, chainFrom: Cell | null) {
    this.erase = erase;
    // Shift+click resumes from the last stroke's end as a straight (bresenham-interpolated) line -
    // ports the `anchor`/`lastPaintCell` setup in onPointerDown's pen/eraser fallback branch
    // (usePixelEditor.ts:2610-2613). Per the engine integration contract, `onPointerMove` is called
    // once with the same down event immediately after `beginGesture` returns - that first call is
    // what actually paints, interpolating from `lastCell` (the chain anchor, if any) to `start`.
    this.lastCell = chainFrom ?? start;
  }

  private captureOriginal(x: number, y: number, ctx: ToolContext): string | null {
    const key = `${x},${y}`;
    if (!this.original.has(key)) this.original.set(key, ctx.getCell(x, y));
    return this.original.get(key)!;
  }

  private pixelPerfectActive(ctx: ToolContext): boolean {
    return ctx.pixelPerfect && ctx.brushSize === 1 && !this.erase;
  }

  /** One raw stroke point: paints its brush footprint (mirrored, selection-clipped, dither-resolved),
   *  then - if Pixel Perfect applies - tracks it for corner trimming and trims the previous corner if
   *  this point closes an L-turn. Ports `strokeStep` (usePixelEditor.ts:3358-3372). */
  private paintRawPoint(p: Cell, ctx: ToolContext, ops: PaintOp[], dirty: DirtyRectTracker): void {
    const baseColor = this.erase ? null : ctx.color;
    const dither = ctx.ditherEnabled && baseColor !== null;
    const write = (x: number, y: number, color: string | null) => {
      if (x < 0 || y < 0 || x >= ctx.width || y >= ctx.height) return;
      this.captureOriginal(x, y, ctx);
      ops.push({ x, y, color });
      dirty.addCell(x, y, 1);
    };
    const resolveAndWrite: CellWriter = (op) => {
      write(op.x, op.y, dither ? ditherColorAt(op.x, op.y, baseColor!, ctx.secondaryColor, 0.5) : op.color);
    };
    const sink = withSymmetry(
      ctx.symmetry,
      ctx.symmetryAxisX,
      ctx.symmetryAxisY,
      withSelectionClip(ctx.selection, ctx.selectionMask, resolveAndWrite)
    );
    brushCellsAt(p.x, p.y, ctx.brushSize).forEach((cell) => sink({ x: cell.x, y: cell.y, color: baseColor }));

    if (!this.pixelPerfectActive(ctx)) return;
    const last = this.strokePoints[this.strokePoints.length - 1];
    if (last && last.x === p.x && last.y === p.y) return;
    this.strokePoints.push(p);
    const key = `${p.x},${p.y}`;
    this.strokeVisits.set(key, (this.strokeVisits.get(key) ?? 0) + 1);
    this.applyCornerTrim(ctx, ops, dirty);
  }

  /** Ports `applyPixelPerfectCorner` (usePixelEditor.ts:3338-3356). */
  private applyCornerTrim(ctx: ToolContext, ops: PaintOp[], dirty: DirtyRectTracker): void {
    const n = this.strokePoints.length;
    if (n < 3) return;
    const a = this.strokePoints[n - 3];
    const b = this.strokePoints[n - 2];
    const c = this.strokePoints[n - 1];
    if (Math.abs(c.x - a.x) !== 1 || Math.abs(c.y - a.y) !== 1) return;
    const isCorner = (b.x === a.x && b.y === c.y) || (b.x === c.x && b.y === a.y);
    if (!isCorner) return;
    const key = `${b.x},${b.y}`;
    const remaining = (this.strokeVisits.get(key) ?? 1) - 1;
    this.strokeVisits.set(key, remaining);
    if (remaining <= 0) {
      const restore: CellWriter = (op) => {
        if (op.x < 0 || op.y < 0 || op.x >= ctx.width || op.y >= ctx.height) return;
        ops.push({ x: op.x, y: op.y, color: this.captureOriginal(op.x, op.y, ctx) });
        dirty.addCell(op.x, op.y, 1);
      };
      withSymmetry(ctx.symmetry, ctx.symmetryAxisX, ctx.symmetryAxisY, restore)({ x: b.x, y: b.y, color: null });
    }
    this.strokePoints.splice(n - 2, 1);
  }

  /** Interpolates from the last processed point to `to` via bresenham (so a fast drag's coalesced
   *  move still paints a continuous line, per `paintCell`'s `isMove` branch, usePixelEditor.ts:3531-
   *  3532) and paints every point along it. */
  private paintTo(to: Cell, ctx: ToolContext): ToolPreview {
    const points = bresenhamLine(this.lastCell.x, this.lastCell.y, to.x, to.y);
    this.lastCell = to;
    const ops: PaintOp[] = [];
    const dirty = new DirtyRectTracker();
    points.forEach((p) => this.paintRawPoint(p, ctx, ops, dirty));
    return { ops, dirtyRects: dirty.toRects(ctx.width, ctx.height) };
  }

  onPointerMove(e: ToolPointerEvent, ctx: ToolContext): ToolPreview | null {
    return this.paintTo(e.cell, ctx);
  }

  onPointerUp(e: ToolPointerEvent, ctx: ToolContext): GestureResult {
    const preview = this.paintTo(e.cell, ctx);
    // Always kept, even if this stroke touched nothing (e.g. a click entirely outside an active
    // selection) - the original never rolls back a pen/eraser gesture the way it does for Fill; only
    // Escape (onCancel) discards it. See onPointerDown's unconditional `pushGestureUndo()` before the
    // pen/eraser fallback branch (usePixelEditor.ts:2563-2565, 2605-2614).
    return { ops: preview.ops ?? [], dirtyRects: preview.dirtyRects, changed: true, finalCell: this.lastCell };
  }

  onCancel(): GestureResult {
    return { ops: [], dirtyRects: [], changed: false, cancelled: true };
  }
}

export function createPenTool(erase: boolean): Tool {
  return {
    name: erase ? 'eraser' : 'pen',
    beginGesture(e) {
      // Right-click erases with any painting tool (`ERASABLE_TOOLS`/`eraseOverride` in
      // usePixelEditor.ts) - resolved once per gesture, exactly like the original `currentPaintColor()`
      // returning null for either the Eraser tool *or* a right-button drag. It also switches off
      // Pixel Perfect for that gesture (see pixelPerfectActive), same as the original did.
      return new PenGesture(erase || e.button === 2, e.cell, e.chainFrom ?? null);
    },
  };
}
