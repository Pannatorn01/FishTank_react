import { normalizeBox } from '../../pixelMath';
import type { Cell, SelectionBox, SelectionMode } from '../../types';
import { rectMask, resolveMarqueeMode, settleSelection } from '../selectionMask';
import type { Gesture, GestureResult, Tool, ToolContext, ToolPointerEvent, ToolPreview } from '../types';

function inBounds(cell: Cell, ctx: ToolContext): boolean {
  return cell.x >= 0 && cell.y >= 0 && cell.x < ctx.width && cell.y < ctx.height;
}

/**
 * Rectangular marquee gesture - ports the 'select' branches of onPointerDown/Move/Up
 * (usePixelEditor.ts:2710-2726, 2896-2906, 3028-3048). Never touches a pixel or the frame - the live
 * drag is pure metadata (`ToolPreview.selectionDraft`, read by `PixelSelectionOverlay.tsx`'s own DOM
 * border), and the engine skips `pushGestureUndo()` for this tool entirely (see NO_UNDO_TOOLS).
 */
class SelectGesture implements Gesture {
  readonly kind = 'select';
  private start: Cell;
  private mode: SelectionMode;
  private box: SelectionBox;

  constructor(start: Cell, mode: SelectionMode) {
    this.start = start;
    this.mode = mode;
    this.box = { x0: start.x, y0: start.y, x1: start.x, y1: start.y };
  }

  onPointerMove(e: ToolPointerEvent, ctx: ToolContext): ToolPreview | null {
    // Matches the original's clamped `cellFromEvent` (returns null off-canvas, so the drag simply
    // stops updating rather than tracking unclamped the way Pen/Move do) - usePixelEditor.ts:2896-2897.
    if (!inBounds(e.cell, ctx)) return null;
    this.box = normalizeBox(this.start, e.cell);
    return { dirtyRects: [], selectionDraft: this.box };
  }

  onPointerUp(_e: ToolPointerEvent, ctx: ToolContext): GestureResult {
    const dragged = this.box.x0 !== this.box.x1 || this.box.y0 !== this.box.y1;
    if (this.mode !== 'new') {
      // A plain click (no drag) in add/subtract mode merges nothing and must leave the existing
      // selection completely untouched - omitting `selection` here, not setting it to anything, is
      // what tells the engine not to touch it (usePixelEditor.ts:3031-3034).
      if (!dragged) return { ops: [], dirtyRects: [], changed: false };
      return { ops: [], dirtyRects: [], changed: false, selection: settleSelection(rectMask(this.box), this.mode, ctx) };
    }
    // 'new': a plain click clears whatever was selected; a real drag replaces it outright, with no
    // mask machinery at all - a rectangular marquee never needs one (usePixelEditor.ts:3035-3039).
    return {
      ops: [],
      dirtyRects: [],
      changed: false,
      selection: dragged ? { box: this.box, mask: null, outline: null } : { box: null, mask: null, outline: null },
    };
  }

  onCancel(): GestureResult {
    return { ops: [], dirtyRects: [], changed: false, cancelled: true };
  }
}

export function createSelectTool(): Tool {
  return {
    name: 'select',
    beginGesture(e, ctx) {
      return new SelectGesture(e.cell, resolveMarqueeMode(e, ctx.selectionMode));
    },
  };
}
