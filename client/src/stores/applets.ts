import { createSignal } from "solid-js";

export type Applet = { id: string; name: string };

export const APPLETS: Applet[] = [
  { id: "media", name: "Media Library" },
  { id: "radio", name: "Radio Stations" },
  { id: "strudel", name: "Patterns (Strudel)" },
];

const STORAGE_KEY = "applet_prefs";

function loadPrefs(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  // Default: all enabled
  const defaults: Record<string, boolean> = {};
  for (const a of APPLETS) defaults[a.id] = true;
  return defaults;
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
