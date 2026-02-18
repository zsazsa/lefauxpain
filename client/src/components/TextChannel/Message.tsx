import { Show, For, createSignal } from "solid-js";
import type { Message } from "../../stores/messages";
import { setReplyingTo } from "../../stores/messages";
import { currentUser } from "../../stores/auth";
import { lookupUsername, onlineUsers, allUsers } from "../../stores/users";
import { send } from "../../lib/ws";
import { isMobile } from "../../stores/responsive";
import { openLightbox } from "../../stores/lightbox";
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

// Render content with mention highlighting and clickable links
function renderContent(content: string): any {
  // Match mentions OR https/http URLs
  const tokenRe = /<@([0-9a-fA-F-]{36})>|(https?:\/\/[^\s<>"'`]+)/gi;
  const result: any[] = [];
  let lastIndex = 0;
  let m: RegExpExecArray | null;

  while ((m = tokenRe.exec(content)) !== null) {
    if (m.index > lastIndex) {
      result.push(content.slice(lastIndex, m.index));
    }

    if (m[1]) {
      // Mention
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
    } else if (m[2]) {
      // URL — strip trailing punctuation that's likely part of the sentence
      let url = m[2];
      let trailing = "";
      while (url.length > 1 && /[.,;:!?)>\]]+$/.test(url)) {
        trailing = url[url.length - 1] + trailing;
        url = url.slice(0, -1);
      }
      // Adjust regex position to account for stripped chars
      tokenRe.lastIndex -= trailing.length;

      result.push(
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            color: "var(--accent)",
            "text-decoration": "underline",
          }}
        >
          {url}
        </a>
      );
    }

    lastIndex = tokenRe.lastIndex;
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
  const [editing, setEditing] = createSignal(false);
  const [editText, setEditText] = createSignal("");
  let editRef: HTMLInputElement | undefined;

  const handleDelete = () => {
    send("delete_message", { message_id: props.message.id });
  };

  const isOwn = () => currentUser()?.id === props.message.author.id;

  const canDelete = () => {
    const user = currentUser();
    if (!user) return false;
    return props.message.author.id === user.id || user.is_admin;
  };

  // Convert <@uuid> → @username for editing
  const mentionsToDisplay = (content: string) =>
    content.replace(/<@([0-9a-fA-F-]{36})>/g, (_, id) => `@${lookupUsername(id) || id}`);

  // Convert @username → <@uuid> for saving
  const displayToMentions = (content: string) => {
    return content.replace(/@(\w+)/g, (match, name) => {
      // Look up user by username
      const user = [...onlineUsers(), ...allUsers()].find(
        (u) => u.username.toLowerCase() === name.toLowerCase()
      );
      return user ? `<@${user.id}>` : match;
    });
  };

  const startEdit = () => {
    setEditText(mentionsToDisplay(props.message.content || ""));
    setEditing(true);
    requestAnimationFrame(() => editRef?.focus());
  };

  const submitEdit = () => {
    const newContent = displayToMentions(editText().trim());
    if (newContent && newContent !== props.message.content) {
      send("edit_message", { message_id: props.message.id, content: newContent });
    }
    setEditing(false);
  };

  const cancelEdit = () => setEditing(false);

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
      onMouseEnter={() => { if (!isMobile()) setHovered(true); }}
      onMouseLeave={() => { if (!isMobile()) setHovered(false); }}
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
      {/* Reply connector — ╭─ aligned with username below */}
      <Show when={props.message.reply_to}>
        <div
          onClick={(e) => {
            e.stopPropagation();
            const el = document.querySelector(`[data-message-id="${props.message.reply_to!.id}"]`);
            if (el) {
              el.scrollIntoView({ behavior: "smooth", block: "center" });
              el.animate(
                [{ backgroundColor: "rgba(201,168,76,0.15)" }, { backgroundColor: "transparent" }],
                { duration: 1500 }
              );
            }
          }}
          style={{
            display: "flex",
            "align-items": "baseline",
            "font-size": "12px",
            cursor: "pointer",
            color: "var(--text-muted)",
          }}
        >
          {/* Invisible spacer matching the timestamp width */}
          <span style={{ visibility: "hidden", "flex-shrink": "0" }}>
            [{formatTime(props.message.created_at)}]
          </span>
          <span style={{ color: "var(--border-gold)", "flex-shrink": "0", "margin-left": "12px" }}>
            {"\u256D\u2500"}
          </span>
          <span style={{ "margin-left": "4px", "min-width": "0", "word-break": "break-word" }}>
            {props.message.reply_to!.deleted
              ? <span style={{ "font-style": "italic" }}>[message was deleted]</span>
              : <>
                  <span style={{ color: "var(--text-secondary)" }}>
                    {props.message.reply_to!.author.username || lookupUsername(props.message.reply_to!.author.id) || "unknown"}:
                  </span>{" "}
                  {props.message.reply_to!.content
                    ? renderContent(props.message.reply_to!.content.slice(0, 60) + (props.message.reply_to!.content.length > 60 ? "..." : ""))
                    : "[attachment]"}
                </>
            }
          </span>
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
        <span style={{ color: props.message.deleted ? "var(--text-muted)" : "var(--text-primary)", "word-break": "break-word", "min-width": "0", flex: "1" }}>
          {(() => {
            if (props.message.deleted) {
              return <span style={{ "font-style": "italic" }}>[message was deleted]</span>;
            }
            if (editing()) {
              return (
                <span style={{ display: "inline-flex", "align-items": "center", width: "100%" }}>
                  <input
                    ref={editRef}
                    type="text"
                    value={editText()}
                    onInput={(e) => setEditText(e.currentTarget.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { e.preventDefault(); submitEdit(); }
                      if (e.key === "Escape") { e.preventDefault(); cancelEdit(); }
                    }}
                    style={{
                      flex: "1",
                      "font-size": "13px",
                      color: "var(--text-primary)",
                      "background-color": "var(--bg-secondary)",
                      border: "1px solid var(--border-gold)",
                      padding: "1px 6px",
                      "caret-color": "var(--accent)",
                    }}
                  />
                  <span style={{ color: "var(--text-muted)", "font-size": "10px", "margin-left": "6px", "white-space": "nowrap" }}>
                    enter to save · esc to cancel
                  </span>
                </span>
              );
            }
            return (
              <>
                <Show when={props.message.content}>
                  {renderContent(props.message.content!)}
                </Show>
                <Show when={props.message.edited_at}>
                  <span style={{ color: "var(--text-muted)", "font-size": "10px", "font-style": "italic" }}> edited</span>
                </Show>
                <Show when={props.message.reactions.length > 0}>
                  <span style={{ "margin-left": "6px" }}>
                    <ReactionBar message={props.message} />
                  </span>
                </Show>
              </>
            );
          })()}
        </span>
      </div>

      {/* Attachments */}
      <Show when={props.message.attachments.length > 0}>
        <div style={{ "padding-left": "7ch", "margin-top": "2px", display: "flex", "flex-wrap": "wrap", gap: "4px" }}>
          <For each={props.message.attachments}>
            {(att) => (
              <img
                src={att.thumb_url || att.url}
                alt={att.filename}
                onClick={(e) => {
                  e.stopPropagation();
                  openLightbox(att.url);
                }}
                style={{
                  "max-width": "400px",
                  "max-height": "300px",
                  "border-radius": "2px",
                  border: "1px solid var(--border-gold)",
                  cursor: "pointer",
                }}
              />
            )}
          </For>
        </div>
      </Show>

      {/* Mobile inline actions */}
      <Show when={!props.message.deleted && isMobile() && showActions()}>
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
          <Show when={isOwn() && props.message.content}>
            <button
              onClick={(e) => handleActionClick(e, startEdit)}
              style={{
                padding: "3px 8px",
                "font-size": "11px",
                color: "var(--text-secondary)",
                border: "1px solid var(--border-gold)",
                "background-color": "var(--bg-secondary)",
              }}
            >
              [edit]
            </button>
          </Show>
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
      <Show when={!props.message.deleted && !isMobile() && showActions()}>
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
          <Show when={isOwn() && props.message.content}>
            <button
              onClick={startEdit}
              title="Edit"
              style={{
                padding: "2px 6px",
                "font-size": "11px",
                color: "var(--text-secondary)",
              }}
            >
              [edit]
            </button>
          </Show>
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
