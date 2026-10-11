import { For, Show, onMount, onCleanup } from "solid-js";
import { channels } from "../../stores/channels";
import {
  getUsersInVoiceChannel,
  currentVoiceChannelId,
  localScreenStream,
  desktopPresenting,
  desktopPreviewUrl,
  getScreenShareForChannel,
  getScreenShareViewerCount,
} from "../../stores/voice";
import { onlineUsers } from "../../stores/users";
import { currentUser } from "../../stores/auth";
import { isMobile, setSidebarOpen } from "../../stores/responsive";
import VoiceUser from "./VoiceUser";
import { joinVoice, leaveVoice } from "../../lib/webrtc";
import { watchScreenShare } from "../../lib/screenshare";

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

  // Someone else's share in this channel (spec: screen-share-discoverability)
  const otherShare = () => {
    const share = getScreenShareForChannel(props.channelId);
    if (!share || share.user_id === currentUser()?.id) return null;
    return share;
  };
  const sharerName = () =>
    onlineUsers().find((u) => u.id === otherShare()?.user_id)?.username || "Someone";

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
          padding: isMobile() ? "10px 12px" : "0 16px",
          ...(!isMobile() && { height: "41px" }),
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
                "font-size": "22px",
                color: "var(--accent)",
                padding: "0 4px",
              }}
            >
              {"\u2261"}
            </button>
          </Show>
          <span style={{ color: "var(--border-gold)", "font-size": isMobile() ? "18px" : "14px" }}>{"\u2666"}</span>
          <span
            ref={glitchRef}
            class="glitch-text"
            style={{
              "font-family": "var(--font-display)",
              "font-weight": "600",
              "font-size": isMobile() ? "16px" : "14px",
              color: "var(--text-primary)",
              display: "inline-block",
            }}
          >
            {channel()?.name}
          </span>
        </div>

        <div style={{ display: "flex", gap: "8px" }}>
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
          <Show when={isMobile() && isConnected()}>
            <button
              onClick={() => leaveVoice()}
              style={{
                padding: "4px 10px",
                "font-size": "11px",
                border: "1px solid var(--danger)",
                "background-color": "rgba(232,64,64,0.15)",
                color: "var(--danger)",
              }}
            >
              [disconnect]
            </button>
          </Show>
        </div>
      </div>

      {/* Watch banner: the one obvious place to click when someone is sharing */}
      <Show when={otherShare()}>
        {(share) => (
          <div
            style={{
              display: "flex",
              "align-items": "center",
              "justify-content": "space-between",
              gap: "12px",
              "flex-wrap": "wrap",
              padding: isMobile() ? "10px 12px" : "10px 16px",
              "background-color": "rgba(201,168,76,0.10)",
              "border-bottom": "1px solid var(--border-gold)",
            }}
          >
            <span style={{ "font-size": "13px", color: "var(--accent)", "min-width": "0" }}>
              {"🖥"} <b>{sharerName()}</b> is sharing their screen
            </span>
            <button
              onClick={() => watchScreenShare(share())}
              style={{
                padding: "5px 14px",
                "background-color": "rgba(80,200,120,0.12)",
                border: "1px solid var(--success)",
                color: "var(--success)",
                "font-size": "12px",
                "font-weight": "600",
                "white-space": "nowrap",
              }}
            >
              [WATCH SCREEN]
            </button>
          </div>
        )}
      </Show>

      {/* User grid */}
      <div
        style={{
          flex: (localScreenStream() || desktopPresenting()) ? "none" : "1",
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
              const share = () => {
                const s = getScreenShareForChannel(props.channelId);
                return s && s.user_id === vs.user_id ? s : null;
              };
              const isMe = () => currentUser()?.id === vs.user_id;
              return (
                <Show when={user()}>
                  <VoiceUser
                    username={user()!.username}
                    voiceState={vs}
                    sharing={!!share()}
                    onWatch={!isMe() && share() ? () => watchScreenShare(share()!) : undefined}
                  />
                </Show>
              );
            }}
          </For>
        </Show>
      </div>

      {/* Screen share preview (when presenting) */}
      <Show when={localScreenStream() || desktopPresenting()}>
        {() => {
          let previewRef: HTMLVideoElement | undefined;

          return (
            <div
              style={{
                flex: "1",
                "min-height": "0",
                "border-top": "1px solid var(--border-gold)",
                display: "flex",
                "flex-direction": "column",
                "align-items": "center",
                "justify-content": "center",
                "background-color": "#0a0a0f",
                padding: "8px",
              }}
            >
              <div style={{
                "font-size": "11px",
                color: "var(--text-muted)",
                "margin-bottom": "6px",
              }}>
                sharing your screen
                <span title="People watching your screen">
                  {" · "}{getScreenShareViewerCount(currentUser()?.id || "")} watching
                </span>
              </div>
              {localScreenStream() ? (
                <video
                  ref={(el) => {
                    previewRef = el;
                    el.srcObject = localScreenStream();
                    onCleanup(() => { el.srcObject = null; });
                  }}
                  autoplay
                  playsinline
                  muted
                  onClick={() => previewRef?.requestFullscreen?.()}
                  style={{
                    "max-width": "100%",
                    "max-height": "100%",
                    "object-fit": "contain",
                    cursor: "pointer",
                    "min-height": "0",
                    transform: "translateZ(0)",
                  }}
                />
              ) : (
                <img
                  src={desktopPreviewUrl() || ""}
                  style={{
                    width: "100%",
                    height: "100%",
                    "object-fit": "contain",
                    "min-height": "0",
                  }}
                />
              )}
            </div>
          );
        }}
      </Show>
    </div>
  );
}
