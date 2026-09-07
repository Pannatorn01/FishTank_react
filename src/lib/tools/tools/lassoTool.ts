import type { Cell } from '../../types';
import { polygonMask, resolveMarqueeMode, settleSelection } from '../selectionMask';
import type { Gesture, GestureResult, SelectionMode, Tool, ToolContext, ToolPointerEvent, ToolPreview } from '../types';

function inBounds(cell: Cell, ctx: ToolContext): boolean {
  return cell.x >= 0 && cell.y >= 0 && cell.x < ctx.width && cell.y < ctx.height;
}

/**
 * Freeform lasso gesture - ports the 'lasso' branches of onPointerDown/Move/Up
 * (usePixelEditor.ts:2728-2738, 2908-2915, 3050-3074). Same metadata-only preview and no-undo
 * treatment as Select (see selectTool.ts's own doc comment) - only the shape of what settles differs:
 * a lasso always needs the mask/outline machinery (`polygonMask`/`settleSelection`), even for a plain
 * 'new' selection, since its shape is never just a rectangle.
 */
class LassoGesture implements Gesture {
  readonly kind = 'lasso';
  private mode: SelectionMode;
  private points: Cell[];

  constructor(start: Cell, mode: SelectionMode) {
    this.mode = mode;
    this.points = [start];
  }

  onPointerMove(e: ToolPointerEvent, ctx: ToolContext): ToolPreview | null {
    // Matches the original's clamped `cellFromEvent` (usePixelEditor.ts:2908-2909) - freezes instead
    // of tracking unclamped off-canvas.
    if (!inBounds(e.cell, ctx)) return null;
    const last = this.points[this.points.length - 1];
    if (!last || last.x !== e.cell.x || last.y !== e.cell.y) this.points.push(e.cell);
    return { dirtyRects: [], lassoDraftPoints: this.points };
  }

  onPointerUp(_e: ToolPointerEvent, ctx: ToolContext): GestureResult {
    const mask = this.points.length >= 3 ? polygonMask(this.points) : null;
    const hasMask = mask !== null && mask.size > 0;
    if (this.mode !== 'new') {
      // Too short a path (or a mask that traced to nothing) merges nothing and must leave the
      // existing selection untouched - omit `selection` entirely (usePixelEditor.ts:3054-3058).
      if (!hasMask) return { ops: [], dirtyRects: [], changed: false };
      return { ops: [], dirtyRects: [], changed: false, selection: settleSelection(mask, this.mode, ctx) };
    }
    if (hasMask) return { ops: [], dirtyRects: [], changed: false, selection: settleSelection(mask, 'new', ctx) };
    return { ops: [], dirtyRects: [], changed: false, selection: { box: null, mask: null, outline: null } };
  }

  onCancel(): GestureResult {
    return { ops: [], dirtyRects: [], changed: false, cancelled: true };
  }
}

export function createLassoTool(): Tool {
  return {
    name: 'lasso',
    beginGesture(e, ctx) {
      return new LassoGesture(e.cell, resolveMarqueeMode(e, ctx.selectionMode));
    },
  };
}
