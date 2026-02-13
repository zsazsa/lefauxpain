import type { VoiceState } from "../../stores/voice";
import { isMobile } from "../../stores/responsive";

interface VoiceUserProps {
  username: string;
  voiceState: VoiceState;
}

export default function VoiceUser(props: VoiceUserProps) {
  const isSpeaking = () => props.voiceState.speaking;
  const isMuted = () =>
    props.voiceState.self_mute || props.voiceState.server_mute;
  const isDeafened = () => props.voiceState.self_deafen;

  return (
    <div
      style={{
        width: isMobile() ? "100px" : "120px",
        display: "flex",
        "flex-direction": "column",
        "align-items": "center",
        gap: "6px",
        padding: isMobile() ? "10px" : "14px",
        border: isSpeaking()
          ? "1px solid var(--success)"
          : "1px solid var(--border-gold)",
        "background-color": "var(--bg-secondary)",
      }}
    >
      {/* Username */}
      <span
        style={{
          "font-size": isMobile() ? "12px" : "13px",
          color: "var(--accent)",
          "text-align": "center",
          "max-width": "100%",
          overflow: "hidden",
          "text-overflow": "ellipsis",
          "white-space": "nowrap",
          "font-weight": "600",
        }}
      >
        {props.username}
      </span>

      {/* Status line */}
      <div
        style={{
          display: "flex",
          gap: "6px",
          "align-items": "center",
          "font-size": "11px",
          color: "var(--text-muted)",
        }}
      >
        <span style={{ color: isSpeaking() ? "var(--success)" : "var(--text-muted)" }}>
          {isSpeaking() ? "[TX]" : "[--]"}
        </span>
        {isMuted() && (
          <span style={{ color: "var(--danger)" }} title={props.voiceState.server_mute ? "Server muted" : "Muted"}>
            [MUTE]
          </span>
        )}
        {isDeafened() && <span style={{ color: "var(--danger)" }} title="Deafened">[DEAF]</span>}
      </div>
    </div>
  );
}
