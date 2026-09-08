import { bresenhamLine } from '../../pixelMath';
import type { Cell, SymmetryMode } from '../../types';
import { mirrorPoints, withSelectionClip, type CellWriter } from '../paintPipeline';
import { DirtyRectTracker } from '../dirtyRect';
import type { Gesture, GestureResult, PaintOp, Tool, ToolContext, ToolPointerEvent, ToolPreview } from '../types';

/** Top-left-anchored square of side `brushSize` centered as closely as possible on (x, y) - ports
 *  `brushCellsAt` (usePixelEditor.ts, also duplicated in penTool.ts/shapeTool.ts - small and stable
 *  enough that a shared import isn't worth it for a fourth caller). */
function brushCellsAt(x: number, y: number, brushSize: number): Cell[] {
  if (brushSize <= 1) return [{ x, y }];
  const off = Math.floor((brushSize - 1) / 2);
  const cells: Cell[] = [];
  for (let dy = 0; dy < brushSize; dy++) {
    for (let dx = 0; dx < brushSize; dx++) cells.push({ x: x - off + dx, y: y - off + dy });
  }
  return cells;
}

/** Thickens a 1px path to `brushSize` by stamping `brushCellsAt` at every point and deduping - ports
 *  the engine's own (now-removed) `thickenPath`, same as shapeTool.ts's own copy for Line. */
function thickenPath(points: Cell[], brushSize: number): Cell[] {
  if (brushSize <= 1) return points;
  const seen = new Set<string>();
  const cells: Cell[] = [];
  points.forEach((p) => {
    brushCellsAt(p.x, p.y, brushSize).forEach((c) => {
      const key = `${c.x},${c.y}`;
      if (!seen.has(key)) {
        seen.add(key);
        cells.push(c);
      }
    });
  });
  return cells;
}

/** Samples a quadratic bezier through p0/p1/p2 and connects the samples with bresenham lines so the
 *  curve has no gaps, then thickens the result to `brushSize` the same way a line does - ports the
 *  engine's own (now-removed) `quadraticBezierCells`. */
function quadraticBezierCells(p0: Cell, p1: Cell, p2: Cell, brushSize: number): Cell[] {
  const approxLen = Math.hypot(p1.x - p0.x, p1.y - p0.y) + Math.hypot(p2.x - p1.x, p2.y - p1.y);
  const steps = Math.max(8, Math.ceil(approxLen * 2));
  const cells: Cell[] = [];
  let prev: Cell | null = null;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const mt = 1 - t;
    const cell = {
      x: Math.round(mt * mt * p0.x + 2 * mt * t * p1.x + t * t * p2.x),
      y: Math.round(mt * mt * p0.y + 2 * mt * t * p1.y + t * t * p2.y),
    };
    if (prev) bresenhamLine(prev.x, prev.y, cell.x, cell.y).forEach((c) => cells.push(c));
    else cells.push(cell);
    prev = cell;
  }
  const seen = new Set<string>();
  const path = cells.filter((c) => {
    const key = `${c.x},${c.y}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return thickenPath(path, brushSize);
}

/** Mirror-expands a cell list, deduped - ports the engine's own (now-removed) `mirroredExpand`, same as
 *  shapeTool.ts's own private copy. Shapes/curve mirror the whole preview once up front, unlike Pen
 *  which mirrors per brush-stamped point. */
function mirrorExpand(cells: Cell[], symmetry: SymmetryMode, axisX: number, axisY: number): Cell[] {
  if (symmetry === 'none') return cells;
  const seen = new Set<string>();
  const out: Cell[] = [];
  cells.forEach((c) => {
    mirrorPoints(symmetry, axisX, axisY, c.x, c.y).forEach((m) => {
      const key = `${m.x},${m.y}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push(m);
      }
    });
  });
  return out;
}

type Phase = 'drag-end' | 'bend-idle' | 'bend-dragging';

/**
 * Curve is a genuine multi-phase interaction spanning *more than one* pointerdown-to-pointerup cycle -
 * unlike every other tool this session migrated. Phase 1 (`drag-end`) drags out the initial straight
 * line; releasing computes a midpoint control point and hands off to phase 2 (`bend`, split here into
 * `bend-idle`/`bend-dragging` sub-states) where the bezier preview sits waiting, with no pointer button
 * held, until a second, separate pointerdown either grabs the control handle (screen-space hit-testing
 * stays engine-side - see `isNearCurveControl`, resolved into the `nearControlPoint` parameter before
 * `onResumeDown` is ever called) or lands elsewhere and commits. This is exactly what
 * `GestureResult.keepActive`/`overlay`/`Gesture.onResumeDown`/`onKeyDown` were added for - ports the
 * original `curvePhase`/`curveStart`/`curveEnd`/`curveControl`/`curveDraggingControl` state machine
 * (usePixelEditor.ts, now removed) into one gesture-internal `phase` enum plus a handful of fields.
 */
class CurveGesture implements Gesture {
  readonly kind = 'curve';
  private phase: Phase = 'drag-end';
  private readonly start: Cell;
  private end: Cell;
  private control: Cell | null = null;
  private readonly eraseOverride: boolean;
  private previewCells: Cell[];

