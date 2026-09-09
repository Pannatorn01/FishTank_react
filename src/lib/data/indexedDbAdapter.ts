import { normalizeSprite, encodeSprite, uid, type StoredSprite } from '../storage';
import type { Sprite } from '../types';
import type { EditorPrefs, StorageAdapter, TankState, TankSummary } from './adapter';
import { del, getAll, get, openDb, put, replaceAll } from './idb';
import type { OutboxEntry } from './outbox';
import { LocalStorageAdapter, SINGLE_TANK_ID } from './localAdapter';

const DB_NAME = 'fishtank';
const DB_VERSION = 2;

const STORE_SPRITES = 'sprites';
const STORE_TANKS = 'tanks';
const STORE_PREFS = 'prefs';
const STORE_META = 'meta';
const STORE_OUTBOX = 'outbox';

const META_MIGRATED = 'migratedFrom.localStorage';
const META_CURRENT_TANK = 'currentTankId';
const META_LOCAL_USER = 'localUserId';
const PREFS_KEY = 'editor';

interface TankRecord extends TankState {
  id: string;
  name: string;
  updatedAt: number;
}

interface MetaRecord {
  key: string;
  value: string;
}

/**
 * The IndexedDB backend. Same data, same rules, a store that is not capped at ~5MB and that can be
 * written one record at a time instead of as one JSON blob.
 *
 * It is also the step that makes the storage layer genuinely asynchronous: with localStorage behind it
 * every "async" call resolved on the same tick, which hides ordering bugs that a real backend would
 * expose. Everything the remote adapter will need - waiting, failing, arriving later - happens here
 * first, with no network involved. See docs/STORAGE_DB_MIGRATION_PLAN.md P4.
 *
 * On first use it copies whatever localStorage holds into IndexedDB and records a flag so it never
 * does that twice. It deliberately does NOT delete the localStorage copy: that copy is the only way
 * back if this turns out to be wrong, and it costs nothing to keep for a version.
 */
export class IndexedDbAdapter implements StorageAdapter {
  private dbPromise: Promise<IDBDatabase | null> | null = null;
  /** Used when the database cannot be opened at all - see db(). */
  private readonly fallback = new LocalStorageAdapter();

  /**
   * The database, or null if this browser will not give us one. Opening can fail for reasons that have
   * nothing to do with this app (private browsing, a locked-down profile, a corrupted store, another
   * tab holding an upgrade open) and none of them are a reason to lose the tank: every method falls
   * back to the localStorage backend, which is still fully functional and still holds the data, since
   * the migration deliberately never deletes it.
   */
  private db(): Promise<IDBDatabase | null> {
    if (!this.dbPromise) {
      this.dbPromise = openDb(DB_NAME, DB_VERSION, (db) => {
        // Guarded individually: an upgrade runs against a database that already has the earlier
        // version's stores, and creating one twice throws.
        if (!db.objectStoreNames.contains(STORE_SPRITES)) db.createObjectStore(STORE_SPRITES, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(STORE_TANKS)) db.createObjectStore(STORE_TANKS, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(STORE_PREFS)) db.createObjectStore(STORE_PREFS, { keyPath: 'key' });
        if (!db.objectStoreNames.contains(STORE_META)) db.createObjectStore(STORE_META, { keyPath: 'key' });
        if (!db.objectStoreNames.contains(STORE_OUTBOX)) db.createObjectStore(STORE_OUTBOX, { keyPath: 'key' });
      })
        .then(async (db) => {
          await this.migrateOnce(db);
          return db;
        })
        .catch((e) => {
          console.warn('IndexedDB unavailable - falling back to localStorage', e);
          return null;
        });
    }
    return this.dbPromise;
  }

  private async meta(db: IDBDatabase, key: string): Promise<string | null> {
    const record = await get<MetaRecord>(db, STORE_META, key);
    return record?.value ?? null;
  }

  private setMeta(db: IDBDatabase, key: string, value: string): Promise<void> {
    return put(db, STORE_META, { key, value });
  }

  /**
   * Copies an existing localStorage library/tank/preferences across, exactly once. Runs inside the
   * db() promise so every other method implicitly waits for it - there is no window where a caller
   * could read an empty database while the copy is still going.
   */
  private async migrateOnce(db: IDBDatabase): Promise<void> {
    if (await this.meta(db, META_MIGRATED)) return;

    const local = new LocalStorageAdapter();
    const sprites = await local.listSprites();
    if (sprites.length > 0) {
      await replaceAll(db, STORE_SPRITES, sprites.map(encodeSprite));
      const tank = await local.loadTankState();
      await put(db, STORE_TANKS, tankRecord(SINGLE_TANK_ID, 'My Tank', tank));
      await this.setMeta(db, META_CURRENT_TANK, SINGLE_TANK_ID);
      const prefs = await local.loadEditorPrefs();
      await put(db, STORE_PREFS, { key: PREFS_KEY, value: prefs });
    }

    // Both ids are minted on the very first run, whether or not there was anything to migrate, so that
    // every record this browser ever writes has an owner and a tank from the start - see the plan's
    // P4-2/P6.1. Backfilling either one onto data that already exists is the expensive version.
    if (!(await this.meta(db, META_CURRENT_TANK))) {
      await this.setMeta(db, META_CURRENT_TANK, uid('tank'));
    }
    // The id this browser's work belongs to until there is a real account to attach it to. Minted here
    // rather than at sign-in so that migrating a guest's work later is a matter of relabelling records
    // that already have an owner, not inventing one (plan P6.1).
    if (!(await this.meta(db, META_LOCAL_USER))) {
      await this.setMeta(db, META_LOCAL_USER, uid('local'));
    }
    await this.setMeta(db, META_MIGRATED, new Date().toISOString());
  }

