import type { StorageAdapter } from './adapter';
import { LocalStorageAdapter } from './localAdapter';
import { EditorPrefsRepo, SpriteRepo, TankRepo } from './repository';

export type { EditorPrefs, StorageAdapter, TankState } from './adapter';
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
  if (!repos) repos = makeRepos(new LocalStorageAdapter());
  return repos;
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
