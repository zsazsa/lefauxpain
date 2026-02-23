import { registerReadyHandler, registerEventHandler } from "../lib/appletRegistry";
import { registerSidebarApplet } from "../lib/appletComponents";
import { registerApplet, isAppletEnabled } from "../stores/applets";
import { registerCommands } from "../components/Terminal/commandRegistry";
import { registerCommandHandler } from "../components/Terminal/commandExecutor";
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

// Commands
registerCommands([
  { name: "patterns", description: "List all patterns", category: "strudel" },
  { name: "pattern-new", description: "Create a new pattern", category: "strudel", args: "<name>" },
  { name: "pattern-open", description: "Open a pattern by name", category: "strudel", args: "<name>" },
  { name: "pattern-play", description: "Play current pattern", category: "strudel" },
  { name: "pattern-stop", description: "Stop current pattern", category: "strudel" },
  { name: "pattern-visibility", description: "Set pattern visibility", category: "strudel", args: "<private|public|open>" },
  { name: "pattern-delete", description: "Delete current pattern", category: "strudel" },
]);

// Command handlers
registerCommandHandler("patterns", (_args, ctx) => {
  if (!isFeatureEnabled("strudel")) {
    ctx.setStatus("Strudel is not enabled");
    return;
  }
  ctx.openDialog("patterns");
});

registerCommandHandler("pattern-new", (args, ctx) => {
  if (!isFeatureEnabled("strudel")) {
    ctx.setStatus("Strudel is not enabled");
    return;
  }
  const pname = args.trim();
  if (!pname) {
    ctx.setStatus("Usage: /pattern-new <name>");
    return;
  }
  send("create_strudel_pattern", { name: pname });
});

registerCommandHandler("pattern-open", (args, ctx) => {
  if (!isFeatureEnabled("strudel")) {
    ctx.setStatus("Strudel is not enabled");
    return;
  }
  const pname = args.trim();
  if (!pname) {
    ctx.openDialog("patterns");
    return;
  }
  const pat = strudelPatterns().find(
    (p) => p.name.toLowerCase() === pname.toLowerCase()
  );
  if (pat) {
    setActivePatternId(pat.id);
  } else {
    ctx.setStatus(`Pattern "${pname}" not found`);
  }
});

registerCommandHandler("pattern-play", (_args, ctx) => {
  const pid = activePatternId();
  if (!pid) {
    ctx.setStatus("No pattern open");
    return;
  }
  send("strudel_play", { pattern_id: pid });
});

registerCommandHandler("pattern-stop", (_args, ctx) => {
  const pid = activePatternId();
  if (!pid) {
    ctx.setStatus("No pattern open");
    return;
  }
  send("strudel_stop", { pattern_id: pid });
});

registerCommandHandler("pattern-visibility", (args, ctx) => {
  const pid = activePatternId();
  if (!pid) {
    ctx.setStatus("No pattern open");
    return;
  }
  const vis = args.trim();
  if (!["private", "public", "open"].includes(vis)) {
    ctx.setStatus("Usage: /pattern-visibility <private|public|open>");
    return;
  }
  send("update_strudel_pattern", { pattern_id: pid, visibility: vis });
});

registerCommandHandler("pattern-delete", (_args, ctx) => {
  const pid = activePatternId();
  if (!pid) {
    ctx.setStatus("No pattern open");
    return;
  }
  const pat = strudelPatterns().find((p) => p.id === pid);
  if (pat && confirm(`Delete pattern "${pat.name}"?`)) {
    send("delete_strudel_pattern", { pattern_id: pid });
  }
});
