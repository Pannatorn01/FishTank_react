import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PixelEditorEngine } from '../usePixelEditor';
import { setRepos, type Repos } from '@/lib/data';
import * as storage from '@/lib/storage';
import type { Sprite } from '@/lib/types';

/** vitest's node env has no localStorage - a minimal in-memory stand-in (copied from useTank.test.ts).
 *  These tests never call init(), but the sprite paths still reach storage.normalizeSprite and friends. */
class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  clear() {
    this.map.clear();
  }
  getItem(k: string) {
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
}

/** A sprite with `frames` animation frames, each one layer of solid color. */
function spriteWith(frames: number, size = 8): Sprite {
  return storage.normalizeSprite({
    ...storage.newRecordMeta(),
    id: storage.uid('sprite'),
    name: 'Test',
    type: 'fish',
    width: size,
    height: size,
    frameMs: 120,
    frames: Array.from({ length: frames }, () => [
      { id: storage.uid('layer'), name: 'l', visible: true, opacity: 1, cells: new Array(size * size).fill('#3ba') },
    ]),
  })!;
}

/** Reads a private engine field by name. */
function field<T>(engine: PixelEditorEngine, name: string): T {
  return (engine as unknown as Record<string, T>)[name];
}

/** vitest's node env has no FileReader either - just enough of one to hand back the File's text. */
class MemoryFileReader {
  result: string | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readAsText(file: File) {
    void file.text().then((text) => {
      this.result = text;
      this.onload?.();
    });
  }
}

beforeEach(() => {
  (globalThis as { localStorage?: Storage }).localStorage = new MemoryStorage();
  (globalThis as { FileReader?: unknown }).FileReader = MemoryFileReader;
  // The engine announces library changes on `window`; nothing here listens, it just has to exist.
  (globalThis as { window?: unknown }).window = { dispatchEvent: () => true };
  (globalThis as { CustomEvent?: unknown }).CustomEvent = class {
    type: string;
    constructor(type: string) {
      this.type = type;
    }
  };
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  setRepos(null);
});

// ─────────────────────────────────────────────────────────────────────────────
// adoptSprite - the one path every "the sprite on the canvas is now a different
// one" flow goes through (new / load / import / delete-the-open-one).
// ─────────────────────────────────────────────────────────────────────────────
describe('swapping the sprite being edited', () => {
  it('leaves no frame index pointing past the new sprite\'s frames', () => {
    const engine = new PixelEditorEngine();
    engine.loadSpriteForEdit(spriteWith(4), () => true);
    engine.selectFrame(3);
    expect(engine.frameIndex).toBe(3);

    engine.loadSpriteForEdit(spriteWith(1), () => true);

    expect(engine.frameIndex).toBe(0);
    // The real symptom of getting this wrong: painting reads frames[frameIndex] and hands it to
    // paintLayers, which would throw on undefined.
    expect(engine.current.frames[engine.frameIndex]).toBeDefined();
    expect(() => engine.drawGrid()).not.toThrow();
  });

  it('does not carry the previous sprite\'s undo history onto the new one', () => {
    const engine = new PixelEditorEngine();
    engine.loadSpriteForEdit(spriteWith(2), () => true);
    engine.pushUndo();
    expect(engine.canUndo()).toBe(true);

    engine.newSprite(() => true);

    expect(engine.canUndo()).toBe(false);
    expect(engine.canRedo()).toBe(false);
  });

  it('clears the selection, so it cannot outlive the pixels it was drawn around', () => {
    const engine = new PixelEditorEngine();
    engine.loadSpriteForEdit(spriteWith(1, 32), () => true);
    engine.selectAll();
    expect(engine.selection).not.toBeNull();

    engine.loadSpriteForEdit(spriteWith(1, 8), () => true);

    expect(engine.selection).toBeNull();
    expect(field(engine, 'selectionMask')).toBeNull();
    expect(engine.lassoPoints).toBeNull();
  });

  it('marks a sprite opened from the library clean, and an imported one dirty', async () => {
    const engine = new PixelEditorEngine();
    engine.loadSpriteForEdit(spriteWith(1), () => true);
    expect(engine.dirty).toBe(false);

    const sprite = spriteWith(2);
    const file = new File([JSON.stringify(sprite)], 'sprite.json', { type: 'application/json' });
    engine.importSpriteFromFile(file, () => true, () => {});
    // FileReader resolves on a macrotask; the fake timers above don't drive it.
    await vi.waitFor(() => expect(engine.dirty).toBe(true));
    expect(engine.current.frames).toHaveLength(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// deleteSprite's "the one you were editing" branch - the same swap, and the one
// that used to skip most of it.
// ─────────────────────────────────────────────────────────────────────────────
describe('deleting the sprite currently being edited', () => {
  /** The repository is injectable (setRepos), so deleteSprite's storage call needs no module mocking -
   *  only the two methods it actually uses. What is under test is the branch that runs *after* the
   *  removal, when the sprite that was deleted is the one on the canvas. */
  function useStubRepos(): void {
    setRepos({
      sprites: { remove: async () => {}, list: () => [] },
      tank: {},
      prefs: {},
    } as unknown as Repos);
  }

  it('resets the frame index, so a blank replacement is never left mid-animation', async () => {
    useStubRepos();
    const engine = new PixelEditorEngine();
    engine.loadSpriteForEdit(spriteWith(4), () => true);
    engine.selectFrame(3);
    const deletedId = engine.current.id;

    await engine.deleteSprite(deletedId, () => true, () => {});

    expect(engine.frameIndex).toBe(0);
    expect(engine.current.frames[engine.frameIndex]).toBeDefined();
    expect(() => engine.drawGrid()).not.toThrow();
  });

  it('does not leave the deleted sprite\'s pixels recoverable through undo', async () => {
    useStubRepos();
    const engine = new PixelEditorEngine();
    engine.loadSpriteForEdit(spriteWith(2), () => true);
    engine.pushUndo();
    expect(engine.canUndo()).toBe(true);

    await engine.deleteSprite(engine.current.id, () => true, () => {});

    expect(engine.canUndo()).toBe(false);
    expect(engine.dirty).toBe(false);
  });
});
