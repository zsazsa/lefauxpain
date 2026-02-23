import { registerReadyHandler, registerEventHandler } from "../lib/appletRegistry";
import { registerSidebarApplet } from "../lib/appletComponents";
import { registerApplet, isAppletEnabled } from "../stores/applets";
import MediaSidebar from "../components/Sidebar/MediaSidebar";
import {
  setMediaList,
  addMediaItem,
  removeMediaItem,
  setMediaPlayback,
  setWatchingMedia,
  mediaPlayback,
  mediaList,
  selectedMediaId,
} from "../stores/media";

// Register applet definition
registerApplet({ id: "media", name: "Media Library" });

// Register sidebar component
registerSidebarApplet({
  id: "media",
  component: MediaSidebar,
  visible: () => isAppletEnabled("media") && mediaList().length > 0,
});

// Ready handler
registerReadyHandler((data) => {
  setMediaList(data.media_list || []);
  setMediaPlayback(data.media_playback || null);
});

// Event handlers
registerEventHandler("media_added", (d) => {
  addMediaItem(d);
});

registerEventHandler("media_removed", (d) => {
  removeMediaItem(d.id);
  // If the removed video was selected, close player
  if (selectedMediaId() === d.id) {
    setMediaPlayback(null);
    setWatchingMedia(false);
  }
});

registerEventHandler("media_playback", (d) => {
  setMediaPlayback(d || null);
});
