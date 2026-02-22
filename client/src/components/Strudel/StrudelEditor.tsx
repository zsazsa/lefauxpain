import { createSignal, createEffect, on, Show, For, onCleanup } from "solid-js";
import {
  strudelPatterns,
  strudelPlayback,
  setActivePatternId,
  getPatternViewers,
  getPatternPlayback,
  updateStrudelPattern,
} from "../../stores/strudel";
import { currentUser } from "../../stores/auth";
import { lookupUsername } from "../../stores/users";
import { send } from "../../lib/ws";
import { serverNow } from "../../stores/radio";
import StrudelReplWrapper, { type StrudelReplHandle } from "./StrudelReplWrapper";

interface Props {
  patternId: string;
}

export default function StrudelEditor(props: Props) {
  const pattern = () => strudelPatterns().find((p) => p.id === props.patternId);
  const playback = () => getPatternPlayback(props.patternId);
  const viewers = () => getPatternViewers(props.patternId);
  const isOwner = () => currentUser()?.id === pattern()?.owner_id;
  const canEdit = () => isOwner() || pattern()?.visibility === "open";

  const [handle, setHandle] = createSignal<StrudelReplHandle | null>(null);
  const [localCode, setLocalCode] = createSignal("");
  const [cps, setCps] = createSignal(0.5);

  // Editing state
  const [editingName, setEditingName] = createSignal(false);
  const [nameInput, setNameInput] = createSignal("");

  // Debounce timer for code edits
  let codeEditTimer: number | undefined;
  onCleanup(() => clearTimeout(codeEditTimer));

  // Track if we're applying remote code to avoid feedback loops
  let applyingRemote = false;

  const handleCodeChange = (code: string) => {
    if (applyingRemote) return;
    setLocalCode(code);

    if (canEdit()) {
      clearTimeout(codeEditTimer);
      codeEditTimer = window.setTimeout(() => {
        send("strudel_code_edit", { pattern_id: props.patternId, code });
      }, 200);
    }
  };

  // Receive remote code sync
  createEffect(on(
    () => pattern()?.code,
    (newCode) => {
      if (newCode === undefined) return;
      const h = handle();
      if (!h) return;
      // Only apply if different from what we have locally
      if (newCode !== h.getCode()) {
        applyingRemote = true;
        h.setCode(newCode);
        applyingRemote = false;
      }
    }
  ));

  // Receive remote playback
  createEffect(on(playback, (pb) => {
    const h = handle();
    if (!h) return;
    if (pb && pb.playing) {
      h.setCode(pb.code);
      h.setCps(pb.cps);
      h.evaluate().catch(() => {});
    } else if (!pb) {
      h.stop().catch(() => {});
    }
  }));

  const handlePlay = () => {
    const h = handle();
    if (!h) return;
    send("strudel_play", { pattern_id: props.patternId, cps: cps() });
  };

  const handleStop = () => {
    send("strudel_stop", { pattern_id: props.patternId });
  };

  const handleRename = () => {
    const name = nameInput().trim();
    if (name && name !== pattern()?.name) {
      send("update_strudel_pattern", { pattern_id: props.patternId, name });
    }
    setEditingName(false);
  };

  const handleVisibilityChange = (v: string) => {
    send("update_strudel_pattern", { pattern_id: props.patternId, visibility: v });
  };

  const handleDelete = () => {
    if (confirm(`Delete pattern "${pattern()?.name}"?`)) {
      send("delete_strudel_pattern", { pattern_id: props.patternId });
    }
  };

  const handleClose = () => {
    setActivePatternId(null);
  };

  const visibilityLabel = (v: string) => {
    switch (v) {
      case "private": return "private";
      case "open": return "open";
      default: return "public";
    }
  };

  return (
    <div style={{
      display: "flex",
      "flex-direction": "column",
      height: "100%",
      "background-color": "var(--bg-primary)",
    }}>
      {/* Header bar */}
      <div style={{
        display: "flex",
        "align-items": "center",
        "justify-content": "space-between",
        padding: "8px 16px",
        "border-bottom": "1px solid var(--border-gold)",
        "flex-shrink": "0",
        gap: "8px",
      }}>
        <div style={{ display: "flex", "align-items": "center", gap: "8px", flex: "1", "min-width": "0" }}>
          <button
            onClick={handleClose}
            style={{
              "font-size": "11px",
              color: "var(--text-muted)",
              padding: "2px 6px",
              "flex-shrink": "0",
            }}
            title="Close"
          >
            [x]
          </button>
          {editingName() ? (
            <input
              value={nameInput()}
              onInput={(e) => setNameInput(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleRename();
                if (e.key === "Escape") setEditingName(false);
              }}
              onBlur={handleRename}
              autofocus
              style={{
                "font-size": "13px",
                "font-weight": "600",
                color: "var(--accent)",
                "background-color": "var(--bg-secondary)",
                border: "1px solid var(--border-gold)",
                padding: "2px 6px",
                flex: "1",
                "min-width": "0",
              }}
            />
          ) : (
            <span
              onClick={() => {
                if (isOwner()) {
                  setNameInput(pattern()?.name || "");
                  setEditingName(true);
                }
              }}
              style={{
                "font-size": "13px",
                "font-weight": "600",
                color: "var(--accent)",
                cursor: isOwner() ? "pointer" : "default",
                overflow: "hidden",
                "text-overflow": "ellipsis",
                "white-space": "nowrap",
              }}
              title={isOwner() ? "Click to rename" : pattern()?.name}
            >
              {pattern()?.name || "Pattern"}
            </span>
          )}

          {/* Visibility badge */}
          <Show when={isOwner()}>
            <select
              value={pattern()?.visibility || "private"}
              onChange={(e) => handleVisibilityChange(e.currentTarget.value)}
              style={{
                "font-size": "10px",
                padding: "1px 4px",
                "background-color": "var(--bg-secondary)",
                color: "var(--text-muted)",
                border: "1px solid var(--border-gold)",
                "flex-shrink": "0",
              }}
            >
              <option value="private">private</option>
              <option value="public">public</option>
              <option value="open">open</option>
            </select>
          </Show>
          <Show when={!isOwner()}>
            <span style={{
              "font-size": "10px",
              color: "var(--text-muted)",
              padding: "1px 4px",
              border: "1px solid var(--border-gold)",
              "flex-shrink": "0",
            }}>
              {visibilityLabel(pattern()?.visibility || "private")}
            </span>
          </Show>

          {/* Owner name */}
          <span style={{
            "font-size": "11px",
            color: "var(--text-muted)",
            "flex-shrink": "0",
          }}>
            by {lookupUsername(pattern()?.owner_id || "") || "unknown"}
          </span>
        </div>

        {/* Controls */}
        <div style={{ display: "flex", "align-items": "center", gap: "6px", "flex-shrink": "0" }}>
          {/* CPS control */}
          <label style={{
            "font-size": "10px",
            color: "var(--text-muted)",
            display: "flex",
            "align-items": "center",
            gap: "4px",
          }}>
            CPS
            <input
              type="number"
              value={cps()}
              onInput={(e) => {
                const v = parseFloat(e.currentTarget.value);
                if (v > 0 && v <= 10) setCps(v);
              }}
              min="0.1"
              max="10"
              step="0.1"
              style={{
                width: "50px",
                "font-size": "10px",
                padding: "2px 4px",
                "background-color": "var(--bg-secondary)",
                color: "var(--text-primary)",
                border: "1px solid var(--border-gold)",
                "text-align": "center",
              }}
            />
          </label>

          {/* Play/Stop */}
          <Show when={playback()?.playing} fallback={
            <button
              onClick={handlePlay}
              style={{
                "font-size": "11px",
                padding: "2px 8px",
                color: "var(--success)",
                border: "1px solid var(--success)",
                "background-color": "transparent",
              }}
              title="Play"
            >
              [{"\u25B6"} play]
            </button>
          }>
            <button
              onClick={handleStop}
              style={{
                "font-size": "11px",
                padding: "2px 8px",
                color: "var(--danger)",
                border: "1px solid var(--danger)",
                "background-color": "transparent",
              }}
              title="Stop"
            >
              [{"\u25A0"} stop]
            </button>
          </Show>

          {/* Delete */}
          <Show when={isOwner() || currentUser()?.is_admin}>
            <button
              onClick={handleDelete}
              style={{
                "font-size": "11px",
                padding: "2px 6px",
                color: "var(--text-muted)",
              }}
              title="Delete pattern"
            >
              [del]
            </button>
          </Show>
        </div>
      </div>

      {/* Editor */}
      <div style={{ flex: "1", "min-height": "0", display: "flex", "flex-direction": "column" }}>
        <StrudelReplWrapper
          initialCode={pattern()?.code || ""}
          readOnly={!canEdit()}
          onCodeChange={handleCodeChange}
          onHandle={setHandle}
        />
      </div>

      {/* Status bar */}
      <div style={{
        display: "flex",
        "align-items": "center",
        "justify-content": "space-between",
        padding: "4px 16px",
        "border-top": "1px solid var(--border-gold)",
        "font-size": "10px",
        color: "var(--text-muted)",
        "flex-shrink": "0",
      }}>
        <span>
          {playback()?.playing ? (
            <span style={{ color: "var(--success)" }}>
              {"\u25CF"} Playing at {playback()?.cps || 0.5} CPS
            </span>
          ) : (
            <span>{"\u25CB"} Stopped</span>
          )}
          {canEdit() ? "" : " (read-only)"}
        </span>
        <Show when={viewers().length > 0}>
          <span>
            {viewers().length} viewer{viewers().length !== 1 ? "s" : ""}:
            {" "}
            {viewers().map((uid) => lookupUsername(uid) || "?").join(", ")}
          </span>
        </Show>
      </div>
    </div>
  );
}
