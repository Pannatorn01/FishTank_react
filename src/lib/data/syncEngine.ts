import type { SupabaseClient } from '@supabase/supabase-js';
import type { Instance, RoomInstance, Sprite, TankGroup } from '../types';
import type { TankState } from './adapter';
import type { IndexedDbAdapter } from './indexedDbAdapter';
import { mergeRecords, type Syncable } from './merge';
import { coalesce, isDue, makeEntry, withFailure, type OutboxEntry } from './outbox';
import {
  childToRow,
  rowToChild,
  rowToSprite,
  spriteToRow,
  tankToRow,
  type ChildRow,
  type SpriteRow,
  type TankRow,
} from './rows';

const MARK_SPRITES = 'sync.mark.sprites';
const CLAIMED_BY = 'sync.claimedBy';
/** One mark per tank, not one for all of them: a single key would carry the high-water mark of
 *  whichever tank was open last, and opening another would then skip everything older than that -
 *  silently, and only for people who own more than one tank. */
const markTank = (tankId: string) => `sync.mark.tank.${tankId}`;
const TABLE_SPRITES = 'sprites';
const TABLE_TANKS = 'tanks';
const TABLE_INSTANCES = 'tank_instances';
const TABLE_GROUPS = 'tank_groups';
const TABLE_ROOM = 'room_instances';

/** Before any pull has happened. A timestamp, because the mark is compared against a Postgres
 *  timestamptz column. */
const EPOCH = '1970-01-01T00:00:00Z';

/** The newest server stamp among rows just seen, never going backwards. ISO-8601 strings from Postgres
 *  compare correctly as text, so no parsing is needed. */
function latestServerStamp(rows: Array<{ server_updated_at?: string }>, previous: string): string {
  return rows.reduce((max, r) => (r.server_updated_at && r.server_updated_at > max ? r.server_updated_at : max), previous);
}

export type SyncState = 'idle' | 'syncing' | 'offline' | 'error' | 'signed-out';

export interface SyncStatus {
  state: SyncState;
  pending: number;
  lastSyncedAt: number | null;
  lastError: string | null;
}

/**
 * Keeps the local database and Supabase in step, in that order of authority.
 *
 * The local store is where writes land and where the app reads from; this engine's whole job is to
 * carry those writes to the server when it can, and to fold the server's version of the world back in.
 * Nothing in the app awaits it, and nothing breaks when it cannot run - offline, signed out, or with
 * no project configured are all ordinary states, not failures (docs/STORAGE_DB_MIGRATION_PLAN.md P5).
 *
 * The engine is deliberately dumb about conflicts: merge.ts decides who wins, one record at a time,
 * and every upload is an idempotent upsert keyed by a client-minted id, so a retry after a failed or
 * lost response cannot duplicate anything.
 */
export class SyncEngine {
  private readonly local: IndexedDbAdapter;
  private readonly supabase: SupabaseClient;
  private timer: number | null = null;
  /** The sync currently running, if any - see syncNow. */
  private current: Promise<void> | null = null;
  private listeners = new Set<(status: SyncStatus) => void>();
  /** Called after a pull actually changed something locally. The engine writes straight into the local
   *  database, which the app's in-memory caches know nothing about - without this, work arriving from
   *  another device would sit in storage, invisible until the next reload. */
  onPulled: ((what: 'sprites' | 'tank') => void) | null = null;
  private status: SyncStatus = { state: 'idle', pending: 0, lastSyncedAt: null, lastError: null };

  constructor(local: IndexedDbAdapter, supabase: SupabaseClient) {
    this.local = local;
    this.supabase = supabase;
  }

  subscribe(listener: (status: SyncStatus) => void): () => void {
    this.listeners.add(listener);
    listener(this.status);
    return () => this.listeners.delete(listener);
  }

  private setStatus(patch: Partial<SyncStatus>): void {
    this.status = { ...this.status, ...patch };
    for (const listener of this.listeners) listener(this.status);
  }

  /** Sync on the events that actually change the answer - coming back online, returning to the tab,
   *  and a slow heartbeat for everything else. Polling faster would not make a single-user app any
   *  more correct, it would only spend the user's battery. */
  start(): void {
    if (this.timer !== null) return;
    window.addEventListener('online', this.onOnline);
    document.addEventListener('visibilitychange', this.onVisible);
    this.timer = window.setInterval(() => void this.syncNow(), 60_000);
    void this.syncNow();
  }

