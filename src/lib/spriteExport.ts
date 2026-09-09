import { downloadBlob } from './download';
import { paintLayers } from './pixelMath';
import type { Sprite } from './types';

/** How many screen pixels one sprite cell becomes in an exported PNG. Aims for a ~256px-long side so a
 *  16x16 sprite lands somewhere usable rather than as a 16px thumbnail, with a floor of 4x so a sprite
 *  that is already large (a 1400x900 background, say) still exports crisply above its native size
 *  instead of being scaled down. Always an integer, so every cell stays a perfect square block and the
 *  export keeps hard pixel-art edges. */
export function exportScale(width: number, height: number): number {
  return Math.max(4, Math.round(256 / Math.max(width, height)));
}

/** The sprite's name reduced to something safe to use as a filename stem, falling back to "sprite" for
 *  a sprite that was never named or whose name is only whitespace. */
export function spriteBaseName(sprite: Sprite): string {
  return (sprite.name || 'sprite').trim() || 'sprite';
}

/** One frame of a sprite, flattened across its layers onto a fresh off-screen canvas at export scale. */
export function renderFrameCanvas(sprite: Sprite, frameIndex: number): HTMLCanvasElement {
  const { width, height } = sprite;
  const scale = exportScale(width, height);
  const off = document.createElement('canvas');
  off.width = width * scale;
  off.height = height * scale;
  paintLayers(off.getContext('2d')!, sprite.frames[frameIndex], width, height, scale);
  return off;
}

/** Every frame of a sprite laid out left to right in one strip - the conventional sprite-sheet layout
 *  a game engine's frame slicer expects, with each cell exactly `width * scale` wide. */
export function renderSpriteSheetCanvas(sprite: Sprite): HTMLCanvasElement {
  const { width, height, frames } = sprite;
  const scale = exportScale(width, height);
  const off = document.createElement('canvas');
  off.width = width * scale * frames.length;
  off.height = height * scale;
  const ctx = off.getContext('2d')!;
  frames.forEach((layers, i) => {
    ctx.save();
    ctx.translate(i * width * scale, 0);
    paintLayers(ctx, layers, width, height, scale);
    ctx.restore();
  });
  return off;
}

export function downloadFramePng(sprite: Sprite, frameIndex: number): void {
  const name = spriteBaseName(sprite);
  renderFrameCanvas(sprite, frameIndex).toBlob((blob) => downloadBlob(blob, `${name}_frame${frameIndex + 1}.png`));
}

export function downloadSpriteSheetPng(sprite: Sprite): void {
  const name = spriteBaseName(sprite);
  renderSpriteSheetCanvas(sprite).toBlob((blob) => downloadBlob(blob, `${name}_sheet.png`));
}

/** Exports a sprite as a standalone .json file (not PNG) - lets an artist back up or share a sprite's
 *  actual editable data, not just a flattened image. GIF export was considered but intentionally
 *  skipped (would need a new dependency, out of scope for this pass). */
export function downloadSpriteJson(sprite: Sprite): void {
  const blob = new Blob([JSON.stringify(sprite, null, 2)], { type: 'application/json' });
  downloadBlob(blob, `${spriteBaseName(sprite)}.json`);
}
