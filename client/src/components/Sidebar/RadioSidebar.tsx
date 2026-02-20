import { createSignal, For, Show } from "solid-js";
import { radioStations, radioStatus, setTunedStationId, getStationListeners } from "../../stores/radio";
import { lookupUsername } from "../../stores/users";
import { send } from "../../lib/ws";
import { isMobile, setSidebarOpen } from "../../stores/responsive";

export default function RadioSidebar() {
  const [creating, setCreating] = createSignal(false);
  const [newName, setNewName] = createSignal("");

  const handleCreate = () => {
    const name = newName().trim();
    if (!name) return;
    send("create_radio_station", { name });
    setNewName("");
    setCreating(false);
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
        RADIO
        <button
          onClick={() => setCreating((v) => !v)}
          style={{
            "font-size": "14px",
            color: "var(--text-muted)",
            padding: "0 2px",
            "line-height": "1",
          }}
          title="Create station"
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
            placeholder="Station name..."
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

      <For each={radioStations()}>
        {(station) => {
          const status = () => radioStatus()[station.id];
          const isActive = () => !!status();
          const djName = () => {
            const s = status();
            return s ? lookupUsername(s.user_id) || "DJ" : null;
          };
          const listenerCount = () => getStationListeners(station.id).length;

          return (
            <div
              onClick={() => {
                setTunedStationId(station.id);
                if (isMobile()) setSidebarOpen(false);
              }}
              style={{
                display: "flex",
                "align-items": "center",
                "justify-content": "space-between",
                padding: "3px 16px 3px 24px",
                cursor: "pointer",
                "font-size": "12px",
                color: isActive() ? "var(--accent)" : "var(--text-secondary)",
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
                <span>{isActive() ? "\u266B " : "\u266A "}{station.name}</span>
                <Show when={isActive()}>
                  <div
                    style={{
                      "font-size": "10px",
                      color: "var(--text-muted)",
                      overflow: "hidden",
                      "text-overflow": "ellipsis",
                      "white-space": "nowrap",
                    }}
                  >
                    {status()!.track_name || "Playing"} — {djName()}
                  </div>
                </Show>
              </div>
              <Show when={listenerCount() > 0}>
                <span
                  style={{
                    "font-size": "9px",
                    color: "var(--text-muted)",
                    "flex-shrink": "0",
                    "margin-left": "4px",
                    "white-space": "nowrap",
                  }}
                  title={`${listenerCount()} listener${listenerCount() !== 1 ? "s" : ""}`}
                >
                  ⌁{listenerCount()}
                </span>
              </Show>
            </div>
          );
        }}
      </For>

      <Show when={radioStations().length === 0 && !creating()}>
        <div
          style={{
            padding: "4px 24px",
            "font-size": "11px",
            color: "var(--text-muted)",
            "font-style": "italic",
          }}
        >
          No stations yet
        </div>
      </Show>
    </>
  );
}
