import { Texture } from 'pixi.js';
import { paintLayers } from '@/lib/pixelMath';
import type { Sprite } from '@/lib/types';

/** Same raster density every sprite in the tank has always been painted at (see DISPLAY_SCALE in
 *  useTank.ts) - kept identical here so a Pixi-rendered sprite is pixel-for-pixel the same crispness
 *  as the Canvas2D one it's replacing, not a coincidentally-close approximation. */
const DISPLAY_SCALE = 4;

function spriteDims(sprite: Sprite): { width: number; height: number } {
  return { width: sprite.width || 16, height: sprite.height || 16 };
}

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

function keyFor(sprite: Sprite, frameIndex: number): string {
  return `${sprite.id ?? 'unsaved'}:${frameIndex}`;
}

export function textureFor(sprite: Sprite, frameIndex = 0): Texture {
  const key = keyFor(sprite, frameIndex);
  const hit = cache.get(key);
  if (hit) return hit;

  const { width, height } = spriteDims(sprite);
  const canvas = document.createElement('canvas');
  canvas.width = width * DISPLAY_SCALE;
  canvas.height = height * DISPLAY_SCALE;
  const ctx = canvas.getContext('2d')!;
  const frame = sprite.frames[frameIndex] ?? sprite.frames[0];
  if (frame) paintLayers(ctx, frame, width, height, DISPLAY_SCALE);

  const texture = Texture.from(canvas);
  // The one line every pixel-art-on-Pixi guide warns about: Pixi's default is bilinear ('linear'),
  // which blurs a scaled-up sprite exactly the way this app's `.pixelated` CSS class (image-rendering:
  // pixelated) exists to prevent on the Canvas2D side. Skipping this is the single most likely way
  // P0's crispness comparison would fail.
  texture.source.scaleMode = 'nearest';
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