  stop(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    window.removeEventListener('online', this.onOnline);
    document.removeEventListener('visibilitychange', this.onVisible);
  }

  private onOnline = () => void this.syncNow();
  private onVisible = () => {
    if (document.visibilityState === 'visible') void this.syncNow();
  };

  /** Records that the local copy of something changed. Called after a local save; never awaited by the
   *  code doing the saving. */
  async queueSprites(sprites: Sprite[]): Promise<void> {
    for (const sprite of sprites) {
      await this.local.outboxPut(makeEntry(TABLE_SPRITES, sprite.id, 'upsert', sprite));
    }
    await this.refreshPending();
  }

  async queueTank(tankId: string, state: TankState): Promise<void> {
    await this.local.outboxPut(makeEntry(TABLE_TANKS, tankId, 'upsert', state));
    await this.refreshPending();
  }

  /** A tank deleted here has to be deleted on the other devices too - "stopped being uploaded" reads
   *  to them as "not synced yet", which is how a deletion comes back to life. */
  async queueTankDeletion(tankId: string): Promise<void> {
    await this.local.outboxPut(makeEntry(TABLE_TANKS, tankId, 'delete', null));
    await this.refreshPending();
  }

  private async refreshPending(): Promise<void> {
    this.setStatus({ pending: (await this.local.outboxAll()).length });
  }

  /**
   * Uploads everything this browser holds to the signed-in account - the "yes, keep my work" answer at
   * first sign-in (plan P6.2).
   *
   * It queues rather than uploads directly, so the work goes through the same outbox as everything
   * else: interrupted halfway, it resumes; run twice, it uploads the same rows to the same ids and
   * changes nothing. Local data is never deleted here, and the flag is only written once the queue has
   * actually drained - claiming to have uploaded work that is still sitting in a queue is how people
   * lose it.
   */
  async claimLocalWork(userId: string): Promise<{ ok: boolean; uploaded: number }> {
    const sprites = (await this.local.allSpriteRecords()).filter((s) => s.deletedAt === 0);
    const tankId = await this.local.getCurrentTankId();
    const tank = await this.local.loadTankState(tankId);

    await this.queueSprites(sprites);
    await this.queueTank(tankId, tank);
    await this.syncNow();

    const remaining = (await this.local.outboxAll()).length;
    if (remaining === 0) await this.local.setMetaValue(CLAIMED_BY, userId);
    return { ok: remaining === 0, uploaded: sprites.length + 1 };
  }

  /** Whether this browser's work has already been attached to an account, and which one. */
  async claimedBy(): Promise<string | null> {
    return this.local.getMeta(CLAIMED_BY);
  }

  /**
   * Runs a sync, queueing behind one already in progress rather than dropping the request.
   *
   * Returning early when busy - the obvious implementation - quietly breaks every caller that needs
   * the sync to have *happened*: the first-sign-in upload said "done" while its own writes were still
   * sitting in the outbox, because the heartbeat happened to be mid-flight when it asked. Chaining
   * costs nothing (syncs are cheap and idempotent) and means an awaited syncNow() always covers work
   * queued before the call.
   */
  syncNow(): Promise<void> {
    const run = (this.current ?? Promise.resolve()).then(() => this.runOnce());
    this.current = run.catch(() => {});
    return run;
  }

  private async runOnce(): Promise<void> {
    if (!navigator.onLine) {
      this.setStatus({ state: 'offline' });
      return;
    }
    const { data } = await this.supabase.auth.getSession();
    if (!data.session) {
      // Not an error: signed-out is the app's default state and everything still works locally.
      this.setStatus({ state: 'signed-out' });
      return;
    }

    this.setStatus({ state: 'syncing', lastError: null });
    try {
      await this.flush();
      await this.pull(data.session.user.id);
      this.setStatus({ state: 'idle', lastSyncedAt: Date.now() });
    } catch (e) {
      console.warn('sync failed', e);
      this.setStatus({ state: 'error', lastError: e instanceof Error ? e.message : String(e) });
    } finally {
      await this.refreshPending();
    }
  }

  // ------------------------------------------------------------------ push

  private async flush(): Promise<void> {
    const entries = coalesce(await this.local.outboxAll()).filter((e) => isDue(e));
    for (const entry of entries) {
      try {
        await this.send(entry);
        await this.local.outboxDelete(entry.key);
      } catch (e) {
        // Kept, with a longer wait before the next attempt. A change that cannot be uploaded is still
        // safe locally, so failing repeatedly costs nothing but a delay.
        console.warn(`uploading ${entry.key} failed`, e);
        await this.local.outboxPut(withFailure(entry));
      }
    }
  }

