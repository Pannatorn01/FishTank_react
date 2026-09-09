import { describe, it } from 'vitest';
import { encodeFrame } from '../pixelCodec';
import { buildDefaultSprites, emptyFrame, makeLayer } from '../storage';
import type { Sprite } from '../types';

function bg(width: number, height: number): Sprite {
  const cells = emptyFrame(width, height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const band = Math.floor((y / height) * 6);
      cells[y * width + x] = y > height * 0.8 && (x * 7 + y * 3) % 11 === 0 ? '#c2b280' : `#1e${(40 + band * 8).toString(16)}7a`;
    }
  }
  return {
    updatedAt: 0, deletedAt: 0, rev: 0, id: 'bg', name: 'bg', type: 'background',
    width, height, frameMs: 120, frames: [[makeLayer(cells)]],
  };
}

function report(label: string, sprites: Sprite[]) {
  const plain = JSON.stringify(sprites).length;
  const encoded = JSON.stringify(
    sprites.map((s) => ({ ...s, frames: s.frames.map((ls) => ls.map((l) => ({ ...l, cells: encodeFrame(l.cells) }))) }))
  ).length;
  const kb = (n: number) => (n / 1024).toFixed(1) + 'KB';
  console.log(`${label}: ${kb(plain)} -> ${kb(encoded)}  (${(plain / encoded).toFixed(1)}x)`);
}

describe('size', () => {
  it('measures', () => {
    report('default sample sprites (2 x 16x16, 2 frames)', buildDefaultSprites());
    report('typical fish 32x32, 4 frames', [{ ...buildDefaultSprites()[0], width: 32, height: 32,
      frames: Array.from({ length: 4 }, () => [makeLayer(emptyFrame(32, 32).map((_, i) => (i % 5 ? null : '#ff7043')))]) }]);
    report('background 640x360', [bg(640, 360)]);
    report('background 1400x900', [bg(1400, 900)]);
  });
});
