import { describe, expect, it } from 'vitest';
import { createMoveTool } from '../tools/moveTool';
import { makeContext, makeFrame } from './testUtils';
import type { ToolPointerEvent } from '../types';

function ptr(x: number, y: number, extra: Partial<ToolPointerEvent> = {}): ToolPointerEvent {
  return { cell: { x, y }, shiftKey: false, altKey: false, ctrlKey: false, button: 0, ...extra };
}

describe('MoveTool', () => {
  it('clears the source cells on lift (move, not copy) via the first preview', () => {
    const frame = makeFrame(5, 5, (x, y) => (x === 2 && y === 2 ? '#ff0000' : null));
    const ctx = makeContext(frame, { selection: { x0: 2, y0: 2, x1: 2, y1: 2 } });
    const tool = createMoveTool();
    const down = ptr(2, 2);
    const gesture = tool.beginGesture(down, ctx)!;
    const preview = gesture.onPointerMove(down, ctx)!;
    expect(preview.ops).toEqual([{ x: 2, y: 2, color: null }]);
    expect(preview.movePreview?.cells).toEqual([{ x: 2, y: 2, color: '#ff0000' }]);
  });

  it('does not clear source cells when copying (Ctrl/Cmd held)', () => {
    const frame = makeFrame(5, 5, (x, y) => (x === 2 && y === 2 ? '#ff0000' : null));
    const ctx = makeContext(frame, { selection: { x0: 2, y0: 2, x1: 2, y1: 2 } });
    const tool = createMoveTool();
    const down = ptr(2, 2, { ctrlKey: true });
    const gesture = tool.beginGesture(down, ctx)!;
    const preview = gesture.onPointerMove(down, ctx)!;
    expect(preview.ops).toBeUndefined();
  });

  it('tracks an unclamped delta while dragging past the canvas edge', () => {
    const frame = makeFrame(5, 5, () => '#ff0000');
    const ctx = makeContext(frame);
    const tool = createMoveTool();
    const down = ptr(0, 0);
    const gesture = tool.beginGesture(down, ctx)!;
    gesture.onPointerMove(down, ctx);
    const preview = gesture.onPointerMove(ptr(-10, -10), ctx)!;
    expect(preview.movePreview?.dx).toBe(-10);
    expect(preview.movePreview?.dy).toBe(-10);
  });

  it('clamps the final write-back to canvas bounds', () => {
    const frame = makeFrame(5, 5, (x, y) => (x === 4 && y === 4 ? '#ff0000' : null));
    const ctx = makeContext(frame, { selection: { x0: 4, y0: 4, x1: 4, y1: 4 } });
    const tool = createMoveTool();
    const down = ptr(4, 4);
    const gesture = tool.beginGesture(down, ctx)!;
    gesture.onPointerMove(down, ctx);
    const result = gesture.onPointerUp(ptr(10, 10), ctx);
    // Would land at (14, 14), well outside a 5x5 canvas - dropped, not wrapped or clamped-in-place.
    expect(result.ops).toEqual([]);
  });

  it('a zero-delta commit still keeps the gesture (changed: true) - only Escape rolls back a move', () => {
    const frame = makeFrame(5, 5, (x, y) => (x === 2 && y === 2 ? '#ff0000' : null));
    const ctx = makeContext(frame, { selection: { x0: 2, y0: 2, x1: 2, y1: 2 } });
    const tool = createMoveTool();
    const down = ptr(2, 2);
    const gesture = tool.beginGesture(down, ctx)!;
    gesture.onPointerMove(down, ctx);
    const result = gesture.onPointerUp(down, ctx);
    expect(result.ops).toEqual([{ x: 2, y: 2, color: '#ff0000' }]);
    expect(result.changed).toBe(true);
    expect(result.moveSelectionBy).toEqual({ dx: 0, dy: 0 });
  });

  it('onCancel reports no changes and no ops', () => {
    const frame = makeFrame(5, 5);
    const ctx = makeContext(frame);
    const tool = createMoveTool();
    const gesture = tool.beginGesture(ptr(0, 0), ctx)!;
    expect(gesture.onCancel(ctx)).toEqual({ ops: [], dirtyRects: [], changed: false, cancelled: true });
  });
});
