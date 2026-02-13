import { For, Show } from "solid-js";
import { channels } from "../../stores/channels";
import { getUsersInVoiceChannel, currentVoiceChannelId } from "../../stores/voice";
import { onlineUsers } from "../../stores/users";
import { currentUser } from "../../stores/auth";
import { isMobile, setSidebarOpen } from "../../stores/responsive";
import VoiceUser from "./VoiceUser";
import { joinVoice } from "../../lib/webrtc";

interface VoiceChannelProps {
  channelId: string;
}

export default function VoiceChannel(props: VoiceChannelProps) {
  const channel = () => channels().find((c) => c.id === props.channelId);
  const usersInChannel = () => getUsersInVoiceChannel(props.channelId);
  const isConnected = () => currentVoiceChannelId() === props.channelId;

  const handleJoin = () => {
    if (!isConnected()) {
      joinVoice(props.channelId);
    }
  };

  return (
    <div
      style={{
        display: "flex",
        "flex-direction": "column",
        height: "100%",
      }}
    >
      {/* Channel header */}
      <div
        style={{
          padding: isMobile() ? "10px 12px" : "12px 16px",
          "border-bottom": "1px solid var(--bg-primary)",
          display: "flex",
          "align-items": "center",
          "justify-content": "space-between",
        }}
      >
        <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
          <Show when={isMobile()}>
            <button
              onClick={() => setSidebarOpen(true)}
              style={{
                "font-size": "20px",
                color: "var(--text-secondary)",
                padding: "0 4px",
              }}
            >
              {"\u2630"}
            </button>
          </Show>
          <span style={{ "font-size": "18px" }}>{"\u{1F50A}"}</span>
          <span style={{ "font-weight": "600" }}>{channel()?.name}</span>
        </div>

        <Show when={!isConnected()}>
          <button
            onClick={handleJoin}
            style={{
              padding: "6px 16px",
              "background-color": "var(--success)",
              color: "#000",
              "border-radius": "4px",
              "font-size": "13px",
              "font-weight": "600",
            }}
          >
            Join Voice
          </button>
        </Show>
      </div>

      {/* User grid */}
      <div
        style={{
          flex: "1",
          padding: isMobile() ? "12px" : "24px",
          display: "flex",
          "flex-wrap": "wrap",
          gap: isMobile() ? "10px" : "16px",
          "align-content": "flex-start",
          overflow: "auto",
        }}
      >
        <Show
          when={usersInChannel().length > 0}
          fallback={
            <div
              style={{
                width: "100%",
                "text-align": "center",
                color: "var(--text-muted)",
                "margin-top": "60px",
              }}
            >
              <p style={{ "font-size": "16px", "margin-bottom": "8px" }}>
                No one is here yet
              </p>
              <p style={{ "font-size": "14px" }}>
                Click "Join Voice" to start a conversation
              </p>
            </div>
          }
        >
          <For each={usersInChannel()}>
            {(vs) => {
              const user = () =>
                onlineUsers().find((u) => u.id === vs.user_id) ||
                (currentUser()?.id === vs.user_id ? currentUser() : null);
              return (
                <Show when={user()}>
                  <VoiceUser
                    username={user()!.username}
                    voiceState={vs}
                  />
                </Show>
              );
            }}
          </For>
        </Show>
      </div>
    </div>
  );
}
