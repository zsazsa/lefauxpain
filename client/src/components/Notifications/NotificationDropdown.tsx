import { For, Show, onMount, onCleanup } from "solid-js";
import { notifications, unreadCount, markRead, markAllRead } from "../../stores/notifications";
import { setSelectedChannelId } from "../../stores/channels";
import { setScrollToMessageId } from "../../stores/messages";
import { send } from "../../lib/ws";
import { isMobile } from "../../stores/responsive";

interface NotificationDropdownProps {
  anchorRef: HTMLElement;
  onClose: () => void;
}

function formatRelativeTime(dateStr: string): string {
  const normalized = dateStr.replace(" ", "T");
  const d = new Date(normalized.endsWith("Z") ? normalized : normalized + "Z");
  const now = Date.now();
  const diffMs = now - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

export default function NotificationDropdown(props: NotificationDropdownProps) {
  // Close on click outside
  const handleClickOutside = (e: MouseEvent) => {
    const target = e.target as Node;
    if (dropdownRef && !dropdownRef.contains(target) && !props.anchorRef.contains(target)) {
      props.onClose();
    }
  };
  onMount(() => document.addEventListener("mousedown", handleClickOutside));
  onCleanup(() => document.removeEventListener("mousedown", handleClickOutside));

  let dropdownRef: HTMLDivElement | undefined;

  // Position below the anchor
  const getPosition = () => {
    const rect = props.anchorRef.getBoundingClientRect();
    return { top: rect.bottom + "px", left: rect.left + "px" };
  };

  const handleClick = (notif: typeof notifications extends () => (infer T)[] ? T : never) => {
    // Mark as read
    if (!notif.read) {
      markRead(notif.id);
      send("mark_notification_read", { id: notif.id });
    }
    // Navigate to channel + message
    setSelectedChannelId(notif.channel_id);
    setScrollToMessageId(notif.message_id);
    props.onClose();
  };

  const handleMarkAllRead = () => {
    markAllRead();
    send("mark_all_notifications_read", {});
  };

  return (
    <div
      ref={dropdownRef}
      style={isMobile() ? {
        position: "fixed",
        inset: "0",
        "background-color": "var(--bg-secondary)",
        "z-index": "1000",
        overflow: "auto",
      } : {
        position: "fixed",
        top: getPosition().top,
        left: getPosition().left,
        width: "360px",
        "background-color": "var(--bg-secondary)",
        "border-radius": "0 0 4px 4px",
        "box-shadow": "0 4px 12px rgba(0,0,0,0.4)",
        "z-index": "1000",
        "max-height": "400px",
        overflow: "auto",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          "align-items": "center",
          "justify-content": "space-between",
          padding: isMobile() ? "12px 16px" : "8px 12px",
          "border-bottom": "1px solid var(--bg-primary)",
          "font-size": isMobile() ? "16px" : "13px",
          "font-weight": "600",
        }}
      >
        <div style={{ display: "flex", "align-items": "center", gap: "12px" }}>
          <Show when={isMobile()}>
            <button
              onClick={props.onClose}
              style={{
                "font-size": "20px",
                color: "var(--text-secondary)",
                padding: "0 4px",
              }}
            >
              {"\u2190"}
            </button>
          </Show>
          <span style={{ color: "var(--text-primary)" }}>Notifications</span>
        </div>
        <Show when={unreadCount() > 0}>
          <button
            onClick={handleMarkAllRead}
            style={{
              "font-size": "12px",
              color: "var(--accent)",
              padding: "2px 6px",
            }}
          >
            Mark all read
          </button>
        </Show>
      </div>

      {/* Notification list */}
      <Show
        when={notifications().length > 0}
        fallback={
          <div
            style={{
              padding: "20px 12px",
              "text-align": "center",
              "font-size": "13px",
              color: "var(--text-muted)",
            }}
          >
            No notifications
          </div>
        }
      >
        <For each={notifications()}>
          {(notif) => (
            <div
              onClick={() => handleClick(notif)}
              style={{
                padding: "8px 12px",
                cursor: "pointer",
                display: "flex",
                gap: "8px",
                "align-items": "flex-start",
                "border-left": notif.read
                  ? "3px solid transparent"
                  : "3px solid var(--accent)",
                "background-color": "transparent",
              }}
              onMouseOver={(e) =>
                (e.currentTarget.style.backgroundColor = "var(--bg-tertiary)")
              }
              onMouseOut={(e) =>
                (e.currentTarget.style.backgroundColor = "transparent")
              }
            >
              {/* Author avatar */}
              <div
                style={{
                  width: "24px",
                  height: "24px",
                  "border-radius": "50%",
                  "background-color": "var(--accent)",
                  display: "flex",
                  "align-items": "center",
                  "justify-content": "center",
                  "font-size": "11px",
                  "font-weight": "700",
                  "flex-shrink": "0",
                  color: "white",
                  "margin-top": "2px",
                }}
              >
                {notif.author.username[0].toUpperCase()}
              </div>

              <div style={{ "min-width": "0", flex: "1" }}>
                <div
                  style={{
                    "font-size": "13px",
                    color: "var(--text-primary)",
                    "line-height": "1.3",
                  }}
                >
                  <strong>{notif.author.username}</strong>{" "}
                  <span style={{ color: "var(--text-secondary)" }}>
                    mentioned you in{" "}
                  </span>
                  <strong>#{notif.channel_name}</strong>
                </div>
                <Show when={notif.content_preview}>
                  <div
                    style={{
                      "font-size": "12px",
                      color: "var(--text-muted)",
                      "margin-top": "2px",
                      overflow: "hidden",
                      "text-overflow": "ellipsis",
                      "white-space": "nowrap",
                    }}
                  >
                    {notif.content_preview}
                  </div>
                </Show>
                <div
                  style={{
                    "font-size": "11px",
                    color: "var(--text-muted)",
                    "margin-top": "2px",
                  }}
                >
                  {formatRelativeTime(notif.created_at)}
                </div>
              </div>
            </div>
          )}
        </For>
      </Show>
    </div>
  );
}
