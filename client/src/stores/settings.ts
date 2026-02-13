import { createSignal } from "solid-js";

export type AppSettings = {
  masterVolume: number; // 0.0 - 2.0
  micGain: number; // 0.0 - 2.0
  inputDeviceId: string; // "" = default
  outputDeviceId: string; // "" = default
};

const defaults: AppSettings = {
  masterVolume: 1.0,
  micGain: 1.0,
  inputDeviceId: "",
  outputDeviceId: "",
};

function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem("settings");
    if (raw) return { ...defaults, ...JSON.parse(raw) };
  } catch {}
  return { ...defaults };
}

const [settings, setSettingsSignal] = createSignal<AppSettings>(loadSettings());
const [settingsOpen, setSettingsOpen] = createSignal(false);

export { settings, settingsOpen, setSettingsOpen };

export function updateSettings(partial: Partial<AppSettings>) {
  setSettingsSignal((prev) => {
    const next = { ...prev, ...partial };
    localStorage.setItem("settings", JSON.stringify(next));
    return next;
  });
}
