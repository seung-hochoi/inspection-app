const DB_NAME = "inspection_app_storage";
const DB_VERSION = 1;
const STORE_NAME = "kv";

function openDb() {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Failed to open IndexedDB"));
  });
}

async function withStore(mode, runner) {
  const db = await openDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const store = tx.objectStore(STORE_NAME);

    let settled = false;
    const done = (fn, value) => {
      if (settled) return;
      settled = true;
      fn(value);
    };

    tx.oncomplete = () => {
      db.close();
    };
    tx.onerror = () => {
      db.close();
      done(reject, tx.error || new Error("IndexedDB transaction failed"));
    };
    tx.onabort = () => {
      db.close();
      done(reject, tx.error || new Error("IndexedDB transaction aborted"));
    };

    Promise.resolve(runner(store))
      .then((value) => done(resolve, value))
      .catch((error) => done(reject, error));
  });
}

export async function loadPersistedState(key) {
  return withStore("readonly", (store) => new Promise((resolve, reject) => {
    const request = store.get(key);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error || new Error("IndexedDB read failed"));
  }));
}

export async function savePersistedState(key, value) {
  return withStore("readwrite", (store) => new Promise((resolve, reject) => {
    const request = store.put(value, key);
    request.onsuccess = () => resolve(true);
    request.onerror = () => reject(request.error || new Error("IndexedDB write failed"));
  }));
}

export async function removePersistedState(key) {
  return withStore("readwrite", (store) => new Promise((resolve, reject) => {
    const request = store.delete(key);
    request.onsuccess = () => resolve(true);
    request.onerror = () => reject(request.error || new Error("IndexedDB delete failed"));
  }));
}
