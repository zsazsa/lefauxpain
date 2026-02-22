import { createSignal, For, Show } from "solid-js";
import {
  strudelPatterns,
  strudelPlayback,
  setActivePatternId,
  activePatternId,
  getPatternViewers,
} from "../../stores/strudel";
import { currentUser } from "../../stores/auth";
import { lookupUsername } from "../../stores/users";
import { send } from "../../lib/ws";
import { isMobile, setSidebarOpen } from "../../stores/responsive";

export default function StrudelSidebar() {
  const [creating, setCreating] = createSignal(false);
  const [newName, setNewName] = createSignal("");

  const handleCreate = () => {
    const name = newName().trim();
    if (!name) return;
    send("create_strudel_pattern", { name });
    setNewName("");
    setCreating(false);
  };

  const visibilityIcon = (v: string) => {
    switch (v) {
      case "private": return "\u{1F512}"; // lock
      case "open": return "\u270E"; // pencil
      default: return "\u{1F441}"; // eye for public
    }
  };

  return (
    <>
      <div
        style={{
          padding: "8px 16px 4px",
          "font-family": "var(--font-display)",
          "font-size": "11px",
          "font-weight": "600",
          "text-transform": "uppercase",
          "letter-spacing": "2px",
          color: "var(--text-muted)",
          "margin-top": "8px",
          display: "flex",
          "align-items": "center",
          "justify-content": "space-between",
        }}
      >
        PATTERNS
        <button
          onClick={() => setCreating((v) => !v)}
          style={{
            "font-size": "14px",
            color: "var(--text-muted)",
            padding: "0 2px",
            "line-height": "1",
          }}
          title="Create pattern"
        >
          {creating() ? "-" : "+"}
        </button>
      </div>

      <Show when={creating()}>
        <div style={{ padding: "4px 16px 4px 24px" }}>
          <input
            value={newName()}
            onInput={(e) => setNewName(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreate();
              if (e.key === "Escape") setCreating(false);
            }}
            placeholder="Pattern name..."
            autofocus
            style={{
              width: "100%",
              padding: "4px 8px",
              "font-size": "12px",
              "background-color": "var(--bg-primary)",
              color: "var(--text-primary)",
              border: "1px solid var(--border-gold)",
            }}
          />
        </div>
      </Show>

      <For each={strudelPatterns()}>
        {(pattern) => {
          const isPlaying = () => !!strudelPlayback()[pattern.id];
          const isActive = () => activePatternId() === pattern.id;
          const viewerCount = () => getPatternViewers(pattern.id).length;
          const isOwner = () => currentUser()?.id === pattern.owner_id;

          // Only show private patterns to owner
          const visible = () => pattern.visibility !== "private" || isOwner();

          return (
            <Show when={visible()}>
              <div
                onClick={() => {
                  setActivePatternId(pattern.id);
                  if (isMobile()) setSidebarOpen(false);
                }}
                style={{
                  display: "flex",
                  "align-items": "center",
                  "justify-content": "space-between",
                  padding: "3px 16px 3px 24px",
                  cursor: "pointer",
                  "font-size": "12px",
                  color: isActive()
                    ? "var(--accent)"
                    : isPlaying()
                      ? "var(--success)"
                      : "var(--text-secondary)",
                  "background-color": isActive() ? "var(--accent-glow)" : "transparent",
                }}
              >
                <div
                  style={{
                    overflow: "hidden",
                    "text-overflow": "ellipsis",
                    "white-space": "nowrap",
                    flex: "1",
                    "min-width": "0",
                  }}
                >
                  <span>
                    {isPlaying() ? "\u25B6 " : "\u25B7 "}
                    {pattern.name}
                  </span>
                  <span
                    style={{ "font-size": "9px", "margin-left": "4px", opacity: "0.6" }}
                    title={pattern.visibility}
                  >
                    {visibilityIcon(pattern.visibility)}
                  </span>
                </div>
                <Show when={viewerCount() > 0}>
                  <span
                    style={{
                      "font-size": "9px",
                      color: "var(--text-muted)",
                      "flex-shrink": "0",
                      "margin-left": "4px",
                      "white-space": "nowrap",
                    }}
                    title={`${viewerCount()} viewer${viewerCount() !== 1 ? "s" : ""}`}
                  >
                    {"\u2301"}{viewerCount()}
                  </span>
                </Show>
              </div>
            </Show>
          );
        }}
      </For>

      <Show when={strudelPatterns().length === 0 && !creating()}>
        <div
          style={{
            padding: "4px 24px",
            "font-size": "11px",
            color: "var(--text-muted)",
            "font-style": "italic",
          }}
        >
          No patterns yet
        </div>
      </Show>
    </>
  );
}
