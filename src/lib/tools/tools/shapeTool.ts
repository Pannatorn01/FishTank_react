import { bresenhamLine, inEllipseLocal } from '../../pixelMath';
import type { Cell } from '../../types';
import { withSelectionClip, type CellWriter } from '../paintPipeline';
import { DirtyRectTracker } from '../dirtyRect';
import { mirrorExpand, thickenPath } from '../cellGeometry';
import type { Gesture, GestureResult, PaintOp, Tool, ToolContext, ToolPointerEvent, ToolPreview } from '../types';

type Shape = 'rect' | 'ellipse' | 'line';

/** Shift-constrain to a square/circle - the rect/ellipse branch of `constrainShapeEnd`
 *  (usePixelEditor.ts:3029-3047; see constrainToAngle below for the line/gradient branch there). */
function constrainToSquare(start: Cell, end: Cell): Cell {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) return end;
  const side = Math.max(Math.abs(dx), Math.abs(dy));
  return { x: start.x + (dx < 0 ? -side : side), y: start.y + (dy < 0 ? -side : side) };
}

/** Shift-constrain to the nearest 0/45/90° increment, keeping the dragged distance - the line/gradient
 *  branch of the now-removed `constrainShapeEnd` (originally usePixelEditor.ts:2982-3001). Exported for
 *  gradientTool.ts's own reuse - Line and Gradient are the two tools that shift-constrain to an angle
 *  rather than a square. */
export function constrainToAngle(start: Cell, end: Cell): Cell {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) return end;
  const step = Math.PI / 4;
  const angle = Math.round(Math.atan2(dy, dx) / step) * step;
  const dist = Math.round(Math.hypot(dx, dy));
  return { x: start.x + Math.round(Math.cos(angle) * dist), y: start.y + Math.round(Math.sin(angle) * dist) };
}

/** Ports the rect/ellipse/line branches of `computeShapeCells` (usePixelEditor.ts:3070-3110). */
function shapeCells(shape: Shape, start: Cell, end: Cell, brushSize: number, filled: boolean): Cell[] {
  if (shape === 'line') return thickenPath(bresenhamLine(start.x, start.y, end.x, end.y), brushSize);
  const x0 = Math.min(start.x, end.x);
  const x1 = Math.max(start.x, end.x);
  const y0 = Math.min(start.y, end.y);
  const y1 = Math.max(start.y, end.y);
  const cells: Cell[] = [];
  if (shape === 'rect') {
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const nearEdge = x - x0 < brushSize || x1 - x < brushSize || y - y0 < brushSize || y1 - y < brushSize;
        if (filled || nearEdge) cells.push({ x, y });
      }
    }
    return cells;
  }
  const cx = (x0 + x1) / 2 + 0.5;
  const cy = (y0 + y1) / 2 + 0.5;
  const rx = Math.max(0.5, (x1 - x0 + 1) / 2);
  const ry = Math.max(0.5, (y1 - y0 + 1) / 2);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (!inEllipseLocal(x + 0.5, y + 0.5, cx, cy, rx, ry)) continue;
      if (filled) {
        cells.push({ x, y });
        continue;
      }
      if (!inEllipseLocal(x + 0.5, y + 0.5, cx, cy, Math.max(0.5, rx - brushSize), Math.max(0.5, ry - brushSize))) cells.push({ x, y });
    }
  }
  return cells;
}

class ShapeGesture implements Gesture {
  readonly kind: string;
  private start: Cell;
  private previewCells: Cell[] = [];
  private readonly eraseOverride: boolean;
  private shape: Shape;

  constructor(shape: Shape, start: Cell, button: number) {
    this.shape = shape;
    this.kind = shape;
    this.start = start;
    this.eraseOverride = button === 2;
  }

  private computePreview(end: Cell, ctx: ToolContext): Cell[] {
    const raw = shapeCells(this.shape, this.start, end, ctx.brushSize, ctx.shapeFilled);
    return mirrorExpand(raw, ctx.symmetry, ctx.symmetryAxisX, ctx.symmetryAxisY);
  }

  private update(e: ToolPointerEvent, ctx: ToolContext): ToolPreview {
    const constrain = this.shape === 'line' ? constrainToAngle : constrainToSquare;
    const end = e.shiftKey ? constrain(this.start, e.cell) : e.cell;
    const next = this.computePreview(end, ctx);
    const dirty = new DirtyRectTracker();
    dirty.addCells(this.previewCells);
    dirty.addCells(next);
    this.previewCells = next;
    const color = this.eraseOverride ? 'rgba(255,255,255,0.45)' : ctx.color;
    return { overlay: { cells: next, color }, dirtyRects: dirty.toRects(ctx.width, ctx.height) };
  }

  onPointerMove(e: ToolPointerEvent, ctx: ToolContext): ToolPreview | null {
    return this.update(e, ctx);
  }

  onPointerUp(e: ToolPointerEvent, ctx: ToolContext): GestureResult {
    this.update(e, ctx);
    const color = this.eraseOverride ? null : ctx.color;
    const ops: PaintOp[] = [];
    // Bounds-checked here (matches the commit's `c.x >= 0 && ... && paintAllowed`, usePixelEditor.ts:
    // 2881) - a shape dragged past the canvas edge naturally produces out-of-bounds preview cells.
    const write: CellWriter = (op) => {
      if (op.x >= 0 && op.y >= 0 && op.x < ctx.width && op.y < ctx.height) ops.push(op);
    };
    const sink = withSelectionClip(ctx.selection, ctx.selectionMask, write);
    this.previewCells.forEach((c) => sink({ x: c.x, y: c.y, color }));
    const dirty = new DirtyRectTracker();
    dirty.addCells(this.previewCells);
    return { ops, dirtyRects: dirty.toRects(ctx.width, ctx.height), changed: ops.length > 0 };
  }

  onCancel(): GestureResult {
    return { ops: [], dirtyRects: [], changed: false, cancelled: true };
  }
}

export function createShapeTool(shape: Shape): Tool {
  return {
    name: shape,
    beginGesture(e) {
      return new ShapeGesture(shape, e.cell, e.button);
    },
  };
}
