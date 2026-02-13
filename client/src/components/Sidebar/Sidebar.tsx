import { For, Show } from "solid-js";
import { channels, selectedChannelId, setSelectedChannelId } from "../../stores/channels";
import { getUsersInVoiceChannel, currentVoiceChannelId } from "../../stores/voice";
import { onlineUsers } from "../../stores/users";
import { currentUser } from "../../stores/auth";
import { joinVoice } from "../../lib/webrtc";
import { setSettingsOpen } from "../../stores/settings";
import ChannelItem from "./ChannelItem";
import CreateChannel from "./CreateChannel";
import VoiceControls from "../VoiceChannel/VoiceControls";

interface SidebarProps {
  onLogout: () => void;
  username: string;
}

export default function Sidebar(props: SidebarProps) {
  const voiceChannels = () => channels().filter((c) => c.type === "voice");
  const textChannels = () => channels().filter((c) => c.type === "text");

  return (
    <div
      style={{
        width: "240px",
        "min-width": "240px",
        "background-color": "var(--bg-secondary)",
        display: "flex",
        "flex-direction": "column",
        height: "100%",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "12px 16px",
          "font-weight": "700",
          "font-size": "16px",
          "border-bottom": "1px solid var(--bg-primary)",
        }}
      >
        Le Faux Pain
      </div>

      {/* Channel list */}
      <div style={{ flex: "1", overflow: "auto", padding: "8px 0" }}>
        <Show when={voiceChannels().length > 0}>
          <div
            style={{
              padding: "6px 16px",
              "font-size": "11px",
              "font-weight": "700",
              "text-transform": "uppercase",
              color: "var(--text-muted)",
            }}
          >
            Voice Channels
          </div>
          <For each={voiceChannels()}>
            {(ch) => (
              <>
                <ChannelItem
                  channel={ch}
                  selected={selectedChannelId() === ch.id}
                  onClick={() => {
                    setSelectedChannelId(ch.id);
                    if (currentVoiceChannelId() !== ch.id) {
                      joinVoice(ch.id);
                    }
                  }}
                />
                {/* Users in this voice channel */}
                <For each={getUsersInVoiceChannel(ch.id)}>
                  {(vs) => {
                    const user = () =>
                      onlineUsers().find((u) => u.id === vs.user_id) ||
                      (currentUser()?.id === vs.user_id ? currentUser() : null);
                    return (
                      <Show when={user()}>
                        <div
                          style={{
                            padding: "2px 16px 2px 44px",
                            "font-size": "12px",
                            color: "var(--text-secondary)",
                            display: "flex",
                            "align-items": "center",
                            gap: "4px",
                          }}
                        >
                          <span
                            style={{
                              width: "6px",
                              height: "6px",
                              "border-radius": "50%",
                              "background-color": vs.speaking
                                ? "var(--success)"
                                : "var(--text-muted)",
                              "flex-shrink": "0",
                            }}
                          />
                          <span>{user()!.username}</span>
                          {vs.self_mute && (
                            <span style={{ "font-size": "10px" }}>
                              {"\u{1F507}"}
                            </span>
                          )}
                          {vs.self_deafen && (
                            <span style={{ "font-size": "10px" }}>
                              {"\u{1F508}"}
                            </span>
                          )}
                        </div>
                      </Show>
                    );
                  }}
                </For>
              </>
            )}
          </For>
        </Show>

        <Show when={textChannels().length > 0}>
          <div
            style={{
              padding: "6px 16px",
              "font-size": "11px",
              "font-weight": "700",
              "text-transform": "uppercase",
              color: "var(--text-muted)",
              "margin-top": "8px",
            }}
          >
            Text Channels
          </div>
          <For each={textChannels()}>
            {(ch) => (
              <ChannelItem
                channel={ch}
                selected={selectedChannelId() === ch.id}
                onClick={() => setSelectedChannelId(ch.id)}
              />
            )}
          </For>
        </Show>

        <CreateChannel />
      </div>

      {/* Voice controls */}
      <VoiceControls />

      {/* User bar */}
      <div
        style={{
          padding: "8px 12px",
          "background-color": "var(--bg-primary)",
          display: "flex",
          "align-items": "center",
          "justify-content": "space-between",
          "font-size": "14px",
        }}
      >
        <span style={{ color: "var(--text-primary)", "font-weight": "600" }}>
          {props.username}
        </span>
        <div style={{ display: "flex", gap: "4px" }}>
          <button
            onClick={() => setSettingsOpen(true)}
            style={{
              padding: "4px 8px",
              "font-size": "14px",
              color: "var(--text-muted)",
              "border-radius": "3px",
            }}
            onMouseOver={(e) =>
              (e.currentTarget.style.color = "var(--text-primary)")
            }
            onMouseOut={(e) =>
              (e.currentTarget.style.color = "var(--text-muted)")
            }
            title="Settings"
          >
            {"\u2699"}
          </button>
          <button
            onClick={props.onLogout}
            style={{
              padding: "4px 8px",
              "font-size": "12px",
              color: "var(--text-muted)",
              "border-radius": "3px",
            }}
            onMouseOver={(e) =>
              (e.currentTarget.style.color = "var(--danger)")
            }
            onMouseOut={(e) =>
              (e.currentTarget.style.color = "var(--text-muted)")
            }
          >
            Logout
          </button>
        </div>
      </div>
    </div>
  );
}
