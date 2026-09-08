import type { CellColor, Frame } from './types';

/**
 * A frame as it is *stored*, run-length encoded. In memory a frame stays a flat array of one colour
 * per cell (see Frame) - that is what drawing needs and nothing here changes it; this is purely the
 * shape written to disk.
 *
 * Why: a 64x64 sprite with 8 frames and 2 layers is 65,536 cells, and JSON spends ~10 characters on
 * every one of them (`"#aabbcc",`). Pixel art is mostly long stretches of the same value - transparent
 * background above all - so encoding those stretches once is the difference between a library that
 * fits in the browser's ~5MB budget and one that does not (docs/STORAGE_DB_MIGRATION_PLAN.md P2).
 *
 * `runs` is a flat [count, paletteIndex, count, paletteIndex, ...] list rather than an array of pairs:
 * half the JSON brackets for the same information. Palette index 0 always means transparent, so it is
 * never stored in `palette` - `palette[0]` is the first *colour*, at index 1.
 */
export interface RleFrame {
  enc: 'rle1';
  palette: string[];
  runs: number[];
}

export function isRleFrame(value: unknown): value is RleFrame {
  return !!value && typeof value === 'object' && (value as RleFrame).enc === 'rle1';
}

export function encodeFrame(cells: Frame): RleFrame {
  const palette: string[] = [];
  const indexOf = new Map<string, number>();
  const runs: number[] = [];

  let runIndex = -1;
  let runLength = 0;
  for (const cell of cells) {
    let index = 0;
    if (cell !== null) {
      const known = indexOf.get(cell);
      if (known === undefined) {
        palette.push(cell);
        index = palette.length; // 1-based: 0 is reserved for transparent
        indexOf.set(cell, index);
      } else {
        index = known;
      }
    }
    if (index === runIndex) {
      runLength += 1;
    } else {
      if (runLength > 0) runs.push(runLength, runIndex);
      runIndex = index;
      runLength = 1;
    }
  }
  if (runLength > 0) runs.push(runLength, runIndex);

  return { enc: 'rle1', palette, runs };
}

/**
 * Rebuilds the flat frame. Tolerant of a malformed value rather than throwing: this runs on data that
 * has been sitting in the browser for months and may have been hand-edited or half-written, and the
 * caller (isValidSprite in storage.ts) already checks the resulting length against the sprite's
 * dimensions - a short or empty frame is caught there and reported, where every other malformed sprite
 * is handled too.
 */
export function decodeFrame(frame: RleFrame): Frame {
  const cells: Frame = [];
  const { palette, runs } = frame;
  if (!Array.isArray(runs) || !Array.isArray(palette)) return cells;
  for (let i = 0; i + 1 < runs.length; i += 2) {
    const count = runs[i];
    const index = runs[i + 1];
    if (!Number.isFinite(count) || count <= 0) continue;
    const color: CellColor = index > 0 ? (palette[index - 1] ?? null) : null;
    for (let n = 0; n < count; n += 1) cells.push(color);
  }
  return cells;
}
