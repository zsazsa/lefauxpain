import { Show, onCleanup, createSignal } from "solid-js";
import { lightboxUrl, closeLightbox } from "../stores/lightbox";

export default function Lightbox() {
  const [scale, setScale] = createSignal(1);
  const [translate, setTranslate] = createSignal({ x: 0, y: 0 });

  let initialPinchDist = 0;
  let initialScale = 1;
  let lastTouch = { x: 0, y: 0 };
  let isPanning = false;

  const reset = () => {
    setScale(1);
    setTranslate({ x: 0, y: 0 });
  };

  const handleClose = () => {
    reset();
    closeLightbox();
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") handleClose();
  };

  window.addEventListener("keydown", handleKeyDown);
  onCleanup(() => window.removeEventListener("keydown", handleKeyDown));

  const getTouchDist = (t1: Touch, t2: Touch) =>
    Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);

  const handleTouchStart = (e: TouchEvent) => {
    if (e.touches.length === 2) {
      e.preventDefault();
      initialPinchDist = getTouchDist(e.touches[0], e.touches[1]);
      initialScale = scale();
    } else if (e.touches.length === 1 && scale() > 1) {
      isPanning = true;
      lastTouch = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }
  };

  const handleTouchMove = (e: TouchEvent) => {
    if (e.touches.length === 2) {
      e.preventDefault();
      const dist = getTouchDist(e.touches[0], e.touches[1]);
      const newScale = Math.min(5, Math.max(1, initialScale * (dist / initialPinchDist)));
      setScale(newScale);
      if (newScale <= 1) setTranslate({ x: 0, y: 0 });
    } else if (e.touches.length === 1 && isPanning && scale() > 1) {
      e.preventDefault();
      const dx = e.touches[0].clientX - lastTouch.x;
      const dy = e.touches[0].clientY - lastTouch.y;
      lastTouch = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      setTranslate((prev) => ({ x: prev.x + dx, y: prev.y + dy }));
    }
  };

  const handleTouchEnd = (e: TouchEvent) => {
    if (e.touches.length < 2) {
      initialPinchDist = 0;
    }
    if (e.touches.length === 0) {
      isPanning = false;
      // Snap back to 1x if close
      if (scale() < 1.1) {
        reset();
      }
    }
  };

  // Double-tap to toggle zoom
  let lastTapTime = 0;
  const handleDoubleTap = (e: TouchEvent) => {
    if (e.touches.length !== 1) return;
    const now = Date.now();
    if (now - lastTapTime < 300) {
      e.preventDefault();
      if (scale() > 1) {
        reset();
      } else {
        setScale(2.5);
      }
    }
    lastTapTime = now;
  };

  return (
    <Show when={lightboxUrl()}>
      <div
        onClick={handleClose}
        onTouchStart={handleDoubleTap}
        style={{
          position: "fixed",
          inset: "0",
          "z-index": "1000",
          "background-color": "rgba(0,0,0,0.85)",
          display: "flex",
          "align-items": "center",
          "justify-content": "center",
          cursor: "pointer",
          "touch-action": "none",
        }}
      >
        <img
          src={lightboxUrl()!}
          onClick={(e) => e.stopPropagation()}
          onTouchStart={(e) => { e.stopPropagation(); handleTouchStart(e); }}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          style={{
            "max-width": "90vw",
            "max-height": "90vh",
            "object-fit": "contain",
            cursor: "default",
            "touch-action": "none",
            transform: `translate(${translate().x}px, ${translate().y}px) scale(${scale()})`,
            "transform-origin": "center center",
          }}
        />
      </div>
    </Show>
  );
}
