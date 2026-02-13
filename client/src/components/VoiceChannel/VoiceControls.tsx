import { Show, onMount } from "solid-js";
import {
  currentVoiceChannelId,
  selfMute,
  setSelfMute,
  selfDeafen,
  setSelfDeafen,
  voiceStats,
} from "../../stores/voice";
import { leaveVoice, toggleMute, toggleDeafen } from "../../lib/webrtc";
import { enumerateDevices } from "../../lib/devices";
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
          "border-top": "1px solid var(--bg-tertiary)",
        }}
      >
        <div
          style={{
            "font-size": "12px",
            color: "var(--success)",
            "font-weight": "600",
            "margin-bottom": "6px",
            "padding-left": "4px",
          }}
        >
          Voice Connected — {channelName()}
        </div>

        {/* Stats overlay */}
        <Show when={voiceStats()}>
          <div
            style={{
              display: "flex",
              gap: "8px",
              "margin-bottom": "6px",
              "padding-left": "4px",
              "font-size": "10px",
              "font-family": "monospace",
              color: "var(--text-muted)",
            }}
          >
            <span style={{ color: qualityColor() }}>
              {voiceStats()!.rtt}ms
            </span>
            <span>{voiceStats()!.bitrate}kbps</span>
            <span>{voiceStats()!.codec}</span>
            <Show when={voiceStats()!.packetLoss > 0}>
              <span style={{ color: "var(--danger)" }}>
                {voiceStats()!.packetLoss}% loss
              </span>
            </Show>
          </div>
        </Show>

        <div style={{ display: "flex", gap: "4px" }}>
          <button
            onClick={handleMute}
            style={{
              flex: "1",
              padding: "6px",
              "font-size": "16px",
              "border-radius": "4px",
              "background-color": selfMute()
                ? "var(--danger)"
                : "var(--bg-tertiary)",
              color: "white",
            }}
            title={selfMute() ? "Unmute" : "Mute"}
          >
            {selfMute() ? "\u{1F507}" : "\u{1F3A4}"}
          </button>

          <button
            onClick={handleDeafen}
            style={{
              flex: "1",
              padding: "6px",
              "font-size": "16px",
              "border-radius": "4px",
              "background-color": selfDeafen()
                ? "var(--danger)"
                : "var(--bg-tertiary)",
              color: "white",
            }}
            title={selfDeafen() ? "Undeafen" : "Deafen"}
          >
            {selfDeafen() ? "\u{1F508}" : "\u{1F50A}"}
          </button>

          <button
            onClick={handleDisconnect}
            style={{
              flex: "1",
              padding: "6px",
              "font-size": "16px",
              "border-radius": "4px",
              "background-color": "var(--danger)",
              color: "white",
            }}
            title="Disconnect"
          >
            {"\u{1F4DE}"}
          </button>
        </div>
      </div>
    </Show>
  );
}
