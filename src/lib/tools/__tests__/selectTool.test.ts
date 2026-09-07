import { describe, expect, it } from 'vitest';
import { createSelectTool } from '../tools/selectTool';
import { resolveMarqueeMode } from '../selectionMask';
import { makeContext, makeFrame } from './testUtils';
import type { ToolPointerEvent } from '../types';

function ptr(x: number, y: number, extra: Partial<ToolPointerEvent> = {}): ToolPointerEvent {
  return { cell: { x, y }, shiftKey: false, altKey: false, ctrlKey: false, button: 0, ...extra };
}

describe('resolveMarqueeMode', () => {
  it('alt resolves to subtract', () => {
    expect(resolveMarqueeMode(ptr(0, 0, { altKey: true }), 'add')).toBe('subtract');
  });
  it('shift resolves to add', () => {
    expect(resolveMarqueeMode(ptr(0, 0, { shiftKey: true }), 'new')).toBe('add');
  });
  it('no modifier falls back to the sticky mode', () => {
    expect(resolveMarqueeMode(ptr(0, 0), 'subtract')).toBe('subtract');
  });
});

describe('SelectTool', () => {
  it('a real drag settles a rectangular selection (mode new)', () => {
    const ctx = makeContext(makeFrame(10, 10));
    const tool = createSelectTool();
    const gesture = tool.beginGesture(ptr(2, 2), ctx)!;
    gesture.onPointerMove(ptr(2, 2), ctx);
    const preview = gesture.onPointerMove(ptr(5, 6), ctx)!;
    expect(preview.selectionDraft).toEqual({ x0: 2, y0: 2, x1: 5, y1: 6 });
    const result = gesture.onPointerUp(ptr(5, 6), ctx);
    expect(result.selection).toEqual({ box: { x0: 2, y0: 2, x1: 5, y1: 6 }, mask: null, outline: null });
    expect(result.changed).toBe(false);
  });

  it('a plain click with mode new clears the selection', () => {
    const ctx = makeContext(makeFrame(10, 10), { selection: { x0: 0, y0: 0, x1: 3, y1: 3 } });
    const tool = createSelectTool();
    const down = ptr(7, 7);
    const gesture = tool.beginGesture(down, ctx)!;
    const result = gesture.onPointerUp(down, ctx);
    expect(result.selection).toEqual({ box: null, mask: null, outline: null });
  });

  it('shift-drag adds a rectangle to the existing selection', () => {
    const ctx = makeContext(makeFrame(10, 10), { selection: { x0: 0, y0: 0, x1: 1, y1: 1 } });
    const tool = createSelectTool();
    const down = ptr(3, 3, { shiftKey: true });
    const gesture = tool.beginGesture(down, ctx)!;
    gesture.onPointerMove(down, ctx);
    gesture.onPointerMove(ptr(4, 4, { shiftKey: true }), ctx);
    const result = gesture.onPointerUp(ptr(4, 4, { shiftKey: true }), ctx);
    // Two disjoint 2x2 blocks - not a single rectangle, so it stays a real mask.
    expect(result.selection?.mask?.has('0,0')).toBe(true);
    expect(result.selection?.mask?.has('3,3')).toBe(true);
    expect(result.selection?.mask?.has('4,4')).toBe(true);
  });

  it('alt-drag subtracts from the existing selection', () => {
    const ctx = makeContext(makeFrame(10, 10), { selection: { x0: 0, y0: 0, x1: 3, y1: 3 } });
    const tool = createSelectTool();
    const down = ptr(0, 0, { altKey: true });
    const gesture = tool.beginGesture(down, ctx)!;
    gesture.onPointerMove(down, ctx);
    gesture.onPointerMove(ptr(1, 1, { altKey: true }), ctx);
    const result = gesture.onPointerUp(ptr(1, 1, { altKey: true }), ctx);
    expect(result.selection?.mask?.has('0,0')).toBe(false);
    expect(result.selection?.mask?.has('3,3')).toBe(true);
  });

  it('a plain click in add/subtract mode leaves the existing selection untouched (omits `selection`)', () => {
    const ctx = makeContext(makeFrame(10, 10), { selection: { x0: 0, y0: 0, x1: 3, y1: 3 } });
    const tool = createSelectTool();
    const down = ptr(7, 7, { shiftKey: true });
    const gesture = tool.beginGesture(down, ctx)!;
    const result = gesture.onPointerUp(down, ctx);
    expect(result.selection).toBeUndefined();
  });

  it('freezes the preview (returns null) once the pointer leaves the canvas', () => {
    const ctx = makeContext(makeFrame(10, 10));
    const tool = createSelectTool();
    const down = ptr(2, 2);
    const gesture = tool.beginGesture(down, ctx)!;
    expect(gesture.onPointerMove(ptr(-1, 5), ctx)).toBeNull();
  });

  it('never touches a pixel and never marks the gesture as changed', () => {
    const ctx = makeContext(makeFrame(10, 10));
    const tool = createSelectTool();
    const down = ptr(0, 0);
    const gesture = tool.beginGesture(down, ctx)!;
    const result = gesture.onPointerUp(ptr(4, 4), ctx);
    expect(result.ops).toEqual([]);
    expect(result.changed).toBe(false);
  });

  it('onCancel reports no changes', () => {
    const ctx = makeContext(makeFrame(10, 10));
    const tool = createSelectTool();
    const gesture = tool.beginGesture(ptr(0, 0), ctx)!;
    expect(gesture.onCancel(ctx)).toEqual({ ops: [], dirtyRects: [], changed: false, cancelled: true });
  });
});
