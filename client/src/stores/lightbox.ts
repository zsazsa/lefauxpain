import { createSignal } from "solid-js";

const [lightboxUrl, setLightboxUrl] = createSignal<string | null>(null);

export function openLightbox(url: string) {
  setLightboxUrl(url);
}

export function closeLightbox() {
  setLightboxUrl(null);
}

export { lightboxUrl };
