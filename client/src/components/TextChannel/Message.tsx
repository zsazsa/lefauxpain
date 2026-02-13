import { Show, For, createSignal } from "solid-js";
import type { Message } from "../../stores/messages";
import { setReplyingTo } from "../../stores/messages";
import { currentUser } from "../../stores/auth";
import { onlineUsers } from "../../stores/users";
import { send } from "../../lib/ws";
import ReactionBar from "./ReactionBar";

interface MessageProps {
  message: Message;
}

function formatTime(dateStr: string): string {
  const normalized = dateStr.replace(" ", "T");
  const d = new Date(normalized.endsWith("Z") ? normalized : normalized + "Z");
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// Render content with mention highlighting
function renderContent(content: string): any {
  const parts = content.split(/(<@[a-f0-9-]{36}>)/g);
  return parts.map((part) => {
    const match = part.match(/^<@([a-f0-9-]{36})>$/);
    if (match) {
      const userId = match[1];
      const user = onlineUsers().find((u) => u.id === userId);
      return (
        <span
          style={{
            "background-color": "var(--mention-bg)",
            color: "var(--mention-text)",
            padding: "0 2px",
            "border-radius": "3px",
          }}
        >
          @{user?.username || "unknown"}
        </span>
      );
    }
    return part;
  });
}

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

  return (
    <div
      onMouseOver={() => setHovered(true)}
      onMouseOut={() => setHovered(false)}
      style={{
        padding: "4px 16px",
        position: "relative",
        "background-color": hovered() ? "rgba(201,168,76,0.04)" : "transparent",
      }}
    >
      {/* Reply preview */}
      <Show when={props.message.reply_to}>
        <div
          style={{
            "font-size": "12px",
            color: "var(--text-muted)",
            "margin-bottom": "2px",
            "padding-left": "36px",
            display: "flex",
            "align-items": "center",
            gap: "4px",
          }}
        >
          <span style={{ color: "var(--text-secondary)" }}>
            @{props.message.reply_to!.author.username}
          </span>
          <span>
            {props.message.reply_to!.content?.slice(0, 60) || "[attachment]"}
            {(props.message.reply_to!.content?.length || 0) > 60 ? "..." : ""}
          </span>
        </div>
      </Show>

      {/* Message body */}
      <div style={{ display: "flex", gap: "12px", "align-items": "flex-start" }}>
        {/* Avatar placeholder */}
        <div
          style={{
            width: "32px",
            height: "32px",
            "border-radius": "50%",
            "background-color": "var(--accent)",
            display: "flex",
            "align-items": "center",
            "justify-content": "center",
            "font-size": "14px",
            "font-weight": "700",
            "flex-shrink": "0",
            color: "white",
          }}
        >
          {props.message.author.username[0].toUpperCase()}
        </div>

        <div style={{ "min-width": "0", flex: "1" }}>
          <div style={{ display: "flex", "align-items": "baseline", gap: "8px" }}>
            <span style={{ "font-weight": "600", "font-size": "14px" }}>
              {props.message.author.username}
            </span>
            <span
              style={{
                "font-size": "11px",
                color: "var(--text-muted)",
              }}
            >
              {formatTime(props.message.created_at)}
              <Show when={props.message.edited_at}>
                <span> (edited)</span>
              </Show>
            </span>
          </div>

          <Show when={props.message.content}>
            <div
              style={{
                "font-size": "14px",
                color: "var(--text-secondary)",
                "line-height": "1.4",
                "word-break": "break-word",
              }}
            >
              {renderContent(props.message.content!)}
            </div>
          </Show>

          {/* Attachments */}
          <Show when={props.message.attachments.length > 0}>
            <div style={{ "margin-top": "4px", display: "flex", "flex-wrap": "wrap", gap: "4px" }}>
              <For each={props.message.attachments}>
                {(att) => (
                  <a href={att.url} target="_blank" rel="noopener">
                    <img
                      src={att.thumb_url || att.url}
                      alt={att.filename}
                      style={{
                        "max-width": "400px",
                        "max-height": "300px",
                        "border-radius": "4px",
                        cursor: "pointer",
                      }}
                    />
                  </a>
                )}
              </For>
            </div>
          </Show>

          {/* Reactions */}
          <Show when={props.message.reactions.length > 0}>
            <ReactionBar message={props.message} />
          </Show>
        </div>
      </div>

      {/* Action buttons on hover */}
      <Show when={hovered()}>
        <div
          style={{
            position: "absolute",
            top: "-8px",
            right: "16px",
            display: "flex",
            gap: "2px",
            "background-color": "var(--bg-secondary)",
            "border-radius": "4px",
            padding: "2px",
            "box-shadow": "0 1px 3px rgba(0,0,0,0.3)",
          }}
        >
          <button
            onClick={() => setReplyingTo(props.message)}
            title="Reply"
            style={{
              padding: "4px 6px",
              "font-size": "12px",
              "border-radius": "3px",
              color: "var(--text-muted)",
            }}
          >
            Reply
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
              padding: "4px 6px",
              "font-size": "12px",
              "border-radius": "3px",
            }}
          >
            +
          </button>
          <Show when={canDelete()}>
            <button
              onClick={handleDelete}
              title="Delete"
              style={{
                padding: "4px 6px",
                "font-size": "12px",
                "border-radius": "3px",
                color: "var(--danger)",
              }}
            >
              Del
            </button>
          </Show>
        </div>
      </Show>
    </div>
  );
}