  private async send(entry: OutboxEntry): Promise<void> {
    if (entry.table === TABLE_SPRITES) {
      const row = spriteToRow(entry.payload as Sprite);
      await this.upsert(TABLE_SPRITES, [row]);
      return;
    }
    if (entry.table === TABLE_TANKS) {
      if (entry.op === 'delete') {
        // A tombstone, like every other deletion here: the row stays so other devices can learn about
        // it, and its children go with it (schema.sql cascades on the real delete, which only an
        // administrator ever does).
        const now = Date.now();
        await this.upsertPartial(TABLE_TANKS, { id: entry.recordId, updated_at: now, deleted_at: now });
        return;
      }
      await this.sendTank(entry.recordId, entry.payload as TankState);
      return;
    }
    throw new Error(`unknown outbox table: ${entry.table}`);
  }

  /**
   * A tank goes up as its own row plus the rows for what is in it. Children the server has and this
   * client does not are tombstoned rather than deleted, so the removal itself replicates: another
   * device has to learn that the fish was taken out, not merely fail to hear about it.
   */
  private async sendTank(tankId: string, state: TankState): Promise<void> {
    const updatedAt = Date.now();
    const existing = await this.local.tankRecord(tankId);
    await this.upsert(TABLE_TANKS, [tankToRow(tankId, existing?.name ?? 'My Tank', state, updatedAt)]);

    await this.sendChildren(TABLE_INSTANCES, tankId, state.instances);
    await this.sendChildren(TABLE_GROUPS, tankId, state.groups);
    await this.sendChildren(TABLE_ROOM, tankId, state.roomInstances);
  }

  private async sendChildren(table: string, tankId: string, records: Array<Instance | TankGroup | RoomInstance>): Promise<void> {
    const rows = records.map((r) => childToRow(tankId, r));
    const { data: remote, error } = await this.supabase
      .from(table)
      .select('id, deleted_at')
      .eq('tank_id', tankId);
    if (error) throw error;

    const live = new Set(rows.map((r) => r.id));
    const now = Date.now();
    const tombstones: ChildRow[] = (remote ?? [])
      .filter((r: { id: string; deleted_at: number }) => !live.has(r.id) && r.deleted_at === 0)
      .map((r: { id: string }) => ({ id: r.id, tank_id: tankId, data: {}, updated_at: now, deleted_at: now }));

    const payload = [...rows, ...tombstones];
    if (payload.length > 0) await this.upsert(table, payload);
  }

  /** Updates only the columns given, leaving the rest of the row alone - used where the client knows
   *  one fact about a row (that it is deleted) rather than its whole contents. */
  private async upsertPartial(table: string, row: Record<string, unknown>): Promise<void> {
    const { error } = await this.supabase.from(table).update(row).eq('id', row.id);
    if (error) throw error;
  }

  private async upsert(table: string, rows: unknown[]): Promise<void> {
    const { error } = await this.supabase.from(table).upsert(rows, { onConflict: 'id' });
    if (error) throw error;
  }

  // ------------------------------------------------------------------ pull

  /**
   * `userId` is not decoration: every pull is scoped to the signed-in user's own rows.
   *
   * Row-level security decides what this client *may* read, and once tanks can be shared that is
   * deliberately more than what it should *store* - a sprite becomes readable to everyone a tank was
   * shared with (schema.sql: sprites_shared_read). An unscoped pull would fold those into this
   * browser's own library, where they are indistinguishable from the user's own work, get re-queued by
   * the merge, and then fail to upload forever because they belong to someone else. Someone else's
   * tank is read on demand and kept in memory instead (see lib/data/sharing.ts).
   */
  private async pull(userId: string): Promise<void> {
    this.lastChildRows = [];
    await this.pullSprites(userId);
    await this.pullTank(userId);
  }

