// ============================================================
// After a deploy, a tab opened on the OLD version asks for code files
// ("chunks") that the new deploy replaced: "Loading chunk 3122 failed".
// importFresh() catches exactly that error and reloads the page ONCE, which
// loads the new version; the order screens keep their state in
// sessionStorage / history, so nothing in progress is lost.
// A second failure within a minute is not reloaded again (no reload loop):
// the error is shown instead.
// ============================================================

const KEY = "sbChunkReloadAt";

export const isChunkError = (err) =>
  !!err && (err.name === "ChunkLoadError" || /Loading (CSS )?chunk [\w-]+ failed/i.test(String(err.message || err)));

/** Reload into the new version unless this tab just did. @returns true if reloading */
export function reloadForNewVersion() {
  let last = 0;
  try { last = Number(sessionStorage.getItem(KEY) || 0); } catch { /* storage blocked */ }
  if (Date.now() - last < 60_000) return false;
  try { sessionStorage.setItem(KEY, String(Date.now())); } catch { /* storage blocked */ }
  window.location.reload();
  return true;
}

/** Wrap a dynamic import: import() as usual, reload once on a stale-chunk error. */
export async function importFresh(loader) {
  try {
    return await loader();
  } catch (err) {
    if (isChunkError(err) && reloadForNewVersion()) {
      // The page is reloading; never resolve so nothing renders half-way.
      return new Promise(() => {});
    }
    if (isChunkError(err)) {
      throw new Error("The app was updated. Please refresh the page (F5) and try again.");
    }
    throw err;
  }
}
