import { describe, expect, it } from 'vitest';
import { bresenhamLine } from '../pixelMath';

describe('bresenhamLine', () => {
  it('draws a straight horizontal line inclusive of both endpoints', () => {
    expect(bresenhamLine(0, 0, 3, 0)).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
    ]);
  });

  it('returns a single point for a zero-length line', () => {
    expect(bresenhamLine(5, 5, 5, 5)).toEqual([{ x: 5, y: 5 }]);
  });

  it('never hangs on NaN input - a bad pointer-position calculation upstream - instead returning a single point', () => {
    expect(bresenhamLine(NaN, 4, 5, 5)).toEqual([{ x: 0, y: 4 }]);
    expect(bresenhamLine(4, NaN, 5, 5)).toEqual([{ x: 4, y: 0 }]);
    expect(bresenhamLine(1, 1, NaN, NaN)).toEqual([{ x: 1, y: 1 }]);
  });

  it('never hangs on Infinite input', () => {
    const result = bresenhamLine(Infinity, 0, 0, 0);
    expect(result).toEqual([{ x: 0, y: 0 }]);
  });
});
