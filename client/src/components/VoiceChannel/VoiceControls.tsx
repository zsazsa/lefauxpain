import { Show, onMount } from "solid-js";
import {
  currentVoiceChannelId,
  selfMute,
  setSelfMute,
  selfDeafen,
  setSelfDeafen,
  voiceStats,
  screenShares,
  getScreenShareForChannel,
  getAudioSourceForUser,
  voiceLink,
  micWarning,
  micLevel,
  watchingScreenShare,
} from "../../stores/voice";
import { currentUser } from "../../stores/auth";
import { leaveVoice, toggleMute, toggleDeafen, rejoinVoice, reacquireMic } from "../../lib/webrtc";
import { startScreenShare, stopScreenShare, getIsPresenting, watchScreenShare, stopWatching } from "../../lib/screenshare";
import { startAudioShare, stopAudioShare } from "../../lib/audioShare";
import { enumerateDevices, isDesktop } from "../../lib/devices";
import { channels } from "../../stores/channels";

export default function VoiceControls() {
  const channelName = () => {
    const id = currentVoiceChannelId();
    return channels().find((c) => c.id === id)?.name || "";
  };

  onMount(() => {
    enumerateDevices();
  });

  const handleMute = () => {
    const muted = toggleMute();
    setSelfMute(muted);
  };

  const handleDeafen = () => {
    const newDeafen = !selfDeafen();
    setSelfDeafen(newDeafen);
    toggleDeafen(newDeafen);
  };

  const handleDisconnect = () => {
    leaveVoice();
  };

  const myScreenShare = () => {
    const chId = currentVoiceChannelId();
    if (!chId) return null;
    const userId = currentUser()?.id;
    if (!userId) return null;
    return screenShares().find((s) => s.user_id === userId && s.channel_id === chId) || null;
  };

  const otherScreenShare = () => {
    const chId = currentVoiceChannelId();
    if (!chId) return null;
    const userId = currentUser()?.id;
    const share = getScreenShareForChannel(chId);
    if (!share || share.user_id === userId) return null;
    return share;
  };

  const handleScreenShare = () => {
    if (myScreenShare()) {
      stopScreenShare();
    } else {
      startScreenShare();
    }
  };

  // Watching the other user's share right now?
  const isWatchingOther = () => {
    const other = otherScreenShare();
    return !!other && watchingScreenShare()?.user_id === other.user_id;
  };

  const handleWatch = () => {
    const other = otherScreenShare();
    if (!other) return;
    if (isWatchingOther()) stopWatching();
    else watchScreenShare(other);
  };

  const linkColor = () =>
    voiceLink() === "connected"
      ? "var(--success)"
      : voiceLink() === "reconnecting"
        ? "var(--accent)"
        : "var(--danger)";
  const linkLabel = () =>
    voiceLink() === "connected"
      ? "VOICE CONNECTED"
      : voiceLink() === "reconnecting"
        ? "RECONNECTING VOICE…"
        : "VOICE LOST";

  const myAudioShare = () => {
    const userId = currentUser()?.id;
    if (!userId) return null;
    return getAudioSourceForUser(userId) || null;
  };

  const handleAudioShare = () => {
    if (myAudioShare()) {
      stopAudioShare();
    } else {
      startAudioShare().catch((err) =>
        console.error("[voice] startAudioShare failed:", err),
      );
    }
  };

  const qualityColor = () => {
    const s = voiceStats();
    if (!s) return "var(--text-muted)";
    if (s.rtt > 200 || s.packetLoss > 5) return "var(--danger)";
    if (s.rtt > 100 || s.packetLoss > 2) return "var(--accent)";
    return "var(--success)";
  };

  return (
    <Show when={currentVoiceChannelId()}>
      <div
        style={{
          padding: "8px",
          "background-color": "var(--bg-primary)",
          "border-top": "1px solid var(--border-gold)",
        }}
      >
        <div
          style={{
            display: "flex",
            "align-items": "center",
            "justify-content": "space-between",
            gap: "6px",
            "font-size": "11px",
            color: linkColor(),
            "font-weight": "600",
            "margin-bottom": "6px",
            "padding-left": "4px",
          }}
        >
          <span style={{ "min-width": "0", overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }}>
            {linkLabel()} — {channelName()}
          </span>
          <Show when={voiceLink() === "failed"}>
            <button
              onClick={() => rejoinVoice()}
              title="Rejoin this voice channel"
              style={{
                padding: "2px 8px",
                "font-size": "10px",
                border: "1px solid var(--success)",
                "background-color": "rgba(80,200,120,0.12)",
                color: "var(--success)",
                "flex-shrink": "0",
              }}
            >
              [REJOIN]
            </button>
          </Show>
        </div>

        {/* Mic health warning (spec: voice-resilience) */}
        <Show when={micWarning()}>
          <div
            style={{
              display: "flex",
              "align-items": "center",
              "justify-content": "space-between",
              gap: "6px",
              "margin-bottom": "6px",
              padding: "4px 6px",
              "font-size": "10px",
              color: "var(--danger)",
              border: "1px solid rgba(232,64,64,0.4)",
              "background-color": "rgba(232,64,64,0.08)",
            }}
          >
            <span style={{ "min-width": "0" }}>{micWarning()}</span>
            <Show when={!isDesktop}>
              <button
                onClick={() => reacquireMic().catch((e) => console.error("[voice] retry mic failed:", e))}
                title="Re-open the microphone"
                style={{
                  padding: "2px 6px",
                  "font-size": "10px",
                  border: "1px solid var(--danger)",
                  "background-color": "transparent",
                  color: "var(--danger)",
                  "flex-shrink": "0",
                }}
              >
                [RETRY MIC]
              </button>
            </Show>
          </div>
        </Show>

        {/* Stats overlay */}
        <Show when={voiceStats()}>
          <div
            style={{
              display: "flex",
              gap: "8px",
              "margin-bottom": "4px",
              "padding-left": "4px",
              "font-size": "10px",
              color: "var(--text-muted)",
              "flex-wrap": "wrap",
            }}
          >
            <span style={{ color: qualityColor() }}>
              {voiceStats()!.rtt}ms
            </span>
            <span>{voiceStats()!.bitrate}kbps</span>
            <span>{voiceStats()!.codec}</span>
            <span title="Audio packets sent from your mic since joining">
              {voiceStats()!.packetsSent} pkts
            </span>
            <Show when={voiceStats()!.packetLoss > 0}>
              <span style={{ color: "var(--danger)" }}>
                {voiceStats()!.packetLoss}% loss
              </span>
            </Show>
          </div>
        </Show>

        {/* Input level meter: your own mic signal */}
        <Show when={!isDesktop}>
          <div
            title="Your microphone level"
            style={{
              height: "3px",
              margin: "0 4px 6px",
              "background-color": "rgba(255,255,255,0.08)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${Math.round(micLevel() * 100)}%`,
                "background-color": selfMute() ? "var(--text-muted)" : "var(--success)",
                transition: "width 60ms linear",
              }}
            />
          </div>
        </Show>

        <div style={{ display: "flex", "flex-wrap": "wrap", gap: "4px" }}>
          <button
            onClick={handleMute}
            style={{
              flex: "1 1 auto",
              padding: "5px",
              "font-size": "11px",
              border: selfMute()
                ? "1px solid var(--danger)"
                : "1px solid var(--border-gold)",
              "background-color": selfMute()
                ? "rgba(232,64,64,0.15)"
                : "transparent",
              color: selfMute() ? "var(--danger)" : "var(--text-secondary)",
            }}
            title={selfMute() ? "Unmute" : "Mute"}
          >
            {selfMute() ? "[MUTED]" : "[MIC]"}
          </button>

          <button
            onClick={handleDeafen}
            style={{
              flex: "1 1 auto",
              padding: "5px",
              "font-size": "11px",
              border: selfDeafen()
                ? "1px solid var(--danger)"
                : "1px solid var(--border-gold)",
              "background-color": selfDeafen()
                ? "rgba(232,64,64,0.15)"
                : "transparent",
              color: selfDeafen() ? "var(--danger)" : "var(--text-secondary)",
            }}
            title={selfDeafen() ? "Undeafen" : "Deafen"}
          >
            {selfDeafen() ? "[DEAF]" : "[SPK]"}
          </button>

          <Show
            when={otherScreenShare()}
            fallback={
              <button
                onClick={handleScreenShare}
                style={{
                  flex: "1 1 auto",
                  padding: "5px",
                  "font-size": "11px",
                  border: myScreenShare()
                    ? "1px solid var(--danger)"
                    : "1px solid var(--border-gold)",
                  "background-color": myScreenShare()
                    ? "rgba(232,64,64,0.15)"
                    : "transparent",
                  color: myScreenShare() ? "var(--danger)" : "var(--text-secondary)",
                }}
                title={myScreenShare() ? "Stop sharing" : "Share screen"}
              >
                {myScreenShare() ? "[STOP]" : "[SHARE]"}
              </button>
            }
          >
            {/* Someone else is sharing: the button becomes the way to watch */}
            <button
              onClick={handleWatch}
              style={{
                flex: "1 1 auto",
                padding: "5px",
                "font-size": "11px",
                border: isWatchingOther()
                  ? "1px solid var(--accent)"
                  : "1px solid var(--success)",
                "background-color": isWatchingOther()
                  ? "rgba(201,168,76,0.12)"
                  : "rgba(80,200,120,0.12)",
                color: isWatchingOther() ? "var(--accent)" : "var(--success)",
                "font-weight": "600",
              }}
              title={isWatchingOther() ? "Close the screen view" : "Watch the shared screen"}
            >
              {isWatchingOther() ? "[STOP WATCHING]" : "[WATCH]"}
            </button>
          </Show>

          <Show when={!isDesktop}>
            <button
              onClick={handleAudioShare}
              style={{
                flex: "1 1 auto",
                padding: "5px",
                "font-size": "11px",
                border: myAudioShare()
                  ? "1px solid var(--danger)"
                  : "1px solid var(--border-gold)",
                "background-color": myAudioShare()
                  ? "rgba(232,64,64,0.15)"
                  : "transparent",
                color: myAudioShare()
                  ? "var(--danger)"
                  : "var(--text-secondary)",
              }}
              title={
                myAudioShare()
                  ? `Stop sharing: ${myAudioShare()!.label}`
                  : "Share tab/system audio (use headphones)"
              }
            >
              {myAudioShare() ? "[STOP AUDIO]" : "[AUDIO]"}
            </button>
          </Show>

          <button
            onClick={handleDisconnect}
            style={{
              flex: "1 1 auto",
              padding: "5px",
              "font-size": "11px",
              border: "1px solid var(--danger)",
              "background-color": "rgba(232,64,64,0.15)",
              color: "var(--danger)",
            }}
            title="Disconnect"
          >
            [QUIT]
          </button>
        </div>
      </div>
    </Show>
  );
}
