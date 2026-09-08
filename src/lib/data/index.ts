import { getSupabase } from '../supabase';
import type { StorageAdapter } from './adapter';
import { IndexedDbAdapter } from './indexedDbAdapter';
import { LocalStorageAdapter } from './localAdapter';
import { EditorPrefsRepo, SpriteRepo, TankRepo } from './repository';
import { SyncEngine } from './syncEngine';

export type { EditorPrefs, StorageAdapter, TankState, TankSummary } from './adapter';
export { IndexedDbAdapter } from './indexedDbAdapter';
export { LocalStorageAdapter } from './localAdapter';
export { EditorPrefsRepo, SpriteRepo, TankRepo } from './repository';

export interface Repos {
  sprites: SpriteRepo;
  tank: TankRepo;
  prefs: EditorPrefsRepo;
}

export type { SyncStatus, SyncState } from './syncEngine';
export { SyncEngine } from './syncEngine';

/**
 * The single place that decides where data lives. Swapping localStorage for IndexedDB, or adding a
 * remote backend behind it (plan P4/P5), is a change to this one function - nothing else in the app
 * names an adapter.
 *
 * One shared set of repositories, not one per hook: the sprite library is genuinely shared state (the
 * editor writes it, the tank reads it), and two caches of it would immediately disagree.
 */
let repos: Repos | null = null;

export function getRepos(): Repos {
  if (!repos) {
    const adapter = pickAdapter();
    repos = makeRepos(adapter);
    attachSync(adapter, repos);
  }
  return repos;
}

let sync: SyncEngine | null = null;

/**
 * Starts syncing to Supabase, when there is a Supabase to sync to and a local database to sync from.
 * Both are optional: with no project configured, or in a browser where IndexedDB will not open, the
 * app is exactly what it was before - fully working, local only. Nothing here is awaited by callers,
 * and a sync failure never reaches the code that saved.
 */
function attachSync(adapter: StorageAdapter, repos: Repos): void {
  const supabase = getSupabase();
  if (!supabase || !(adapter instanceof IndexedDbAdapter)) return;
  sync = new SyncEngine(adapter, supabase);
  repos.sprites.onWrite = (sprites) => void sync?.queueSprites(sprites);
  repos.tank.onWrite = (state, tankId) => void sync?.queueTank(tankId, state);
  // Signing in (or out, or a token refresh) changes what a sync would do, so it is worth one
  // immediately rather than waiting up to a minute for the heartbeat.
  supabase.auth.onAuthStateChange(() => void sync?.syncNow());
  sync.start();
}

/** The running sync engine, or null when the app is local-only (see attachSync). */
export function getSync(): SyncEngine | null {
  getRepos();
  return sync;
}

/**
 * IndexedDB where it exists, localStorage where it does not. The fallback is not theoretical: private
 * browsing modes and locked-down browsers do refuse to open a database, and losing the tank entirely
 * there would be a far worse outcome than the ~5MB ceiling this app lived with until now. IndexedDB
 * copies any existing localStorage data across on its first run (see IndexedDbAdapter.migrateOnce) and
 * leaves the original in place, so this decision can be reversed by changing this one line.
 */
function pickAdapter(): StorageAdapter {
  if (typeof indexedDB === 'undefined') {
    console.warn('IndexedDB is unavailable - falling back to localStorage');
    return new LocalStorageAdapter();
  }
  return new IndexedDbAdapter();
}

export function makeRepos(adapter: StorageAdapter): Repos {
  return {
    sprites: new SpriteRepo(adapter),
    tank: new TankRepo(adapter),
    prefs: new EditorPrefsRepo(adapter),
  };
}

/** Tests only: point the app at a different adapter (and drop any cached data from a previous one). */
export function setRepos(next: Repos | null): void {
  repos = next;
  sync?.stop();
  sync = null;
}