  constructor(start: Cell, eraseOverride: boolean) {
    this.start = start;
    this.end = start;
    this.eraseOverride = eraseOverride;
    this.previewCells = [start];
  }

  private overlayColor(ctx: ToolContext): string {
    return this.eraseOverride ? 'rgba(255,255,255,0.45)' : ctx.color;
  }

  private curvePhaseTag(): 'drag-end' | 'bend' {
    return this.phase === 'drag-end' ? 'drag-end' : 'bend';
  }

  /** Mirror-expands `cells`, diffs against the previously-shown preview for a dirty-rect union (ports
   *  `redrawShapePreview`'s own old-vs-new bounding box), and mirrors phase/control into
   *  ToolPreview.curvePreview for the DOM-drawn bend handle. */
  private setPreview(cells: Cell[], ctx: ToolContext): ToolPreview {
    const mirrored = mirrorExpand(cells, ctx.symmetry, ctx.symmetryAxisX, ctx.symmetryAxisY);
    const dirty = new DirtyRectTracker();
    dirty.addCells(this.previewCells);
    dirty.addCells(mirrored);
    this.previewCells = mirrored;
    return {
      overlay: { cells: mirrored, color: this.overlayColor(ctx) },
      dirtyRects: dirty.toRects(ctx.width, ctx.height),
      curvePreview: { phase: this.curvePhaseTag(), control: this.control },
    };
  }

  onPointerMove(e: ToolPointerEvent, ctx: ToolContext): ToolPreview | null {
    if (this.phase === 'drag-end') {
      this.end = e.cell;
      return this.setPreview(bresenhamLine(this.start.x, this.start.y, this.end.x, this.end.y), ctx);
    }
    if (this.phase === 'bend-dragging') {
      this.control = e.cell;
      return this.setPreview(quadraticBezierCells(this.start, this.control, this.end, ctx.brushSize), ctx);
    }
    // bend-idle: no button held, hovering paints nothing - matches the original, whose onPointerMove
    // never reached the curve branch at all while `painting` was false.
    return null;
  }

  onPointerUp(e: ToolPointerEvent, ctx: ToolContext): GestureResult {
    if (this.phase === 'drag-end') {
      this.end = e.cell;
      if (this.start.x === this.end.x && this.start.y === this.end.y) {
        // Zero-length drag: cancel, matching the original's cancelCurve() branch here exactly.
        const dirty = new DirtyRectTracker();
        dirty.addCells(this.previewCells);
        return { ops: [], dirtyRects: dirty.toRects(ctx.width, ctx.height), changed: false, cancelled: true };
      }
      this.control = { x: Math.round((this.start.x + this.end.x) / 2), y: Math.round((this.start.y + this.end.y) / 2) };
      this.phase = 'bend-idle';
      const preview = this.setPreview(quadraticBezierCells(this.start, this.control, this.end, ctx.brushSize), ctx);
      return {
        ops: [],
        dirtyRects: preview.dirtyRects,
        changed: false,
        keepActive: true,
        overlay: preview.overlay,
        curvePreview: preview.curvePreview,
      };
    }
    // Releasing after dragging the control handle: stays in bend, still not done - matches the
    // original (curveDraggingControl=false, curvePhase stays 'bend'). Reuses the bezier already drawn
    // by the last onPointerMove rather than recomputing an identical one.
    this.phase = 'bend-idle';
    return { ops: [], dirtyRects: [], changed: false, keepActive: true, curvePreview: { phase: 'bend', control: this.control } };
  }

  onResumeDown(e: ToolPointerEvent, ctx: ToolContext, nearControlPoint: boolean): { preview: ToolPreview | null } | { result: GestureResult } {
    if (nearControlPoint) {
      this.phase = 'bend-dragging';
      this.control = e.cell;
      return { preview: this.setPreview(quadraticBezierCells(this.start, this.control, this.end, ctx.brushSize), ctx) };
    }
    return { result: this.commitResult(ctx) };
  }

  onKeyDown(key: string, ctx: ToolContext): GestureResult | null {
    if (key === 'Enter' && this.phase === 'bend-idle') return this.commitResult(ctx);
    return null;
  }

  private commitResult(ctx: ToolContext): GestureResult {
    const color = this.eraseOverride ? null : ctx.color;
    const ops: PaintOp[] = [];
    const write: CellWriter = (op) => {
      if (op.x >= 0 && op.y >= 0 && op.x < ctx.width && op.y < ctx.height) ops.push(op);
    };
    const sink = withSelectionClip(ctx.selection, ctx.selectionMask, write);
    this.previewCells.forEach((c) => sink({ x: c.x, y: c.y, color }));
    const dirty = new DirtyRectTracker();
    dirty.addCells(this.previewCells);
    return {
      ops,
      dirtyRects: dirty.toRects(ctx.width, ctx.height),
      // The original never rolls back a curve commit (no rollback call anywhere in commitCurve()) -
      // always keeps the undo entry pushed at drag-end, same as Pen/Move/Gradient/Spray.
      changed: true,
    };
  }

  onCancel(): GestureResult {
    return { ops: [], dirtyRects: [], changed: false, cancelled: true };
  }
}

export function createCurveTool(): Tool {
  return {
    name: 'curve',
    beginGesture(e: ToolPointerEvent) {
      return new CurveGesture(e.cell, e.button === 2);
    },
  };
}
