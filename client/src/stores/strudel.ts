import { createSignal } from "solid-js";
import { send } from "../lib/ws";

export type StrudelPattern = {
  id: string;
  name: string;
  code: string;
  owner_id: string;
  visibility: string; // "private" | "public" | "open"
};

export type StrudelPlayback = {
  pattern_id: string;
  code: string;
  playing: boolean;
  started_at: number;
  cps: number;
  user_id: string;
};

// Enabled features (server-gated)
const [enabledFeatures, setEnabledFeatures] = createSignal<string[]>([]);

export function isFeatureEnabled(feature: string): boolean {
  return enabledFeatures().includes(feature);
}

export { enabledFeatures, setEnabledFeatures };

// Strudel patterns
const [strudelPatterns, setStrudelPatterns] = createSignal<StrudelPattern[]>([]);
const [strudelPlayback, setStrudelPlayback] = createSignal<Record<string, StrudelPlayback>>({});
const [strudelViewers, setStrudelViewers] = createSignal<Record<string, string[]>>({});
const [activePatternId, _setActivePatternId] = createSignal<string | null>(null);
// Whether the pattern editor is "in front" vs a channel
const [viewingPattern, setViewingPattern] = createSignal(false);

const setActivePatternId = (id: string | null) => {
  const prev = activePatternId();
  _setActivePatternId(id);
  setViewingPattern(!!id);
  if (id && id !== prev) {
    send("strudel_open", { pattern_id: id });
  } else if (!id && prev) {
    send("strudel_close", {});
  }
};

export {
  strudelPatterns,
  setStrudelPatterns,
  strudelPlayback,
  setStrudelPlayback,
  strudelViewers,
  setStrudelViewers,
  activePatternId,
  setActivePatternId,
  viewingPattern,
  setViewingPattern,
};

export function addStrudelPattern(pattern: StrudelPattern) {
  setStrudelPatterns((prev) => [...prev, pattern]);
}

export function removeStrudelPattern(patternId: string) {
  setStrudelPatterns((prev) => prev.filter((p) => p.id !== patternId));
  if (activePatternId() === patternId) {
    _setActivePatternId(null);
  }
}

export function updateStrudelPattern(id: string, updates: Partial<StrudelPattern>) {
  setStrudelPatterns((prev) =>
    prev.map((p) => {
      if (p.id !== id) return p;
      return { ...p, ...updates };
    })
  );
}

export function updateStrudelPlaybackForPattern(patternId: string, pb: StrudelPlayback | null) {
  setStrudelPlayback((prev) => {
    const next = { ...prev };
    if (pb) {
      next[patternId] = pb;
    } else {
      delete next[patternId];
    }
    return next;
  });
}

export function updateStrudelViewersForPattern(patternId: string, userIds: string[]) {
  setStrudelViewers((prev) => ({ ...prev, [patternId]: userIds }));
}

export function getPatternViewers(patternId: string): string[] {
  return strudelViewers()[patternId] || [];
}

export function getPatternPlayback(patternId: string): StrudelPlayback | null {
  return strudelPlayback()[patternId] || null;
}

export function toggleFeature(feature: string, enabled: boolean) {
  setEnabledFeatures((prev) => {
    if (enabled) {
      return prev.includes(feature) ? prev : [...prev, feature];
    } else {
      return prev.filter((f) => f !== feature);
    }
  });
}
