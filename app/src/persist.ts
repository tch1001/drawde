/**
 * Chat persistence — one saved session per document.
 *
 * IndexedDB rather than localStorage: a session's weight is its crops, and one
 * crop is a base64 PNG rendered at CROP_SCALE — hundreds of KB each. A couple
 * of papers would blow localStorage's ~5MB budget, and it fails by throwing
 * mid-write, which would lose the thread it was trying to protect.
 *
 * Everything here degrades to a no-op rather than throwing: private-mode
 * browsers refuse to open a database at all, and a chat that isn't saved is a
 * far better outcome than a viewer that won't boot.
 */
import type { Region } from './types';
import type { ChatMessage } from './chat';

const DB_NAME = 'drawde';
const STORE = 'sessions';
const DB_VERSION = 1;
/** Keep the list useful without letting crops accumulate unboundedly. */
const MAX_SESSIONS = 25;

/** A Region as stored: the object URL is dropped, the base64 is the survivor. */
export type StoredRegion = Omit<Region, 'imageUrl'>;

export interface StoredMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  error?: string;
  contexts?: StoredRegion[];
}

export interface StoredSession {
  /** Stable per document — see documentKey(). */
  key: string;
  /** How to reopen it; null for a dropped file, which cannot be re-fetched. */
  url: string | null;
  label: string;
  updatedAt: number;
  messages: StoredMessage[];
}

/**
 * Stable identity for a document across reloads.
 *
 * A dropped file's blob: URL is regenerated on every open, so it can't be the
 * key — the file name is the only thing that survives. Such a session is still
 * saved (re-drop the same file and the thread returns) but has no url, so the
 * recent list won't offer it as a link it cannot honour.
 */
export function documentKey(url: string | null, label: string): string {
  if (url && !url.startsWith('blob:')) return url;
  return `file:${label}`;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'key' }).createIndex('updatedAt', 'updatedAt');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  return openDb().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) return resolve(null);
        try {
          const req = run(db.transaction(STORE, mode).objectStore(STORE));
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(null);
        } catch {
          resolve(null);
        }
      }),
  );
}

/** Strip a live thread down to what is worth keeping on disk. */
export function toStored(messages: ChatMessage[]): StoredMessage[] {
  return messages
    // a half-streamed answer would come back as a truncated turn with no way
    // to resume it, so only settled messages are kept
    .filter((m) => !m.streaming)
    .map((m) => ({
      id: m.id,
      role: m.role,
      text: m.text,
      ...(m.error ? { error: m.error } : {}),
      ...(m.contexts?.length
        ? {
            contexts: m.contexts.map(({ imageUrl: _drop, ...rest }) => rest as StoredRegion),
          }
        : {}),
    }));
}

/**
 * Rebuild a thread for display.
 *
 * Crops come back as data: URLs rather than object URLs — they need no
 * revoking, so a restored thread can't leak or, worse, blank itself out when
 * something revokes a URL it thought it owned.
 */
export function fromStored(messages: StoredMessage[]): ChatMessage[] {
  return messages.map((m) => ({
    id: m.id,
    role: m.role,
    text: m.text,
    ...(m.error ? { error: m.error } : {}),
    ...(m.contexts
      ? {
          contexts: m.contexts.map(
            (r) =>
              ({
                ...r,
                ...(r.imageBase64
                  ? { imageUrl: `data:image/png;base64,${r.imageBase64}` }
                  : {}),
              }) as Region,
          ),
        }
      : {}),
  }));
}

export async function saveSession(s: StoredSession): Promise<void> {
  if (!s.messages.length) return void deleteSession(s.key);
  await tx('readwrite', (store) => store.put(s));
  await prune();
}

export async function loadSession(key: string): Promise<StoredSession | null> {
  const found = await tx<StoredSession>('readonly', (store) => store.get(key));
  return found ?? null;
}

export async function deleteSession(key: string): Promise<void> {
  await tx('readwrite', (store) => store.delete(key) as unknown as IDBRequest<undefined>);
}

/** Most recently used first. */
export async function listSessions(limit = 8): Promise<StoredSession[]> {
  const all = await tx<StoredSession[]>('readonly', (store) => store.getAll());
  return (all ?? []).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit);
}

async function prune(): Promise<void> {
  const all = await tx<StoredSession[]>('readonly', (store) => store.getAll());
  if (!all || all.length <= MAX_SESSIONS) return;
  const doomed = all.sort((a, b) => b.updatedAt - a.updatedAt).slice(MAX_SESSIONS);
  for (const s of doomed) await deleteSession(s.key);
}
