import { createSignal } from "solid-js";

export type RadioStation = {
  id: string;
  name: string;
  created_by: string | null;
  position: number;
};

export type RadioTrack = {
  id: string;
  filename: string;
  url: string;
  duration: number;
  position: number;
};

export type RadioPlaylist = {
  id: string;
  name: string;
  user_id: string;
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

const [radioStations, setRadioStations] = createSignal<RadioStation[]>([]);
const [radioPlayback, setRadioPlayback] = createSignal<Record<string, RadioPlayback>>({});
const [radioPlaylists, setRadioPlaylists] = createSignal<RadioPlaylist[]>([]);
const [tunedStationId, setTunedStationId] = createSignal<string | null>(null);

export {
  radioStations,
  setRadioStations,
  radioPlayback,
  setRadioPlayback,
  radioPlaylists,
  setRadioPlaylists,
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
