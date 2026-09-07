import { describe, expect, it } from 'vitest';
import { createShapeTool } from '../tools/shapeTool';
import { makeContext, makeFrame } from './testUtils';
import type { ToolPointerEvent } from '../types';

function ptr(x: number, y: number, extra: Partial<ToolPointerEvent> = {}): ToolPointerEvent {
  return { cell: { x, y }, shiftKey: false, altKey: false, ctrlKey: false, button: 0, ...extra };
}

describe('ShapeTool (rect)', () => {
  it('paints a single cell for a zero-size drag', () => {
    const ctx = makeContext(makeFrame(10, 10));
    const tool = createShapeTool('rect');
    const down = ptr(3, 3);
    const gesture = tool.beginGesture(down, ctx)!;
    const result = gesture.onPointerUp(down, ctx);
    expect(result.ops).toEqual([{ x: 3, y: 3, color: '#ff0000' }]);
    expect(result.changed).toBe(true);
  });

  it('shift-constrains an unequal drag into a square', () => {
    const ctx = makeContext(makeFrame(20, 20));
    const tool = createShapeTool('rect');
    const down = ptr(0, 0);
    const gesture = tool.beginGesture(down, ctx)!;
    // Drag to (2, 9) - unequal width/height - with Shift held, should constrain to a square using the
    // larger extent (side = max(2, 9) = 9), i.e. a 10x10 square, not a 3x10 rectangle.
    const result = gesture.onPointerUp(ptr(2, 9, { shiftKey: true }), ctx);
    const xs = result.ops.map((o) => o.x);
    const ys = result.ops.map((o) => o.y);
    expect(Math.max(...xs) - Math.min(...xs)).toBe(Math.max(...ys) - Math.min(...ys));
    expect(Math.max(...xs)).toBe(9);
  });

  it('filled vs outline-only produce different cell counts for the same box', () => {
    const outlineCtx = makeContext(makeFrame(10, 10), { shapeFilled: false, brushSize: 1 });
    const filledCtx = makeContext(makeFrame(10, 10), { shapeFilled: true });
    const tool = createShapeTool('rect');
    const down = ptr(0, 0);
    const end = ptr(4, 4);

    const outlineGesture = tool.beginGesture(down, outlineCtx)!;
    const outlineResult = outlineGesture.onPointerUp(end, outlineCtx);

    const filledGesture = tool.beginGesture(down, filledCtx)!;
    const filledResult = filledGesture.onPointerUp(end, filledCtx);

    expect(filledResult.ops.length).toBeGreaterThan(outlineResult.ops.length);
    expect(filledResult.ops.length).toBe(25); // 5x5 fully filled
  });

  it('a thicker brush widens the outline band', () => {
    const thin = makeContext(makeFrame(10, 10), { shapeFilled: false, brushSize: 1 });
    const thick = makeContext(makeFrame(10, 10), { shapeFilled: false, brushSize: 2 });
    const tool = createShapeTool('rect');
    const down = ptr(0, 0);
    const end = ptr(6, 6);

    const thinResult = tool.beginGesture(down, thin)!.onPointerUp(end, thin);
    const thickResult = tool.beginGesture(down, thick)!.onPointerUp(end, thick);

    expect(thickResult.ops.length).toBeGreaterThan(thinResult.ops.length);
  });

  it('bounds-checks ops for a drag past the canvas edge', () => {
    const ctx = makeContext(makeFrame(5, 5), { shapeFilled: true });
    const tool = createShapeTool('rect');
    const down = ptr(3, 3);
    const gesture = tool.beginGesture(down, ctx)!;
    const result = gesture.onPointerUp(ptr(20, 20), ctx);
    result.ops.forEach((op) => {
      expect(op.x).toBeGreaterThanOrEqual(0);
      expect(op.y).toBeGreaterThanOrEqual(0);
      expect(op.x).toBeLessThan(5);
      expect(op.y).toBeLessThan(5);
    });
  });
});
