import { For, Show, onMount, onCleanup } from "solid-js";
import { notifications, unreadCount, markRead, markAllRead } from "../../stores/notifications";
import { setSelectedChannelId } from "../../stores/channels";
import { setScrollToMessageId } from "../../stores/messages";
import { send } from "../../lib/ws";
import { lookupUsername } from "../../stores/users";
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

function resolveMentions(text: string): string {
  return text.replace(/<@([0-9a-fA-F-]{36})>/g, (_, id) => {
    const name = lookupUsername(id);
    return name ? `@${name}` : "@unknown";
  });
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
        border: "1px solid var(--border-gold)",
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
          "border-bottom": "1px solid var(--border-gold)",
        }}
      >
        <div style={{ display: "flex", "align-items": "center", gap: "12px" }}>
          <Show when={isMobile()}>
            <button
              onClick={props.onClose}
              style={{
                "font-size": "14px",
                color: "var(--accent)",
                padding: "0 4px",
              }}
            >
              [{"\u2190"}]
            </button>
          </Show>
          <span style={{
            "font-family": "var(--font-display)",
            "font-size": isMobile() ? "14px" : "12px",
            "font-weight": "600",
            color: "var(--accent)",
            "letter-spacing": "1px",
          }}>
            Avis
          </span>
        </div>
        <Show when={unreadCount() > 0}>
          <button
            onClick={handleMarkAllRead}
            style={{
              "font-size": "11px",
              color: "var(--cyan)",
              padding: "2px 6px",
            }}
          >
            [mark all read]
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
              "font-size": "12px",
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
                "border-left": notif.read
                  ? "2px solid transparent"
                  : "2px solid var(--cyan)",
                "background-color": "transparent",
              }}
              onMouseOver={(e) =>
                (e.currentTarget.style.backgroundColor = "var(--accent-glow)")
              }
              onMouseOut={(e) =>
                (e.currentTarget.style.backgroundColor = "transparent")
              }
            >
              <div
                style={{
                  "font-size": "12px",
                  color: "var(--text-primary)",
                  "line-height": "1.4",
                }}
              >
                <span style={{ color: "var(--cyan)" }}>@{notif.author.username}</span>{" "}
                <span style={{ color: "var(--text-muted)" }}>
                  mentioned you in{" "}
                </span>
                <span style={{ color: "var(--accent)" }}>#{notif.channel_name}</span>
              </div>
              <Show when={notif.content_preview}>
                <div
                  style={{
                    "font-size": "11px",
                    color: "var(--text-muted)",
                    "margin-top": "2px",
                    overflow: "hidden",
                    "text-overflow": "ellipsis",
                    "white-space": "nowrap",
                  }}
                >
                  {resolveMentions(notif.content_preview!)}
                </div>
              </Show>
              <div
                style={{
                  "font-size": "10px",
                  color: "var(--text-muted)",
                  "margin-top": "2px",
                }}
              >
                {formatRelativeTime(notif.created_at)}
              </div>
            </div>
          )}
        </For>
      </Show>
    </div>
  );
}
