import { createSignal, createEffect, on, For, Show, onCleanup } from "solid-js";
import { channels, selectedChannelId, setSelectedChannelId } from "../../stores/channels";
import { getUsersInVoiceChannel, currentVoiceChannelId } from "../../stores/voice";
import { onlineUsers } from "../../stores/users";
import { currentUser } from "../../stores/auth";
import { joinVoice } from "../../lib/webrtc";
import { setSettingsOpen } from "../../stores/settings";
import { unreadCount } from "../../stores/notifications";
import { isMobile, setSidebarOpen } from "../../stores/responsive";
import ChannelItem from "./ChannelItem";
import CreateChannel from "./CreateChannel";
import VoiceControls from "../VoiceChannel/VoiceControls";
import NotificationDropdown from "../Notifications/NotificationDropdown";

interface SidebarProps {
  onLogout: () => void;
  username: string;
}

export default function Sidebar(props: SidebarProps) {
  const voiceChannels = () => channels().filter((c) => c.type === "voice");
  const textChannels = () => channels().filter((c) => c.type === "text");
  const [notifOpen, setNotifOpen] = createSignal(false);
  const [shaking, setShaking] = createSignal(false);
  let headerRef: HTMLDivElement | undefined;

  // Shake for 20s when unread count increases
  let shakeTimer: number | undefined;
  createEffect(on(unreadCount, (count, prev) => {
    if (count > 0 && (prev === undefined || count > prev)) {
      setShaking(true);
      clearTimeout(shakeTimer);
      shakeTimer = window.setTimeout(() => setShaking(false), 20000);
    }
    if (count === 0) {
      setShaking(false);
      clearTimeout(shakeTimer);
    }
  }));
  onCleanup(() => clearTimeout(shakeTimer));

  return (
    <div
      style={{
        width: "100%",
        "background-color": "var(--bg-secondary)",
        display: "flex",
        "flex-direction": "column",
        height: "100%",
      }}
    >
      {/* Header */}
      <div
        ref={headerRef}
        style={{
          padding: "12px 16px",
          "font-weight": "700",
          "font-size": "16px",
          "border-bottom": "1px solid var(--bg-primary)",
          display: "flex",
          "align-items": "center",
          "justify-content": "space-between",
        }}
      >
        <span>Le Faux Pain</span>
        <button
          onClick={() => setNotifOpen((v) => !v)}
          style={{
            position: "relative",
            padding: "2px 6px",
            "font-size": "18px",
            "line-height": "1",
            filter: unreadCount() > 0 ? "none" : "grayscale(1) brightness(0.7)",
            animation: shaking() ? "bread-shake 0.4s ease-in-out infinite" : "none",
          }}
          title="Notifications"
        >
          {"\u{1F956}"}
          <Show when={unreadCount() > 0}>
            <span
              style={{
                position: "absolute",
                top: "-2px",
                right: "0",
                "background-color": "var(--accent)",
                color: "var(--bg-primary)",
                "font-size": "10px",
                "font-weight": "700",
                "min-width": "16px",
                height: "16px",
                "border-radius": "8px",
                display: "flex",
                "align-items": "center",
                "justify-content": "center",
                padding: "0 4px",
              }}
            >
              {unreadCount()}
            </span>
          </Show>
        </button>
        <Show when={notifOpen()}>
          <NotificationDropdown anchorRef={headerRef!} onClose={() => setNotifOpen(false)} />
        </Show>
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
                    if (isMobile()) setSidebarOpen(false);
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
                onClick={() => {
                  setSelectedChannelId(ch.id);
                  if (isMobile()) setSidebarOpen(false);
                }}
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
