import { Show, For, createSignal } from "solid-js";
import type { Message } from "../../stores/messages";
import { setReplyingTo } from "../../stores/messages";
import { currentUser } from "../../stores/auth";
import { lookupUsername } from "../../stores/users";
import { send } from "../../lib/ws";
import { isMobile } from "../../stores/responsive";
import ReactionBar from "./ReactionBar";

interface MessageProps {
  message: Message;
  highlighted?: boolean;
}

function formatTime(dateStr: string): string {
  const normalized = dateStr.replace(" ", "T");
  const d = new Date(normalized.endsWith("Z") ? normalized : normalized + "Z");
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// Generate a consistent color for a username from a small royal palette
const USERNAME_COLORS = [
  "#c9a84c", // gold
  "#4de8e0", // cyan
  "#b48ade", // violet
  "#e88a9a", // rose
  "#6ecf8a", // emerald
  "#e0a060", // amber
  "#7ab8e0", // sky
  "#d4a0d4", // mauve
];

function usernameColor(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) | 0;
  }
  return USERNAME_COLORS[Math.abs(hash) % USERNAME_COLORS.length];
}

// Render content with mention highlighting
function renderContent(content: string): any {
  const mentionRe = /<@([0-9a-fA-F-]{36})>/g;
  const result: any[] = [];
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = mentionRe.exec(content)) !== null) {
    if (m.index > lastIndex) {
      result.push(content.slice(lastIndex, m.index));
    }
    const userId = m[1];
    const name = lookupUsername(userId) || "unknown";
    result.push(
      <span
        style={{
          "background-color": "var(--mention-bg)",
          color: "var(--mention-text)",
          padding: "0 3px",
        }}
      >
        @{name}
      </span>
    );
    lastIndex = mentionRe.lastIndex;
  }
  if (lastIndex < content.length) {
    result.push(content.slice(lastIndex));
  }
  return result.length > 0 ? result : content;
}

// Module-level signal: only one message shows actions at a time on mobile
const [activeMessageId, setActiveMessageId] = createSignal<string | null>(null);

