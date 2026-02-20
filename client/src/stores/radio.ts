import { createSignal } from "solid-js";

export type RadioStation = {
  id: string;
  name: string;
  created_by: string | null;
  position: number;
  playback_mode: string;
  manager_ids: string[];
};

export type RadioTrack = {
  id: string;
  filename: string;
  url: string;
  duration: number;
  position: number;
  waveform?: string;
};

export type RadioPlaylist = {
  id: string;
  name: string;
  user_id: string;
  station_id: string;
  tracks: RadioTrack[];
};

export type RadioPlayback = {
  station_id: string;
  playlist_id: string;
  track_index: number;
  track: RadioTrack;
  playing: boolean;
  position: number;
  updated_at: number;
  user_id: string;
};

export type RadioStatus = {
  station_id: string;
  playing: boolean;
  track_name: string;
  user_id: string;
};

const [radioStations, setRadioStations] = createSignal<RadioStation[]>([]);
const [radioPlayback, setRadioPlayback] = createSignal<Record<string, RadioPlayback>>({});
const [radioPlaylists, setRadioPlaylists] = createSignal<RadioPlaylist[]>([]);
const [radioListeners, setRadioListeners] = createSignal<Record<string, string[]>>({});
const [radioStatus, setRadioStatus] = createSignal<Record<string, RadioStatus>>({});
const [tunedStationId, _setTunedStationId] = createSignal<string | null>(
  sessionStorage.getItem("radio_station")
);
const setTunedStationId = (id: string | null) => {
  _setTunedStationId(id);
  if (id) {
    sessionStorage.setItem("radio_station", id);
  } else {
    sessionStorage.removeItem("radio_station");
  }
};

export {
  radioStations,
  setRadioStations,
  radioPlayback,
  setRadioPlayback,
  radioPlaylists,
  setRadioPlaylists,
  radioListeners,
  setRadioListeners,
  radioStatus,
  setRadioStatus,
  tunedStationId,
  setTunedStationId,
};

export function addRadioStation(station: RadioStation) {
  setRadioStations((prev) => [...prev, station].sort((a, b) => a.position - b.position));
}

export function removeRadioStation(stationId: string) {
  setRadioStations((prev) => prev.filter((s) => s.id !== stationId));
  // If we were tuned to it, untune
  if (tunedStationId() === stationId) {
    setTunedStationId(null);
  }
}

export function renameRadioStation(stationId: string, name: string) {
  setRadioStations((prev) =>
    prev.map((s) => (s.id === stationId ? { ...s, name } : s))
  );
}

export function updateRadioStation(stationId: string, name: string, managerIds: string[], playbackMode?: string) {
  setRadioStations((prev) =>
    prev.map((s) => {
      if (s.id !== stationId) return s;
      const updated = { ...s, name, manager_ids: managerIds };
      if (playbackMode !== undefined) updated.playback_mode = playbackMode;
      return updated;
    })
  );
}

export function addRadioPlaylist(playlist: RadioPlaylist) {
  setRadioPlaylists((prev) => [...prev, playlist]);
}

export function removeRadioPlaylist(playlistId: string) {
  setRadioPlaylists((prev) => prev.filter((p) => p.id !== playlistId));
}

export function updatePlaylistTracks(playlistId: string, tracks: RadioTrack[]) {
  setRadioPlaylists((prev) =>
    prev.map((p) => (p.id === playlistId ? { ...p, tracks } : p))
  );
}

export function updateRadioPlaybackForStation(stationId: string, pb: RadioPlayback | null) {
  setRadioPlayback((prev) => {
    const next = { ...prev };
    if (pb) {
      next[stationId] = pb;
    } else {
      delete next[stationId];
    }
    return next;
  });
}

export function getStationPlayback(stationId: string): RadioPlayback | null {
  return radioPlayback()[stationId] || null;
}

export function updateRadioListeners(stationId: string, userIds: string[]) {
  setRadioListeners((prev) => ({ ...prev, [stationId]: userIds }));
}

export function updateRadioStatusForStation(stationId: string, status: RadioStatus | null) {
  setRadioStatus((prev) => {
    const next = { ...prev };
    if (status) {
      next[stationId] = status;
    } else {
      delete next[stationId];
    }
    return next;
  });
}

export function getStationStatus(stationId: string): RadioStatus | null {
  return radioStatus()[stationId] || null;
}

export function getStationListeners(stationId: string): string[] {
  return radioListeners()[stationId] || [];
}

// Clock offset: server_time - client_time (seconds).
// Add this to Date.now()/1000 to get server-relative time.
let _clockOffset = 0;
export function setClockOffset(serverTime: number) {
  _clockOffset = serverTime - Date.now() / 1000;
}
export function serverNow(): number {
  return Date.now() / 1000 + _clockOffset;
}
