import { describe, expect, it } from 'vitest';
import { CAT_VARIANTS, type CatPose, catSpriteName, ROOM_CAST_PACK } from '../data/pixellabPack';
import { decodeFrame } from '../pixelCodec';
import { buildDefaultSprites } from '../defaultSprites';
import { buildCastSprites, castRoomSprite, strayCastSprites } from '../storage';

/** The pack is generated (pixellab-assets/genpack.py), so the risk it carries is not a typo in one
 *  entry but a whole regeneration that silently encodes the wrong size or leaves a colour outside
 *  the shared palette - either of which reaches the user as a sprite the editor cannot open. */
/** All the generated art is the renderer's own now. It still has to decode to exactly the canvas it
 *  declares - a regenerated module that gets that wrong reaches the user as a room that will not
 *  draw - and it must never end up in the user's sprite library, which is what seeding it did for
 *  several versions running. */
describe("Life mode's art", () => {
  it('decodes every frame to exactly its declared canvas size', () => {
    for (const entry of ROOM_CAST_PACK) {
      for (const frame of entry.frames) {
        expect(decodeFrame(frame), entry.name).toHaveLength(entry.width * entry.height);
      }
    }
  });

  it('is not seeded into the starter library', () => {
    const names = new Set(buildDefaultSprites().map((s) => s.name));
    for (const entry of ROOM_CAST_PACK) {
      expect(names.has(entry.name), entry.name).toBe(false);
    }
  });

  it('offers every cat coat in every pose the room asks for', () => {
    const names = new Set(ROOM_CAST_PACK.map((e) => e.name));
    const poses: CatPose[] = ['asleep', 'walking', 'sitting', 'pouncing', 'eating'];
    for (const variant of CAT_VARIANTS) {
      for (const pose of poses) {
        expect(names.has(catSpriteName(variant, pose)), catSpriteName(variant, pose)).toBe(true);
      }
    }
  });

  it('keeps every frame of an animation the same size', () => {
    for (const entry of ROOM_CAST_PACK) {
      const lengths = new Set(entry.frames.map((f) => decodeFrame(f).length));
      expect(lengths.size, entry.name).toBe(1);
    }
  });

  it('uses only plain #rrggbb colours, since sprite cells carry no alpha', () => {
    for (const entry of ROOM_CAST_PACK) {
      for (const frame of entry.frames) {
        for (const color of frame.palette) {
          expect(color, entry.name).toMatch(/^#[0-9a-f]{6}$/);
        }
      }
    }
  });

  it('leaves the starter library as just the two hand-drawn samples', () => {
    expect(buildDefaultSprites().map((s) => s.name)).toEqual(['Goldfish (sample)', 'Seaweed (sample)']);
  });

  it('offers the room backdrop the scene falls back to', () => {
    expect(castRoomSprite()?.name).toBe('Room by the window');
  });

  it('builds one Sprite per cast entry, with a stable id across calls', () => {
    const first = buildCastSprites();
    expect(first.size).toBe(ROOM_CAST_PACK.length);
    expect(buildCastSprites().get('Cat orange asleep')?.id).toBe(first.get('Cat orange asleep')?.id);
  });

  it('finds cast art already sitting in a library, current names and retired ones alike', () => {
    const library = buildDefaultSprites();
    const strays = [
      { ...library[0], id: 'a', name: 'Cat orange asleep' },
      { ...library[0], id: 'b', name: 'Bird flapping' },
      { ...library[0], id: 'c', name: 'Algae patch' },
      { ...library[0], id: 'd', name: 'My own cat drawing' },
    ];
    expect(strayCastSprites(strays).map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });
});
