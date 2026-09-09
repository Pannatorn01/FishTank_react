import { describe, expect, it } from 'vitest';
import { createFillTool } from '../tools/fillTool';
import { makeContext, makeFrame, ptr } from './testUtils';

describe('FillTool', () => {
  it('floods a contiguous same-color region', () => {
    // 3x3 all one color - clicking anywhere fills the whole thing.
    const ctx = makeContext(makeFrame(3, 3, () => null));
    const tool = createFillTool();
    const result = tool.beginGesture(ptr(1, 1), ctx)!.onPointerUp(ptr(1, 1), ctx);
    expect(result.ops.length).toBe(9);
    expect(result.ops.every((op) => op.color === '#ff0000')).toBe(true);
    expect(result.changed).toBe(true);
  });

  it('stops at a color boundary', () => {
    // 3x1: red, red, blue - filling from the left only reaches the two reds.
    const ctx = makeContext(makeFrame(3, 1, (x) => (x < 2 ? '#000000' : '#0000ff')));
    const tool = createFillTool();
    const result = tool.beginGesture(ptr(0, 0), ctx)!.onPointerUp(ptr(0, 0), ctx);
    const keys = result.ops.map((o) => `${o.x},${o.y}`).sort();
    expect(keys).toEqual(['0,0', '1,0']);
  });

  it('a selection blocks the flood from leaking through a path outside it', () => {
    // 3x3, all one color. Selection covers only the two opposite corners' rows, NOT the middle row -
    // so within the selection there are two 1x1 regions (top-left, bottom-left corners of the mask)
    // that are only connected to each other via the middle row, which is OUTSIDE the selection.
    // Clicking one corner must not reach the other.
    const frame = makeFrame(1, 3, () => null); // a single column, 3 cells tall, all same color
    const mask = new Set(['0,0', '0,2']); // top and bottom cells selected; middle (0,1) is not
    const ctx = makeContext(frame, { selection: { x0: 0, y0: 0, x1: 0, y1: 2 }, selectionMask: mask });
    const tool = createFillTool();
    const result = tool.beginGesture(ptr(0, 0), ctx)!.onPointerUp(ptr(0, 0), ctx);
    const keys = result.ops.map((o) => `${o.x},${o.y}`);
    expect(keys).toEqual(['0,0']); // NOT ['0,0', '0,2'] - the flood must not leak through (0,1)
  });

  it('shift+click (global replace) reaches every matching pixel regardless of adjacency', () => {
    // 3x1: red, blue, red - a plain click only reaches the clicked cell; global reaches both reds.
    const ctx = makeContext(makeFrame(3, 1, (x) => (x === 1 ? '#0000ff' : '#ff5500')));
    const tool = createFillTool();
    const result = tool
      .beginGesture(ptr(0, 0, { shiftKey: true }), ctx)!
      .onPointerUp(ptr(0, 0, { shiftKey: true }), ctx);
    const keys = result.ops.map((o) => `${o.x},${o.y}`).sort();
    expect(keys).toEqual(['0,0', '2,0']);
  });

  it('mirrors as N independent floods (each sampling its own target color), not one mirrored result', () => {
    // 4x1 with vertical symmetry (axis at x=2): left half is green, right half is blue - both
    // different from ctx.color ('#ff0000', the fillColor), so neither flood is a same-color no-op.
    // Clicking the green side floods only the green cells there; its mirror point (on the blue side)
    // independently floods the blue cells there too - two different source colors, one fillColor.
    const frame = makeFrame(4, 1, (x) => (x < 2 ? '#00ff00' : '#0000ff'));
    const ctx = makeContext(frame, { symmetry: 'vertical', symmetryAxisX: 2, symmetryAxisY: 0.5 });
    const tool = createFillTool();
    const result = tool.beginGesture(ptr(0, 0), ctx)!.onPointerUp(ptr(0, 0), ctx);
    const keys = result.ops.map((o) => `${o.x},${o.y}`).sort();
    // (0,0) is green, mirrors to (3,0); the flood from (0,0) covers green cells {0,0;1,0}, and the
    // independent flood from the mirror point (3,0) covers blue cells {2,0;3,0}.
    expect(keys).toEqual(['0,0', '1,0', '2,0', '3,0']);
    expect(result.ops.every((op) => op.color === '#ff0000')).toBe(true);
  });

  it('right-click erases (fillColor null)', () => {
    const ctx = makeContext(makeFrame(3, 3, () => '#123456'));
    const tool = createFillTool();
    const result = tool.beginGesture(ptr(1, 1, { button: 2 }), ctx)!.onPointerUp(ptr(1, 1, { button: 2 }), ctx);
    expect(result.ops.every((op) => op.color === null)).toBe(true);
  });

  it('reports changed: false when clicking a pixel already the fill color', () => {
    const ctx = makeContext(makeFrame(3, 3, () => '#ff0000')); // ctx.color default is '#ff0000'
    const tool = createFillTool();
    const result = tool.beginGesture(ptr(1, 1), ctx)!.onPointerUp(ptr(1, 1), ctx);
    expect(result.changed).toBe(false);
  });

  it('onCancel reports no changes', () => {
    const ctx = makeContext(makeFrame(3, 3));
    const tool = createFillTool();
    const gesture = tool.beginGesture(ptr(0, 0), ctx)!;
    expect(gesture.onCancel(ctx)).toEqual({ ops: [], dirtyRects: [], changed: false, cancelled: true });
  });
});
