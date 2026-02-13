import { Show, onMount, onCleanup } from "solid-js";
import { channels } from "../../stores/channels";
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
          padding: isMobile() ? "8px 12px" : "10px 16px",
          "border-bottom": "1px solid var(--border-gold)",
          display: "flex",
          "align-items": "center",
          gap: "8px",
        }}
      >
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
        <span style={{ color: "var(--border-gold)", "font-size": "16px" }}>#</span>
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

      {/* Messages */}
      <MessageList channelId={props.channelId} />

      {/* Input */}
      <MessageInput channelId={props.channelId} channelName={channel()?.name || ""} />
    </div>
  );
}
