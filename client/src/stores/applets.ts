import { createSignal } from "solid-js";

export type Applet = { id: string; name: string };

const appletList: Applet[] = [];

export function registerApplet(applet: Applet) {
  if (!appletList.some((a) => a.id === applet.id)) {
    appletList.push(applet);
  }
}

// Dynamic list — populated by applet self-registration
export const APPLETS = appletList;

const STORAGE_KEY = "applet_prefs";

function loadPrefs(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  // Default: all enabled (unrecognized applets default to true via isAppletEnabled)
  return {};
}

function savePrefs(prefs: Record<string, boolean>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
}

const [appletPrefs, setAppletPrefs] = createSignal<Record<string, boolean>>(loadPrefs());

export function isAppletEnabled(id: string): boolean {
  return appletPrefs()[id] !== false;
}

export function toggleApplet(id: string) {
  setAppletPrefs((prev) => {
    const next = { ...prev, [id]: !prev[id] };
    savePrefs(next);
    return next;
  });
}

export { appletPrefs };
