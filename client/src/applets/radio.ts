import { registerReadyHandler, registerEventHandler } from "../lib/appletRegistry";
import { registerSidebarApplet } from "../lib/appletComponents";
import { registerApplet, isAppletEnabled } from "../stores/applets";
import { send } from "../lib/ws";
import RadioSidebar from "../components/Sidebar/RadioSidebar";
import {
  setClockOffset,
  setRadioStations,
  addRadioStation,
  removeRadioStation,
  renameRadioStation,
  updateRadioStation,
  setRadioPlayback,
  setRadioPlaylists,
  setRadioListeners,
  setRadioStatus,
  addRadioPlaylist,
  removeRadioPlaylist,
  updatePlaylistTracks,
  updateRadioPlaybackForStation,
  updateRadioListeners,
  updateRadioStatusForStation,
  tunedStationId,
  setTunedStationId,
  radioStations,
} from "../stores/radio";

// Register applet definition
registerApplet({ id: "radio", name: "Radio Stations" });

// Register sidebar component
registerSidebarApplet({
  id: "radio",
  component: RadioSidebar,
  visible: () => isAppletEnabled("radio"),
});

// Ready handler
registerReadyHandler((data) => {
  if (data.server_time) setClockOffset(data.server_time);
  setRadioStations(data.radio_stations || []);
  setRadioPlaylists(data.radio_playlists || []);
  // Convert radio_playback object to our store format
  {
    const pb = data.radio_playback || {};
    const mapped: Record<string, any> = {};
    for (const [sid, state] of Object.entries(pb)) {
      if (state && !(state as any).stopped) {
        mapped[sid] = state;
      }
    }
    setRadioPlayback(mapped);
  }
  setRadioListeners(data.radio_listeners || {});
  // Derive initial radio_status from radio_playback
  {
    const pb = data.radio_playback || {};
    const statusMap: Record<string, any> = {};
    for (const [sid, state] of Object.entries(pb)) {
      if (state && !(state as any).stopped) {
        const s = state as any;
        statusMap[sid] = {
          station_id: sid,
          playing: s.playing,
          track_name: s.track?.filename || "Playing",
          user_id: s.user_id,
        };
      }
    }
    setRadioStatus(statusMap);
  }
  // Re-send tune if we were already tuned (e.g. after reconnect)
  {
    const sid = tunedStationId();
    if (sid) send("radio_tune", { station_id: sid });
  }
});

// Event handlers
registerEventHandler("radio_station_create", (d) => {
  addRadioStation({ ...d, manager_ids: d.manager_ids || [], playback_mode: d.playback_mode || "play_all", public_controls: d.public_controls || false });
});

registerEventHandler("radio_station_delete", (d) => {
  removeRadioStation(d.station_id);
});

registerEventHandler("radio_station_rename", (d) => {
  renameRadioStation(d.id, d.name);
});

registerEventHandler("radio_station_update", (d) => {
  updateRadioStation(d.id, d.name, d.manager_ids || [], d.playback_mode, d.public_controls);
});

registerEventHandler("radio_playback", (d) => {
  if (d && !d.stopped) {
    updateRadioPlaybackForStation(d.station_id, d);
  } else if (d) {
    updateRadioPlaybackForStation(d.station_id, null);
  }
});

registerEventHandler("radio_playlist_created", (d) => {
  addRadioPlaylist(d);
});

registerEventHandler("radio_playlist_deleted", (d) => {
  removeRadioPlaylist(d.playlist_id);
});

registerEventHandler("radio_playlist_tracks", (d) => {
  updatePlaylistTracks(d.playlist_id, d.tracks || []);
});

registerEventHandler("radio_status", (d) => {
  if (d.stopped) {
    updateRadioStatusForStation(d.station_id, null);
  } else {
    updateRadioStatusForStation(d.station_id, {
      station_id: d.station_id,
      playing: d.playing,
      track_name: d.track_name,
      user_id: d.user_id,
    });
  }
});

registerEventHandler("radio_listeners", (d) => {
  updateRadioListeners(d.station_id, d.user_ids || []);
});
