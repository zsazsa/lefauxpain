import { registerReadyHandler, registerEventHandler } from "../lib/appletRegistry";
import { registerSidebarApplet } from "../lib/appletComponents";
import { registerApplet, isAppletEnabled } from "../stores/applets";
import { registerCommands } from "../components/Terminal/commandRegistry";
import { registerCommandHandler } from "../components/Terminal/commandExecutor";
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

// Commands
registerCommands([
  { name: "radio", description: "List all radio stations", category: "radio" },
  { name: "radio-create", description: "Create a new radio station", category: "radio", args: "<name>" },
  { name: "radio-delete", description: "Delete a radio station", category: "radio", args: "<station>" },
  { name: "radio-tune", description: "Tune into a station", category: "radio", args: "<station>" },
  { name: "radio-untune", description: "Stop listening to current station", category: "radio" },
  { name: "radio-play", description: "Start/resume playback", category: "radio" },
  { name: "radio-pause", description: "Pause playback", category: "radio" },
  { name: "radio-skip", description: "Skip to next track", category: "radio" },
  { name: "radio-stop", description: "Stop playback entirely", category: "radio" },
  { name: "radio-seek", description: "Seek to position", category: "radio", args: "<time>" },
  { name: "radio-upload", description: "Upload a track", category: "radio", args: "<station>" },
  { name: "radio-queue", description: "Show station playlist", category: "radio" },
  { name: "radio-mode", description: "Set playback mode", category: "radio", args: "<mode>" },
  { name: "radio-managers", description: "Manage station managers", category: "radio", args: "<station>" },
  { name: "radio-public", description: "Toggle public controls", category: "radio" },
]);

// Command handlers
registerCommandHandler("radio", (_args, ctx) => {
  ctx.openDialog("radio");
});

registerCommandHandler("radio-create", (args, ctx) => {
  const stationName = args.trim();
  if (!stationName) {
    ctx.setStatus("Usage: /radio-create <name>");
    return;
  }
  send("radio_create_station", { name: stationName });
});

registerCommandHandler("radio-delete", (args, ctx) => {
  const stationName = args.trim();
  const station = radioStations().find(
    (s) => s.name.toLowerCase() === stationName.toLowerCase()
  );
  if (station) {
    if (confirm(`Delete station "${station.name}"?`)) {
      send("radio_delete_station", { station_id: station.id });
    }
  } else {
    ctx.setStatus(`Station "${stationName}" not found`);
  }
});

registerCommandHandler("radio-tune", (args, ctx) => {
  const stationName = args.trim();
  if (!stationName) {
    ctx.openDialog("radio");
    return;
  }
  const station = radioStations().find(
    (s) => s.name.toLowerCase() === stationName.toLowerCase()
  );
  if (station) {
    setTunedStationId(station.id);
    send("radio_tune", { station_id: station.id });
  } else {
    ctx.setStatus(`Station "${stationName}" not found`);
  }
});

registerCommandHandler("radio-untune", () => {
  if (tunedStationId()) {
    send("radio_untune", { station_id: tunedStationId() });
    setTunedStationId(null);
  }
});

registerCommandHandler("radio-play", (_args, ctx) => {
  const sid = tunedStationId();
  if (sid) {
    send("radio_play", { station_id: sid });
  } else {
    ctx.setStatus("Not tuned to any station");
  }
});

registerCommandHandler("radio-pause", (_args, ctx) => {
  const sid = tunedStationId();
  if (sid) {
    send("radio_pause", { station_id: sid });
  } else {
    ctx.setStatus("Not tuned to any station");
  }
});

registerCommandHandler("radio-skip", (_args, ctx) => {
  const sid = tunedStationId();
  if (sid) {
    send("radio_skip", { station_id: sid });
  } else {
    ctx.setStatus("Not tuned to any station");
  }
});

registerCommandHandler("radio-stop", (_args, ctx) => {
  const sid = tunedStationId();
  if (sid) {
    send("radio_stop", { station_id: sid });
  } else {
    ctx.setStatus("Not tuned to any station");
  }
});

registerCommandHandler("radio-seek", (args, ctx) => {
  const sid = tunedStationId();
  if (!sid) {
    ctx.setStatus("Not tuned to any station");
    return;
  }
  const timeStr = args.trim();
  let seconds = 0;
  if (timeStr.includes(":")) {
    const parts = timeStr.split(":");
    seconds = parseInt(parts[0]) * 60 + parseInt(parts[1]);
  } else {
    seconds = parseInt(timeStr);
  }
  if (!isNaN(seconds)) {
    send("radio_seek", { station_id: sid, position: seconds });
  }
});

registerCommandHandler("radio-upload", (_args, ctx) => {
  ctx.openDialog("radio-upload");
});

registerCommandHandler("radio-queue", (_args, ctx) => {
  ctx.openDialog("radio-queue");
});

registerCommandHandler("radio-mode", (args, ctx) => {
  const sid = tunedStationId();
  if (!sid) {
    ctx.setStatus("Not tuned to any station");
    return;
  }
  const mode = args.trim();
  const validModes = ["play-all", "loop-one", "loop-all", "single"];
  if (validModes.includes(mode)) {
    send("radio_set_mode", { station_id: sid, mode: mode.replace("-", "_") });
  } else {
    ctx.setStatus(`Valid modes: ${validModes.join(", ")}`);
  }
});

registerCommandHandler("radio-managers", (_args, ctx) => {
  ctx.openDialog("radio-managers");
});

registerCommandHandler("radio-public", (_args, ctx) => {
  const sid = tunedStationId();
  if (sid) {
    const station = radioStations().find((s) => s.id === sid);
    if (station) {
      send("radio_update_station", {
        station_id: sid,
        public_controls: !station.public_controls,
      });
    }
  } else {
    ctx.setStatus("Not tuned to any station");
  }
});