  async listSprites(): Promise<Sprite[]> {
    const db = await this.db();
    if (!db) return this.fallback.listSprites();
    const records = await getAll<StoredSprite>(db, STORE_SPRITES);
    // Tombstones stay in the store (a deletion has to be reportable to a server later) but never reach
    // the app, exactly as in the localStorage backend.
    return records.map((r) => normalizeSprite(r as unknown as Sprite)).filter((s) => s.deletedAt === 0);
  }

  /**
   * Writes the live library. Sprites that were in the store and are not in `sprites` any more become
   * tombstones - same rule as the localStorage backend, only here it is one row per sprite rather than
   * one blob for all of them, so saving after editing a single sprite no longer rewrites the rest.
   */
  async saveSprites(sprites: Sprite[]): Promise<void> {
    const db = await this.db();
    if (!db) return this.fallback.saveSprites(sprites);
    const existing = await getAll<StoredSprite>(db, STORE_SPRITES);
    const live = new Set(sprites.map((s) => s.id));
    const now = Date.now();
    const tombstones = existing
      .filter((s) => !live.has(s.id))
      .map((s) => (s.deletedAt > 0 ? s : { ...s, frames: [], updatedAt: now, deletedAt: now }));
    await replaceAll(db, STORE_SPRITES, [...sprites.map(encodeSprite), ...tombstones]);
  }

  async getCurrentTankId(): Promise<string> {
    const db = await this.db();
    if (!db) return this.fallback.getCurrentTankId();
    const current = await this.meta(db, META_CURRENT_TANK);
    if (current) {
      await this.ensureTankRow(db, current);
      return current;
    }
    // Normally minted during the first-run migration; this only catches a store whose meta was wiped
    // out from under a running app.
    const id = uid('tank');
    await this.setMeta(db, META_CURRENT_TANK, id);
    await this.ensureTankRow(db, id);
    return id;
  }

  /**
   * Makes sure the open tank exists as a row, not just as an id in `meta`.
   *
   * A tank used to be written only when it was first saved, which meant a brand-new browser had a
   * current tank that listTanks() could not see - so the tank switcher, which hides itself when there
   * are no tanks, was invisible until the user happened to save. A tank the app is *showing* exists.
   */
  private async ensureTankRow(db: IDBDatabase, id: string): Promise<void> {
    const existing = await get<TankRecord>(db, STORE_TANKS, id);
    if (!existing) await put(db, STORE_TANKS, tankRecord(id, 'My Tank', emptyTankState()));
  }

  async setCurrentTankId(id: string): Promise<void> {
    const db = await this.db();
    if (!db) return this.fallback.setCurrentTankId(id);
    await this.setMeta(db, META_CURRENT_TANK, id);
  }

  readonly supportsMultipleTanks = true;

  /**
   * Creates the tank straight away rather than waiting for its first save.
   *
   * A tank that exists only once something has been put in it cannot be listed, named, or switched to
   * - so making one would appear to do nothing until the user also placed a fish. The row is written
   * empty, which is exactly what a new tank is.
   */
  async createTank(name: string): Promise<string> {
    const db = await this.db();
    if (!db) return this.fallback.createTank(name);
    const id = uid('tank');
    await put(db, STORE_TANKS, tankRecord(id, name.trim() || 'My Tank', emptyTankState()));
    return id;
  }

  async renameTank(id: string, name: string): Promise<void> {
    const db = await this.db();
    if (!db) return this.fallback.renameTank(id, name);
    const existing = await get<TankRecord>(db, STORE_TANKS, id);
    if (!existing) return;
    await put(db, STORE_TANKS, { ...existing, name: name.trim() || existing.name, updatedAt: Date.now() });
  }

  /**
   * Deletes a tank locally and moves off it if it was the one open.
   *
   * Refuses the last one: an app with no tank has nowhere to put anything, and would have to invent a
   * replacement on the next load - which is a confusing way to say "that did not work".
   */
  async deleteTank(id: string): Promise<void> {
    const db = await this.db();
    if (!db) return this.fallback.deleteTank(id);
    const tanks = await getAll<TankRecord>(db, STORE_TANKS);
    if (tanks.length <= 1) throw new Error('cannot delete the only tank');
    await del(db, STORE_TANKS, id);
    if ((await this.meta(db, META_CURRENT_TANK)) === id) {
      const next = tanks.find((t) => t.id !== id);
      if (next) await this.setMeta(db, META_CURRENT_TANK, next.id);
    }
  }

