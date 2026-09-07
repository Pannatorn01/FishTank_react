import { describe, expect, it } from 'vitest';
import { DirtyRectTracker } from '../dirtyRect';

describe('DirtyRectTracker', () => {
  it('returns nothing for an empty tracker', () => {
    const t = new DirtyRectTracker();
    expect(t.toRects(10, 10)).toEqual([]);
  });

  it('bounds a single cell', () => {
    const t = new DirtyRectTracker();
    t.addCell(3, 4);
    expect(t.toRects(10, 10)).toEqual([{ x0: 3, y0: 4, x1: 3, y1: 4 }]);
  });

  it('unions disjoint cells into one bbox', () => {
    const t = new DirtyRectTracker();
    t.addCell(1, 1);
    t.addCell(8, 9);
    expect(t.toRects(10, 10)).toEqual([{ x0: 1, y0: 1, x1: 8, y1: 9 }]);
  });

  it('clamps to canvas bounds', () => {
    const t = new DirtyRectTracker();
    t.addCell(-5, -5, 2);
    t.addCell(50, 50, 2);
    expect(t.toRects(10, 10)).toEqual([{ x0: 0, y0: 0, x1: 9, y1: 9 }]);
  });

  it('returns nothing when everything added falls outside the canvas', () => {
    const t = new DirtyRectTracker();
    t.addCell(-5, -5);
    expect(t.toRects(10, 10)).toEqual([]);
  });
});
