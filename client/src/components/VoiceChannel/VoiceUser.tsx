import type { VoiceState } from "../../stores/voice";

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
        width: "120px",
        display: "flex",
        "flex-direction": "column",
        "align-items": "center",
        gap: "8px",
        padding: "16px",
        "border-radius": "8px",
        "background-color": "var(--bg-secondary)",
      }}
    >
      {/* Avatar with speaking ring */}
      <div
        style={{
          width: "64px",
          height: "64px",
          "border-radius": "50%",
          "background-color": "var(--accent)",
          display: "flex",
          "align-items": "center",
          "justify-content": "center",
          "font-size": "24px",
          "font-weight": "700",
          color: "white",
          border: isSpeaking()
            ? "3px solid var(--success)"
            : "3px solid transparent",
          transition: "border-color 0.15s",
        }}
      >
        {props.username[0].toUpperCase()}
      </div>

      {/* Username */}
      <span
        style={{
          "font-size": "13px",
          color: "var(--text-primary)",
          "text-align": "center",
          "max-width": "100%",
          overflow: "hidden",
          "text-overflow": "ellipsis",
          "white-space": "nowrap",
        }}
      >
        {props.username}
      </span>

      {/* Status icons */}
      <div
        style={{
          display: "flex",
          gap: "4px",
          "font-size": "14px",
        }}
      >
        {isMuted() && (
          <span title={props.voiceState.server_mute ? "Server muted" : "Muted"}>
            {props.voiceState.server_mute ? "\u{1F507}" : "\u{1F507}"}
          </span>
        )}
        {isDeafened() && <span title="Deafened">{"\u{1F508}"}</span>}
      </div>
    </div>
  );
}
