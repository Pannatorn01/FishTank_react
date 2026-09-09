import { describe, expect, it, vi } from 'vitest';
import type { EditorPrefs, StorageAdapter, TankState, TankSummary } from '../adapter';
import { EditorPrefsRepo, SpriteRepo, TankRepo } from '../repository';
import * as storage from '../../storage';
import type { Sprite } from '../../types';

function sprite(id: string): Sprite {
  return {
    ...storage.newRecordMeta(),
    id,
    name: id,
    type: 'fish',
    width: 2,
    height: 2,
    frameMs: 120,
    frames: [[storage.makeLayer([null, null, null, null])]],
  };
}

/** A StorageAdapter that answers on a later microtask (a real one always will) and can be told to fail
 *  the next write - the two things the repository has to behave correctly under. */
class FakeAdapter implements StorageAdapter {
  sprites: Sprite[] = [];
  failNextWrite = false;
  listCalls = 0;
  prefsWritten: Partial<EditorPrefs>[] = [];

  async listSprites(): Promise<Sprite[]> {
    this.listCalls += 1;
    await Promise.resolve();
    return [...this.sprites];
  }

  async saveSprites(sprites: Sprite[]): Promise<void> {
    await Promise.resolve();
    if (this.failNextWrite) {
      this.failNextWrite = false;
      throw new Error('write failed');
    }
    this.sprites = [...sprites];
  }

  async getCurrentTankId(): Promise<string> {
    return 'tank_test';
  }
  async setCurrentTankId(): Promise<void> {}
  tanks: TankSummary[] = [{ id: 'tank_test', name: 'Test', updatedAt: 0 }];
  async listTanks(): Promise<TankSummary[]> {
    return this.tanks;
  }
  readonly supportsMultipleTanks = true;
  async createTank(name: string): Promise<string> {
    const id = `tank_${this.tanks.length + 1}`;
    this.tanks = [...this.tanks, { id, name, updatedAt: Date.now() }];
    return id;
  }
  async renameTank(id: string, name: string): Promise<void> {
    this.tanks = this.tanks.map((t) => (t.id === id ? { ...t, name } : t));
  }
  async deleteTank(id: string): Promise<void> {
    if (this.tanks.length <= 1) throw new Error('cannot delete the only tank');
    this.tanks = this.tanks.filter((t) => t.id !== id);
  }
  async loadTankState(): Promise<TankState> {
    throw new Error('not used in these tests');
  }
  async saveTankState(): Promise<void> {}
  async loadEditorPrefs(): Promise<EditorPrefs> {
    throw new Error('not used in these tests');
  }
  async saveEditorPrefs(patch: Partial<EditorPrefs>): Promise<void> {
    await Promise.resolve();
    if (this.failNextWrite) {
      this.failNextWrite = false;
      throw new Error('write failed');
    }
    this.prefsWritten.push(patch);
  }
}

