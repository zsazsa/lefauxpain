import { createSignal } from "solid-js";

export type MediaItem = {
  id: string;
  filename: string;
  url: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
};

export type MediaPlayback = {
  video_id: string;
  playing: boolean;
  position: number;
  updated_at: number; // unix timestamp in seconds (fractional)
};

const [mediaList, setMediaList] = createSignal<MediaItem[]>([]);
const [mediaPlayback, setMediaPlayback] = createSignal<MediaPlayback | null>(null);
const [watchingMedia, setWatchingMedia] = createSignal(false);

export {
  mediaList,
  setMediaList,
  mediaPlayback,
  setMediaPlayback,
  watchingMedia,
  setWatchingMedia,
};

export function addMediaItem(item: MediaItem) {
  setMediaList((prev) => [item, ...prev]);
}

export function removeMediaItem(id: string) {
  setMediaList((prev) => prev.filter((m) => m.id !== id));
}

export function getMediaById(id: string): MediaItem | undefined {
  return mediaList().find((m) => m.id === id);
}
