import type { Cell } from '../../types';
import type { Gesture, GestureResult, PaintOp, Tool, ToolContext, ToolPointerEvent, ToolPreview } from '../types';

interface BufferCell extends Cell {
  color: string;
}

/** Floating-selection move/copy gesture - ports `startMoveGesture`/`commitMove`
 *  (usePixelEditor.ts:1897-1917, 1686-1708): lifts the selection (or the whole canvas) into an
 *  unclamped floating buffer, tracks the drag delta, and writes the buffer back at its final
 *  (clamped) position on release. `copy` (Ctrl/Cmd held) skips clearing the source cells on lift. */
class MoveGesture implements Gesture {
  readonly kind = 'move';
  private readonly buffer: BufferCell[];
  /** Emitted once, by the first onPointerMove call (per the engine's "call onPointerMove once with
   *  the down event right after beginGesture" contract) - clearing the source cells on lift only
   *  happens once, not on every move, matching `startMoveGesture`'s one-time `frame[...] = null`. */
  private pendingClearOps: PaintOp[];
  private delta = { dx: 0, dy: 0 };
  private start: Cell;

  constructor(start: Cell, copy: boolean, ctx: ToolContext) {
    this.start = start;
    const box = ctx.selection ?? { x0: 0, y0: 0, x1: ctx.width - 1, y1: ctx.height - 1 };
    const cells: BufferCell[] = [];
    const clearOps: PaintOp[] = [];
    for (let y = box.y0; y <= box.y1; y++) {
      for (let x = box.x0; x <= box.x1; x++) {
        if (ctx.selectionMask && !ctx.selectionMask.has(`${x},${y}`)) continue;
        const c = ctx.getCell(x, y);
        if (c) cells.push({ x, y, color: c });
        if (!copy) clearOps.push({ x, y, color: null });
      }
    }
    this.buffer = cells;
    this.pendingClearOps = clearOps;
  }

  private preview(): ToolPreview {
    const ops = this.pendingClearOps;
    this.pendingClearOps = [];
    return {
      ops: ops.length ? ops : undefined,
      dirtyRects: [],
      movePreview: { cells: this.buffer, dx: this.delta.dx, dy: this.delta.dy },
    };
  }

  onPointerMove(e: ToolPointerEvent): ToolPreview {
    this.delta = { dx: e.cell.x - this.start.x, dy: e.cell.y - this.start.y };
    return this.preview();
  }

  onPointerUp(e: ToolPointerEvent, ctx: ToolContext): GestureResult {
    this.delta = { dx: e.cell.x - this.start.x, dy: e.cell.y - this.start.y };
    const ops: PaintOp[] = [];
    this.buffer.forEach((c) => {
      const nx = c.x + this.delta.dx;
      const ny = c.y + this.delta.dy;
      if (nx >= 0 && ny >= 0 && nx < ctx.width && ny < ctx.height) ops.push({ x: nx, y: ny, color: c.color });
    });
    // Always kept, even for a click-then-release with no drag (writes the buffer back at the same
    // spot it was lifted from) - the original never rolls this back either; only Escape does. See
    // `startMoveGesture`'s unconditional `pushGestureUndo()` (usePixelEditor.ts:1898).
    return {
      ops,
      dirtyRects: [],
      changed: true,
      moveSelectionBy: { dx: this.delta.dx, dy: this.delta.dy },
    };
  }

  onCancel(): GestureResult {
    return { ops: [], dirtyRects: [], changed: false, cancelled: true };
  }
}

export function createMoveTool(): Tool {
  return {
    name: 'move',
    beginGesture(e, ctx) {
      return new MoveGesture(e.cell, e.ctrlKey, ctx);
    },
  };
}
