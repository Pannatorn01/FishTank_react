import { ditherColorAt } from '../../pixelMath';
import type { Cell } from '../../types';
import { withSelectionClip, withSymmetry, type CellWriter } from '../paintPipeline';
import { DirtyRectTracker } from '../dirtyRect';
import type { Gesture, GestureResult, PaintOp, Tool, ToolContext, ToolPointerEvent, ToolPreview } from '../types';

/**
 * Scatters a handful of random dots within the brush-size radius around the last known pointer cell -
 * ports `sprayTick` (usePixelEditor.ts:3122-3143). Called from both `onPointerMove` (the original also
 * ticks once per move event, not just on the timer - see SprayGesture's own doc comment) and `onTick`
 * (the wall-clock timer that keeps scattering while the pointer holds still). Mirrored/selection-clipped/
 * dither-resolved exactly like Pen's brush footprint (see penTool.ts's `paintRawPoint`) - unlike Fill's
 * per-mirror-point quirk, spray's `mirrorCells` usage applies one shared color to every mirrored copy of
 * each dot, so the standard `withSymmetry(withSelectionClip(...))` pipeline is correct here.
 */
function scatterOps(around: Cell, ctx: ToolContext, eraseOverride: boolean): ToolPreview {
  const baseColor = eraseOverride ? null : ctx.color;
  const radius = ctx.brushSize + 1;
  const dots = Math.max(1, Math.round(radius * ctx.sprayDensity));
  const dither = ctx.ditherEnabled && baseColor !== null;
  const ops: PaintOp[] = [];
  const dirty = new DirtyRectTracker();
  const write = (x: number, y: number, color: string | null) => {
    if (x < 0 || y < 0 || x >= ctx.width || y >= ctx.height) return;
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
  for (let i = 0; i < dots; i++) {
    const angle = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * radius;
    const x = Math.round(around.x + Math.cos(angle) * r);
    const y = Math.round(around.y + Math.sin(angle) * r);
    sink({ x, y, color: baseColor });
  }
  return { ops, dirtyRects: dirty.toRects(ctx.width, ctx.height) };
}

class SprayGesture implements Gesture {
  readonly kind = 'spray';
  private lastCell: Cell;
  private readonly eraseOverride: boolean;

  constructor(start: Cell, eraseOverride: boolean) {
    this.lastCell = start;
    this.eraseOverride = eraseOverride;
  }

  // The original scatters dots on *every* pointermove, not just on the timer (usePixelEditor.ts's own
  // onPointerMove branch called sprayTick() directly, in addition to onPointerDown's first tick and the
  // timer that keeps it going while the pointer holds still) - so this returns a real preview with ops,
  // it doesn't just track position the way a "wait for the next tick" design would.
  onPointerMove(e: ToolPointerEvent, ctx: ToolContext): ToolPreview | null {
    this.lastCell = e.cell;
    return scatterOps(this.lastCell, ctx, this.eraseOverride);
  }

  onTick(ctx: ToolContext): ToolPreview | null {
    return scatterOps(this.lastCell, ctx, this.eraseOverride);
  }

  onPointerUp(): GestureResult {
    // Ports the original: no extra scatter on release, and the gesture's undo entry is never rolled
    // back (no rollback call anywhere in spray's original code, same as Pen/Eraser/Move/Gradient) -
    // `changed` is unconditionally `true`, not derived from whether this release itself painted.
    return { ops: [], dirtyRects: [], changed: true };
  }

  onCancel(): GestureResult {
    return { ops: [], dirtyRects: [], changed: false, cancelled: true };
  }
}

export function createSprayTool(): Tool {
  return {
    name: 'spray',
    beginGesture(e: ToolPointerEvent) {
      return new SprayGesture(e.cell, e.button === 2);
    },
  };
}