  async listTanks(): Promise<TankSummary[]> {
    const db = await this.db();
    if (!db) return this.fallback.listTanks();
    const tanks = await getAll<TankRecord>(db, STORE_TANKS);
    return tanks.map((t) => ({ id: t.id, name: t.name, updatedAt: t.updatedAt }));
  }

  async loadTankState(tankId?: string): Promise<TankState> {
    const db = await this.db();
    if (!db) return this.fallback.loadTankState();
    const id = tankId ?? (await this.getCurrentTankId());
    const record = await get<TankRecord>(db, STORE_TANKS, id);
    return record ? stripRecordFields(record) : emptyTankState();
  }

  async saveTankState(state: TankState, tankId?: string): Promise<void> {
    const db = await this.db();
    if (!db) return this.fallback.saveTankState(state);
    const id = tankId ?? (await this.getCurrentTankId());
    const existing = await get<TankRecord>(db, STORE_TANKS, id);
    await put(db, STORE_TANKS, tankRecord(id, existing?.name ?? 'My Tank', state));
  }

  async loadEditorPrefs(): Promise<EditorPrefs> {
    const db = await this.db();
    if (!db) return this.fallback.loadEditorPrefs();
    const record = await get<{ key: string; value: EditorPrefs }>(db, STORE_PREFS, PREFS_KEY);
    return { ...emptyPrefs(), ...(record?.value ?? {}) };
  }

  async saveEditorPrefs(patch: Partial<EditorPrefs>): Promise<void> {
    const db = await this.db();
    if (!db) return this.fallback.saveEditorPrefs(patch);
    const current = await this.loadEditorPrefs();
    await put(db, STORE_PREFS, { key: PREFS_KEY, value: { ...current, ...patch } });
  }

  // ------------------------------------------------------------------ used by the sync engine
  // These reach past the StorageAdapter interface on purpose: syncing needs the *stored* view of the
  // data (tombstones included, sync marks, the outbox) which the app itself must never see.

  async getMeta(key: string): Promise<string | null> {
    const db = await this.db();
    return db ? this.meta(db, key) : null;
  }

  async setMetaValue(key: string, value: string): Promise<void> {
    const db = await this.db();
    if (db) await this.setMeta(db, key, value);
  }

  /** Every sprite record, tombstones included - what the server needs to be told about. */
  async allSpriteRecords(): Promise<Sprite[]> {
    const db = await this.db();
    if (!db) return this.fallback.listSprites();
    const records = await getAll<StoredSprite>(db, STORE_SPRITES);
    return records.map((r) => normalizeSprite(r as unknown as Sprite));
  }

  /** Writes records exactly as given, with no tombstoning pass - the sync engine has already decided
   *  which version of each record wins (see merge.ts). */
  async writeSpriteRecords(records: Sprite[]): Promise<void> {
    const db = await this.db();
    if (!db) return;
    await replaceAll(db, STORE_SPRITES, records.map(encodeSprite));
  }

  async tankRecord(id: string): Promise<TankRecord | undefined> {
    const db = await this.db();
    if (!db) return undefined;
    return get<TankRecord>(db, STORE_TANKS, id);
  }

  async outboxAll(): Promise<OutboxEntry[]> {
    const db = await this.db();
    if (!db) return [];
    return getAll<OutboxEntry>(db, STORE_OUTBOX);
  }

  async outboxPut(entry: OutboxEntry): Promise<void> {
    const db = await this.db();
    if (db) await put(db, STORE_OUTBOX, entry);
  }

  async outboxDelete(key: string): Promise<void> {
    const db = await this.db();
    if (db) await del(db, STORE_OUTBOX, key);
  }

  /** The id this browser's work belongs to before there is an account (see migrateOnce). */
  async localUserId(): Promise<string> {
    const db = await this.db();
    if (!db) return '';
    return (await this.meta(db, META_LOCAL_USER)) ?? '';
  }
}

function tankRecord(id: string, name: string, state: TankState): TankRecord {
  return { ...state, id, name, updatedAt: Date.now() };
}

/** The row carries its own identity fields; TankState does not, and must not start doing so by
 *  accident just because it round-tripped through a store keyed by id. */
function stripRecordFields(record: TankRecord): TankState {
  const { id: _id, name: _name, updatedAt: _updatedAt, ...state } = record;
  return state;
}

function emptyTankState(): TankState {
  return {
    instances: [],
    groups: [],
    roomInstances: [],
    width: null,
    height: null,
    shape: 'rectangle',
    cornerRadiusFrac: 0.22,
    ovalTopCutFrac: 0.28,
    backgroundSpriteId: null,
    backgroundTransform: { x: 0, y: 0, scale: 1, rotation: 0 },
    waterLevel: 1,
    algae: 0,
    lastTickAt: null,
  };
}

function emptyPrefs(): EditorPrefs {
  return {
    paletteColors: null,
    savedColors: [],
    pinnedColors: [],
    brushSizes: {},
    canvasBackground: null,
    onion: null,
  };
}
