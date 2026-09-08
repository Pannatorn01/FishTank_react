import type { SupabaseClient } from '@supabase/supabase-js';
import type { Instance, RoomInstance, Sprite, TankGroup } from '../types';
import type { TankState } from './adapter';
import type { IndexedDbAdapter } from './indexedDbAdapter';
import { latestUpdatedAt, mergeRecords, type Syncable } from './merge';
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
const MARK_TANK = 'sync.mark.tank';
const TABLE_SPRITES = 'sprites';
const TABLE_TANKS = 'tanks';
const TABLE_INSTANCES = 'tank_instances';
const TABLE_GROUPS = 'tank_groups';
const TABLE_ROOM = 'room_instances';

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
  private running = false;
  private listeners = new Set<(status: SyncStatus) => void>();
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

  async syncNow(): Promise<void> {
    if (this.running) return;
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

    this.running = true;
    this.setStatus({ state: 'syncing', lastError: null });
    try {
      await this.flush();
      await this.pull();
      this.setStatus({ state: 'idle', lastSyncedAt: Date.now() });
    } catch (e) {
      console.warn('sync failed', e);
      this.setStatus({ state: 'error', lastError: e instanceof Error ? e.message : String(e) });
    } finally {
      this.running = false;
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

  private async upsert(table: string, rows: unknown[]): Promise<void> {
    const { error } = await this.supabase.from(table).upsert(rows, { onConflict: 'id' });
    if (error) throw error;
  }

  // ------------------------------------------------------------------ pull

  private async pull(): Promise<void> {
    await this.pullSprites();
    await this.pullTank();
  }

  /** Only rows changed since the last successful pull. The mark is the newest `updated_at` actually
   *  seen, not "now": a row written while this pull was in flight must still be picked up next time. */
  private async pullSprites(): Promise<void> {
    const mark = Number((await this.local.getMeta(MARK_SPRITES)) ?? 0);
    const { data, error } = await this.supabase
      .from(TABLE_SPRITES)
      .select('*')
      .gt('updated_at', mark)
      .order('updated_at', { ascending: true });
    if (error) throw error;
    const incoming = (data ?? []).map((row: SpriteRow) => rowToSprite(row));
    if (incoming.length === 0) return;

    const local = await this.local.allSpriteRecords();
    const { merged, localWins } = mergeRecords<Sprite & Syncable>(local as (Sprite & Syncable)[], incoming as (Sprite & Syncable)[]);
    await this.local.writeSpriteRecords(merged);
    // Anything the local copy won stays owed to the server; queueing it here is what makes an offline
    // edit survive a pull that would otherwise have quietly overwritten it.
    for (const sprite of localWins) {
      await this.local.outboxPut(makeEntry(TABLE_SPRITES, sprite.id, 'upsert', sprite));
    }
    await this.local.setMetaValue(MARK_SPRITES, String(latestUpdatedAt(incoming as Syncable[], mark)));
  }

  private async pullTank(): Promise<void> {
    const tankId = await this.local.getCurrentTankId();
    const mark = Number((await this.local.getMeta(MARK_TANK)) ?? 0);

    const { data: tankRows, error: tankError } = await this.supabase
      .from(TABLE_TANKS)
      .select('*')
      .eq('id', tankId)
      .gt('updated_at', mark);
    if (tankError) throw tankError;

    const [instances, groups, room] = await Promise.all([
      this.pullChildren<Instance>(TABLE_INSTANCES, tankId, mark),
      this.pullChildren<TankGroup>(TABLE_GROUPS, tankId, mark),
      this.pullChildren<RoomInstance>(TABLE_ROOM, tankId, mark),
    ]);

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
    const seen = [
      ...(remoteTank ? [{ id: remoteTank.id, updatedAt: remoteTank.updated_at, deletedAt: 0, rev: 0 }] : []),
      ...(instances as Syncable[]),
      ...(groups as Syncable[]),
      ...(room as Syncable[]),
    ];
    await this.local.setMetaValue(MARK_TANK, String(latestUpdatedAt(seen, mark)));
  }

  private async pullChildren<T extends Instance | TankGroup | RoomInstance>(table: string, tankId: string, mark: number): Promise<T[]> {
    const { data, error } = await this.supabase
      .from(table)
      .select('*')
      .eq('tank_id', tankId)
      .gt('updated_at', mark);
    if (error) throw error;
    return (data ?? []).map((row: ChildRow) => rowToChild<T>(row));
  }
}
