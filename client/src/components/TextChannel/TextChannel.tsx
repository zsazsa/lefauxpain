import { Show, onMount, onCleanup, createSignal } from "solid-js";
import { channels } from "../../stores/channels";
import { currentUser } from "../../stores/auth";
import { currentVoiceChannelId } from "../../stores/voice";
import { leaveVoice } from "../../lib/webrtc";
import { isMobile, setSidebarOpen } from "../../stores/responsive";
import { send } from "../../lib/ws";
import { threadPanelOpen, setThreadPanelOpen, setThreadPanelTab } from "../../stores/messages";
import { requestChannelAccess } from "../../lib/api";
import MessageList from "./MessageList";
import MessageInput from "./MessageInput";
import ThreadPanel from "./ThreadPanel";
import ChannelSettingsModal from "./ChannelSettingsModal";

interface TextChannelProps {
  channelId: string;
}

export default function TextChannel(props: TextChannelProps) {
  const channel = () => channels().find((c) => c.id === props.channelId);
  const [channelSettingsOpen, setChannelSettingsOpen] = createSignal(false);
  const [accessRequested, setAccessRequested] = createSignal(false);
  const [accessError, setAccessError] = createSignal("");
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
        <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
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
          <Show when={channel()?.role === "owner" || currentUser()?.is_admin}>
            <button
              onClick={() => setChannelSettingsOpen(true)}
              style={{ color: "var(--text-muted)", background: "none", border: "none", cursor: "pointer", "font-size": "12px" }}
            >
              [{"\u2699"}]
            </button>
          </Show>
          <button
            onClick={() => { setThreadPanelTab("starred"); setThreadPanelOpen(true); }}
            style={{ color: "var(--accent)", background: "none", border: "none", cursor: "pointer", "font-size": "12px" }}
          >
            [*]
          </button>
          <button
            onClick={() => {
              if (threadPanelOpen()) {
                setThreadPanelOpen(false);
              } else {
                setThreadPanelTab("starred");
                setThreadPanelOpen(true);
              }
            }}
            style={{
              color: threadPanelOpen() ? "var(--accent)" : "var(--text-muted)",
              background: "none",
              border: "none",
              cursor: "pointer",
              "font-size": "12px",
            }}
          >
            {threadPanelOpen() ? "[<]" : "[>]"}
          </button>
        </div>
      </div>

      {/* Messages + Thread Panel */}
      <Show when={channel()?.visibility !== "public" && !channel()?.is_member} fallback={
        <div style={{ display: "flex", flex: "1", overflow: "hidden" }}>
          <div style={{ flex: "1", display: "flex", "flex-direction": "column", overflow: "hidden" }}>
            <MessageList channelId={props.channelId} />
            <MessageInput channelId={props.channelId} channelName={channel()?.name || ""} />
          </div>
          <ThreadPanel channelId={props.channelId} channelName={channel()?.name || ""} send={(op, data) => send(op, data)} />
        </div>
      }>
        <div style={{
          flex: "1",
          display: "flex",
          "flex-direction": "column",
          "align-items": "center",
          "justify-content": "center",
          color: "var(--text-muted)",
          gap: "12px",
        }}>
          <div style={{ "font-size": "14px", "font-family": "var(--font-display)", color: "var(--accent)" }}>
            {"\uD83D\uDD12"} This channel is restricted
          </div>
          <Show when={channel()?.description}>
            <div style={{ "font-size": "12px", "max-width": "400px", "text-align": "center" }}>
              {channel()?.description}
            </div>
          </Show>
          <Show when={accessRequested()} fallback={
            <button
              onClick={async () => {
                try {
                  setAccessError("");
                  await requestChannelAccess(props.channelId);
                  setAccessRequested(true);
                } catch (e: any) {
                  setAccessError(e.message || "Failed to request access");
                }
              }}
              style={{
                padding: "8px 20px",
                "font-size": "12px",
                color: "var(--accent)",
                border: "1px solid var(--accent)",
                "background-color": "var(--accent-glow)",
                cursor: "pointer",
                "font-family": "var(--font-display)",
                "letter-spacing": "1px",
              }}
            >
              [request access]
            </button>
          }>
            <div style={{ "font-size": "12px", color: "var(--text-muted)", "font-family": "var(--font-display)" }}>
              Access requested — waiting for approval
            </div>
          </Show>
          <Show when={accessError()}>
            <div style={{ "font-size": "11px", color: "var(--danger)" }}>{accessError()}</div>
          </Show>
        </div>
      </Show>

      <ChannelSettingsModal
        channelId={props.channelId}
        open={channelSettingsOpen()}
        onClose={() => setChannelSettingsOpen(false)}
      />
    </div>
  );
}
