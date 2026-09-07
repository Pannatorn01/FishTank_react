import { describe, expect, it } from 'vitest';
import { createPenTool } from '../tools/penTool';
import { makeContext, makeFrame } from './testUtils';
import type { PaintOp, ToolPointerEvent } from '../types';

function ptr(x: number, y: number, extra: Partial<ToolPointerEvent> = {}): ToolPointerEvent {
  return { cell: { x, y }, shiftKey: false, altKey: false, ctrlKey: false, button: 0, ...extra };
}

/** Applies a sequence of ops onto a plain Map, simulating what the engine's `applyToolPreview`/
 *  `commitGestureResult` do to the real frame - lets tests assert final per-cell state instead of
 *  just the raw op list. */
function applyOps(state: Map<string, string | null>, ops: PaintOp[]) {
  ops.forEach((op) => state.set(`${op.x},${op.y}`, op.color));
}

describe('PenTool', () => {
  it('paints the brush footprint once for a zero-length stroke (a single click)', () => {
    const frame = makeFrame(10, 10);
    const ctx = makeContext(frame);
    const tool = createPenTool(false);
    const down = ptr(2, 2);
    const gesture = tool.beginGesture(down, ctx)!;
    const preview = gesture.onPointerMove(down, ctx)!;
    expect(preview.ops).toEqual([{ x: 2, y: 2, color: '#ff0000' }]);
  });

  it('fills gaps between fast (coalesced) move points via bresenham', () => {
    const frame = makeFrame(10, 10);
    const ctx = makeContext(frame, { pixelPerfect: false });
    const tool = createPenTool(false);
    const down = ptr(0, 0);
    const gesture = tool.beginGesture(down, ctx)!;
    const state = new Map<string, string | null>();
    applyOps(state, gesture.onPointerMove(down, ctx)!.ops ?? []);
    applyOps(state, gesture.onPointerMove(ptr(3, 0), ctx)!.ops ?? []);
    for (let x = 0; x <= 3; x++) expect(state.get(`${x},0`)).toBe('#ff0000');
  });

  it('trims the inner corner pixel on an L-turn when Pixel Perfect is active (brush size 1)', () => {
    const frame = makeFrame(10, 10);
    const ctx = makeContext(frame, { pixelPerfect: true, brushSize: 1 });
    const tool = createPenTool(false);
    const down = ptr(0, 0);
    const gesture = tool.beginGesture(down, ctx)!;
    const state = new Map<string, string | null>();
    applyOps(state, gesture.onPointerMove(down, ctx)!.ops ?? []);
    applyOps(state, gesture.onPointerMove(ptr(1, 0), ctx)!.ops ?? []);
    applyOps(state, gesture.onPointerMove(ptr(1, 1), ctx)!.ops ?? []);
    expect(state.get('0,0')).toBe('#ff0000');
    expect(state.get('1,1')).toBe('#ff0000');
    // The corner cell (1,0) was painted, then trimmed back to its pre-stroke value (blank).
    expect(state.get('1,0')).toBeNull();
  });

  it('does not trim corners when the brush is wider than 1px', () => {
    const frame = makeFrame(10, 10);
    const ctx = makeContext(frame, { pixelPerfect: true, brushSize: 2 });
    const tool = createPenTool(false);
    const down = ptr(2, 2);
    const gesture = tool.beginGesture(down, ctx)!;
    const state = new Map<string, string | null>();
    applyOps(state, gesture.onPointerMove(down, ctx)!.ops ?? []);
    applyOps(state, gesture.onPointerMove(ptr(3, 2), ctx)!.ops ?? []);
    applyOps(state, gesture.onPointerMove(ptr(3, 3), ctx)!.ops ?? []);
    expect(state.get('3,2')).toBe('#ff0000');
  });

  it('erase mode writes null instead of the active color', () => {
    const frame = makeFrame(10, 10, () => '#123456');
    const ctx = makeContext(frame);
    const tool = createPenTool(true);
    const down = ptr(4, 4);
    const gesture = tool.beginGesture(down, ctx)!;
    const preview = gesture.onPointerMove(down, ctx)!;
    expect(preview.ops).toEqual([{ x: 4, y: 4, color: null }]);
  });

  it('onCancel reports no changes and no ops', () => {
    const frame = makeFrame(10, 10);
    const ctx = makeContext(frame);
    const tool = createPenTool(false);
    const gesture = tool.beginGesture(ptr(0, 0), ctx)!;
    const result = gesture.onCancel(ctx);
    expect(result).toEqual({ ops: [], dirtyRects: [], changed: false, cancelled: true });
  });

  it('onPointerUp always keeps the gesture (changed: true), even for a click that painted nothing new', () => {
    // A click outside the active selection paints nothing (selection-clipped), but the original never
    // rolls back a pen/eraser gesture the way it does for Fill - only Escape does.
    const frame = makeFrame(10, 10);
    const ctx = makeContext(frame, { selection: { x0: 0, y0: 0, x1: 0, y1: 0 } });
    const tool = createPenTool(false);
    const down = ptr(5, 5);
    const gesture = tool.beginGesture(down, ctx)!;
    gesture.onPointerMove(down, ctx);
    const result = gesture.onPointerUp(down, ctx);
    expect(result.ops).toEqual([]);
    expect(result.changed).toBe(true);
  });
});
