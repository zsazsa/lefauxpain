import { createEffect, onCleanup, onMount } from "solid-js";
import { send } from "../../lib/ws";
import { mediaPlayback, getMediaById, setWatchingMedia } from "../../stores/media";

export default function MediaPlayer() {
  let videoRef: HTMLVideoElement | undefined;
  let ignoreEvents = false; // prevent feedback loops from programmatic seeks

  const currentVideo = () => {
    const pb = mediaPlayback();
    if (!pb) return null;
    return getMediaById(pb.video_id) || null;
  };

  // Sync video element to server playback state
  createEffect(() => {
    const pb = mediaPlayback();
    const video = videoRef;
    if (!video || !pb) return;

    // If video source changed, update src
    const item = getMediaById(pb.video_id);
    if (!item) return;
    if (!video.src.endsWith(item.url)) {
      ignoreEvents = true;
      video.src = item.url;
      video.load();
    }

    // Calculate expected position
    const now = Date.now() / 1000;
    const expectedPos = pb.playing
      ? pb.position + (now - pb.updated_at)
      : pb.position;

    // Only seek if drift > 0.5s
    const drift = Math.abs(video.currentTime - expectedPos);
    if (drift > 0.5) {
      ignoreEvents = true;
      video.currentTime = expectedPos;
    }

    // Sync play/pause state
    if (pb.playing && video.paused) {
      ignoreEvents = true;
      video.play().catch(() => {}).finally(() => { ignoreEvents = false; });
    } else if (!pb.playing && !video.paused) {
      ignoreEvents = true;
      video.pause();
      ignoreEvents = false;
    } else {
      ignoreEvents = false;
    }
  });

  const handlePlay = () => {
    if (ignoreEvents || !videoRef) return;
    const pb = mediaPlayback();
    if (!pb) return;
    send("media_play", {
      video_id: pb.video_id,
      position: videoRef.currentTime,
    });
  };

  const handlePause = () => {
    if (ignoreEvents || !videoRef) return;
    send("media_pause", { position: videoRef.currentTime });
  };

  const handleSeeked = () => {
    if (ignoreEvents || !videoRef) return;
    send("media_seek", { position: videoRef.currentTime });
  };

  const handleStop = () => {
    send("media_stop", {});
  };

  const handleHide = () => {
    setWatchingMedia(false);
  };

  const skip = (delta: number) => {
    if (!videoRef) return;
    const newPos = videoRef.currentTime + delta;
    videoRef.currentTime = Math.max(0, newPos);
    send("media_seek", { position: Math.max(0, newPos) });
  };

  return (
    <div
      style={{
        display: "flex",
        "flex-direction": "column",
        height: "100%",
        "background-color": "var(--bg-primary)",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          "align-items": "center",
          "justify-content": "space-between",
          padding: "8px 16px",
          "border-bottom": "1px solid var(--border-gold)",
          "min-height": "41px",
        }}
      >
        <span
          style={{
            "font-size": "13px",
            color: "var(--accent)",
            "font-weight": "600",
            overflow: "hidden",
            "text-overflow": "ellipsis",
            "white-space": "nowrap",
          }}
        >
          {currentVideo()?.filename || "Media Player"}
        </span>
        <div style={{ display: "flex", gap: "4px", "flex-shrink": "0" }}>
          <button
            onClick={() => skip(-10)}
            style={{
              padding: "2px 8px",
              "font-size": "11px",
              color: "var(--text-muted)",
            }}
            title="Rewind 10s"
          >
            [-10s]
          </button>
          <button
            onClick={() => skip(10)}
            style={{
              padding: "2px 8px",
              "font-size": "11px",
              color: "var(--text-muted)",
            }}
            title="Forward 10s"
          >
            [+10s]
          </button>
          <button
            onClick={handleStop}
            style={{
              padding: "2px 8px",
              "font-size": "11px",
              color: "var(--danger)",
            }}
            title="Stop for everyone"
          >
            [STOP]
          </button>
          <button
            onClick={handleHide}
            style={{
              padding: "2px 8px",
              "font-size": "11px",
              color: "var(--text-muted)",
            }}
            title="Hide player (keeps playing)"
          >
            [HIDE]
          </button>
        </div>
      </div>

      {/* Video */}
      <div
        style={{
          flex: "1",
          display: "flex",
          "align-items": "center",
          "justify-content": "center",
          "min-height": "0",
          padding: "8px",
        }}
      >
        <video
          ref={videoRef}
          controls
          onPlay={handlePlay}
          onPause={handlePause}
          onSeeked={handleSeeked}
          style={{
            "max-width": "100%",
            "max-height": "100%",
            "background-color": "#000",
          }}
        />
      </div>
    </div>
  );
}
