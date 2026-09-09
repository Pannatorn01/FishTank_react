import { encodeSprite, normalizeSprite } from '../storage';
import type { Instance, RoomInstance, Sprite, TankGroup } from '../types';
import type { TankState } from './adapter';

/**
 * Translation between the app's records and Supabase rows (supabase/schema.sql).
 *
 * Kept in one file, away from both the sync engine and the adapters, because this mapping is the thing
 * most likely to be got wrong quietly: a field dropped here does not fail anywhere, it just stops
 * arriving on the user's other device. Every function below is pure, so the tests can check both
 * directions without a network or a database.
 *
 * Two conventions throughout:
 * - `user_id` is never sent. The column defaults to auth.uid(), and row-level security checks it, so a
 *   client that names an owner can only ever name itself - and cannot get it wrong.
 * - `rev` is never sent either. The server assigns it (see the bump_rev trigger); a client that
 *   claimed a revision would be claiming knowledge it does not have.
 */

export interface SpriteRow {
  id: string;
  /** Set by the database on every write (see supabase/schema.sql). Only the sync engine reads it, to
   *  ask for "everything changed since I last looked" without trusting any client's clock. */
  server_updated_at?: string;
  name: string;
  type: string;
  width: number;
  height: number;
  frame_ms: number;
  frames: unknown;
  visibility?: string;
  forked_from?: string | null;
  updated_at: number;
  deleted_at: number;
  rev?: number;
}

export function spriteToRow(sprite: Sprite): SpriteRow {
  const encoded = encodeSprite(sprite);
  return {
    id: sprite.id,
    name: sprite.name,
    type: sprite.type,
    width: sprite.width,
    height: sprite.height,
    frame_ms: sprite.frameMs,
    frames: encoded.frames,
    updated_at: sprite.updatedAt,
    deleted_at: sprite.deletedAt,
  };
}

export function rowToSprite(row: SpriteRow): Sprite {
  return normalizeSprite({
    id: row.id,
    name: row.name,
    type: row.type,
    width: row.width,
    height: row.height,
    frameMs: row.frame_ms,
    frames: row.frames,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    rev: row.rev ?? 0,
  } as unknown as Sprite);
}

/** A tank's own settings - everything about the tank that is not the things floating in it. */
export type TankSettings = Omit<TankState, 'instances' | 'groups' | 'roomInstances'>;

export interface TankRow {
  id: string;
  server_updated_at?: string;
  name: string;
  settings: TankSettings;
  updated_at: number;
  deleted_at: number;
  rev?: number;
}

export function tankToRow(id: string, name: string, state: TankState, updatedAt: number): TankRow {
  const { instances: _i, groups: _g, roomInstances: _r, ...settings } = state;
  return { id, name, settings, updated_at: updatedAt, deleted_at: 0 };
}

/** A row in one of the three "things in a tank" tables. They share a shape on purpose: the contents
 *  differ, the sync rules do not. */
export interface ChildRow {
  id: string;
  server_updated_at?: string;
  tank_id: string;
  sprite_id?: string | null;
  data: Record<string, unknown>;
  updated_at: number;
  deleted_at: number;
  rev?: number;
}

type Child = Instance | TankGroup | RoomInstance;

export function childToRow(tankId: string, record: Child): ChildRow {
  const { id, updatedAt, deletedAt, ...data } = record as Child & Record<string, unknown>;
  return {
    id,
    tank_id: tankId,
    // Omitted entirely, not sent as null, for a record that has no sprite. Groups live in a table with
    // no sprite_id column, and PostgREST rejects the whole request for naming a column that does not
    // exist - which is a rejection the outbox can only retry, forever. (Room decor does have a sprite,
    // and the column it needs was added in supabase/schema.sql's P6-3 section for the same reason.)
    ...('spriteId' in record ? { sprite_id: (record as Instance).spriteId } : {}),
    // The meta fields live in columns, so they are stripped from the payload rather than stored twice
    // and given the chance to disagree.
    data: data as Record<string, unknown>,
    updated_at: updatedAt,
    deleted_at: deletedAt,
  };
}

export function rowToChild<T extends Child>(row: ChildRow): T {
  return {
    ...(row.data as object),
    id: row.id,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    rev: row.rev ?? 0,
  } as T;
}

/** A record that has been deleted locally, as the row that tells the server so. Tombstones are how a
 *  deletion travels: a row that simply vanished from a client would be indistinguishable from one that
 *  client has not uploaded yet. */
export function tombstoneRow(row: ChildRow, deletedAt: number): ChildRow {
  return { ...row, data: {}, updated_at: deletedAt, deleted_at: deletedAt };
}
