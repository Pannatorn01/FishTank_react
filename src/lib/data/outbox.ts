/**
 * The queue of local changes the server has not accepted yet.
 *
 * Offline-first means a write is finished the moment it is in IndexedDB - the user never waits for a
 * network round-trip, and never loses work because one failed. What is owed to the server is recorded
 * here and flushed when it can be.
 *
 * Two properties matter more than anything else about this queue:
 *
 * - **One entry per record.** Moving a fish twenty times leaves one entry holding the latest version,
 *   not twenty. A queue that grows with edits rather than with records would, after an afternoon
 *   offline, take longer to drain than the editing took.
 * - **Idempotent entries.** Every entry is "make the server's copy of record X look like this", not
 *   "apply this change". Ids come from the client, so replaying an entry after a failure - or after a
 *   response that was lost on its way back - cannot duplicate anything.
 */
export type OutboxOp = 'upsert' | 'delete';

export interface OutboxEntry {
  /** `${table}:${recordId}` - the key, so a second edit to the same record replaces the first. */
  key: string;
  table: string;
  recordId: string;
  op: OutboxOp;
  payload: unknown;
  /** Failed attempts so far; drives the backoff in nextAttemptAt. */
  tries: number;
  /** epoch ms before which this entry should not be retried. */
  nextAttemptAt: number;
  queuedAt: number;
}

export function outboxKey(table: string, recordId: string): string {
  return `${table}:${recordId}`;
}

export function makeEntry(table: string, recordId: string, op: OutboxOp, payload: unknown): OutboxEntry {
  return {
    key: outboxKey(table, recordId),
    table,
    recordId,
    op,
    payload,
    tries: 0,
    nextAttemptAt: 0,
    queuedAt: Date.now(),
  };
}

/** Base for the exponential backoff, capped so a long outage does not push the next attempt days out. */
const RETRY_BASE_MS = 2000;
const RETRY_MAX_MS = 5 * 60 * 1000;

export function withFailure(entry: OutboxEntry, now = Date.now()): OutboxEntry {
  const tries = entry.tries + 1;
  const delay = Math.min(RETRY_BASE_MS * 2 ** (tries - 1), RETRY_MAX_MS);
  return { ...entry, tries, nextAttemptAt: now + delay };
}

export function isDue(entry: OutboxEntry, now = Date.now()): boolean {
  return entry.nextAttemptAt <= now;
}

/**
 * Collapses a list of entries so that only the newest one per record survives, in the order they were
 * first queued. Used when queueing (replace, do not append) and when draining a queue written by an
 * older build that did not coalesce.
 */
export function coalesce(entries: OutboxEntry[]): OutboxEntry[] {
  const byKey = new Map<string, OutboxEntry>();
  for (const entry of entries) {
    const existing = byKey.get(entry.key);
    // Keep the newer payload but the older queuedAt: what is owed is the latest state, and how long it
    // has been owed is measured from when the record first went unsynced.
    byKey.set(entry.key, existing ? { ...entry, queuedAt: existing.queuedAt } : entry);
  }
  return [...byKey.values()].sort((a, b) => a.queuedAt - b.queuedAt);
}
