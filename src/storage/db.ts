/*
 * IndexedDB persistence with localStorage fallback.
 * Stores: projects, custom materials, app settings.
 */
import type { ProjectRecord } from './project';
import type { MaterialDef } from '../physics/types';

const DB_NAME = 'neth-speakers';
const DB_VERSION = 1;
const STORE_PROJECTS = 'projects';
const STORE_MATERIALS = 'materials';
const STORE_SETTINGS = 'settings';

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDB(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') { resolve(null); return; }
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_PROJECTS)) db.createObjectStore(STORE_PROJECTS, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(STORE_MATERIALS)) db.createObjectStore(STORE_MATERIALS, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(STORE_SETTINGS)) db.createObjectStore(STORE_SETTINGS);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
  return dbPromise;
}

/* ---- localStorage fallback ---- */
const lsKey = (store: string) => `neth:${store}`;

function lsAll<T>(store: string): T[] {
  try {
    const raw = localStorage.getItem(lsKey(store));
    return raw ? (JSON.parse(raw) as T[]) : [];
  } catch { return []; }
}
function lsWrite<T>(store: string, items: T[]): void {
  try { localStorage.setItem(lsKey(store), JSON.stringify(items)); } catch { /* quota */ }
}

/* ---- Projects ---- */
export async function listProjects(): Promise<ProjectRecord[]> {
  const db = await openDB();
  if (!db) return lsAll<ProjectRecord>(STORE_PROJECTS).sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
  return new Promise((resolve) => {
    const out: ProjectRecord[] = [];
    try {
      const tx = db.transaction(STORE_PROJECTS, 'readonly');
      const req = tx.objectStore(STORE_PROJECTS).openCursor();
      req.onsuccess = () => {
        const cur = req.result;
        if (cur) { out.push(cur.value as ProjectRecord); cur.continue(); }
        else resolve(out.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt)));
      };
      req.onerror = () => resolve(out);
    } catch { resolve(out); }
  });
}

export async function putProject(p: ProjectRecord): Promise<void> {
  const db = await openDB();
  if (!db) {
    const items = lsAll<ProjectRecord>(STORE_PROJECTS).filter((x) => x.id !== p.id);
    items.push(p);
    lsWrite(STORE_PROJECTS, items);
    return;
  }
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_PROJECTS, 'readwrite');
      tx.objectStore(STORE_PROJECTS).put(p);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch { resolve(); }
  });
}

export async function deleteProject(id: string): Promise<void> {
  const db = await openDB();
  if (!db) { lsWrite(STORE_PROJECTS, lsAll<ProjectRecord>(STORE_PROJECTS).filter((x) => x.id !== id)); return; }
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_PROJECTS, 'readwrite');
      tx.objectStore(STORE_PROJECTS).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch { resolve(); }
  });
}

/* ---- Custom materials ---- */
export async function listCustomMaterials(): Promise<MaterialDef[]> {
  const db = await openDB();
  if (!db) return lsAll<MaterialDef>(STORE_MATERIALS);
  return new Promise((resolve) => {
    const out: MaterialDef[] = [];
    try {
      const tx = db.transaction(STORE_MATERIALS, 'readonly');
      const req = tx.objectStore(STORE_MATERIALS).openCursor();
      req.onsuccess = () => {
        const cur = req.result;
        if (cur) { out.push(cur.value as MaterialDef); cur.continue(); } else resolve(out);
      };
      req.onerror = () => resolve(out);
    } catch { resolve(out); }
  });
}

export async function putMaterial(m: MaterialDef): Promise<void> {
  const db = await openDB();
  if (!db) {
    const items = lsAll<MaterialDef>(STORE_MATERIALS).filter((x) => x.id !== m.id);
    items.push(m);
    lsWrite(STORE_MATERIALS, items);
    return;
  }
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_MATERIALS, 'readwrite');
      tx.objectStore(STORE_MATERIALS).put(m);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch { resolve(); }
  });
}

export async function deleteMaterial(id: string): Promise<void> {
  const db = await openDB();
  if (!db) { lsWrite(STORE_MATERIALS, lsAll<MaterialDef>(STORE_MATERIALS).filter((x) => x.id !== id)); return; }
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_MATERIALS, 'readwrite');
      tx.objectStore(STORE_MATERIALS).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch { resolve(); }
  });
}

/* ---- Small settings (kv) ---- */
export async function getSetting<T>(key: string): Promise<T | null> {
  const db = await openDB();
  if (!db) {
    try {
      const raw = localStorage.getItem(`${lsKey(STORE_SETTINGS)}:${key}`);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch { return null; }
  }
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_SETTINGS, 'readonly');
      const req = tx.objectStore(STORE_SETTINGS).get(key);
      req.onsuccess = () => resolve((req.result?.value ?? null) as T | null);
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  const db = await openDB();
  if (!db) {
    try { localStorage.setItem(`${lsKey(STORE_SETTINGS)}:${key}`, JSON.stringify(value)); } catch { /* quota */ }
    return;
  }
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_SETTINGS, 'readwrite');
      tx.objectStore(STORE_SETTINGS).put({ key, value });
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch { resolve(); }
  });
}

export async function storageEstimate(): Promise<string> {
  try {
    if (navigator.storage?.estimate) {
      const e = await navigator.storage.estimate();
      if (e.usage != null && e.quota != null) {
        return `${(e.usage / 1048576).toFixed(1)} MB used of ${(e.quota / 1048576).toFixed(0)} MB quota`;
      }
    }
  } catch { /* ignore */ }
  return 'Storage estimate unavailable';
}
