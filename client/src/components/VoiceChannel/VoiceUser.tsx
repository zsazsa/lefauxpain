import { createSignal } from "solid-js";
import type { VoiceState } from "../../stores/voice";
import { getAudioSourceForUser } from "../../stores/voice";
import { isMobile } from "../../stores/responsive";

interface VoiceUserProps {
  username: string;
  voiceState: VoiceState;
  /** This user is sharing their screen (spec: screen-share-discoverability). */
  sharing?: boolean;
  /** When set, the tile is a click target that opens the watch view. */
  onWatch?: () => void;
}

export default function VoiceUser(props: VoiceUserProps) {
  const isSpeaking = () => props.voiceState.speaking;
  const isMuted = () =>
    props.voiceState.self_mute || props.voiceState.server_mute;
  const isDeafened = () => props.voiceState.self_deafen;
  const sharedAudio = () => getAudioSourceForUser(props.voiceState.user_id);
  const watchable = () => !!(props.sharing && props.onWatch);
  const [hover, setHover] = createSignal(false);

  const borderColor = () => {
    if (watchable() && hover()) return "var(--accent)";
    if (isSpeaking()) return "var(--success)";
    return "var(--border-gold)";
  };

  return (
    <div
      onClick={() => watchable() && props.onWatch!()}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={watchable() ? `Watch ${props.username}'s screen` : undefined}
      style={{
        width: isMobile() ? "100px" : "120px",
        display: "flex",
        "flex-direction": "column",
        "align-items": "center",
        gap: "6px",
        padding: isMobile() ? "10px" : "14px",
        border: `1px solid ${borderColor()}`,
        "box-shadow": watchable() && hover() ? "0 0 0 1px var(--accent)" : "none",
        "background-color": "var(--bg-secondary)",
        cursor: watchable() ? "pointer" : "default",
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
          "flex-wrap": "wrap",
          "justify-content": "center",
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
        {sharedAudio() && (
          <span
            style={{ color: "var(--accent)" }}
            title={`Sharing audio: ${sharedAudio()!.label}`}
          >
            [♪]
          </span>
        )}
        {props.sharing && (
          <span
            style={{
              color: "var(--accent)",
              "font-weight": "600",
              "letter-spacing": "1px",
            }}
            title={watchable() ? "Click to watch" : "Sharing screen"}
          >
            SHARING
          </span>
        )}
      </div>

      {props.sharing && watchable() && (
        <span style={{ "font-size": "10px", color: hover() ? "var(--accent)" : "var(--text-muted)" }}>
          [watch]
        </span>
      )}
    </div>
  );
}
