import { describe, expect, it } from 'vitest';
import { latestUpdatedAt, mergeRecords, pickWinner, type Syncable } from '../merge';
import { coalesce, isDue, makeEntry, withFailure } from '../outbox';
import { childToRow, rowToChild, rowToSprite, spriteToRow } from '../rows';
import * as storage from '../../storage';
import type { Instance, RoomInstance, Sprite, TankGroup } from '../../types';

function rec(id: string, updatedAt: number, extra: Partial<Syncable> = {}): Syncable {
  return { id, updatedAt, deletedAt: 0, rev: 0, ...extra };
}

describe('merge (last-write-wins with a server tiebreak)', () => {
  it('the newer edit wins', () => {
    expect(pickWinner(rec('a', 200), rec('a', 100)).updatedAt).toBe(200);
    expect(pickWinner(rec('a', 100), rec('a', 200)).updatedAt).toBe(200);
  });

  it('a deletion is just an edit - the later one wins either way', () => {
    const deleted = rec('a', 300, { deletedAt: 300 });
    const movedLater = rec('a', 400);
    expect(pickWinner(movedLater, deleted).deletedAt).toBe(0);
    expect(pickWinner(rec('a', 100), deleted).deletedAt).toBe(300);
  });

  it('falls back to the server revision when timestamps tie (skewed clocks)', () => {
    const local = rec('a', 500, { rev: 2 });
    const remote = rec('a', 500, { rev: 7 });
    expect(pickWinner(local, remote).rev).toBe(7);
  });

  it('prefers the remote copy when the two are indistinguishable, so devices converge', () => {
    const local = rec('a', 500);
    const remote = rec('a', 500);
    expect(pickWinner(local, remote)).toBe(remote);
  });

  it('merges by id and reports what the local copy still owes the server', () => {
    const local = [rec('a', 200), rec('b', 100), rec('c', 50)];
    const remote = [rec('a', 100), rec('b', 300)];

    const { merged, localWins } = mergeRecords(local, remote);

    expect(merged.find((r) => r.id === 'a')!.updatedAt).toBe(200); // local edit is newer
    expect(merged.find((r) => r.id === 'b')!.updatedAt).toBe(300); // remote edit is newer
    expect(merged.map((r) => r.id).sort()).toEqual(['a', 'b', 'c']);
    // 'a' the server has an older copy of; 'c' it has never seen at all.
    expect(localWins.map((r) => r.id).sort()).toEqual(['a', 'c']);
  });

  it('takes records the local copy has never seen', () => {
    const { merged } = mergeRecords([], [rec('new', 10)]);
    expect(merged.map((r) => r.id)).toEqual(['new']);
  });

  it('advances the pull mark to the newest record actually seen', () => {
    expect(latestUpdatedAt([rec('a', 10), rec('b', 40), rec('c', 25)])).toBe(40);
    expect(latestUpdatedAt([], 99)).toBe(99);
  });
});

describe('outbox', () => {
  it('keeps one entry per record, however many times it was edited', () => {
    const first = { ...makeEntry('sprites', 'a', 'upsert', { v: 1 }), queuedAt: 100 };
    const second = { ...makeEntry('sprites', 'a', 'upsert', { v: 2 }), queuedAt: 200 };
    const other = { ...makeEntry('sprites', 'b', 'upsert', { v: 1 }), queuedAt: 150 };

    const result = coalesce([first, second, other]);

    expect(result).toHaveLength(2);
    const a = result.find((e) => e.recordId === 'a')!;
    expect(a.payload).toEqual({ v: 2 });
    // The newest payload, but still queued at the moment the record first went unsynced.
    expect(a.queuedAt).toBe(100);
    expect(result.map((e) => e.recordId)).toEqual(['a', 'b']);
  });

  it('backs off further on each failure, up to a cap', () => {
    let entry = makeEntry('sprites', 'a', 'upsert', {});
    const delays: number[] = [];
    for (let i = 0; i < 12; i += 1) {
      const before = 1_000_000;
      entry = withFailure(entry, before);
      delays.push(entry.nextAttemptAt - before);
    }
    expect(delays[0]).toBe(2000);
    expect(delays[1]).toBe(4000);
    expect(delays[2]).toBe(8000);
    expect(Math.max(...delays)).toBe(5 * 60 * 1000);
    expect(entry.tries).toBe(12);
  });

  it('a fresh entry is due immediately; a failed one is not', () => {
    const entry = makeEntry('sprites', 'a', 'upsert', {});
    expect(isDue(entry)).toBe(true);
    expect(isDue(withFailure(entry, Date.now()))).toBe(false);
  });
});

