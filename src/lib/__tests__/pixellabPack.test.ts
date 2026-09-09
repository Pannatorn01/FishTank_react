import { describe, expect, it } from 'vitest';
import { PIXELLAB_PACK } from '../data/pixellabPack';
import { decodeFrame } from '../pixelCodec';
import { buildDefaultSprites } from '../storage';

/** The pack is generated (pixellab-assets/genpack.py), so the risk it carries is not a typo in one
 *  entry but a whole regeneration that silently encodes the wrong size or leaves a colour outside
 *  the shared palette - either of which reaches the user as a sprite the editor cannot open. */
describe('the PixelLab art pack', () => {
  it('decodes every frame to exactly its declared canvas size', () => {
    for (const entry of PIXELLAB_PACK) {
      for (const frame of entry.frames) {
        expect(decodeFrame(frame), entry.name).toHaveLength(entry.width * entry.height);
      }
    }
  });

  it('keeps every frame of an animation the same size', () => {
    for (const entry of PIXELLAB_PACK) {
      const lengths = new Set(entry.frames.map((f) => decodeFrame(f).length));
      expect(lengths.size, entry.name).toBe(1);
    }
  });

  it('uses only plain #rrggbb colours, since sprite cells carry no alpha', () => {
    for (const entry of PIXELLAB_PACK) {
      for (const frame of entry.frames) {
        for (const color of frame.palette) {
          expect(color, entry.name).toMatch(/^#[0-9a-f]{6}$/);
        }
      }
    }
  });

  it('is seeded into the starter library', () => {
    const names = buildDefaultSprites().map((s) => s.name);
    for (const entry of PIXELLAB_PACK) {
      expect(names).toContain(entry.name);
    }
  });

  it('seeds sprites whose layer cell count matches their dimensions', () => {
    for (const sprite of buildDefaultSprites()) {
      for (const frame of sprite.frames) {
        for (const layer of frame) {
          expect(layer.cells, sprite.name).toHaveLength(sprite.width * sprite.height);
        }
      }
    }
  });
});
