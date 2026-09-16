import { createSignal } from "solid-js";

// Build identifier of this client bundle.
export const clientVersion: string = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev";

// Set when the server reports a different build and an automatic reload has
// already been attempted for it, so the user gets a manual prompt instead of
// a reload loop.
const [staleVersion, setStaleVersion] = createSignal<string | null>(null);
export { staleVersion };

const RELOAD_KEY = "reloaded_for_version";

/**
 * Called with the server's build identifier (from `ready`). If it differs
 * from ours, reload once; if we already reloaded for this exact version and
 * still differ (e.g. a proxy served a cached bundle), show a banner instead.
 */
export function checkServerVersion(serverVersion: string | undefined) {
  if (!serverVersion || serverVersion === "dev" || clientVersion === "dev") return;
  if (serverVersion === clientVersion) {
    setStaleVersion(null);
    try { sessionStorage.removeItem(RELOAD_KEY); } catch {}
    return;
  }
  let already = "";
  try { already = sessionStorage.getItem(RELOAD_KEY) || ""; } catch {}
  if (already === serverVersion) {
    setStaleVersion(serverVersion);
    return;
  }
  try { sessionStorage.setItem(RELOAD_KEY, serverVersion); } catch {}
  window.location.reload();
}

/** Reload after a lazy chunk failed to load (assets replaced by a deploy). */
export function reloadForMissingChunk() {
  const key = "reloaded_for_chunk";
  let already = "";
  try { already = sessionStorage.getItem(key) || ""; } catch {}
  if (already === clientVersion) return; // don't loop if the reload didn't help
  try { sessionStorage.setItem(key, clientVersion); } catch {}
  window.location.reload();
}
