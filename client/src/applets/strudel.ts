import { registerReadyHandler, registerEventHandler } from "../lib/appletRegistry";
import { registerSidebarApplet } from "../lib/appletComponents";
import { registerApplet, isAppletEnabled } from "../stores/applets";
import { send } from "../lib/ws";
import StrudelSidebar from "../components/Sidebar/StrudelSidebar";
import {
  isFeatureEnabled,
  setStrudelPatterns,
  setStrudelPlayback,
  setStrudelViewers,
  addStrudelPattern,
  removeStrudelPattern,
  updateStrudelPattern,
  updateStrudelPlaybackForPattern,
  updateStrudelViewersForPattern,
  activePatternId,
  setActivePatternId,
  strudelPatterns,
} from "../stores/strudel";

// Register applet definition
registerApplet({ id: "strudel", name: "Patterns (Strudel)" });

// Register sidebar component
registerSidebarApplet({
  id: "strudel",
  component: StrudelSidebar,
  visible: () => isFeatureEnabled("strudel") && isAppletEnabled("strudel"),
});

// Ready handler
registerReadyHandler((data) => {
  setStrudelPatterns(data.strudel_patterns || []);
  {
    const pb = data.strudel_playback || {};
    const mapped: Record<string, any> = {};
    for (const [pid, state] of Object.entries(pb)) {
      if (state && !(state as any).stopped) {
        mapped[pid] = state;
      }
    }
    setStrudelPlayback(mapped);
  }
  setStrudelViewers(data.strudel_viewers || {});
  // Re-send strudel_open if we were viewing a pattern (e.g. after reconnect)
  {
    const pid = activePatternId();
    if (pid) send("strudel_open", { pattern_id: pid });
  }
});

// Event handlers
registerEventHandler("strudel_pattern_created", (d) => {
  addStrudelPattern(d);
});

registerEventHandler("strudel_pattern_updated", (d) => {
  updateStrudelPattern(d.id, d);
});

registerEventHandler("strudel_pattern_deleted", (d) => {
  removeStrudelPattern(d.pattern_id);
});

registerEventHandler("strudel_playback", (d) => {
  if (d && !d.stopped) {
    updateStrudelPlaybackForPattern(d.pattern_id, d);
  } else if (d) {
    updateStrudelPlaybackForPattern(d.pattern_id, null);
  }
});

registerEventHandler("strudel_viewers", (d) => {
  updateStrudelViewersForPattern(d.pattern_id, d.user_ids || []);
});

registerEventHandler("strudel_code_sync", (d) => {
  // Update the pattern's code in our local store
  updateStrudelPattern(d.pattern_id, { code: d.code });
});
