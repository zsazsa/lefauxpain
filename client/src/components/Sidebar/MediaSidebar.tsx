import { For, Show } from "solid-js";
import { mediaList, mediaPlayback, setWatchingMedia, setSelectedMediaId } from "../../stores/media";
import { deleteMedia } from "../../lib/api";
import { currentUser } from "../../stores/auth";
import { isMobile, setSidebarOpen } from "../../stores/responsive";

export default function MediaSidebar() {
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
        }}
      >
        MEDIA
      </div>
      <For each={mediaList()}>
        {(item) => {
          const isActive = () => mediaPlayback()?.video_id === item.id;
          return (
            <div
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
              <span
                onClick={() => {
                  setSelectedMediaId(item.id);
                  setWatchingMedia(true);
                  if (isMobile()) setSidebarOpen(false);
                }}
                style={{
                  overflow: "hidden",
                  "text-overflow": "ellipsis",
                  "white-space": "nowrap",
                  flex: "1",
                  "min-width": "0",
                }}
                title={item.filename}
              >
                {isActive() ? "\u25B6 " : "\u25B7 "}{item.filename}
              </span>
              <Show when={currentUser()?.is_admin}>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm(`Delete "${item.filename}"?`)) {
                      deleteMedia(item.id).catch(() => {});
                    }
                  }}
                  style={{
                    "font-size": "10px",
                    color: "var(--text-muted)",
                    padding: "0 4px",
                    "flex-shrink": "0",
                  }}
                >
                  [x]
                </button>
              </Show>
            </div>
          );
        }}
      </For>
    </>
  );
}
