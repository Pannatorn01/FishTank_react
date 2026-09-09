import { describe, expect, it } from 'vitest';
import { createEyedropperTool } from '../tools/eyedropperTool';
import { makeContext, makeFrame, ptr } from './testUtils';

describe('EyedropperTool', () => {
  it('picks the color at the clicked cell and switches to pen', () => {
    const ctx = makeContext(makeFrame(10, 10, () => '#123456'));
    const tool = createEyedropperTool();
    const gesture = tool.beginGesture(ptr(3, 3), ctx)!;
    const result = gesture.onPointerUp(ptr(3, 3), ctx);
    expect(result.pickedColor).toBe('#123456');
    expect(result.switchToPen).toBe(true);
  });

  it('samples the topmost visible layer, not just the active one', () => {
    // getVisibleColor is the context's own multi-layer reader - simulate a case where it differs
    // from getCell (the active layer) by overriding it directly.
    const ctx = makeContext(makeFrame(10, 10, () => null), { getVisibleColor: () => '#abcdef' });
    const tool = createEyedropperTool();
    const result = tool.beginGesture(ptr(0, 0), ctx)!.onPointerUp(ptr(0, 0), ctx);
    expect(result.pickedColor).toBe('#abcdef');
  });

  it('does nothing when the clicked cell has no paint on any visible layer', () => {
    const ctx = makeContext(makeFrame(10, 10, () => null));
    const tool = createEyedropperTool();
    const result = tool.beginGesture(ptr(5, 5), ctx)!.onPointerUp(ptr(5, 5), ctx);
    expect(result.pickedColor).toBeUndefined();
    expect(result.switchToPen).toBeUndefined();
  });

  it('never touches a pixel or marks the gesture as changed', () => {
    const ctx = makeContext(makeFrame(10, 10, () => '#fff'));
    const tool = createEyedropperTool();
    const result = tool.beginGesture(ptr(0, 0), ctx)!.onPointerUp(ptr(0, 0), ctx);
    expect(result.ops).toEqual([]);
    expect(result.changed).toBe(false);
  });

  it('onCancel reports no changes', () => {
    const ctx = makeContext(makeFrame(10, 10));
    const tool = createEyedropperTool();
    const gesture = tool.beginGesture(ptr(0, 0), ctx)!;
    expect(gesture.onCancel(ctx)).toEqual({ ops: [], dirtyRects: [], changed: false, cancelled: true });
  });
});
