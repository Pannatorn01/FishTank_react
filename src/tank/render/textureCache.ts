import { Texture, TextureSource } from 'pixi.js';
import { paintLayers, spriteDims } from '@/lib/pixelMath';
import type { Sprite } from '@/lib/types';

// The one line every pixel-art-on-Pixi guide warns about, set once for the whole app rather than on
// each texture as it's made. Pixi's default is bilinear ('linear'), which blurs a scaled-up sprite
// exactly the way this app's `.pixelated` CSS class (image-rendering: pixelated) exists to prevent on
// the Canvas2D side. TextureSource's constructor merges these defaults in (`{...defaultOptions,
// ...options}`), so this covers every texture any renderer here creates - including any future one
// that doesn't come from textureFor() below and whose author would otherwise have to remember.
TextureSource.defaultOptions.scaleMode = 'nearest';

/** Same raster density every sprite in the tank has always been painted at (see DISPLAY_SCALE in
 *  useTank.ts) - kept identical here so a Pixi-rendered sprite is pixel-for-pixel the same crispness
 *  as the Canvas2D one it's replacing, not a coincidentally-close approximation. */
const DISPLAY_SCALE = 4;

/**
 * Pixi textures for every (sprite, frame) pair currently in use, keyed so a sprite with multiple
 * animation frames gets one texture per frame (see textureFor). Rasterizing happens exactly once per
 * key, through the *same* `paintLayers()` the Canvas2D tank and the editor's own preview both already
 * use - the only thing that changes between "how the editor draws a sprite" and "how Pixi draws a
 * sprite" is what happens to the pixels *after* they're painted onto a plain 2D canvas: here, that
 * canvas becomes a Texture source instead of being blitted onto another 2D context directly.
 *
 * This is the entire "bridge" between the pixel-art drawing tools (usePixelEditor.ts, untouched by
 * this migration) and Pixi - see docs/PIXI_MIGRATION_PLAN.md §5.
 */
const cache = new Map<string, Texture>();

function keyFor(sprite: Sprite, frameIndex: number, scale: number): string {
  return `${sprite.id}:${frameIndex}@${scale}`;
}

/**
 * `scale` is the raster density, defaulting to the tank's own DISPLAY_SCALE so every caller that
 * draws a sprite at tank size keeps the crispness it always had.
 *
 * Pass 1 for anything the renderer is going to resize anyway - Life mode's room backdrop is stretched
 * to fit the whole viewport, so rasterizing it at 4x first only costs 16x the memory and throws the
 * extra pixels away: a 348x224 backdrop is 4.8MB per frame at 4x and 0.3MB at 1x. Nearest-neighbour
 * upscaling (see scaleMode below) makes the two visually identical.
 */
export function textureFor(sprite: Sprite, frameIndex = 0, scale = DISPLAY_SCALE): Texture {
  const key = keyFor(sprite, frameIndex, scale);
  const hit = cache.get(key);
  if (hit) return hit;

  const { width, height } = spriteDims(sprite);
  const canvas = document.createElement('canvas');
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext('2d')!;
  const frame = sprite.frames[frameIndex] ?? sprite.frames[0];
  if (frame) paintLayers(ctx, frame, width, height, scale);

  // 'nearest' scaling comes from TextureSource.defaultOptions at the top of this file - skipping it
  // is the single most likely way P0's crispness comparison would fail, which is why it's set once
  // there rather than per-texture here.
  const texture = Texture.from(canvas);
  cache.set(key, texture);
  return texture;
}

/** Drops every cached texture for one sprite id - called on 'ft:sprite-deleted' (see useTank.ts's
 *  existing removeInstancesBySprite wiring) so a deleted sprite's stale frames can't outlive it. */
export function invalidateSprite(spriteId: string): void {
  for (const key of cache.keys()) {
    if (key.startsWith(`${spriteId}:`)) {
      cache.get(key)?.destroy(true);
      cache.delete(key);
    }
  }
}

/** Drops every cached texture - called on 'ft:sprites-updated' (dispatched by usePixelEditor.ts
 *  after any save), since that event doesn't say *which* sprite changed and edits are infrequent
 *  enough that a full cache clear is simpler and cheap. */
export function invalidateAll(): void {
  for (const tex of cache.values()) tex.destroy(true);
  cache.clear();
}

export function textureCacheSize(): number {
  return cache.size;
}
