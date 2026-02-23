import { createSignal, createEffect, on, Show, onCleanup, onMount } from "solid-js";
import {
  strudelPatterns,
  strudelPlayback,
  setActivePatternId,
  getPatternViewers,
  getPatternPlayback,
} from "../../stores/strudel";
import { currentUser } from "../../stores/auth";
import { lookupUsername } from "../../stores/users";
import { send } from "../../lib/ws";

interface Props {
  patternId: string;
}

export default function StrudelEditor(props: Props) {
  const pattern = () => strudelPatterns().find((p) => p.id === props.patternId);
  const playback = () => getPatternPlayback(props.patternId);
  const viewers = () => getPatternViewers(props.patternId);
  const isOwner = () => currentUser()?.id === pattern()?.owner_id;
  const canEdit = () => isOwner() || pattern()?.visibility === "open";

  const [cps, setCps] = createSignal(0.5);
  const [sandboxReady, setSandboxReady] = createSignal(false);
  const [soundErrors, setSoundErrors] = createSignal<string[]>([]);

  // Editing state
  const [editingName, setEditingName] = createSignal(false);
  const [nameInput, setNameInput] = createSignal("");

  // Debounce timer for code edits
  let codeEditTimer: number | undefined;
  onCleanup(() => clearTimeout(codeEditTimer));

  // Track if we're applying remote code to avoid feedback loops
  let applyingRemote = false;
  let iframeRef: HTMLIFrameElement | undefined;
  // Track the last code we know the iframe has, for dedup
  let lastSentCode: string | undefined;

  const postToSandbox = (msg: any) => {
    if (iframeRef?.contentWindow) {
      iframeRef.contentWindow.postMessage(msg, "*");
    }
  };

  // Handle messages from the sandbox iframe
  const handleMessage = (event: MessageEvent) => {
    // Only accept messages from our iframe
    if (!iframeRef || event.source !== iframeRef.contentWindow) return;

    const { op } = event.data || {};
    switch (op) {
      case "ready":
        setSandboxReady(true);
        // Send initial code once sandbox is ready
        const p = pattern();
        if (p?.code) {
          postToSandbox({ op: "set_code", code: p.code });
          lastSentCode = p.code;
        }
        // If there's active playback, start it
        const pb = playback();
        if (pb?.playing) {
          postToSandbox({ op: "evaluate", code: pb.code, cps: pb.cps });
        }
        break;

      case "code_change":
        if (applyingRemote) return;
        lastSentCode = event.data.code;
        if (canEdit()) {
          clearTimeout(codeEditTimer);
          codeEditTimer = window.setTimeout(() => {
            send("strudel_code_edit", { pattern_id: props.patternId, code: event.data.code });
          }, 200);
        }
        break;

      case "state":
        // Playback state change from iframe — currently handled via WS
        break;

      case "error":
        console.warn("[strudel sandbox]", event.data.message);
        break;

      case "sound_error":
        setSoundErrors((prev) => prev.includes(event.data.sound) ? prev : [...prev, event.data.sound]);
        break;
    }
  };

  onMount(() => {
    window.addEventListener("message", handleMessage);
  });

  onCleanup(() => {
    window.removeEventListener("message", handleMessage);
  });

  // Receive remote code sync
  createEffect(on(
    () => pattern()?.code,
    (newCode) => {
      if (newCode === undefined || !sandboxReady()) return;
      // Only apply if different from what the iframe has
      if (newCode !== lastSentCode) {
        applyingRemote = true;
        postToSandbox({ op: "set_code", code: newCode });
        lastSentCode = newCode;
        applyingRemote = false;
      }
    }
  ));

  // Receive remote playback
  createEffect(on(playback, (pb) => {
    if (!sandboxReady()) return;
    if (pb && pb.playing) {
      postToSandbox({ op: "evaluate", code: pb.code, cps: pb.cps });
    } else if (!pb) {
      postToSandbox({ op: "stop" });
    }
  }));

  const handlePlay = () => {
    setSoundErrors([]);
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
          <a
            href="https://strudel.cc/workshop/getting-started/"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              "font-size": "11px",
              color: "var(--accent)",
              "text-decoration": "none",
              "flex-shrink": "0",
            }}
            title="Strudel getting started guide"
          >
            [learn]
          </a>
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

      {/* Sandboxed Strudel iframe */}
      <div style={{ flex: "1", "min-height": "0", display: "flex", "flex-direction": "column" }}>
        <iframe
          ref={iframeRef}
          src="/strudel-sandbox.html"
          sandbox="allow-scripts"
          style={{
            width: "100%",
            height: "100%",
            border: "none",
            flex: "1",
            "min-height": "0",
          }}
        />
      </div>

      {/* Sound errors */}
      <Show when={soundErrors().length > 0}>
        <div style={{
          padding: "4px 16px",
          "background-color": "rgba(244,67,54,0.1)",
          "border-top": "1px solid var(--danger)",
          "font-size": "10px",
          color: "var(--danger)",
          "flex-shrink": "0",
          display: "flex",
          "align-items": "center",
          "justify-content": "space-between",
        }}>
          <span>
            Sounds not found: {soundErrors().join(", ")}
          </span>
          <button
            onClick={() => setSoundErrors([])}
            style={{ "font-size": "10px", color: "var(--danger)", padding: "0 4px" }}
          >
            [x]
          </button>
        </div>
      </Show>

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
