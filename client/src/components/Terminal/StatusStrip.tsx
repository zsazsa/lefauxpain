import { Show } from "solid-js";
import { currentVoiceChannelId, selfMute, selfDeafen, getUsersInVoiceChannel } from "../../stores/voice";
import { tunedStationId, radioStations, getStationPlayback, serverNow } from "../../stores/radio";
import { channels } from "../../stores/channels";
import { connState, ping } from "../../lib/ws";

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function StatusStrip() {
  const voiceChannel = () => {
    const id = currentVoiceChannelId();
    if (!id) return null;
    return channels().find((c) => c.id === id);
  };

  const voiceUserCount = () => {
    const id = currentVoiceChannelId();
    if (!id) return 0;
    return getUsersInVoiceChannel(id).length;
  };

  const tunedStation = () => {
    const id = tunedStationId();
    if (!id) return null;
    return radioStations().find((s) => s.id === id);
  };

  const playback = () => {
    const id = tunedStationId();
    if (!id) return null;
    return getStationPlayback(id);
  };

  const currentPosition = () => {
    const pb = playback();
    if (!pb || !pb.playing) return pb?.position ?? 0;
    return pb.position + (serverNow() - pb.updated_at);
  };

  const pingColor = () => {
    const p = ping();
    if (p === null) return "var(--text-muted)";
    if (p < 100) return "var(--success)";
    if (p < 300) return "var(--accent)";
    return "var(--danger)";
  };

  const hasContent = () => voiceChannel() || tunedStation() || ping() !== null;

  return (
    <Show when={hasContent()}>
      <div
        style={{
          display: "flex",
          "align-items": "center",
          gap: "12px",
          padding: "2px 12px",
          "font-size": "11px",
          color: "var(--text-muted)",
          "border-top": "1px solid var(--border-gold)",
          "border-bottom": "1px solid var(--border-gold)",
          "background-color": "var(--bg-secondary)",
          "white-space": "nowrap",
          overflow: "hidden",
          "min-height": "20px",
        }}
      >
        {/* Voice segment */}
        <Show when={voiceChannel()}>
          <span style={{ display: "flex", "align-items": "center", gap: "4px" }}>
            <span style={{ color: "var(--accent)" }}>{"\u2666"}</span>
            <span style={{ color: "var(--text-secondary)" }}>{voiceChannel()!.name}</span>
            <span>({voiceUserCount()})</span>
            <Show when={selfMute()}>
              <span>{"\uD83D\uDD07"}</span>
            </Show>
            <Show when={selfDeafen()}>
              <span>{"\uD83D\uDD08"}</span>
            </Show>
          </span>
        </Show>

        {/* Separator */}
        <Show when={voiceChannel() && tunedStation()}>
          <span style={{ color: "var(--border-gold)" }}>{"\u2502"}</span>
        </Show>

        {/* Radio segment */}
        <Show when={tunedStation()}>
          <span style={{ display: "flex", "align-items": "center", gap: "4px" }}>
            <span>{"\uD83D\uDCFB"}</span>
            <span style={{ color: "var(--text-secondary)" }}>{tunedStation()!.name}</span>
            <Show when={playback()}>
              <span>{playback()!.playing ? "\u25B6" : "\u23F8"}</span>
              <span>{playback()!.track.filename}</span>
              <span>
                {formatTime(currentPosition())}/{formatTime(playback()!.track.duration)}
              </span>
            </Show>
          </span>
        </Show>

        {/* Spacer */}
        <span style={{ flex: "1" }} />

        {/* Connection quality */}
        <Show when={ping() !== null}>
          <span style={{ display: "flex", "align-items": "center", gap: "4px" }}>
            <span style={{
              width: "6px",
              height: "6px",
              "border-radius": "50%",
              "background-color": pingColor(),
              display: "inline-block",
            }} />
            <span>{ping()}ms</span>
          </span>
        </Show>
      </div>
    </Show>
  );
}
