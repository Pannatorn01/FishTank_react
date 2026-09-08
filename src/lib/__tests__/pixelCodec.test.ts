import { describe, expect, it } from 'vitest';
import { decodeFrame, encodeFrame, isRleFrame, type RleFrame } from '../pixelCodec';
import type { Frame } from '../types';

function roundTrip(cells: Frame): Frame {
  return decodeFrame(encodeFrame(cells));
}

describe('pixelCodec round-trip', () => {
  it('an empty frame stays empty', () => {
    expect(roundTrip([])).toEqual([]);
  });

  it('an all-transparent frame comes back the same length', () => {
    const cells: Frame = new Array(64).fill(null);
    expect(roundTrip(cells)).toEqual(cells);
  });

  it('preserves a mix of colours and gaps', () => {
    const cells: Frame = ['#ff0000', '#ff0000', null, '#00ff00', null, null, '#ff0000'];
    expect(roundTrip(cells)).toEqual(cells);
  });

  it('preserves a frame where every cell differs (the worst case for run-length coding)', () => {
    const cells: Frame = Array.from({ length: 256 }, (_, i) => `#${i.toString(16).padStart(6, '0')}`);
    expect(roundTrip(cells)).toEqual(cells);
  });

  it('reuses one palette entry for a colour that appears in several runs', () => {
    const encoded = encodeFrame(['#abcdef', null, '#abcdef']);
    expect(encoded.palette).toEqual(['#abcdef']);
    expect(encoded.runs).toEqual([1, 1, 1, 0, 1, 1]);
  });

  it('collapses a long single-colour stretch into one run', () => {
    const encoded = encodeFrame(new Array(1000).fill('#123456'));
    expect(encoded.runs).toEqual([1000, 1]);
  });

  it('is much smaller than the raw array for typical pixel art', () => {
    // A sprite-shaped frame: transparent margins, a solid body, a little detail.
    const cells: Frame = new Array(32 * 32).fill(null);
    for (let i = 300; i < 700; i += 1) cells[i] = '#ff7043';
    cells[512] = '#1a1a1a';
    const raw = JSON.stringify(cells).length;
    const encoded = JSON.stringify(encodeFrame(cells)).length;
    expect(encoded).toBeLessThan(raw / 5);
  });
});

describe('pixelCodec robustness', () => {
  it('recognises only its own encoded shape', () => {
    expect(isRleFrame(encodeFrame([null]))).toBe(true);
    expect(isRleFrame([null, '#fff'])).toBe(false);
    expect(isRleFrame(null)).toBe(false);
    expect(isRleFrame({ enc: 'something-else' })).toBe(false);
  });

  it('decodes a damaged frame to something short rather than throwing', () => {
    // isValidSprite (storage.ts) catches the short result against the sprite's own width x height;
    // throwing here would take down the whole load instead of dropping one sprite.
    const damaged = { enc: 'rle1', palette: ['#fff'], runs: [3, 1, 2] } as RleFrame;
    expect(decodeFrame(damaged)).toEqual(['#fff', '#fff', '#fff']);
    expect(decodeFrame({ enc: 'rle1', palette: [], runs: [4, 9] })).toEqual([null, null, null, null]);
    expect(decodeFrame({ enc: 'rle1' } as unknown as RleFrame)).toEqual([]);
  });

  it('ignores a nonsense run length instead of looping forever', () => {
    expect(decodeFrame({ enc: 'rle1', palette: ['#fff'], runs: [-5, 1, 2, 1] })).toEqual(['#fff', '#fff']);
  });
});
