import { createEffect, createSignal } from "solid-js";
import { send } from "../../lib/ws";
import {
  mediaPlayback,
  getMediaById,
  setWatchingMedia,
  selectedMediaId,
} from "../../stores/media";

export default function MediaPlayer() {
  let videoRef: HTMLVideoElement | undefined;
  let containerRef: HTMLDivElement | undefined;
  let ignoreEvents = false;
  const [expanded, setExpanded] = createSignal(false);
  const [pos, setPos] = createSignal({ x: 16, y: 16 });
  const [size, setSize] = createSignal({ w: 480, h: 300 });
  const [dragging, setDragging] = createSignal(false);
  const [resizing, setResizing] = createSignal(false);
  let dragOffset = { x: 0, y: 0 };
  let resizeStart = { x: 0, y: 0, w: 0, h: 0 };

  const currentVideo = () => {
    const id = selectedMediaId();
    if (!id) return null;
    return getMediaById(id) || null;
  };

  const isSynced = () => {
    const pb = mediaPlayback();
    const id = selectedMediaId();
    return pb && id && pb.video_id === id;
  };

  // --- Drag (header) ---
  const onDragDown = (e: PointerEvent) => {
    if (expanded()) return;
    if ((e.target as HTMLElement).tagName === "BUTTON") return;
    const el = containerRef;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    dragOffset = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    setDragging(true);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  };

  const onDragMove = (e: PointerEvent) => {
    if (!dragging()) return;
    const el = containerRef;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let left = Math.max(0, Math.min(e.clientX - dragOffset.x, window.innerWidth - w));
    let top = Math.max(0, Math.min(e.clientY - dragOffset.y, window.innerHeight - h));
    setPos({ x: window.innerWidth - left - w, y: top });
  };

  const onDragUp = () => setDragging(false);

  // --- Resize (bottom-left handle) ---
  const onResizeDown = (e: PointerEvent) => {
    if (expanded()) return;
    resizeStart = { x: e.clientX, y: e.clientY, w: size().w, h: size().h };
    setResizing(true);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  };

  const onResizeMove = (e: PointerEvent) => {
    if (!resizing()) return;
    // Dragging bottom-left: left shrinks width (dx negative = wider), down grows height
    const dx = e.clientX - resizeStart.x;
    const dy = e.clientY - resizeStart.y;
    const newW = Math.max(280, Math.min(resizeStart.w - dx, window.innerWidth - 32));
    const newH = Math.max(180, Math.min(resizeStart.h + dy, window.innerHeight - 32));
    setSize({ w: newW, h: newH });
  };

  const onResizeUp = () => setResizing(false);

  const interacting = () => dragging() || resizing();

  // --- Sync video to server playback ---
  createEffect(() => {
    const video = videoRef;
    if (!video) return;
    const item = currentVideo();
    if (!item) return;

    if (!video.src.endsWith(item.url)) {
      ignoreEvents = true;
      video.src = item.url;
      video.load();
      ignoreEvents = false;
    }

    const pb = mediaPlayback();
    if (!pb || pb.video_id !== item.id) return;

    const now = Date.now() / 1000;
    const expectedPos = pb.playing
      ? pb.position + (now - pb.updated_at)
      : pb.position;

    const drift = Math.abs(video.currentTime - expectedPos);
    if (drift > 0.5) {
      ignoreEvents = true;
      video.currentTime = expectedPos;
    }

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
    const id = selectedMediaId();
    if (!id) return;
    send("media_play", { video_id: id, position: videoRef.currentTime });
  };

  const handlePause = () => {
    if (ignoreEvents || !videoRef) return;
    if (!isSynced()) return;
    send("media_pause", { position: videoRef.currentTime });
  };

  const handleSeeked = () => {
    if (ignoreEvents || !videoRef) return;
    if (!isSynced()) return;
    send("media_seek", { position: videoRef.currentTime });
  };

  const handleStop = () => send("media_stop", {});
  const handleHide = () => setWatchingMedia(false);

  return (
    <div
      ref={containerRef}
      style={{
        position: "fixed",
        top: expanded() ? "0" : `${pos().y}px`,
        right: expanded() ? "0" : `${pos().x}px`,
        width: expanded() ? "100%" : `${size().w}px`,
        height: expanded() ? "100%" : `${size().h}px`,
        "z-index": "50",
        "background-color": "var(--bg-secondary)",
        border: expanded() ? "none" : "1px solid var(--border-gold)",
        "box-shadow": expanded() ? "none" : "0 4px 20px rgba(0,0,0,0.5)",
        display: "flex",
        "flex-direction": "column",
        "user-select": interacting() ? "none" : "auto",
      }}
    >
      {/* Header — drag handle */}
      <div
        onPointerDown={onDragDown}
        onPointerMove={onDragMove}
        onPointerUp={onDragUp}
        style={{
          display: "flex",
          "align-items": "center",
          "justify-content": "space-between",
          padding: "4px 8px",
          "border-bottom": "1px solid var(--border-gold)",
          "background-color": "var(--bg-primary)",
          "min-height": "28px",
          gap: "4px",
          cursor: expanded() ? "default" : "grab",
          "touch-action": "none",
          "flex-shrink": "0",
        }}
      >
        <span
          style={{
            "font-size": "11px",
            color: "var(--accent)",
            "font-weight": "600",
            overflow: "hidden",
            "text-overflow": "ellipsis",
            "white-space": "nowrap",
            "min-width": "0",
            flex: "1",
            "pointer-events": "none",
          }}
          title={currentVideo()?.filename}
        >
          {currentVideo()?.filename || "Media Player"}
        </span>
        <div style={{ display: "flex", gap: "2px", "flex-shrink": "0" }}>
          <button
            onClick={() => setExpanded((v) => !v)}
            style={{ padding: "1px 5px", "font-size": "10px", color: "var(--text-muted)" }}
            title={expanded() ? "Minimize" : "Expand"}
          >
            {expanded() ? "[_]" : "[+]"}
          </button>
          <button
            onClick={handleStop}
            style={{ padding: "1px 5px", "font-size": "10px", color: "var(--danger)" }}
            title="Stop for everyone"
          >
            [STOP]
          </button>
          <button
            onClick={handleHide}
            style={{ padding: "1px 5px", "font-size": "10px", color: "var(--text-muted)" }}
            title="Hide player"
          >
            [x]
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
          "background-color": "#000",
          position: "relative",
        }}
      >
        <video
          ref={videoRef}
          controls
          onPlay={handlePlay}
          onPause={handlePause}
          onSeeked={handleSeeked}
          style={{
            width: "100%",
            height: "100%",
            display: "block",
            "object-fit": "contain",
          }}
        />

        {/* Resize handle — bottom-left corner */}
        {!expanded() && (
          <div
            onPointerDown={onResizeDown}
            onPointerMove={onResizeMove}
            onPointerUp={onResizeUp}
            style={{
              position: "absolute",
              bottom: "0",
              left: "0",
              width: "18px",
              height: "18px",
              cursor: "nesw-resize",
              "touch-action": "none",
              "z-index": "1",
            }}
          >
            <svg width="18" height="18" viewBox="0 0 18 18" style={{ display: "block" }}>
              <line x1="4" y1="14" x2="14" y2="4" stroke="var(--text-muted)" stroke-width="1.5" />
              <line x1="4" y1="10" x2="10" y2="4" stroke="var(--text-muted)" stroke-width="1.5" />
            </svg>
          </div>
        )}
      </div>
    </div>
  );
}
