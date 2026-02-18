import { createSignal, For, Show, onMount, onCleanup } from "solid-js";
import type { Channel } from "../../stores/channels";
import { allUsers } from "../../stores/users";
import { currentUser } from "../../stores/auth";
import { send } from "../../lib/ws";

interface ChannelManageMenuProps {
  channel: Channel;
  onClose: () => void;
}

export default function ChannelManageMenu(props: ChannelManageMenuProps) {
  const [mode, setMode] = createSignal<"main" | "rename" | "managers" | "confirmDelete">("main");
  const [renameValue, setRenameValue] = createSignal(props.channel.name);
  const [confirmValue, setConfirmValue] = createSignal("");
  let menuRef: HTMLDivElement | undefined;

  const handleClickOutside = (e: MouseEvent) => {
    if (menuRef && !menuRef.contains(e.target as Node)) {
      props.onClose();
    }
  };

  onMount(() => {
    document.addEventListener("mousedown", handleClickOutside);
  });
  onCleanup(() => {
    document.removeEventListener("mousedown", handleClickOutside);
  });

  const handleRename = () => {
    const name = renameValue().trim();
    if (name && name.length <= 32) {
      send("rename_channel", { channel_id: props.channel.id, name });
      props.onClose();
    }
  };

  const handleDelete = () => {
    send("delete_channel", { channel_id: props.channel.id });
    props.onClose();
  };

  const handleAddManager = (userId: string) => {
    send("add_channel_manager", { channel_id: props.channel.id, user_id: userId });
  };

  const handleRemoveManager = (userId: string) => {
    send("remove_channel_manager", { channel_id: props.channel.id, user_id: userId });
  };

  const nonManagerUsers = () =>
    allUsers().filter(
      (u) => !props.channel.manager_ids.includes(u.id) && u.id !== currentUser()?.id
    );

  const managerUsers = () =>
    allUsers().filter((u) => props.channel.manager_ids.includes(u.id));

  return (
    <div
      ref={menuRef}
      style={{
        position: "absolute",
        top: "100%",
        left: "16px",
        "z-index": "100",
        "background-color": "var(--bg-primary)",
        border: "1px solid var(--border-gold)",
        "min-width": "200px",
        "max-width": "260px",
        "font-size": "12px",
        "box-shadow": "0 4px 12px rgba(0,0,0,0.4)",
      }}
    >
      {/* Main menu */}
      <Show when={mode() === "main"}>
        <button
          onClick={() => setMode("rename")}
          style={menuItemStyle}
          onMouseOver={(e) => (e.currentTarget.style.backgroundColor = "var(--accent-glow)")}
          onMouseOut={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
        >
          Rename
        </button>
        <button
          onClick={() => setMode("managers")}
          style={menuItemStyle}
          onMouseOver={(e) => (e.currentTarget.style.backgroundColor = "var(--accent-glow)")}
          onMouseOut={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
        >
          Managers
        </button>
        <button
          onClick={() => setMode("confirmDelete")}
          style={{ ...menuItemStyle, color: "var(--danger)" }}
          onMouseOver={(e) => (e.currentTarget.style.backgroundColor = "rgba(232,64,64,0.1)")}
          onMouseOut={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
        >
          Delete
        </button>
      </Show>

      {/* Rename */}
      <Show when={mode() === "rename"}>
        <div style={{ padding: "8px" }}>
          <input
            value={renameValue()}
            onInput={(e) => setRenameValue(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleRename();
              if (e.key === "Escape") props.onClose();
            }}
            maxLength={32}
            style={{
              width: "100%",
              padding: "4px 8px",
              "background-color": "var(--bg-secondary)",
              color: "var(--text-primary)",
              border: "1px solid var(--border-gold)",
              "font-size": "12px",
              "box-sizing": "border-box",
            }}
            autofocus
          />
          <div style={{ display: "flex", gap: "4px", "margin-top": "6px" }}>
            <button onClick={handleRename} style={actionBtnStyle}>
              [save]
            </button>
            <button
              onClick={() => setMode("main")}
              style={{ ...actionBtnStyle, color: "var(--text-muted)", border: "1px solid var(--text-muted)" }}
            >
              [back]
            </button>
          </div>
        </div>
      </Show>

      {/* Managers */}
      <Show when={mode() === "managers"}>
        <div style={{ padding: "8px", "max-height": "250px", overflow: "auto" }}>
          <div style={{
            "font-size": "10px",
            "text-transform": "uppercase",
            "letter-spacing": "1px",
            color: "var(--text-muted)",
            "margin-bottom": "6px",
          }}>
            Current Managers
          </div>
          <Show when={managerUsers().length === 0}>
            <div style={{ color: "var(--text-muted)", "font-size": "11px", "margin-bottom": "8px" }}>
              None
            </div>
          </Show>
          <For each={managerUsers()}>
            {(user) => (
              <div style={{
                display: "flex",
                "align-items": "center",
                "justify-content": "space-between",
                padding: "3px 0",
              }}>
                <span style={{ color: "var(--text-primary)" }}>{user.username}</span>
                <button
                  onClick={() => handleRemoveManager(user.id)}
                  style={{
                    "font-size": "10px",
                    color: "var(--danger)",
                    padding: "0 4px",
                  }}
                >
                  [x]
                </button>
              </div>
            )}
          </For>

          <Show when={nonManagerUsers().length > 0}>
            <div style={{
              "font-size": "10px",
              "text-transform": "uppercase",
              "letter-spacing": "1px",
              color: "var(--text-muted)",
              "margin-top": "8px",
              "margin-bottom": "6px",
            }}>
              Add Manager
            </div>
            <For each={nonManagerUsers()}>
              {(user) => (
                <button
                  onClick={() => handleAddManager(user.id)}
                  style={{
                    display: "block",
                    width: "100%",
                    "text-align": "left",
                    padding: "3px 4px",
                    color: "var(--text-secondary)",
                    "background-color": "transparent",
                    border: "none",
                    cursor: "pointer",
                    "font-size": "12px",
                  }}
                  onMouseOver={(e) => (e.currentTarget.style.backgroundColor = "var(--accent-glow)")}
                  onMouseOut={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                >
                  + {user.username}
                </button>
              )}
            </For>
          </Show>

          <div style={{ "margin-top": "8px" }}>
            <button
              onClick={() => setMode("main")}
              style={{ ...actionBtnStyle, color: "var(--text-muted)", border: "1px solid var(--text-muted)" }}
            >
              [back]
            </button>
          </div>
        </div>
      </Show>

      {/* Confirm delete */}
      <Show when={mode() === "confirmDelete"}>
        <div style={{ padding: "8px" }}>
          <div style={{ color: "var(--text-secondary)", "margin-bottom": "8px", "line-height": "1.4" }}>
            This will archive the channel and make its history inaccessible. Type <span style={{ color: "var(--danger)", "font-weight": "600" }}>{props.channel.name}</span> to confirm.
          </div>
          <input
            value={confirmValue()}
            onInput={(e) => setConfirmValue(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && confirmValue() === props.channel.name) handleDelete();
              if (e.key === "Escape") { setConfirmValue(""); setMode("main"); }
            }}
            placeholder={props.channel.name}
            style={{
              width: "100%",
              padding: "4px 8px",
              "background-color": "var(--bg-secondary)",
              color: "var(--text-primary)",
              border: "1px solid var(--danger)",
              "font-size": "12px",
              "box-sizing": "border-box",
              "margin-bottom": "6px",
            }}
            autofocus
          />
          <div style={{ display: "flex", gap: "4px" }}>
            <button
              onClick={handleDelete}
              disabled={confirmValue() !== props.channel.name}
              style={{
                ...actionBtnStyle,
                color: confirmValue() === props.channel.name ? "var(--danger)" : "var(--text-muted)",
                border: `1px solid ${confirmValue() === props.channel.name ? "var(--danger)" : "var(--text-muted)"}`,
                "background-color": confirmValue() === props.channel.name ? "rgba(232,64,64,0.1)" : "transparent",
                opacity: confirmValue() === props.channel.name ? "1" : "0.5",
                cursor: confirmValue() === props.channel.name ? "pointer" : "not-allowed",
              }}
            >
              [delete]
            </button>
            <button
              onClick={() => { setConfirmValue(""); setMode("main"); }}
              style={{ ...actionBtnStyle, color: "var(--text-muted)", border: "1px solid var(--text-muted)" }}
            >
              [cancel]
            </button>
          </div>
        </div>
      </Show>
    </div>
  );
}

const menuItemStyle = {
  display: "block",
  width: "100%",
  "text-align": "left",
  padding: "8px 12px",
  color: "var(--text-primary)",
  "background-color": "transparent",
  border: "none",
  "border-bottom": "1px solid rgba(201,168,76,0.1)",
  cursor: "pointer",
  "font-size": "12px",
} as const;

const actionBtnStyle = {
  "font-size": "11px",
  padding: "3px 10px",
  border: "1px solid var(--accent)",
  "background-color": "transparent",
  color: "var(--accent)",
  cursor: "pointer",
} as const;
