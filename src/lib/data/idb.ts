/**
 * The smallest possible promise wrapper around IndexedDB - open a database, read a store, write a
 * store. Hand-rolled rather than pulling in a library because this is all of IndexedDB the app uses:
 * no indexes, no cursors, no versioning beyond the initial schema. Every call here is one transaction.
 */

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

/** Resolves when the transaction commits, not when the last request succeeds - a write is only really
 *  done when its transaction has committed, and only then is it safe to tell the user it saved. */
function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

/** `version` omitted opens whatever version exists, without triggering an upgrade - what a reader that
 *  only wants to look at the data (the backup path) needs, and the only way for such a reader not to
 *  break every time the schema moves on. */
export function openDb(name: string, version: number | undefined, upgrade: (db: IDBDatabase) => void): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available'));
      return;
    }
    const req = version === undefined ? indexedDB.open(name) : indexedDB.open(name, version);
    req.onupgradeneeded = () => upgrade(req.result);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('opening IndexedDB failed'));
    // Another tab holding an older version open blocks the upgrade forever; failing loudly beats a
    // page that simply never finishes loading.
    req.onblocked = () => reject(new Error('IndexedDB upgrade blocked by another tab'));
  });
}

export function getAll<T>(db: IDBDatabase, store: string): Promise<T[]> {
  return request(db.transaction(store, 'readonly').objectStore(store).getAll() as IDBRequest<T[]>);
}

export function get<T>(db: IDBDatabase, store: string, key: IDBValidKey): Promise<T | undefined> {
  return request(db.transaction(store, 'readonly').objectStore(store).get(key) as IDBRequest<T | undefined>);
}

export async function put(db: IDBDatabase, store: string, value: unknown): Promise<void> {
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).put(value);
  await done(tx);
}

export async function del(db: IDBDatabase, store: string, key: IDBValidKey): Promise<void> {
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).delete(key);
  await done(tx);
}

/** Replaces a whole store's contents in one transaction: either every record lands or none does, so a
 *  failure part-way through cannot leave half a sprite library behind. */
export async function replaceAll(db: IDBDatabase, store: string, values: unknown[]): Promise<void> {
  const tx = db.transaction(store, 'readwrite');
  const objectStore = tx.objectStore(store);
  objectStore.clear();
  for (const value of values) objectStore.put(value);
  await done(tx);
}
