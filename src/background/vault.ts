// Token vault.
//
// - A random AES-256-GCM key is generated once with `extractable: false` and
//   kept in the extension's own IndexedDB. Chrome stores it as an opaque
//   CryptoKey: no script (including ours) can export the raw key bytes.
// - Tokens are encrypted with that key. The ciphertext lives in
//   chrome.storage.local; the account id is bound in as AES-GCM
//   "additional data" so a ciphertext can't be swapped onto another account.
// - Decrypted tokens are held only in this service worker's memory.
// - Only the background service worker imports this module. UI pages and the
//   content script never see a token.

const DB_NAME = "ytsw-vault";
const STORE = "keys";
const KEY_ID = "master-v1";

interface Sealed {
  v: 1;
  iv: string; // base64
  ct: string; // base64
}

const memory = new Map<string, string>();
let keyPromise: Promise<CryptoKey> | null = null;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idb<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = fn(tx.objectStore(STORE));
        tx.oncomplete = () => {
          db.close();
          resolve(req.result as T);
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error);
        };
      })
  );
}

async function loadOrCreateKey(): Promise<CryptoKey> {
  const existing = await idb<CryptoKey | undefined>("readonly", (s) => s.get(KEY_ID));
  if (existing) return existing;
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
    "encrypt",
    "decrypt",
  ]);
  await idb("readwrite", (s) => s.put(key, KEY_ID));
  return key;
}

function getKey(): Promise<CryptoKey> {
  if (!keyPromise) {
    keyPromise = loadOrCreateKey().catch((e) => {
      keyPromise = null;
      throw e;
    });
  }
  return keyPromise;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

function toB64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromB64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function seal(accountId: string, token: string): Promise<Sealed> {
  const key = await getKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: enc.encode(accountId) },
    key,
    enc.encode(token)
  );
  memory.set(accountId, token);
  return { v: 1, iv: toB64(iv), ct: toB64(ct) };
}

/** Returns the token, or null if it cannot be decrypted (key lost / tampered). */
export async function unseal(accountId: string, sealed: Sealed | undefined): Promise<string | null> {
  const cached = memory.get(accountId);
  if (cached) return cached;
  if (!sealed || sealed.v !== 1) return null;
  try {
    const key = await getKey();
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromB64(sealed.iv), additionalData: enc.encode(accountId) },
      key,
      fromB64(sealed.ct)
    );
    const token = dec.decode(pt);
    memory.set(accountId, token);
    return token;
  } catch {
    return null;
  }
}

export function forget(accountId: string): void {
  memory.delete(accountId);
}

/** Destroys the master key. Used when the last account is removed. */
export async function destroyKey(): Promise<void> {
  memory.clear();
  keyPromise = null;
  await idb("readwrite", (s) => s.delete(KEY_ID));
}

export type { Sealed };
