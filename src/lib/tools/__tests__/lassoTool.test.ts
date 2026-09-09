import { describe, expect, it } from 'vitest';
import { createLassoTool } from '../tools/lassoTool';
import { makeContext, makeFrame, ptr } from './testUtils';
import type { ToolPointerEvent } from '../types';

/** Traces a small square path so the resulting mask/outline is unambiguous to assert on. */
function dragSquare(gesture: ReturnType<ReturnType<typeof createLassoTool>['beginGesture']>, ctx: ReturnType<typeof makeContext>, extra: Partial<ToolPointerEvent> = {}) {
  gesture!.onPointerMove(ptr(2, 2, extra), ctx);
  gesture!.onPointerMove(ptr(5, 2, extra), ctx);
  gesture!.onPointerMove(ptr(5, 5, extra), ctx);
  gesture!.onPointerMove(ptr(2, 5, extra), ctx);
  return gesture!.onPointerUp(ptr(2, 5, extra), ctx);
}

describe('LassoTool', () => {
  it('settles a closed freeform path into a selection (mode new)', () => {
    const ctx = makeContext(makeFrame(10, 10));
    const tool = createLassoTool();
    const gesture = tool.beginGesture(ptr(2, 2), ctx);
    const result = dragSquare(gesture, ctx);
    expect(result.selection?.box).toEqual({ x0: 2, y0: 2, x1: 4, y1: 4 });
  });

  it('a too-short path (a click) with mode new clears the selection', () => {
    const ctx = makeContext(makeFrame(10, 10), { selection: { x0: 0, y0: 0, x1: 3, y1: 3 } });
    const tool = createLassoTool();
    const down = ptr(7, 7);
    const gesture = tool.beginGesture(down, ctx)!;
    const result = gesture.onPointerUp(down, ctx);
    expect(result.selection).toEqual({ box: null, mask: null, outline: null });
  });

  it('a too-short path in add/subtract mode leaves the existing selection untouched', () => {
    const ctx = makeContext(makeFrame(10, 10), { selection: { x0: 0, y0: 0, x1: 3, y1: 3 } });
    const tool = createLassoTool();
    const down = ptr(7, 7, { shiftKey: true });
    const gesture = tool.beginGesture(down, ctx)!;
    const result = gesture.onPointerUp(down, ctx);
    expect(result.selection).toBeUndefined();
  });

  it('shift-drag adds the traced shape to the existing selection', () => {
    const ctx = makeContext(makeFrame(10, 10), { selection: { x0: 0, y0: 0, x1: 0, y1: 0 } });
    const tool = createLassoTool();
    const gesture = tool.beginGesture(ptr(2, 2, { shiftKey: true }), ctx);
    const result = dragSquare(gesture, ctx, { shiftKey: true });
    expect(result.selection?.mask?.has('0,0')).toBe(true);
    expect(result.selection?.mask?.has('3,3')).toBe(true);
  });

  it('alt-drag subtracts the traced shape from the existing selection', () => {
    const ctx = makeContext(makeFrame(10, 10), { selection: { x0: 0, y0: 0, x1: 4, y1: 4 } });
    const tool = createLassoTool();
    const gesture = tool.beginGesture(ptr(2, 2, { altKey: true }), ctx);
    const result = dragSquare(gesture, ctx, { altKey: true });
    expect(result.selection?.mask?.has('3,3')).toBe(false);
    expect(result.selection?.mask?.has('0,0')).toBe(true);
  });

  it('freezes the preview (returns null) once the pointer leaves the canvas', () => {
    const ctx = makeContext(makeFrame(10, 10));
    const tool = createLassoTool();
    const gesture = tool.beginGesture(ptr(2, 2), ctx)!;
    expect(gesture.onPointerMove(ptr(20, 20), ctx)).toBeNull();
  });

  it('never touches a pixel and never marks the gesture as changed', () => {
    const ctx = makeContext(makeFrame(10, 10));
    const tool = createLassoTool();
    const gesture = tool.beginGesture(ptr(2, 2), ctx);
    const result = dragSquare(gesture, ctx);
    expect(result.ops).toEqual([]);
    expect(result.changed).toBe(false);
  });

  it('onCancel reports no changes', () => {
    const ctx = makeContext(makeFrame(10, 10));
    const tool = createLassoTool();
    const gesture = tool.beginGesture(ptr(0, 0), ctx)!;
    expect(gesture.onCancel(ctx)).toEqual({ ops: [], dirtyRects: [], changed: false, cancelled: true });
  });
});
