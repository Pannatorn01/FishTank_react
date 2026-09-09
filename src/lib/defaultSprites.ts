import { emptyFrame } from './pixelMath';
import { makeLayer, newRecordMeta, uid, DEFAULT_FRAME_MS, DEFAULT_GRID_SIZE } from './storage';
import type { Frame, Sprite } from './types';

/**
 * The sprites a brand new library starts with, drawn in code rather than shipped as data.
 *
 * They lived in storage.ts, which is why this file exists: none of it is storage. It is procedural
 * pixel art - a few ellipses and triangles composed into a fish and a plant - that happens to be run
 * once, when there is nothing saved yet. Keeping it next to the localStorage keys meant a reader
 * looking for how sprites are persisted had to scroll past 190 lines of drawing code first.
 */
function setPixel(frame: Frame, width: number, height: number, x: number, y: number, color: string): void {
  if (x < 0 || y < 0 || x >= width || y >= height) return;
  frame[y * width + x] = color;
}

function inEllipse(x: number, y: number, cx: number, cy: number, rx: number, ry: number): boolean {
  const dx = (x - cx) / rx;
  const dy = (y - cy) / ry;
  return dx * dx + dy * dy <= 1;
}

function inTriangle(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x3: number,
  y3: number
): boolean {
  const sign = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) =>
    (ax - cx) * (by - cy) - (bx - cx) * (ay - cy);
  const d1 = sign(px, py, x1, y1, x2, y2);
  const d2 = sign(px, py, x2, y2, x3, y3);
  const d3 = sign(px, py, x3, y3, x1, y1);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

function buildFishFrame(size: number, tailPhase: number): Frame {
  const frame = emptyFrame(size, size);
  const cx = 10;
  const cy = 8;
  const rx = 4.5;
  const ry = 3.5;
  const tailY = 8 + tailPhase;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (inEllipse(x, y, cx, cy, rx + 1, ry + 1) || inTriangle(x, y, 1, tailY, 5, tailY - 3, 5, tailY + 3)) {
        setPixel(frame, size, size, x, y, '#c8501c');
      }
    }
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (inEllipse(x, y, cx, cy, rx, ry) || inTriangle(x, y, 2, tailY, 5, tailY - 2, 5, tailY + 2)) {
        setPixel(frame, size, size, x, y, '#ff7043');
      }
    }
  }
  for (let x = 0; x < size; x++) {
    for (let y = Math.round(cy); y < size; y++) {
      if (inEllipse(x, y, cx, cy + 1, rx - 1, ry - 1.5)) setPixel(frame, size, size, x, y, '#ffccbc');
    }
  }
  setPixel(frame, size, size, 12, 6, '#1a1a1a');
  return frame;
}

function buildPlantFrame(size: number, phase: number): Frame {
  const frame = emptyFrame(size, size);
  const stems = [4, 8, 12];
  stems.forEach((baseX, si) => {
    for (let y = size - 1; y >= 3; y--) {
      const wave = Math.sin(y * 0.5 + phase + si * 1.3) * 1.4;
      const x = Math.round(baseX + wave);
      setPixel(frame, size, size, x, y, y % 3 === 0 ? '#66bb6a' : '#2e7d32');
      setPixel(frame, size, size, x + 1, y, y % 3 === 0 ? '#66bb6a' : '#2e7d32');
    }
  });
  return frame;
}

export function buildDefaultSprites(): Sprite[] {
  return [
    {
      ...newRecordMeta(),
      id: uid('sprite'),
      name: 'Goldfish (sample)',
      type: 'fish',
      width: DEFAULT_GRID_SIZE,
      height: DEFAULT_GRID_SIZE,
      frames: [
        [makeLayer(buildFishFrame(DEFAULT_GRID_SIZE, -2))],
        [makeLayer(buildFishFrame(DEFAULT_GRID_SIZE, 2))],
      ],
      frameMs: DEFAULT_FRAME_MS,
    },
    {
      ...newRecordMeta(),
      id: uid('sprite'),
      name: 'Seaweed (sample)',
      type: 'object',
      width: DEFAULT_GRID_SIZE,
      height: DEFAULT_GRID_SIZE,
      frames: [
        [makeLayer(buildPlantFrame(DEFAULT_GRID_SIZE, 0))],
        [makeLayer(buildPlantFrame(DEFAULT_GRID_SIZE, Math.PI / 2))],
      ],
      frameMs: DEFAULT_FRAME_MS,
    },
  ];
}

/** Every localStorage key this app writes - kept as one list so backup/reset (see below) can't drift
 *  out of sync with a key added elsewhere in this file without updating this too. */
