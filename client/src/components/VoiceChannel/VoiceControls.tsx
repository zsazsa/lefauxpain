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
          "border-top": "1px solid var(--border-gold)",
        }}
      >
        <div
          style={{
            "font-size": "11px",
            color: "var(--success)",
            "font-weight": "600",
            "margin-bottom": "6px",
            "padding-left": "4px",
          }}
        >
          VOICE CONNECTED — {channelName()}
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
              flex: "1",
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

          <button
            onClick={handleDisconnect}
            style={{
              flex: "1",
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