describe('row mapping', () => {
  function sprite(): Sprite {
    return {
      ...storage.newRecordMeta(),
      id: 'sprite_1',
      name: 'Fish',
      type: 'fish',
      width: 2,
      height: 2,
      frameMs: 120,
      frames: [[storage.makeLayer(['#fff', null, null, '#000'])]],
    };
  }

  it('round-trips a sprite through its database row', () => {
    const original = sprite();
    const restored = rowToSprite(spriteToRow(original));

    expect(restored.id).toBe(original.id);
    expect(restored.name).toBe(original.name);
    expect(restored.width).toBe(original.width);
    expect(restored.frameMs).toBe(original.frameMs);
    expect(restored.updatedAt).toBe(original.updatedAt);
    // Pixels survive the encode/decode the row does on the way through.
    expect(restored.frames[0][0].cells).toEqual(['#fff', null, null, '#000']);
  });

  it('carries gallery state both ways, defaulting to private', () => {
    const published: Sprite = { ...sprite(), visibility: 'public', forkedFrom: 'sprite_origin' };
    const row = spriteToRow(published);
    expect(row.visibility).toBe('public');
    expect(row.forked_from).toBe('sprite_origin');

    const restored = rowToSprite(row);
    expect(restored.visibility).toBe('public');
    expect(restored.forkedFrom).toBe('sprite_origin');

    // A record that predates the gallery reads as private and not a copy, never as undefined - the
    // library badge and the publish toggle both read these without a fallback of their own.
    const legacy = rowToSprite({ ...spriteToRow(sprite()), visibility: undefined, forked_from: undefined });
    expect(legacy.visibility).toBe('private');
    expect(legacy.forkedFrom).toBeNull();
  });

  it('sends frames encoded, and never sends user_id or rev', () => {
    const row = spriteToRow(sprite()) as unknown as Record<string, unknown>;
    expect(JSON.stringify(row.frames)).toContain('rle1');
    // The server decides both: user_id from the session, rev from its own trigger.
    expect(row.user_id).toBeUndefined();
    expect(row.rev).toBeUndefined();
  });

  it('round-trips a tank instance, keeping meta in columns rather than in the payload', () => {
    const instance = {
      ...storage.newRecordMeta(),
      id: 'inst_1',
      spriteId: 'sprite_1',
      kind: 'fish',
      x: 10,
      y: 20,
      dir: 1,
      vx: 1,
      vy: 0,
      targetY: 20,
      frameIndex: 0,
      frameTimer: 0,
      bobPhase: 0,
      isDragging: false,
      swimSpeed: 'medium',
      groupId: null,
      schoolOffsetY: 0,
      zone: null,
      visible: true,
      bornAt: 1,
      lifespanMs: 2,
      dead: false,
      diedAt: 0,
      hunger: 1,
      starvingSince: 0,
    } as Instance;

    const row = childToRow('tank_1', instance);
    expect(row.tank_id).toBe('tank_1');
    expect(row.sprite_id).toBe('sprite_1');
    expect(row.data).not.toHaveProperty('updatedAt');
    expect(row.data).not.toHaveProperty('id');

    const restored = rowToChild<Instance>(row);
    expect(restored).toEqual({ ...instance, rev: 0 });
  });

  // A group has no sprite, and `tank_groups` has no sprite_id column. Sending the key anyway - even as
  // null - makes PostgREST reject the whole request for naming a column that does not exist, which the
  // outbox can only retry forever: every group and every piece of room decor silently stopped syncing.
  it('leaves sprite_id off entirely for a record that has no sprite', () => {
    const group: TankGroup = { id: 'group_1', name: 'School', zone: null, updatedAt: 5, deletedAt: 0, rev: 0 };
    const row = childToRow('tank_1', group);
    expect('sprite_id' in row).toBe(false);
    expect(rowToChild<TankGroup>(row)).toEqual(group);
  });

  it('keeps sprite_id for room decor, which does point at a sprite', () => {
    const decor: RoomInstance = {
      id: 'room_1',
      spriteId: 'sprite_9',
      x: 3,
      y: 4,
      visible: true,
      updatedAt: 5,
      deletedAt: 0,
      rev: 0,
    };
    expect(childToRow('tank_1', decor).sprite_id).toBe('sprite_9');
  });
});
