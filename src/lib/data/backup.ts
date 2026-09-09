import { collectLocalStorageDump, clearLocalStorageData } from '../storage';
import { downloadBlob } from '../download';
import { getAll, openDb } from './idb';

const DB_NAME = 'fishtank';
// 'outbox' included deliberately: it holds changes the server has not accepted yet, which are exactly
// the ones a backup must not miss.
const STORES = ['sprites', 'tanks', 'prefs', 'meta', 'outbox'];

/**
 * "Get my work out" and "start over", now that the work can live in two places.
 *
 * Both of these existed for localStorage (see the ErrorBoundary that offers them). Moving the data to
 * IndexedDB without moving these would have quietly broken the only escape hatch the app has: a backup
 * that no longer contains the sprites, and a reset that leaves the broken data exactly where it was.
 *
 * Both read the raw stored values rather than going through the adapters, deliberately: if the app is
 * crashing because something cannot be loaded, the recovery path must not depend on loading it.
 */
export async function collectBackup(): Promise<Record<string, unknown>> {
  const dump: Record<string, unknown> = { localStorage: collectLocalStorageDump() };
  try {
    // No version: a backup must read whatever schema this browser happens to be on, and must never
    // trigger an upgrade of its own.
    const db = await openDb(DB_NAME, undefined, () => {});
    for (const store of STORES) {
      if (db.objectStoreNames.contains(store)) dump[store] = await getAll(db, store);
    }
    db.close();
  } catch (e) {
    console.warn('backing up IndexedDB failed - the localStorage part is still included', e);
  }
  return dump;
}

export async function downloadDataBackup(): Promise<boolean> {
  const dump = await collectBackup();
  const hasSomething = Object.values(dump).some((v) => (Array.isArray(v) ? v.length > 0 : Object.keys(v as object).length > 0));
  if (!hasSomething) return false;

  const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' });
  downloadBlob(blob, `pixel-fish-tank-backup-${new Date().toISOString().slice(0, 10)}.json`);
  return true;
}

/** Wipes both stores. Leaves every other origin - and every key this app does not own - untouched. */
export async function resetAllData(): Promise<void> {
  clearLocalStorageData();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    // Resolve either way: a delete that is blocked by another tab must not stop the caller from
    // reloading, which is what unblocks it.
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}
