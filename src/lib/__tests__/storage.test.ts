import { beforeEach, describe, expect, it } from 'vitest';
import * as storage from '../storage';
import type { Sprite } from '../types';

/** vitest's default (node) environment has no `localStorage` - a minimal in-memory stand-in, since
 *  adding jsdom/happy-dom as a dependency just for this would be overkill for what these tests need. */
class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  clear(): void {
    this.map.clear();
  }
  getItem(key: string): string | null {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

beforeEach(() => {
  (globalThis as { localStorage?: Storage }).localStorage = new MemoryStorage();
});

function validSprite(overrides: Partial<Sprite> = {}): Sprite {
  const width = 4;
  const height = 4;
  return {
    ...storage.newRecordMeta(),
    id: 'sprite_1',
    name: 'Test Fish',
    type: 'fish',
    width,
    height,
    frames: [[storage.makeLayer(storage.emptyFrame(width, height))]],
    frameMs: storage.DEFAULT_FRAME_MS,
    ...overrides,
  };
}

describe('sprite save/load round-trip', () => {
  it('returns null when nothing has been saved yet', () => {
    expect(storage.loadSprites()).toBeNull();
  });

  it('round-trips a valid sprite unchanged', () => {
    const sprite = validSprite();
    storage.saveSprites([sprite]);
    expect(storage.loadSprites()).toEqual([sprite]);
  });
});

describe('loadSprites malformed-data handling (docs/EDITOR_IMPROVEMENTS.md #2)', () => {
  it('falls back to null for JSON that does not parse', () => {
    localStorage.setItem('fishtank.sprites.v1', 'not json{{{');
    expect(storage.loadSprites()).toBeNull();
  });

  it('falls back to null when the saved value is not an array', () => {
    localStorage.setItem('fishtank.sprites.v1', JSON.stringify({ oops: true }));
    expect(storage.loadSprites()).toBeNull();
  });

  it('drops a sprite with non-finite width/height instead of crashing', () => {
    const bad = validSprite({ width: NaN as unknown as number });
    const good = validSprite({ id: 'sprite_2', name: 'Good Fish' });
    localStorage.setItem('fishtank.sprites.v1', JSON.stringify([bad, good]));
    expect(storage.loadSprites()).toEqual([good]);
  });

  it('drops a sprite whose cells array does not match width*height', () => {
    const bad = validSprite();
    bad.frames[0][0].cells = bad.frames[0][0].cells.slice(0, 3); // one cell short
    localStorage.setItem('fishtank.sprites.v1', JSON.stringify([bad]));
    expect(storage.loadSprites()).toBeNull();
  });

  it('drops a sprite with an empty frames array', () => {
    const bad = validSprite({ frames: [] });
    localStorage.setItem('fishtank.sprites.v1', JSON.stringify([bad]));
    expect(storage.loadSprites()).toBeNull();
  });

  it('keeps every sprite it can when only some are malformed', () => {
    const good1 = validSprite({ id: 'a', name: 'A' });
    const good2 = validSprite({ id: 'b', name: 'B' });
    const bad = validSprite({ id: 'c', name: 'C', height: -1 as unknown as number });
    localStorage.setItem('fishtank.sprites.v1', JSON.stringify([good1, bad, good2]));
    const loaded = storage.loadSprites();
    expect(loaded?.map((s) => s.id)).toEqual(['a', 'b']);
  });
});

describe('backup / reset (docs/EDITOR_IMPROVEMENTS.md #1)', () => {
  it('downloadDataBackup returns false when there is nothing saved', () => {
    // No DOM (Blob/URL/document) in this environment - only exercise the "nothing to back up" path,
    // which returns before touching any of that.
    expect(storage.downloadDataBackup()).toBe(false);
  });

  it('resetAllData clears every key this module owns, sparing everything else', () => {
    storage.saveSprites([validSprite()]);
    localStorage.setItem('someOtherApp.unrelatedKey', 'keep me');
    storage.resetAllData();
    expect(storage.loadSprites()).toBeNull();
    expect(localStorage.getItem('someOtherApp.unrelatedKey')).toBe('keep me');
  });
});

describe('normalizeSprite (legacy shape migration)', () => {
  it('backfills width/height from a legacy single "size" field', () => {
    const legacy = { name: 'Old', type: 'fish', size: 8, frames: [[null, '#fff']] } as unknown as Sprite;
    const normalized = storage.normalizeSprite(legacy);
    expect(normalized.width).toBe(8);
    expect(normalized.height).toBe(8);
  });

  it('wraps a pre-layers flat frame in a single layer', () => {
    const legacy = { name: 'Old', type: 'fish', width: 2, height: 1, frames: [[null, '#fff']] } as unknown as Sprite;
    const normalized = storage.normalizeSprite(legacy);
    expect(normalized.frames[0]).toHaveLength(1);
    expect(normalized.frames[0][0].cells).toEqual([null, '#fff']);
  });
});

describe('quota handling (P0)', () => {
  /** Mimics a full store the way browsers report it: setItem throws a DOMException named
   *  QuotaExceededError, everything else keeps working. */
  function makeFullStorage(): void {
    const store = localStorage;
    store.setItem = () => {
      throw new DOMException('full', 'QuotaExceededError');
    };
  }

  it('save* raises StorageQuotaError (not a bare DOMException) when the store is full', () => {
    makeFullStorage();
    expect(() => storage.saveSprites([validSprite()])).toThrow(storage.StorageQuotaError);
  });

  it('the raised error names the key it failed on, so the caller can report it', () => {
    makeFullStorage();
    try {
      storage.saveSprites([validSprite()]);
      throw new Error('expected saveSprites to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(storage.StorageQuotaError);
      expect((e as InstanceType<typeof storage.StorageQuotaError>).key).toContain('fishtank.sprites');
    }
  });

  it('a non-quota failure is passed through unchanged', () => {
    localStorage.setItem = () => {
      throw new TypeError('something else entirely');
    };
    expect(() => storage.saveSprites([validSprite()])).toThrow(TypeError);
  });

  it('estimateUsage grows with what is stored and never exceeds 100%', () => {
    const empty = storage.estimateUsage();
    storage.saveSprites([validSprite(), validSprite({ id: 'sprite_2' })]);
    const filled = storage.estimateUsage();
    expect(filled.bytes).toBeGreaterThan(empty.bytes);
    expect(filled.percent).toBeLessThanOrEqual(100);
  });
});

describe('keys written outside storage.ts (P0-4)', () => {
  it('resetAllData also clears the editor layout, ui scale, and per-panel collapse flags', () => {
    localStorage.setItem(storage.KEY_EDITOR_LAYOUT, '{"left":[]}');
    localStorage.setItem(storage.KEY_UI_SCALE, 'large');
    localStorage.setItem(`${storage.KEY_SIDE_PANEL_COLLAPSED_PREFIX}palette`, '1');
    localStorage.setItem('someOtherApp.unrelatedKey', 'keep me');

    storage.resetAllData();

    expect(localStorage.getItem(storage.KEY_EDITOR_LAYOUT)).toBeNull();
    expect(localStorage.getItem(storage.KEY_UI_SCALE)).toBeNull();
    expect(localStorage.getItem(`${storage.KEY_SIDE_PANEL_COLLAPSED_PREFIX}palette`)).toBeNull();
    expect(localStorage.getItem('someOtherApp.unrelatedKey')).toBe('keep me');
  });
});

describe('record metadata and tombstones (P1)', () => {
  it('backfills updatedAt/deletedAt/rev onto a sprite saved before they existed', () => {
    const legacy = { id: 'old_1', name: 'Old', type: 'fish', width: 2, height: 1, frames: [[null, '#fff']] };
    localStorage.setItem('fishtank.sprites.v1', JSON.stringify([legacy]));
    const loaded = storage.loadSprites();
    expect(loaded).toHaveLength(1);
    expect(loaded![0].updatedAt).toBeGreaterThan(0);
    expect(loaded![0].deletedAt).toBe(0);
    expect(loaded![0].rev).toBe(0);
  });

  it('gives a sprite an id when an older record has none', () => {
    const legacy = { name: 'No id', type: 'fish', width: 2, height: 1, frames: [[null, '#fff']] };
    localStorage.setItem('fishtank.sprites.v1', JSON.stringify([legacy]));
    expect(storage.loadSprites()![0].id).toMatch(/^sprite/);
  });

  it('leaves a tombstone when a sprite disappears from the saved list', () => {
    storage.saveSprites([validSprite({ id: 'a' }), validSprite({ id: 'b' })]);
    storage.saveSprites([validSprite({ id: 'a' })]);

    // The user no longer sees it...
    expect(storage.loadSprites()!.map((s) => s.id)).toEqual(['a']);
    // ...but the record survives, marked deleted and stripped of its pixels, so a future sync can tell
    // "deleted" apart from "not uploaded yet".
    const raw = JSON.parse(localStorage.getItem('fishtank.sprites.v1')!) as Sprite[];
    const tombstone = raw.find((s) => s.id === 'b');
    expect(tombstone).toBeDefined();
    expect(tombstone!.deletedAt).toBeGreaterThan(0);
    expect(tombstone!.frames).toEqual([]);
  });

  it('keeps tombstones across later saves without resurrecting them', () => {
    storage.saveSprites([validSprite({ id: 'a' }), validSprite({ id: 'b' })]);
    storage.saveSprites([validSprite({ id: 'a' })]);
    storage.saveSprites([validSprite({ id: 'a' }), validSprite({ id: 'c' })]);

    const raw = JSON.parse(localStorage.getItem('fishtank.sprites.v1')!) as Sprite[];
    expect(raw.find((s) => s.id === 'b')!.deletedAt).toBeGreaterThan(0);
    expect(storage.loadSprites()!.map((s) => s.id).sort()).toEqual(['a', 'c']);
  });

  it('a sprite saved again after deletion is alive once more', () => {
    storage.saveSprites([validSprite({ id: 'a' })]);
    storage.saveSprites([]);
    storage.saveSprites([validSprite({ id: 'a' })]);
    expect(storage.loadSprites()!.map((s) => s.id)).toEqual(['a']);
  });

  it('touchMeta moves updatedAt forward and leaves the rest of the record alone', () => {
    const sprite = validSprite({ updatedAt: 1 });
    const touched = storage.touchMeta(sprite);
    expect(touched.updatedAt).toBeGreaterThan(1);
    expect(touched.id).toBe(sprite.id);
    expect(touched.deletedAt).toBe(0);
    expect(touched.rev).toBe(0);
  });
});
