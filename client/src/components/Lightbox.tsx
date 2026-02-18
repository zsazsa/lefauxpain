import { Show, onCleanup } from "solid-js";
import { lightboxUrl, closeLightbox } from "../stores/lightbox";

export default function Lightbox() {
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") closeLightbox();
  };

  window.addEventListener("keydown", handleKeyDown);
  onCleanup(() => window.removeEventListener("keydown", handleKeyDown));

  return (
    <Show when={lightboxUrl()}>
      <div
        onClick={closeLightbox}
        style={{
          position: "fixed",
          inset: "0",
          "z-index": "1000",
          "background-color": "rgba(0,0,0,0.85)",
          display: "flex",
          "align-items": "center",
          "justify-content": "center",
          cursor: "pointer",
        }}
      >
        <img
          src={lightboxUrl()!}
          onClick={(e) => e.stopPropagation()}
          style={{
            "max-width": "90vw",
            "max-height": "90vh",
            "object-fit": "contain",
            cursor: "default",
          }}
        />
      </div>
    </Show>
  );
}
