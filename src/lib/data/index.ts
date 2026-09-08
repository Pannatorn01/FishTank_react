import type { StorageAdapter } from './adapter';
import { IndexedDbAdapter } from './indexedDbAdapter';
import { LocalStorageAdapter } from './localAdapter';
import { EditorPrefsRepo, SpriteRepo, TankRepo } from './repository';

export type { EditorPrefs, StorageAdapter, TankState, TankSummary } from './adapter';
export { IndexedDbAdapter } from './indexedDbAdapter';
export { LocalStorageAdapter } from './localAdapter';
export { EditorPrefsRepo, SpriteRepo, TankRepo } from './repository';

export interface Repos {
  sprites: SpriteRepo;
  tank: TankRepo;
  prefs: EditorPrefsRepo;
}

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
  if (!repos) repos = makeRepos(pickAdapter());
  return repos;
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
}
