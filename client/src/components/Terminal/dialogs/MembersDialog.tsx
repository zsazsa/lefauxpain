import { For, Show } from "solid-js";
import { onlineUsers, allUsers } from "../../../stores/users";
import { currentUser } from "../../../stores/auth";
import TerminalDialog from "../TerminalDialog";

interface MembersDialogProps {
  onClose: () => void;
}

export default function MembersDialog(props: MembersDialogProps) {
  const me = () => currentUser();

  const offlineUsers = () =>
    allUsers().filter((u) => {
      const m = me();
      if (m && u.id === m.id) return false;
      return !onlineUsers().some((o) => o.id === u.id);
    });

  return (
    <TerminalDialog title="MEMBERS" onClose={props.onClose}>
      {/* Current user */}
      <Show when={me()}>
        <div
          style={{
            padding: "3px 8px",
            "font-size": "13px",
            color: "var(--accent)",
            display: "flex",
            "align-items": "center",
            gap: "6px",
          }}
        >
          <span style={{ color: "var(--success)", "font-size": "8px" }}>{"\u25CF"}</span>
          {me()!.username}
          <span style={{ "font-size": "10px", color: "var(--text-muted)" }}>(you)</span>
        </div>
      </Show>

      {/* Online users */}
      <For each={onlineUsers()}>
        {(user) => (
          <div
            style={{
              padding: "3px 8px",
              "font-size": "13px",
              color: "var(--text-secondary)",
              display: "flex",
              "align-items": "center",
              gap: "6px",
            }}
          >
            <span style={{ color: "var(--success)", "font-size": "8px" }}>{"\u25CF"}</span>
            {user.username}
          </div>
        )}
      </For>

      {/* Separator */}
      <Show when={offlineUsers().length > 0}>
        <div style={{
          padding: "6px 8px 2px",
          "font-size": "10px",
          "text-transform": "uppercase",
          "letter-spacing": "1px",
          color: "var(--text-muted)",
        }}>
          Offline
        </div>
      </Show>

      {/* Offline users */}
      <For each={offlineUsers()}>
        {(user) => (
          <div
            style={{
              padding: "3px 8px",
              "font-size": "13px",
              color: "var(--text-muted)",
              display: "flex",
              "align-items": "center",
              gap: "6px",
              opacity: "0.5",
            }}
          >
            <span style={{ color: "var(--text-muted)", "font-size": "8px" }}>{"\u25CF"}</span>
            {user.username}
          </div>
        )}
      </For>
    </TerminalDialog>
  );
}
