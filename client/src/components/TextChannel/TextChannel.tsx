import { Show, onMount, onCleanup } from "solid-js";
import { channels } from "../../stores/channels";
import { currentVoiceChannelId } from "../../stores/voice";
import { leaveVoice } from "../../lib/webrtc";
import { isMobile, setSidebarOpen } from "../../stores/responsive";
import MessageList from "./MessageList";
import MessageInput from "./MessageInput";

interface TextChannelProps {
  channelId: string;
}

export default function TextChannel(props: TextChannelProps) {
  const channel = () => channels().find((c) => c.id === props.channelId);
  let glitchRef: HTMLSpanElement | undefined;
  let glitchTimer: number | undefined;

  function scheduleGlitch() {
    // Random 3–7 minutes
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

  return (
    <div
      class="crt-vignette"
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
          <span style={{ color: "var(--accent)", "font-size": isMobile() ? "18px" : "16px" }}>#</span>
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
        <Show when={isMobile() && currentVoiceChannelId()}>
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

      {/* Messages */}
      <MessageList channelId={props.channelId} />

      {/* Input */}
      <MessageInput channelId={props.channelId} channelName={channel()?.name || ""} />
    </div>
  );
}
