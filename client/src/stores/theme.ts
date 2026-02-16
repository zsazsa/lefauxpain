import { createSignal } from "solid-js";

export type ThemeId =
  | "french-gold"
  | "english-gold"
  | "french-cyan"
  | "english-cyan"
  | "french-green"
  | "english-green";

type Locale = "fr" | "en";

interface ThemeConfig {
  name: string;
  locale: Locale;
  palette: "gold" | "cyan" | "green";
}

const themes: Record<ThemeId, ThemeConfig> = {
  "french-gold":   { name: "French Mainframe Cyberpunk",  locale: "fr", palette: "gold" },
  "english-gold":  { name: "English Mainframe Cyberpunk", locale: "en", palette: "gold" },
  "french-cyan":   { name: "French Neon Cyberpunk",       locale: "fr", palette: "cyan" },
  "english-cyan":  { name: "English Neon Cyberpunk",      locale: "en", palette: "cyan" },
  "french-green":  { name: "French Matrix Terminal",      locale: "fr", palette: "green" },
  "english-green": { name: "English Matrix Terminal",     locale: "en", palette: "green" },
};

type TranslationKey =
  | "appName"
  | "online"
  | "voiceChannels"
  | "textChannels"
  | "members"
  | "notifications"
  | "settings"
  | "openChannels"
  | "selectChannel"
  | "pageTitle";

const translations: Record<Locale, Record<TranslationKey, string>> = {
  fr: {
    appName: "Le Faux Pain",
    online: "en ligne",
    voiceChannels: "Canaux Vocaux",
    textChannels: "Canaux Texte",
    members: "Membres",
    notifications: "Avis",
    settings: "Param\u00e8tres",
    openChannels: "open canaux",
    selectChannel: "// select a channel to begin",
    pageTitle: "Le Faux Pain",
  },
  en: {
    appName: "The Fake Bread",
    online: "online",
    voiceChannels: "Voice Channels",
    textChannels: "Text Channels",
    members: "Members",
    notifications: "Notifications",
    settings: "Settings",
    openChannels: "open channels",
    selectChannel: "// select a channel to begin",
    pageTitle: "The Fake Bread",
  },
};

const paletteVars: Record<string, Record<string, string>> = {
  cyan: {
    "--accent": "#4de8e0",
    "--accent-hover": "#3ab8b2",
    "--accent-glow": "rgba(77,232,224,0.15)",
    "--border-gold": "rgba(77,232,224,0.25)",
  },
  green: {
    "--accent": "#39ff14",
    "--accent-hover": "#2ecc10",
    "--accent-glow": "rgba(57,255,20,0.15)",
    "--border-gold": "rgba(57,255,20,0.25)",
  },
};

const STORAGE_KEY = "voicechat-theme";

const stored = localStorage.getItem(STORAGE_KEY) as ThemeId | null;
const initial: ThemeId = stored && stored in themes ? stored : "french-gold";

const [theme, setThemeSignal] = createSignal<ThemeId>(initial);

export function t(key: TranslationKey): string {
  const cfg = themes[theme()];
  return translations[cfg.locale][key];
}

export function themeName(): string {
  return themes[theme()].name;
}

export function applyTheme(id?: ThemeId) {
  const themeId = id ?? theme();
  const cfg = themes[themeId];
  const el = document.documentElement;

  // Remove previous palette overrides
  const allVars = ["--accent", "--accent-hover", "--accent-glow", "--border-gold"];
  for (const v of allVars) {
    el.style.removeProperty(v);
  }

  // Apply new palette if not gold (gold uses :root defaults)
  const vars = paletteVars[cfg.palette];
  if (vars) {
    for (const [prop, val] of Object.entries(vars)) {
      el.style.setProperty(prop, val);
    }
  }

  document.title = translations[cfg.locale].pageTitle;
}

export function setTheme(id: ThemeId) {
  setThemeSignal(id);
  localStorage.setItem(STORAGE_KEY, id);
  applyTheme(id);
}

export { theme };
export { themes };
