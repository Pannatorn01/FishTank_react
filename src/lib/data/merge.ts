import type { RecordMeta } from '../types';

export type Syncable = RecordMeta & { id: string };

/**
 * Which of two versions of the same record wins.
 *
 * Last-write-wins, decided by the client's `updated_at`, with the server's `rev` as the tiebreak. That
 * is enough for what this app actually supports - one person, several devices, one of which was
 * offline - and deliberately not more: real concurrent editing needs a different data model, and
 * pretending otherwise with a cleverer merge here would only hide the fact that it cannot work.
 *
 * A deletion is just another edit, so a tombstone wins or loses on its timestamp like anything else:
 * delete a fish on the phone, then move it on the laptop a minute later, and the later move wins -
 * which is what the person doing the moving would expect.
 *
 * Clock skew is the reason `rev` exists: two devices whose clocks disagree can produce timestamps in
 * the wrong order, and the server-assigned revision is the only value in the pair that came from a
 * single authority. It is only consulted when the timestamps tie, which is exactly when the client
 * clocks have told us nothing.
 */
export function pickWinner<T extends Syncable>(local: T, remote: T): T {
  if (local.updatedAt !== remote.updatedAt) return local.updatedAt > remote.updatedAt ? local : remote;
  if (local.rev !== remote.rev) return local.rev > remote.rev ? local : remote;
  // Identical timestamps and revisions: the two are the same write, or close enough that there is no
  // honest way to order them. Preferring the remote keeps every device converging on one answer
  // instead of each insisting on its own.
  return remote;
}

/**
 * Folds records pulled from the server into what is held locally. Returns the merged list plus the
 * records whose local version won, which are the ones still owed to the server.
 */
export function mergeRecords<T extends Syncable>(local: T[], remote: T[]): { merged: T[]; localWins: T[] } {
  const byId = new Map<string, T>();
  for (const record of local) byId.set(record.id, record);

  const localWins: T[] = [];
  for (const incoming of remote) {
    const mine = byId.get(incoming.id);
    if (!mine) {
      byId.set(incoming.id, incoming);
      continue;
    }
    const winner = pickWinner(mine, incoming);
    byId.set(incoming.id, winner);
    if (winner === mine && mine.updatedAt !== incoming.updatedAt) localWins.push(mine);
  }

  // A local record the server has never seen is also owed to it.
  const remoteIds = new Set(remote.map((r) => r.id));
  for (const record of local) {
    if (!remoteIds.has(record.id) && record.rev === 0) localWins.push(record);
  }

  return { merged: [...byId.values()], localWins };
}

/** The high-water mark for the next delta pull: nothing older than this needs asking for again. */
export function latestUpdatedAt(records: Syncable[], previous = 0): number {
  return records.reduce((max, r) => Math.max(max, r.updatedAt), previous);
}
