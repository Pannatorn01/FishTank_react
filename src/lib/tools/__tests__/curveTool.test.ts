import { describe, expect, it } from 'vitest';
import { createCurveTool } from '../tools/curveTool';
import { makeContext, makeFrame } from './testUtils';
import type { ToolPointerEvent } from '../types';

function ptr(x: number, y: number, extra: Partial<ToolPointerEvent> = {}): ToolPointerEvent {
  return { cell: { x, y }, shiftKey: false, altKey: false, ctrlKey: false, button: 0, ...extra };
}

describe('CurveTool', () => {
  it('drag-end phase previews a straight bresenham line and mirrors phase into curvePreview', () => {
    const ctx = makeContext(makeFrame(10, 10));
    const tool = createCurveTool();
    const gesture = tool.beginGesture(ptr(0, 0), ctx)!;
    const preview = gesture.onPointerMove(ptr(3, 0), ctx)!;
    expect(preview.overlay!.cells.map((c) => `${c.x},${c.y}`).sort()).toEqual(['0,0', '1,0', '2,0', '3,0']);
    expect(preview.curvePreview).toEqual({ phase: 'drag-end', control: null });
  });

  it('a zero-length drag cancels instead of transitioning to bend', () => {
    const ctx = makeContext(makeFrame(10, 10));
    const tool = createCurveTool();
    const gesture = tool.beginGesture(ptr(5, 5), ctx)!;
    gesture.onPointerMove(ptr(5, 5), ctx);
    const result = gesture.onPointerUp(ptr(5, 5), ctx);
    expect(result.cancelled).toBe(true);
    expect(result.changed).toBe(false);
    expect(result.keepActive).toBeUndefined();
  });

  it('a real drag transitions to bend on release: keepActive, midpoint control, bezier overlay', () => {
    const ctx = makeContext(makeFrame(10, 10));
    const tool = createCurveTool();
    const gesture = tool.beginGesture(ptr(0, 0), ctx)!;
    gesture.onPointerMove(ptr(4, 0), ctx);
    const result = gesture.onPointerUp(ptr(4, 0), ctx);
    expect(result.keepActive).toBe(true);
    expect(result.changed).toBe(false);
    expect(result.curvePreview).toEqual({ phase: 'bend', control: { x: 2, y: 0 } });
    expect(result.overlay).toBeTruthy();
    expect(result.ops).toEqual([]); // nothing committed to the frame yet, just a preview
  });

  it('onPointerMove returns null during bend-idle (hovering with no button held paints nothing)', () => {
    const ctx = makeContext(makeFrame(10, 10));
    const tool = createCurveTool();
    const gesture = tool.beginGesture(ptr(0, 0), ctx)!;
    gesture.onPointerMove(ptr(4, 0), ctx);
    gesture.onPointerUp(ptr(4, 0), ctx); // now in bend-idle
    expect(gesture.onPointerMove(ptr(4, 1), ctx)).toBeNull();
  });

  it('onResumeDown near the control point starts dragging it (a live preview, gesture stays active)', () => {
    const ctx = makeContext(makeFrame(10, 10));
    const tool = createCurveTool();
    const gesture = tool.beginGesture(ptr(0, 0), ctx)!;
    gesture.onPointerMove(ptr(4, 0), ctx);
    gesture.onPointerUp(ptr(4, 0), ctx); // bend-idle, control at (2,0)
    const outcome = gesture.onResumeDown!(ptr(2, 2), ctx, true);
    expect('preview' in outcome).toBe(true);
    const preview = (outcome as { preview: ReturnType<typeof gesture.onPointerMove> }).preview!;
    expect(preview.curvePreview).toEqual({ phase: 'bend', control: { x: 2, y: 2 } });
  });

  it('onResumeDown away from the control point commits the curve', () => {
    const ctx = makeContext(makeFrame(10, 10));
    const tool = createCurveTool();
    const gesture = tool.beginGesture(ptr(0, 0), ctx)!;
    gesture.onPointerMove(ptr(4, 0), ctx);
    gesture.onPointerUp(ptr(4, 0), ctx); // bend-idle, straight bezier along y=0 from x=0 to x=4
    const outcome = gesture.onResumeDown!(ptr(8, 8), ctx, false);
    expect('result' in outcome).toBe(true);
    const result = (outcome as { result: ReturnType<typeof gesture.onPointerUp> }).result;
    expect(result.changed).toBe(true);
    expect(result.keepActive).toBeUndefined();
    expect(result.ops.map((o) => `${o.x},${o.y}`).sort()).toEqual(['0,0', '1,0', '2,0', '3,0', '4,0']);
    expect(result.ops.every((op) => op.color === '#ff0000')).toBe(true);
  });

  it('Enter commits during bend-idle, same as clicking away', () => {
    const ctx = makeContext(makeFrame(10, 10));
    const tool = createCurveTool();
    const gesture = tool.beginGesture(ptr(0, 0), ctx)!;
    gesture.onPointerMove(ptr(2, 0), ctx);
    gesture.onPointerUp(ptr(2, 0), ctx); // bend-idle
    const result = gesture.onKeyDown!('Enter', ctx)!;
    expect(result).not.toBeNull();
    expect(result.changed).toBe(true);
    expect(result.keepActive).toBeUndefined();
  });

  it('onKeyDown returns null for keys it does not handle, or outside bend-idle, letting normal key handling continue', () => {
    const ctx = makeContext(makeFrame(10, 10));
    const tool = createCurveTool();
    const gesture = tool.beginGesture(ptr(0, 0), ctx)!;
    expect(gesture.onKeyDown!('Enter', ctx)).toBeNull(); // still drag-end, not bend-idle
    gesture.onPointerMove(ptr(2, 0), ctx);
    gesture.onPointerUp(ptr(2, 0), ctx); // now bend-idle
    expect(gesture.onKeyDown!('a', ctx)).toBeNull(); // a key curve doesn't care about
  });

  it('right-click erases (color null) on commit, without ever setting a null color mid-drag', () => {
    const ctx = makeContext(makeFrame(10, 10));
    const tool = createCurveTool();
    const gesture = tool.beginGesture(ptr(0, 0, { button: 2 }), ctx)!;
    gesture.onPointerMove(ptr(2, 0, { button: 2 }), ctx);
    const bendResult = gesture.onPointerUp(ptr(2, 0, { button: 2 }), ctx);
    expect(bendResult.overlay!.color).toBe('rgba(255,255,255,0.45)');
    const outcome = gesture.onResumeDown!(ptr(9, 9), ctx, false);
    const result = (outcome as { result: ReturnType<typeof gesture.onPointerUp> }).result;
    expect(result.ops.every((op) => op.color === null)).toBe(true);
  });

  it('a selection restricts the final commit to inside it (the live preview itself is unclipped)', () => {
    const ctx = makeContext(makeFrame(10, 10), { selection: { x0: 0, y0: 0, x1: 1, y1: 0 } });
    const tool = createCurveTool();
    const gesture = tool.beginGesture(ptr(0, 0), ctx)!;
    gesture.onPointerMove(ptr(4, 0), ctx);
    gesture.onPointerUp(ptr(4, 0), ctx);
    const outcome = gesture.onResumeDown!(ptr(9, 9), ctx, false);
    const result = (outcome as { result: ReturnType<typeof gesture.onPointerUp> }).result;
    expect(result.ops.map((o) => `${o.x},${o.y}`).sort()).toEqual(['0,0', '1,0']);
  });

  it('mirrors the live preview through symmetry', () => {
    const ctx = makeContext(makeFrame(10, 10), { symmetry: 'vertical', symmetryAxisX: 5, symmetryAxisY: 5 });
    const tool = createCurveTool();
    const gesture = tool.beginGesture(ptr(2, 0), ctx)!;
    const preview = gesture.onPointerMove(ptr(2, 3), ctx)!;
    // The straight-line drag-end preview (0,0)-independent path from (2,0) to (2,3) plus its mirror
    // across axisX=5 (x=7) - twice as many cells as the unmirrored path, none shared (x=2 vs x=7).
    const xs = new Set(preview.overlay!.cells.map((c) => c.x));
    expect(xs.has(2)).toBe(true);
    expect(xs.has(7)).toBe(true);
  });

  it('onCancel reports no changes', () => {
    const ctx = makeContext(makeFrame(10, 10));
    const tool = createCurveTool();
    const gesture = tool.beginGesture(ptr(0, 0), ctx)!;
    expect(gesture.onCancel(ctx)).toEqual({ ops: [], dirtyRects: [], changed: false, cancelled: true });
  });
});