  /**
   * Only rows changed since the last successful pull.
   *
   * The mark is a *server* timestamp (server_updated_at, stamped by the database on every write), not
   * the client's updated_at. Filtering by the client's clock looks equivalent and is not: a record
   * uploaded now can carry an older updated_at than one uploaded a minute ago - a sprite seeded on
   * first run and uploaded at sign-in, say - and would then sit forever below the mark, never pulled,
   * never learning the revision the server gave it. That is how this went wrong the first time.
   *
   * It is the newest value actually seen, not "now", so a row written while this pull was in flight is
   * still picked up next time.
   */
  private async pullSprites(userId: string): Promise<void> {
    const mark = (await this.local.getMeta(MARK_SPRITES)) || EPOCH;
    const { data, error } = await this.supabase
      .from(TABLE_SPRITES)
      .select('*')
      .eq('user_id', userId)
      .gt('server_updated_at', mark)
      .order('server_updated_at', { ascending: true });
    if (error) throw error;
    const rows = (data ?? []) as SpriteRow[];
    const incoming = rows.map((row) => rowToSprite(row));
    if (incoming.length === 0) return;

    const local = await this.local.allSpriteRecords();
    const { merged, localWins } = mergeRecords<Sprite & Syncable>(local as (Sprite & Syncable)[], incoming as (Sprite & Syncable)[]);
    await this.local.writeSpriteRecords(merged);
    // Anything the local copy won stays owed to the server; queueing it here is what makes an offline
    // edit survive a pull that would otherwise have quietly overwritten it.
    for (const sprite of localWins) {
      await this.local.outboxPut(makeEntry(TABLE_SPRITES, sprite.id, 'upsert', sprite));
    }
    await this.local.setMetaValue(MARK_SPRITES, latestServerStamp(rows, mark));
    this.onPulled?.('sprites');
  }

  private async pullTank(userId: string): Promise<void> {
    const tankId = await this.local.getCurrentTankId();
    const mark = (await this.local.getMeta(markTank(tankId))) || EPOCH;

    const { data: tankRows, error: tankError } = await this.supabase
      .from(TABLE_TANKS)
      .select('*')
      .eq('id', tankId)
      .eq('user_id', userId)
      .gt('server_updated_at', mark);
    if (tankError) throw tankError;

    const [instances, groups, room] = await Promise.all([
      this.pullChildren<Instance>(TABLE_INSTANCES, tankId, mark),
      this.pullChildren<TankGroup>(TABLE_GROUPS, tankId, mark),
      this.pullChildren<RoomInstance>(TABLE_ROOM, tankId, mark),
    ]);
    const stamps = [...(tankRows ?? []), ...this.lastChildRows];

    const nothingNew = (tankRows ?? []).length === 0 && instances.length === 0 && groups.length === 0 && room.length === 0;
    if (nothingNew) return;

    const localState = await this.local.loadTankState(tankId);
    const remoteTank = (tankRows ?? [])[0] as TankRow | undefined;
    const merged: TankState = {
      // Tank settings are one record, so they move as one: the newer of the two wins outright rather
      // than being blended field by field into a shape neither device ever had.
      ...(remoteTank ? { ...localState, ...remoteTank.settings } : localState),
      instances: mergeRecords(localState.instances as Syncable[], instances as Syncable[]).merged as Instance[],
      groups: mergeRecords(localState.groups as Syncable[], groups as Syncable[]).merged as TankGroup[],
      roomInstances: mergeRecords(localState.roomInstances as Syncable[], room as Syncable[]).merged as RoomInstance[],
    };
    // Records deleted elsewhere arrive as tombstones and are dropped here: the tank state the app reads
    // holds only what is actually in the tank.
    merged.instances = merged.instances.filter((r) => r.deletedAt === 0);
    merged.groups = merged.groups.filter((r) => r.deletedAt === 0);
    merged.roomInstances = merged.roomInstances.filter((r) => r.deletedAt === 0);

    await this.local.saveTankState(merged, tankId);
    await this.local.setMetaValue(markTank(tankId), latestServerStamp(stamps, mark));
    this.onPulled?.('tank');
  }

  /** Rows from the most recent pullChildren calls, so pullTank can advance its mark past every row it
   *  actually saw - including ones whose contents merged away to nothing. */
  private lastChildRows: Array<{ server_updated_at?: string }> = [];

  private async pullChildren<T extends Instance | TankGroup | RoomInstance>(table: string, tankId: string, mark: string): Promise<T[]> {
    const { data, error } = await this.supabase
      .from(table)
      .select('*')
      .eq('tank_id', tankId)
      .gt('server_updated_at', mark);
    if (error) throw error;
    const rows = (data ?? []) as ChildRow[];
    this.lastChildRows = [...this.lastChildRows, ...(rows as Array<{ server_updated_at?: string }>)];
    return rows.map((row) => rowToChild<T>(row));
  }
}