export default function MessageItem(props: MessageProps) {
  const [hovered, setHovered] = createSignal(false);

  const handleDelete = () => {
    send("delete_message", { message_id: props.message.id });
  };

  const canDelete = () => {
    const user = currentUser();
    if (!user) return false;
    return props.message.author.id === user.id;
  };

  const showActions = () => {
    if (isMobile()) {
      return activeMessageId() === props.message.id;
    }
    return hovered();
  };

  const handleTap = () => {
    if (!isMobile()) return;
    setActiveMessageId((prev) =>
      prev === props.message.id ? null : props.message.id
    );
  };

  const handleActionClick = (e: MouseEvent, action: () => void) => {
    e.stopPropagation();
    action();
    if (isMobile()) setActiveMessageId(null);
  };

  const color = () => usernameColor(props.message.author.id);

  return (
    <div
      data-message-id={props.message.id}
      onMouseOver={() => { if (!isMobile()) setHovered(true); }}
      onMouseOut={() => { if (!isMobile()) setHovered(false); }}
      onClick={handleTap}
      style={{
        padding: isMobile() ? "1px 10px" : "1px 16px",
        position: "relative",
        "background-color": props.highlighted
          ? "rgba(201,168,76,0.1)"
          : hovered()
            ? "rgba(201,168,76,0.03)"
            : "transparent",
        "font-size": "13px",
        "line-height": "1.5",
      }}
    >
      {/* Reply connector */}
      <Show when={props.message.reply_to}>
        <div
          style={{
            color: "var(--text-muted)",
            "padding-left": "7ch",
            "font-size": "12px",
          }}
        >
          <span style={{ color: "var(--border-gold)" }}>{"\u2570\u2500"} </span>
          <span style={{ color: "var(--text-secondary)" }}>
            {props.message.reply_to!.author.username}:
          </span>{" "}
          {props.message.reply_to!.content?.slice(0, 60) || "[attachment]"}
          {(props.message.reply_to!.content?.length || 0) > 60 ? "..." : ""}
        </div>
      </Show>

      {/* Main message line: [time] username > content */}
      <div style={{ display: "flex", "align-items": "baseline", gap: "0" }}>
        <span style={{ color: "var(--text-muted)", "flex-shrink": "0" }}>
          [{formatTime(props.message.created_at)}]
        </span>
        <span style={{ color: color(), "font-weight": "600", "flex-shrink": "0", "margin-left": "6px" }}>
          {props.message.author.username}
        </span>
        <span style={{ color: "var(--border-gold)", "flex-shrink": "0", margin: "0 6px" }}>
          {">"}
        </span>
        <span style={{ color: "var(--text-primary)", "word-break": "break-word", "min-width": "0" }}>
          <Show when={props.message.content}>
            {renderContent(props.message.content!)}
          </Show>
          <Show when={props.message.edited_at}>
            <span style={{ color: "var(--text-muted)", "font-size": "11px" }}> (edited)</span>
          </Show>
          {/* Inline reactions */}
          <Show when={props.message.reactions.length > 0}>
            <span style={{ "margin-left": "6px" }}>
              <ReactionBar message={props.message} />
            </span>
          </Show>
        </span>
      </div>

      {/* Attachments */}
      <Show when={props.message.attachments.length > 0}>
        <div style={{ "padding-left": "7ch", "margin-top": "2px", display: "flex", "flex-wrap": "wrap", gap: "4px" }}>
          <For each={props.message.attachments}>
            {(att) => (
              <a href={att.url} target="_blank" rel="noopener">
                <img
                  src={att.thumb_url || att.url}
                  alt={att.filename}
                  style={{
                    "max-width": "400px",
                    "max-height": "300px",
                    "border-radius": "2px",
                    border: "1px solid var(--border-gold)",
                    cursor: "pointer",
                  }}
                />
              </a>
            )}
          </For>
        </div>
      </Show>

      {/* Mobile inline actions */}
      <Show when={isMobile() && showActions()}>
        <div
          style={{
            display: "flex",
            gap: "4px",
            "margin-top": "4px",
            "padding-left": "7ch",
          }}
        >
          <button
            onClick={(e) => handleActionClick(e, () => setReplyingTo(props.message))}
            style={{
              padding: "3px 8px",
              "font-size": "11px",
              color: "var(--text-secondary)",
              border: "1px solid var(--border-gold)",
              "background-color": "var(--bg-secondary)",
            }}
          >
            [reply]
          </button>
          <button
            onClick={(e) =>
              handleActionClick(e, () =>
                send("add_reaction", {
                  message_id: props.message.id,
                  emoji: "\u{1F44D}",
                })
              )
            }
            style={{
              padding: "3px 8px",
              "font-size": "11px",
              color: "var(--text-secondary)",
              border: "1px solid var(--border-gold)",
              "background-color": "var(--bg-secondary)",
            }}
          >
            [react]
          </button>
          <Show when={canDelete()}>
            <button
              onClick={(e) => handleActionClick(e, handleDelete)}
              style={{
                padding: "3px 8px",
                "font-size": "11px",
                color: "var(--danger)",
                border: "1px solid var(--danger)",
                "background-color": "var(--bg-secondary)",
              }}
            >
              [del]
            </button>
          </Show>
        </div>
      </Show>

      {/* Desktop hover actions */}
      <Show when={!isMobile() && showActions()}>
        <div
          style={{
            position: "absolute",
            top: "-4px",
            right: "16px",
            display: "flex",
            gap: "1px",
            "background-color": "var(--bg-secondary)",
            border: "1px solid var(--border-gold)",
            "z-index": "5",
          }}
        >
          <button
            onClick={() => setReplyingTo(props.message)}
            title="Reply"
            style={{
              padding: "2px 6px",
              "font-size": "11px",
              color: "var(--text-secondary)",
            }}
          >
            [reply]
          </button>
          <button
            onClick={() =>
              send("add_reaction", {
                message_id: props.message.id,
                emoji: "\u{1F44D}",
              })
            }
            title="React"
            style={{
              padding: "2px 6px",
              "font-size": "11px",
              color: "var(--text-secondary)",
            }}
          >
            [+]
          </button>
          <Show when={canDelete()}>
            <button
              onClick={handleDelete}
              title="Delete"
              style={{
                padding: "2px 6px",
                "font-size": "11px",
                color: "var(--danger)",
              }}
            >
              [del]
            </button>
          </Show>
        </div>
      </Show>
    </div>
  );
}
