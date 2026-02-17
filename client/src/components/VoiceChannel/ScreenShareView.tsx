import { createEffect, createSignal, onCleanup } from "solid-js";
import {
  screenShareStream,
  watchingScreenShare,
  setWatchingScreenShare,
} from "../../stores/voice";
import { currentUser } from "../../stores/auth";
import { onlineUsers } from "../../stores/users";
import { stopScreenShare, unsubscribeScreenShare } from "../../lib/screenshare";

interface ScreenShareViewProps {
  userId: string;
  channelId: string;
}

export default function ScreenShareView(props: ScreenShareViewProps) {
  let videoRef: HTMLVideoElement | undefined;
  const [muted, setMuted] = createSignal(true);

  const isPresenter = () => currentUser()?.id === props.userId;

  const presenterName = () => {
    if (isPresenter()) return "You";
    const user = onlineUsers().find((u) => u.id === props.userId);
    return user?.username || "Unknown";
  };

  createEffect(() => {
    const stream = screenShareStream();
    if (videoRef && stream) {
      videoRef.srcObject = stream;
      videoRef.play().catch(() => {});
    }
  });

  onCleanup(() => {
    if (videoRef) {
      videoRef.srcObject = null;
    }
  });

  const handleClose = () => {
    if (isPresenter()) {
      stopScreenShare();
    } else {
      unsubscribeScreenShare();
    }
    setWatchingScreenShare(null);
  };

  const handleFullscreen = () => {
    videoRef?.requestFullscreen?.();
  };

  const toggleMute = () => {
    if (videoRef) {
      const newMuted = !muted();
      videoRef.muted = newMuted;
      setMuted(newMuted);
    }
  };

  return (
    <div
      style={{
        display: "flex",
        "flex-direction": "column",
        height: "100%",
        "background-color": "#0a0a0f",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          "align-items": "center",
          "justify-content": "space-between",
          padding: "8px 16px",
          "background-color": "var(--bg-secondary)",
          "border-bottom": "1px solid var(--border-gold)",
          "flex-shrink": "0",
        }}
      >
        <span style={{ "font-size": "13px", color: "var(--text-secondary)" }}>
          {"\uD83D\uDDA5"} {presenterName()}{isPresenter() ? " (sharing)" : " is sharing"}
        </span>
        <button
          onClick={handleClose}
          style={{
            padding: "2px 8px",
            "font-size": "11px",
            border: "1px solid var(--danger)",
            "background-color": "rgba(232,64,64,0.15)",
            color: "var(--danger)",
          }}
        >
          {isPresenter() ? "[STOP SHARING]" : "[X]"}
        </button>
      </div>

      {/* Video */}
      <div
        style={{
          flex: "1",
          display: "flex",
          "align-items": "center",
          "justify-content": "center",
          "min-height": "0",
          position: "relative",
        }}
      >
        <video
          ref={videoRef}
          autoplay
          playsinline
          muted={muted()}
          onClick={handleFullscreen}
          style={{
            width: "100%",
            height: "100%",
            "object-fit": "contain",
            cursor: "pointer",
            "background-color": "#000",
            transform: "translateZ(0)",
          }}
        />

        {/* Unmute button */}
        <button
          onClick={toggleMute}
          style={{
            position: "absolute",
            bottom: "12px",
            right: "12px",
            padding: "4px 10px",
            "font-size": "11px",
            border: "1px solid var(--border-gold)",
            "background-color": muted()
              ? "rgba(232,64,64,0.3)"
              : "rgba(0,0,0,0.6)",
            color: muted() ? "var(--danger)" : "var(--text-secondary)",
          }}
          title={muted() ? "Unmute audio" : "Mute audio"}
        >
          {muted() ? "[MUTED]" : "[AUDIO ON]"}
        </button>
      </div>
    </div>
  );
}
