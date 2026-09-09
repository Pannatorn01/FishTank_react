import { describe, expect, it } from 'vitest';
import { createGradientTool } from '../tools/gradientTool';
import { hexToRgb, rgbToHex } from '../../pixelMath';
import { makeContext, makeFrame, ptr } from './testUtils';

describe('GradientTool', () => {
  it('blends color -> secondaryColor linearly along the drag axis', () => {
    // 3x1, drag (0,0)->(2,0): t(x) = (x+0.5)/2, clamped to 1 - hand-computed against color #ff0000 /
    // secondaryColor #0000ff (testUtils' defaults), not re-derived from the implementation's own formula.
    const ctx = makeContext(makeFrame(3, 1));
    const tool = createGradientTool();
    const gesture = tool.beginGesture(ptr(0, 0), ctx)!;
    gesture.onPointerMove(ptr(2, 0), ctx);
    const result = gesture.onPointerUp(ptr(2, 0), ctx);
    expect(result.ops).toEqual([
      { x: 0, y: 0, color: '#bf0040' },
      { x: 1, y: 0, color: '#4000bf' },
      { x: 2, y: 0, color: '#0000ff' }, // t clamps to 1 - exactly secondaryColor
    ]);
    expect(result.changed).toBe(true);
  });

  it('right-click reverses which color is the start vs. the end ("reversed gradient", not a real erase)', () => {
    const ctx = makeContext(makeFrame(3, 1));
    const tool = createGradientTool();
    const gesture = tool.beginGesture(ptr(0, 0, { button: 2 }), ctx)!;
    const result = gesture.onPointerUp(ptr(2, 0, { button: 2 }), ctx);
    expect(result.ops).toEqual([
      { x: 0, y: 0, color: '#4000bf' },
      { x: 1, y: 0, color: '#bf0040' },
      { x: 2, y: 0, color: '#ff0000' }, // t clamps to 1 - exactly the primary color now
    ]);
  });

  it('shift-drag snaps the end to the nearest 45° increment via constrainToAngle', () => {
    const ctx = makeContext(makeFrame(10, 10));
    const tool = createGradientTool();
    const gesture = tool.beginGesture(ptr(0, 0), ctx)!;
    const preview = gesture.onPointerMove(ptr(5, 1, { shiftKey: true }), ctx)!;
    expect(preview.gradientPreview).toEqual({ start: { x: 0, y: 0 }, end: { x: 5, y: 0 }, eraseOverride: false });
  });

  it('onPointerMove returns gradientPreview (mirrored engine state for the native-gradient overlay), not ops/overlay', () => {
    const ctx = makeContext(makeFrame(5, 5));
    const tool = createGradientTool();
    const gesture = tool.beginGesture(ptr(1, 1, { button: 2 }), ctx)!;
    const preview = gesture.onPointerMove(ptr(3, 3), ctx)!;
    expect(preview.gradientPreview).toEqual({ start: { x: 1, y: 1 }, end: { x: 3, y: 3 }, eraseOverride: true });
    expect(preview.ops).toBeUndefined();
    expect(preview.overlay).toBeUndefined();
  });

  it('a selection restricts the affected cells to its bounding box', () => {
    const ctx = makeContext(makeFrame(3, 3), { selection: { x0: 1, y0: 0, x1: 1, y1: 2 } });
    const tool = createGradientTool();
    const gesture = tool.beginGesture(ptr(0, 0), ctx)!;
    const result = gesture.onPointerUp(ptr(2, 2), ctx);
    expect(result.ops.map((o) => `${o.x},${o.y}`).sort()).toEqual(['1,0', '1,1', '1,2']);
  });

  it('a non-rectangular selection mask excludes cells inside the bounding box but outside the mask', () => {
    const mask = new Set(['0,0', '2,0']); // corners only, not the middle
    const ctx = makeContext(makeFrame(3, 1), { selection: { x0: 0, y0: 0, x1: 2, y1: 0 }, selectionMask: mask });
    const tool = createGradientTool();
    const gesture = tool.beginGesture(ptr(0, 0), ctx)!;
    const result = gesture.onPointerUp(ptr(2, 0), ctx);
    expect(result.ops.map((o) => `${o.x},${o.y}`).sort()).toEqual(['0,0', '2,0']);
  });

  it('a zero-length drag (click without dragging) paints the whole box with the midpoint blend (t=0.5)', () => {
    const ctx = makeContext(makeFrame(2, 1));
    const tool = createGradientTool();
    const gesture = tool.beginGesture(ptr(0, 0), ctx)!;
    const result = gesture.onPointerUp(ptr(0, 0), ctx);
    const [sr, sg, sb] = hexToRgb('#ff0000');
    const [er, eg, eb] = hexToRgb('#0000ff');
    const mid = rgbToHex((sr + er) / 2, (sg + eg) / 2, (sb + eb) / 2);
    expect(result.ops).toEqual([
      { x: 0, y: 0, color: mid },
      { x: 1, y: 0, color: mid },
    ]);
  });

  it('dither mode picks exactly the start or end color for every cell, never a blended hex', () => {
    const ctx = makeContext(makeFrame(4, 4), { ditherEnabled: true });
    const tool = createGradientTool();
    const gesture = tool.beginGesture(ptr(0, 0), ctx)!;
    const result = gesture.onPointerUp(ptr(3, 3), ctx);
    result.ops.forEach((op) => expect(['#ff0000', '#0000ff']).toContain(op.color));
  });

  it('changed is always true, even when the selection excludes every cell (the original never rolls back a gradient commit)', () => {
    const ctx = makeContext(makeFrame(3, 3), { selection: { x0: 0, y0: 0, x1: 2, y1: 2 }, selectionMask: new Set<string>() });
    const tool = createGradientTool();
    const gesture = tool.beginGesture(ptr(0, 0), ctx)!;
    const result = gesture.onPointerUp(ptr(2, 2), ctx);
    expect(result.ops).toEqual([]);
    expect(result.changed).toBe(true);
  });

  it('always reports alsoSaveColor as the secondary color, alongside the primary color the engine saves generically', () => {
    const ctx = makeContext(makeFrame(2, 1), { secondaryColor: '#123456' });
    const tool = createGradientTool();
    const gesture = tool.beginGesture(ptr(0, 0), ctx)!;
    const result = gesture.onPointerUp(ptr(1, 0), ctx);
    expect(result.alsoSaveColor).toBe('#123456');
  });

  it('ignores symmetry entirely (a pre-existing inconsistency in the original, preserved as-is)', () => {
    const ctx = makeContext(makeFrame(4, 1), { symmetry: 'vertical', symmetryAxisX: 2, symmetryAxisY: 0.5 });
    const tool = createGradientTool();
    const gesture = tool.beginGesture(ptr(0, 0), ctx)!;
    const result = gesture.onPointerUp(ptr(1, 0), ctx);
    expect(result.ops.length).toBe(4); // one op per canvas cell, never doubled/mirrored
  });

  it('onCancel reports no changes', () => {
    const ctx = makeContext(makeFrame(3, 3));
    const tool = createGradientTool();
    const gesture = tool.beginGesture(ptr(0, 0), ctx)!;
    expect(gesture.onCancel(ctx)).toEqual({ ops: [], dirtyRects: [], changed: false, cancelled: true });
  });

  describe('radial', () => {
    it('blends by distance from the drag start (the center), not projection onto the axis', () => {
      // 5x1, drag (2,0)->(4,0): centre at cell 2, radius = 2 cells. t(x) = |x - 2| / 2, clamped.
      // x=0 -> 1 (clamped) ; x=1 -> 0.5 ; x=2 -> 0 ; x=3 -> 0.5 ; x=4 -> 1
      const ctx = makeContext(makeFrame(5, 1), { gradientType: 'radial' });
      const tool = createGradientTool();
      const gesture = tool.beginGesture(ptr(2, 0), ctx)!;
      const result = gesture.onPointerUp(ptr(4, 0), ctx);
      const mix = (t: number) => {
        const [sr, sg, sb] = hexToRgb('#ff0000');
        const [er, eg, eb] = hexToRgb('#0000ff');
        return rgbToHex(sr + (er - sr) * t, sg + (eg - sg) * t, sb + (eb - sb) * t);
      };
      expect(result.ops).toEqual([
        { x: 0, y: 0, color: '#0000ff' },
        { x: 1, y: 0, color: mix(0.5) },
        { x: 2, y: 0, color: '#ff0000' },
        { x: 3, y: 0, color: mix(0.5) },
        { x: 4, y: 0, color: '#0000ff' },
      ]);
    });

    it('is symmetric about the center in 2D (equal-distance cells get the same color)', () => {
      // 5x5, centre (2,2), radius 3 so nothing inside the frame clamps.
      const ctx = makeContext(makeFrame(5, 5), { gradientType: 'radial' });
      const tool = createGradientTool();
      const gesture = tool.beginGesture(ptr(2, 2), ctx)!;
      const result = gesture.onPointerUp(ptr(2, 5), ctx);
      const at = (x: number, y: number) => result.ops.find((o) => o.x === x && o.y === y)!.color;
      // the centre cell is exactly the start colour
      expect(at(2, 2)).toBe('#ff0000');
      // the four edge-neighbours are all one cell from the centre -> same colour
      expect(at(1, 2)).toBe(at(3, 2));
      expect(at(2, 1)).toBe(at(2, 3));
      expect(at(1, 2)).toBe(at(2, 1));
      // the four diagonal-neighbours are all sqrt(2) away -> same colour, further along than the edges
      expect(at(1, 1)).toBe(at(3, 3));
      expect(at(1, 1)).not.toBe(at(1, 2));
    });

    it('a zero-length radial drag still paints the whole box with the t=0.5 midpoint', () => {
      const ctx = makeContext(makeFrame(2, 1), { gradientType: 'radial' });
      const tool = createGradientTool();
      const gesture = tool.beginGesture(ptr(0, 0), ctx)!;
      const result = gesture.onPointerUp(ptr(0, 0), ctx);
      const mid = rgbToHex(127.5, 0, 127.5);
      expect(result.ops).toEqual([
        { x: 0, y: 0, color: mid },
        { x: 1, y: 0, color: mid },
      ]);
    });
  });
});
