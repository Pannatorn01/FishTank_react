import { ditherColorAt, ditherGradientMix, hexToRgb, rgbToHex } from '../../pixelMath';
import type { Cell, GradientType } from '../../types';
import { withSelectionClip, type CellWriter } from '../paintPipeline';
import { DirtyRectTracker } from '../dirtyRect';
import { constrainToAngle } from './shapeTool';
import type { Gesture, GestureResult, PaintOp, Tool, ToolContext, ToolPointerEvent, ToolPreview } from '../types';

/** The blend parameter (0..1, clamped) for cell (x, y): projection onto the drag axis for a linear
 *  gradient, or distance from `start` as a fraction of the drag length for a radial one. A zero-length
 *  drag gives 0.5 everywhere (matches the original's `t = 0.5` default), for both types. Shared by the
 *  commit path here and the live overlay's dither branch (drawGradientPreviewOverlay). */
export function gradientT(
  x: number,
  y: number,
  start: Cell,
  end: Cell,
  type: GradientType,
): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return 0.5;
  if (type === 'radial') {
    // Measured between cell centres: the start cell (px=py=0 -> t=0) is the exact centre, and the drag
    // length is the radius. The linear branch below keeps its original corner-anchored projection.
    const rx = x - start.x;
    const ry = y - start.y;
    return Math.min(1, Math.sqrt((rx * rx + ry * ry) / lenSq));
  }
  const px = x + 0.5 - start.x;
  const py = y + 0.5 - start.y;
  return Math.min(1, Math.max(0, (px * dx + py * dy) / lenSq));
}

/**
 * Ports `gradientCellsPreview` (usePixelEditor.ts:3059-3083) - the exact per-cell color array, computed
 * only once, on commit. The live drag preview never calls this: it mirrors state into the engine's own
 * `gradientStart`/`gradientEnd`/`eraseOverride` fields instead (see ToolPreview.gradientPreview's own
 * doc comment) so the existing `drawGradientPreviewOverlay()` keeps painting with the canvas's native,
 * GPU-composited `ctx.createLinearGradient`/`createRadialGradient` - a measured optimization this
 * migration must not bypass.
 *
 * Iterates the same bounding box the original did (the selection's box, or the whole canvas) for the
 * same reason (a gradient fills its entire box, so there's no cheaper region to loop over), then filters
 * each write through `withSelectionClip` for a non-rectangular selection mask - ports `paintAllowed`'s
 * own mask check, which the original applied at the write step, not the loop-bounds step.
 */
function gradientCellsPreviewOps(ctx: ToolContext, start: Cell, end: Cell, eraseOverride: boolean): PaintOp[] {
  const box = ctx.selection ?? { x0: 0, y0: 0, x1: ctx.width - 1, y1: ctx.height - 1 };
  const startColor = eraseOverride ? ctx.secondaryColor : ctx.color;
  const endColor = eraseOverride ? ctx.color : ctx.secondaryColor;
  const [sr, sg, sb] = hexToRgb(startColor);
  const [er, eg, eb] = hexToRgb(endColor);
  const ops: PaintOp[] = [];
  const sink: CellWriter = (op) => ops.push(op);
  const write = withSelectionClip(ctx.selection, ctx.selectionMask, sink);
  for (let y = box.y0; y <= box.y1; y++) {
    for (let x = box.x0; x <= box.x1; x++) {
      const t = gradientT(x, y, start, end, ctx.gradientType);
      const color = ctx.ditherEnabled
        ? ditherColorAt(x, y, startColor, endColor, ditherGradientMix(t))
        : rgbToHex(sr + (er - sr) * t, sg + (eg - sg) * t, sb + (eb - sb) * t);
      write({ x, y, color });
    }
  }
  return ops;
}

class GradientGesture implements Gesture {
  readonly kind = 'gradient';
  private start: Cell;
  private end: Cell;
  private readonly eraseOverride: boolean;

  constructor(start: Cell, eraseOverride: boolean) {
    this.start = start;
    this.end = start;
    this.eraseOverride = eraseOverride;
  }

  private resolveEnd(e: ToolPointerEvent): Cell {
    return e.shiftKey ? constrainToAngle(this.start, e.cell) : e.cell;
  }

  onPointerMove(e: ToolPointerEvent): ToolPreview | null {
    this.end = this.resolveEnd(e);
    return { dirtyRects: [], gradientPreview: { start: this.start, end: this.end, eraseOverride: this.eraseOverride } };
  }

  onPointerUp(e: ToolPointerEvent, ctx: ToolContext): GestureResult {
    this.end = this.resolveEnd(e);
    const ops = gradientCellsPreviewOps(ctx, this.start, this.end, this.eraseOverride);
    const dirty = new DirtyRectTracker();
    dirty.addCells(ops);
    return {
      ops,
      dirtyRects: dirty.toRects(ctx.width, ctx.height),
      // The original never rolled back a gradient commit (no rollback call anywhere in its onPointerUp
      // branch) - a gradient drag always keeps the undo entry it pushed, even a same-color or
      // fully-outside-selection one. `changed: true` unconditionally reproduces that exactly.
      changed: true,
      alsoSaveColor: ctx.secondaryColor,
    };
  }

  onCancel(): GestureResult {
    return { ops: [], dirtyRects: [], changed: false, cancelled: true };
  }
}

export function createGradientTool(): Tool {
  return {
    name: 'gradient',
    beginGesture(e: ToolPointerEvent) {
      return new GradientGesture(e.cell, e.button === 2);
    },
  };
}
