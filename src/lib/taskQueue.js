const DB_NAME = "inspection_task_queue";
const DB_VERSION = 1;
const STORE_NAME = "tasks";

function openDb() {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "taskId" });
        store.createIndex("by_status", "status", { unique: false });
        store.createIndex("by_itemKey", "itemKey", { unique: false });
        store.createIndex("by_createdAt", "createdAt", { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Failed to open task queue"));
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
      done(reject, tx.error || new Error("Task queue transaction failed"));
    };
    tx.onabort = () => {
      db.close();
      done(reject, tx.error || new Error("Task queue transaction aborted"));
    };

    Promise.resolve(runner(store))
      .then((value) => done(resolve, value))
      .catch((error) => done(reject, error));
  });
}

function readAllFromRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(Array.isArray(request.result) ? request.result : []);
    request.onerror = () => reject(request.error || new Error("Task queue read failed"));
  });
}

export function createOperationId(prefix = "op") {
  const cryptoObj = window.crypto;
  if (cryptoObj?.randomUUID) {
    return `${prefix}_${cryptoObj.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function createTaskId(prefix = "task") {
  return createOperationId(prefix);
}

export async function upsertTask(task) {
  if (!task?.taskId) {
    throw new Error("taskId is required");
  }

  return withStore("readwrite", (store) => new Promise((resolve, reject) => {
    const request = store.put(task);
    request.onsuccess = () => resolve(task);
    request.onerror = () => reject(request.error || new Error("Failed to save task"));
  }));
}

export async function getTask(taskId) {
  return withStore("readonly", (store) => new Promise((resolve, reject) => {
    const request = store.get(taskId);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error || new Error("Failed to load task"));
  }));
}

export async function listAllTasks() {
  return withStore("readonly", async (store) => {
    const tasks = await readAllFromRequest(store.getAll());
    return tasks.sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0));
  });
}

export async function listPendingTasks(limit = 50) {
  const all = await listAllTasks();
  return all
    .filter((task) => ["pending", "retry", "uploading", "saving"].includes(String(task?.status || "")))
    .sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0))
    .slice(0, limit);
}

export async function listTasksByItemKey(itemKey) {
  return withStore("readonly", async (store) => {
    const tasks = await readAllFromRequest(store.index("by_itemKey").getAll(itemKey));
    return tasks.sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0));
  });
}

export async function patchTask(taskId, patch) {
  const current = await getTask(taskId);
  if (!current) return null;
  const next = {
    ...current,
    ...patch,
  };
  await upsertTask(next);
  return next;
}

export async function removeTask(taskId) {
  return withStore("readwrite", (store) => new Promise((resolve, reject) => {
    const request = store.delete(taskId);
    request.onsuccess = () => resolve(true);
    request.onerror = () => reject(request.error || new Error("Failed to delete task"));
  }));
}

export async function clearCompletedTasks() {
  const all = await listAllTasks();
  const removable = all.filter((task) => ["completed", "cancelled"].includes(String(task?.status || "")));
  await Promise.all(removable.map((task) => removeTask(task.taskId)));
  return removable.length;
}
