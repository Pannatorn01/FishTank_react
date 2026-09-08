import type { Sprite } from '../types';
import type { EditorPrefs, StorageAdapter, TankState } from './adapter';

/**
 * The sprite library, cached in memory.
 *
 * The cache is not an optimisation, it is a requirement: the tank's render loop looks a sprite up on
 * every frame for every fish, and the three places that react to `ft:sprites-updated` re-read the
 * whole library on the spot. None of that can await anything. So reads are synchronous against the
 * cache, and only writes (and the one-off hydrate) are async - which is exactly the shape a remote
 * backend needs too, where the cache doubles as the offline copy (plan P4/P5).
 */
export class SpriteRepo {
  private sprites: Sprite[] = [];
  private hydrated = false;
  private readonly adapter: StorageAdapter;

  constructor(adapter: StorageAdapter) {
    this.adapter = adapter;
  }

  /** Fills the cache from storage. Safe to call from more than one place - the second caller waits for
   *  the first load rather than starting another (both engines hydrate independently). */
  private pending: Promise<void> | null = null;

  async hydrate(): Promise<void> {
    if (this.hydrated) return;
    if (!this.pending) {
      this.pending = this.adapter.listSprites().then((sprites) => {
        this.sprites = sprites;
        this.hydrated = true;
        this.pending = null;
      });
    }
    return this.pending;
  }

  get isHydrated(): boolean {
    return this.hydrated;
  }

  /** A copy, so a caller that sorts or splices what it gets back cannot corrupt the cache. */
  list(): Sprite[] {
    return [...this.sprites];
  }

  find(id: string | null): Sprite | undefined {
    return id ? this.sprites.find((s) => s.id === id) : undefined;
  }

  /** Inserts or replaces one sprite and writes the library. The cache is updated first so the UI can
   *  render the result immediately; if the write fails the cache is rolled back and the error is
   *  rethrown, because a library on screen that is not the library on disk is the one outcome nothing
   *  downstream can recover from. */
  async put(sprite: Sprite): Promise<void> {
    const previous = this.sprites;
    const idx = this.sprites.findIndex((s) => s.id === sprite.id);
    const next = [...this.sprites];
    if (idx >= 0) next[idx] = sprite;
    else next.push(sprite);
    this.sprites = next;
    try {
      await this.adapter.saveSprites(next);
    } catch (e) {
      this.sprites = previous;
      throw e;
    }
  }

  async remove(id: string): Promise<void> {
    const previous = this.sprites;
    this.sprites = this.sprites.filter((s) => s.id !== id);
    try {
      await this.adapter.saveSprites(this.sprites);
    } catch (e) {
      this.sprites = previous;
      throw e;
    }
  }

  /** Replaces the whole library at once - used when seeding the default sprites on a first run. */
  async replaceAll(sprites: Sprite[]): Promise<void> {
    const previous = this.sprites;
    this.sprites = [...sprites];
    this.hydrated = true;
    try {
      await this.adapter.saveSprites(this.sprites);
    } catch (e) {
      this.sprites = previous;
      throw e;
    }
  }
}

export class TankRepo {
  private readonly adapter: StorageAdapter;

  constructor(adapter: StorageAdapter) {
    this.adapter = adapter;
  }

  load(): Promise<TankState> {
    return this.adapter.loadTankState();
  }

  save(state: TankState): Promise<void> {
    return this.adapter.saveTankState(state);
  }
}

export class EditorPrefsRepo {
  private readonly adapter: StorageAdapter;

  constructor(adapter: StorageAdapter) {
    this.adapter = adapter;
  }

  load(): Promise<EditorPrefs> {
    return this.adapter.loadEditorPrefs();
  }

  /**
   * Preferences are written as the user changes them (picking a colour, resizing a brush) and nothing
   * waits for the result, so a failure here must not surface as an unhandled rejection in the console
   * or - worse - interrupt drawing. It is logged and dropped: the setting is still applied in memory,
   * it just may not survive a reload, which is the mildest failure any of this code has.
   */
  set(patch: Partial<EditorPrefs>): void {
    this.adapter.saveEditorPrefs(patch).catch((e) => console.warn('saving preferences failed', e));
  }
}
