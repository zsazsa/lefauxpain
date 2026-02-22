import { createSignal, For, Show, onMount, onCleanup } from "solid-js";
import { notifications, markRead, markAllRead } from "../../../stores/notifications";
import { setSelectedChannelId } from "../../../stores/channels";
import { setScrollToMessageId } from "../../../stores/messages";
import TerminalDialog from "../TerminalDialog";

interface NotificationsDialogProps {
  onClose: () => void;
}

export default function NotificationsDialog(props: NotificationsDialogProps) {
  const [selectedIdx, setSelectedIdx] = createSignal(0);

  const handleClick = (n: typeof notifications extends () => (infer T)[] ? T : never) => {
    markRead(n.id);
    // Navigate to channel/message if applicable
    if (n.data.channel_id) {
      setSelectedChannelId(n.data.channel_id);
      if (n.data.message_id) {
        setScrollToMessageId(n.data.message_id);
      }
    }
    props.onClose();
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    const list = notifications();
    if (!list.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      e.stopPropagation();
      setSelectedIdx((i) => Math.min(i + 1, list.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      setSelectedIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      const n = list[selectedIdx()];
      if (n) handleClick(n);
    }
  };

  onMount(() => document.addEventListener("keydown", handleKeyDown, true));
  onCleanup(() => document.removeEventListener("keydown", handleKeyDown, true));

  return (
    <TerminalDialog title="NOTIFICATIONS" onClose={props.onClose}>
      <Show when={notifications().length > 0} fallback={
        <div style={{ color: "var(--text-muted)", "font-size": "12px", padding: "8px 0" }}>
          No notifications
        </div>
      }>
        <div style={{
          display: "flex",
          "justify-content": "flex-end",
          "margin-bottom": "6px",
        }}>
          <button
            onClick={() => markAllRead()}
            style={{
              "font-size": "11px",
              color: "var(--accent)",
              padding: "2px 6px",
            }}
          >
            [mark all read]
          </button>
        </div>
        <For each={notifications()}>
          {(n, i) => (
            <div
              onClick={() => handleClick(n)}
              onMouseOver={() => setSelectedIdx(i())}
              style={{
                padding: "4px 8px",
                cursor: "pointer",
                "font-size": "12px",
                color: n.read ? "var(--text-muted)" : "var(--text-primary)",
                "background-color": i() === selectedIdx()
                  ? "var(--accent-glow)"
                  : n.read ? "transparent" : "rgba(201, 168, 76, 0.08)",
                "margin-bottom": "2px",
                display: "flex",
                "align-items": "center",
                gap: "6px",
              }}
            >
              <Show when={!n.read}>
                <span style={{
                  width: "6px",
                  height: "6px",
                  "border-radius": "50%",
                  "background-color": "var(--accent)",
                  "flex-shrink": "0",
                }} />
              </Show>
              <span>
                {n.type === "mention" && (
                  <span>
                    <span style={{ color: "var(--cyan)" }}>@{n.data.from_username}</span>
                    {" mentioned you"}
                    {n.data.channel_name && (
                      <span style={{ color: "var(--text-muted)" }}> in #{n.data.channel_name}</span>
                    )}
                  </span>
                )}
                {n.type === "admin_knock" && (
                  <span>
                    <span style={{ color: "var(--accent)" }}>{n.data.username}</span>
                    {" is requesting access"}
                  </span>
                )}
                {n.type !== "mention" && n.type !== "admin_knock" && (
                  <span>{n.type}: {JSON.stringify(n.data)}</span>
                )}
              </span>
            </div>
          )}
        </For>
      </Show>
    </TerminalDialog>
  );
}
