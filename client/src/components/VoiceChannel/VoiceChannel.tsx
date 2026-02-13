import { For, Show, onMount, onCleanup } from "solid-js";
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
  let glitchRef: HTMLSpanElement | undefined;
  let glitchTimer: number | undefined;

  function scheduleGlitch() {
    const delay = (3 + Math.random() * 4) * 60 * 1000;
    glitchTimer = window.setTimeout(() => {
      if (glitchRef) {
        glitchRef.classList.add("glitching");
        setTimeout(() => glitchRef?.classList.remove("glitching"), 350);
      }
      scheduleGlitch();
    }, delay);
  }

  onMount(() => scheduleGlitch());
  onCleanup(() => clearTimeout(glitchTimer));

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
          padding: isMobile() ? "8px 12px" : "10px 16px",
          "border-bottom": "1px solid var(--border-gold)",
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
                "font-size": "18px",
                color: "var(--accent)",
                padding: "0 4px",
              }}
            >
              {"\u2261"}
            </button>
          </Show>
          <span style={{ color: "var(--border-gold)", "font-size": "14px" }}>{"\u2666"}</span>
          <span
            ref={glitchRef}
            class="glitch-text"
            style={{
              "font-family": "var(--font-display)",
              "font-weight": "600",
              "font-size": "14px",
              color: "var(--text-primary)",
              display: "inline-block",
            }}
          >
            {channel()?.name}
          </span>
        </div>

        <Show when={!isConnected()}>
          <button
            onClick={handleJoin}
            style={{
              padding: "4px 12px",
              "background-color": "transparent",
              border: "1px solid var(--success)",
              color: "var(--success)",
              "font-size": "12px",
              "font-weight": "600",
            }}
          >
            [join voice]
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
              <p style={{ "font-size": "14px", "margin-bottom": "8px" }}>
                No one is here yet
              </p>
              <p style={{ "font-size": "12px" }}>
                Click [join voice] to start
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
