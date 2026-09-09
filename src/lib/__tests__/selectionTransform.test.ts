import { describe, expect, it } from 'vitest';
import {
  inverseRotation,
  resizedBox,
  rotatedMask,
  rotatedRegionCells,
  scaledRegionCells,
  type RegionPixels,
} from '../selectionTransform';
import type { SelectionBox } from '../types';

/** A `w` x `h` region where every cell carries its own coordinates as a color, so a test can tell
 *  exactly which source pixel ended up where. */
function region(w: number, h: number): RegionPixels {
  return Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => `#${x}${y}`));
}

const box = (x0: number, y0: number, x1: number, y1: number): SelectionBox => ({ x0, y0, x1, y1 });

describe('resizedBox', () => {
  it('moves only the edges the grabbed handle names', () => {
    const origin = box(2, 2, 6, 6);
    expect(resizedBox(origin, 'e', { x: 9, y: 99 })).toEqual(box(2, 2, 9, 6));
    expect(resizedBox(origin, 'n', { x: 99, y: 0 })).toEqual(box(2, 0, 6, 6));
    expect(resizedBox(origin, 'sw', { x: 0, y: 8 })).toEqual(box(0, 2, 6, 8));
  });

  it('flips rather than inverting when a handle is dragged past the opposite edge', () => {
    const result = resizedBox(box(2, 2, 6, 6), 'e', { x: 0, y: 4 });
    expect(result.x0).toBeLessThanOrEqual(result.x1);
    expect(result).toEqual(box(0, 2, 2, 6));
  });
});

describe('scaledRegionCells', () => {
  it('is a plain copy when the box does not change size', () => {
    const cells = scaledRegionCells(region(2, 2), box(0, 0, 1, 1), box(5, 5, 6, 6));
    expect(cells).toEqual([
      { x: 5, y: 5, color: '#00' },
      { x: 6, y: 5, color: '#10' },
      { x: 5, y: 6, color: '#01' },
      { x: 6, y: 6, color: '#11' },
    ]);
  });

  it('duplicates whole cells when scaling up - never blends two colors into a third', () => {
    const cells = scaledRegionCells(region(2, 2), box(0, 0, 1, 1), box(0, 0, 3, 3));
    expect(cells).toHaveLength(16);
    const colors = new Set(cells.map((c) => c.color));
    expect([...colors].sort()).toEqual(['#00', '#01', '#10', '#11']);
  });

  it('drops empty source cells instead of writing them as holes', () => {
    const source: RegionPixels = [
      ['#aaa', null],
      [null, '#bbb'],
    ];
    const cells = scaledRegionCells(source, box(0, 0, 1, 1), box(0, 0, 1, 1));
    expect(cells.map((c) => c.color)).toEqual(['#aaa', '#bbb']);
  });
});

describe('rotatedRegionCells', () => {
  it('is the identity at angle 0', () => {
    const origin = box(1, 1, 3, 3);
    const { cells, box: out } = rotatedRegionCells(origin, region(3, 3), 0, 16, 16);
    expect(out).toEqual(origin);
    expect(cells).toHaveLength(9);
    // Every cell still holds the color of the cell it sits on.
    cells.forEach((c) => expect(c.color).toBe(`#${c.x - 1}${c.y - 1}`));
  });

  it('turns a quarter-turn into an exact, lossless transpose', () => {
    const origin = box(0, 0, 2, 2);
    const { cells } = rotatedRegionCells(origin, region(3, 3), Math.PI / 2, 16, 16);
    // A 90-degree turn of a square keeps every pixel: nothing lands outside, nothing doubles up.
    expect(cells).toHaveLength(9);
    expect(new Set(cells.map((c) => c.color)).size).toBe(9);
  });

  it('leaves the corners of the rotated box empty rather than smearing edge pixels into them', () => {
    const origin = box(0, 0, 7, 7);
    const { cells, box: out } = rotatedRegionCells(origin, region(8, 8), Math.PI / 4, 40, 40);
    // A 45-degree turn needs a bigger box than the square it rotates...
    expect(out.x1 - out.x0 + 1).toBeGreaterThan(8);
    // ...and cannot fill it: the four corner triangles hold no pixel of the original.
    const area = (out.x1 - out.x0 + 1) * (out.y1 - out.y0 + 1);
    expect(cells.length).toBeLessThan(area);
    // Whatever it does paint really is the original's pixels, not invented ones.
    const originals = new Set(region(8, 8).flat());
    cells.forEach((c) => expect(originals.has(c.color)).toBe(true));
  });

  it('keeps the original box when the rotation lands entirely off-canvas', () => {
    const origin = box(30, 30, 33, 33);
    const { cells, box: out } = rotatedRegionCells(origin, region(4, 4), 0.3, 8, 8);
    expect(out).toEqual(origin);
    expect(cells).toEqual([]);
  });
});

describe('rotatedMask travels with the pixels', () => {
  // This is the property the whole module exists for: the mask and the artwork are derived from one
  // `inverseRotation`, so a rotated selection cannot end up describing a different shape than the
  // pixels that just moved under it.
  const angles = [0, 0.3, Math.PI / 4, Math.PI / 2, 2.1, -1.4];

  it('marks exactly the cells that received a pixel, for a fully opaque selection', () => {
    const origin = box(2, 2, 7, 9);
    const source = region(6, 8);
    for (const angle of angles) {
      const { cells, box: out } = rotatedRegionCells(origin, source, angle, 32, 32);
      const mask = rotatedMask(origin, null, angle, out);
      const painted = new Set(cells.map((c) => `${c.x},${c.y}`));
      expect([...mask].sort()).toEqual([...painted].sort());
    }
  });

  it('follows a freeform mask, keeping only the cells whose source was selected', () => {
    const origin = box(0, 0, 5, 5);
    // A diagonal half of the region.
    const selected = new Set<string>();
    for (let y = 0; y <= 5; y++) for (let x = 0; x <= y; x++) selected.add(`${x},${y}`);

    for (const angle of angles) {
      const { box: out } = rotatedRegionCells(origin, region(6, 6), angle, 32, 32);
      const mask = rotatedMask(origin, selected, angle, out);
      // Never more cells than the original selection had, and every one of them traces back to a cell
      // that really was selected.
      expect(mask.size).toBeLessThanOrEqual(selected.size);
      const rot = inverseRotation(origin, angle);
      mask.forEach((key) => {
        const [x, y] = key.split(',').map(Number);
        const src = rot.sourceOf(x, y);
        expect(selected.has(`${src.x},${src.y}`)).toBe(true);
      });
    }
  });

  it('is the identity at angle 0, mask and all', () => {
    const origin = box(1, 1, 4, 4);
    const selected = new Set(['1,1', '2,2', '3,3']);
    const { box: out } = rotatedRegionCells(origin, region(4, 4), 0, 16, 16);
    expect([...rotatedMask(origin, selected, 0, out)].sort()).toEqual([...selected].sort());
  });
});
