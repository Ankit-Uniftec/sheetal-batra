// ============================================================
// A local snapshot of the dashboard's data, kept in this browser's own
// database (IndexedDB) so the dashboard opens instantly: it shows the last
// snapshot at once and refreshes from the server in the background.
//
// What is stored: the production columns of orders (no money, no client
// phone or address: those columns are never loaded by this dashboard), the
// pieces, vendor names and the small data sets Today reads. It is kept per
// login and deleted on log out. Nothing here is ever written back to the
// server; the server stays the only source of truth.
// ============================================================

const DB = "sb-production-manager";
const STORE = "snapshots";
const VERSION = 1;
// A snapshot older than this is not shown: the floor moves too much in a day.
export const MAX_AGE_MS = 24 * 60 * 60 * 1000;

function open() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") { reject(new Error("no indexedDB")); return; }
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run(mode, fn) {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const out = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(out && "result" in out ? out.result : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}

const keyFor = (email) => `pm:${String(email || "").toLowerCase()}`;

// A small flag, readable instantly at start-up, that a snapshot exists on this
// browser: the dashboard then opens straight onto its frame instead of the
// logo screen while the login is checked.
const FLAG = "sb-pm-snapshot";
export const hasSnapshotFlag = () => { try { return localStorage.getItem(FLAG) === "1"; } catch { return false; } };
const setFlag = (on) => { try { if (on) localStorage.setItem(FLAG, "1"); else localStorage.removeItem(FLAG); } catch { /* storage blocked */ } };

/** The saved snapshot for this login, or null (missing, too old or unreadable). */
export async function readSnapshot(email) {
  try {
    const snap = await run("readonly", (s) => s.get(keyFor(email)));
    if (!snap || !snap.savedAt || Date.now() - snap.savedAt > MAX_AGE_MS) { if (!snap) setFlag(false); return null; }
    return snap;
  } catch { return null; }
}

/** Save the snapshot; failures are ignored (the dashboard works without it). */
export async function writeSnapshot(email, data) {
  try { await run("readwrite", (s) => s.put({ ...data, savedAt: Date.now() }, keyFor(email))); setFlag(true); } catch { /* storage full or blocked */ }
}

/** Delete every snapshot on this browser (on log out). */
export async function clearSnapshots() {
  setFlag(false);
  try { await run("readwrite", (s) => s.clear()); } catch { /* nothing to clear */ }
}