describe('SpriteRepo', () => {
  it('serves reads synchronously once hydrated', async () => {
    const adapter = new FakeAdapter();
    adapter.sprites = [sprite('a'), sprite('b')];
    const repo = new SpriteRepo(adapter);

    expect(repo.isHydrated).toBe(false);
    expect(repo.list()).toEqual([]);

    await repo.hydrate();

    // No await here: the render loop and the sprite-updated listeners depend on this being sync.
    expect(repo.list().map((s) => s.id)).toEqual(['a', 'b']);
    expect(repo.find('b')?.id).toBe('b');
    expect(repo.find(null)).toBeUndefined();
  });

  it('loads once even when both engines hydrate at the same time', async () => {
    const adapter = new FakeAdapter();
    adapter.sprites = [sprite('a')];
    const repo = new SpriteRepo(adapter);

    await Promise.all([repo.hydrate(), repo.hydrate(), repo.hydrate()]);

    expect(adapter.listCalls).toBe(1);
  });

  it('hands back a copy, so a caller cannot corrupt the cache', async () => {
    const adapter = new FakeAdapter();
    adapter.sprites = [sprite('a')];
    const repo = new SpriteRepo(adapter);
    await repo.hydrate();

    repo.list().pop();

    expect(repo.list()).toHaveLength(1);
  });

  it('adds and replaces on put', async () => {
    const adapter = new FakeAdapter();
    const repo = new SpriteRepo(adapter);
    await repo.hydrate();

    await repo.put(sprite('a'));
    await repo.put({ ...sprite('a'), name: 'renamed' });
    await repo.put(sprite('b'));

    expect(repo.list().map((s) => s.id)).toEqual(['a', 'b']);
    expect(repo.find('a')?.name).toBe('renamed');
    expect(adapter.sprites.map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('rolls the cache back when a write fails', async () => {
    const adapter = new FakeAdapter();
    const repo = new SpriteRepo(adapter);
    await repo.hydrate();
    await repo.put(sprite('a'));

    adapter.failNextWrite = true;
    await expect(repo.put(sprite('b'))).rejects.toThrow('write failed');

    // The failure has to reach the caller *and* leave the cache matching storage - a library on screen
    // that disagrees with the one on disk is the state nothing downstream can recover from.
    expect(repo.list().map((s) => s.id)).toEqual(['a']);
    expect(adapter.sprites.map((s) => s.id)).toEqual(['a']);
  });

  it('rolls back a failed delete too', async () => {
    const adapter = new FakeAdapter();
    const repo = new SpriteRepo(adapter);
    await repo.hydrate();
    await repo.put(sprite('a'));

    adapter.failNextWrite = true;
    await expect(repo.remove('a')).rejects.toThrow('write failed');

    expect(repo.list().map((s) => s.id)).toEqual(['a']);
  });

  it('replaceAll counts as hydrated (the first-run default sprites path)', async () => {
    const adapter = new FakeAdapter();
    const repo = new SpriteRepo(adapter);

    await repo.replaceAll([sprite('a')]);

    expect(repo.isHydrated).toBe(true);
    expect(adapter.sprites.map((s) => s.id)).toEqual(['a']);
  });
});

describe('EditorPrefsRepo', () => {
  it('writes a patch without the caller having to wait', async () => {
    const adapter = new FakeAdapter();
    new EditorPrefsRepo(adapter).set({ canvasBackground: 'white' });
    await Promise.resolve();
    await Promise.resolve();
    expect(adapter.prefsWritten).toEqual([{ canvasBackground: 'white' }]);
  });

  it('swallows a failed preference write instead of rejecting into nobody', async () => {
    // Nothing awaits set(), so a rejection here would surface as an unhandled promise rejection while
    // the user is drawing. Losing a remembered setting is the mildest failure in this codebase.
    const adapter = new FakeAdapter();
    adapter.failNextWrite = true;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    new EditorPrefsRepo(adapter).set({ savedColors: ['#fff'] });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('TankRepo (several tanks)', () => {
  it('creates, renames and lists tanks', async () => {
    const adapter = new FakeAdapter();
    const repo = new TankRepo(adapter);

    const id = await repo.create('Reef');
    await repo.rename(id, 'Reef tank');

    const names = (await repo.list()).map((t) => t.name);
    expect(names).toContain('Reef tank');
    expect(repo.supportsMultiple).toBe(true);
  });

  it('announces a deletion so it can be carried to other devices', async () => {
    // Without this the deletion is purely local, and the next device to sync reads the still-present
    // row as "not uploaded yet" and brings the tank back.
    const adapter = new FakeAdapter();
    const repo = new TankRepo(adapter);
    const deleted: string[] = [];
    repo.onDelete = (id) => deleted.push(id);

    const id = await repo.create('Spare');
    await repo.delete(id);

    expect(deleted).toEqual([id]);
    expect((await repo.list()).some((t) => t.id === id)).toBe(false);
  });

  it('refuses to delete the only tank, and says nothing was deleted', async () => {
    const adapter = new FakeAdapter();
    const repo = new TankRepo(adapter);
    const deleted: string[] = [];
    repo.onDelete = (id) => deleted.push(id);

    await expect(repo.delete('tank_test')).rejects.toThrow('only tank');
    expect(deleted).toEqual([]);
  });
});
