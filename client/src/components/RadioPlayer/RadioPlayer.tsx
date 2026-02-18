import { createEffect, createSignal, For, Show, onCleanup } from "solid-js";
import { send } from "../../lib/ws";
import {
  radioStations,
  radioPlayback,
  radioPlaylists,
  tunedStationId,
  setTunedStationId,
  getStationPlayback,
  updatePlaylistTracks,
  type RadioPlayback,
  type RadioPlaylist,
  type RadioTrack,
} from "../../stores/radio";
import { currentUser } from "../../stores/auth";
import { lookupUsername } from "../../stores/users";
import { uploadRadioTrack, deleteRadioTrack } from "../../lib/api";

export default function RadioPlayer() {
  let audioRef: HTMLAudioElement | undefined;
  let containerRef: HTMLDivElement | undefined;
  let ignoreEvents = false;

  const [pos, setPos] = createSignal({ x: 16, y: 60 });
  const [size, setSize] = createSignal({ w: 360, h: 420 });
  const [dragging, setDragging] = createSignal(false);
  const [resizing, setResizing] = createSignal(false);
  const [expanded, setExpanded] = createSignal(false);
  const [playlistOpen, setPlaylistOpen] = createSignal(false);
  const [creatingPlaylist, setCreatingPlaylist] = createSignal(false);
  const [newPlaylistName, setNewPlaylistName] = createSignal("");
  const [uploading, setUploading] = createSignal(false);
  let dragOffset = { x: 0, y: 0 };
  let resizeStart = { x: 0, y: 0, w: 0, h: 0 };

  const stationId = () => tunedStationId();
  const station = () => radioStations().find((s) => s.id === stationId());
  const pb = (): RadioPlayback | null => {
    const sid = stationId();
    return sid ? getStationPlayback(sid) : null;
  };
  const isController = () => {
    const p = pb();
    return p && p.user_id === currentUser()?.id;
  };
  const djName = () => {
    const p = pb();
    return p ? lookupUsername(p.user_id) || "DJ" : null;
  };

  // --- Drag ---
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

  // --- Resize ---
  const onResizeDown = (e: PointerEvent) => {
    if (expanded()) return;
    resizeStart = { x: e.clientX, y: e.clientY, w: size().w, h: size().h };
    setResizing(true);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  const onResizeMove = (e: PointerEvent) => {
    if (!resizing()) return;
    const dx = e.clientX - resizeStart.x;
    const dy = e.clientY - resizeStart.y;
    const newW = Math.max(280, Math.min(resizeStart.w - dx, window.innerWidth - 32));
    const newH = Math.max(200, Math.min(resizeStart.h + dy, window.innerHeight - 32));
    setSize({ w: newW, h: newH });
  };
  const onResizeUp = () => setResizing(false);

  const interacting = () => dragging() || resizing();

  // --- Audio sync ---
  createEffect(() => {
    const audio = audioRef;
    if (!audio) return;
    const p = pb();
    if (!p || !p.track) {
      audio.pause();
      audio.src = "";
      return;
    }

    if (!audio.src.endsWith(p.track.url)) {
      ignoreEvents = true;
      audio.src = p.track.url;
      audio.load();
    }

    const now = Date.now() / 1000;
    const expectedPos = p.playing
      ? p.position + (now - p.updated_at)
      : p.position;

    const drift = Math.abs(audio.currentTime - expectedPos);
    if (drift > 0.5) {
      ignoreEvents = true;
      audio.currentTime = Math.max(0, expectedPos);
    }

    if (p.playing && audio.paused) {
      ignoreEvents = true;
      audio.play().catch(() => {}).finally(() => { ignoreEvents = false; });
    } else if (!p.playing && !audio.paused) {
      ignoreEvents = true;
      audio.pause();
      ignoreEvents = false;
    } else {
      ignoreEvents = false;
    }
  });

  const handleEnded = () => {
    const sid = stationId();
    if (sid) {
      send("radio_track_ended", { station_id: sid });
    }
  };

  const handlePause = () => {
    if (ignoreEvents || !audioRef || !isController()) return;
    const sid = stationId();
    if (sid) send("radio_pause", { station_id: sid, position: audioRef.currentTime });
  };

  const handlePlay = () => {
    if (ignoreEvents || !audioRef || !isController()) return;
    // If no playback state exists, don't send — user should use play button
  };

  const handleSeeked = () => {
    if (ignoreEvents || !audioRef || !isController()) return;
    const sid = stationId();
    if (sid) send("radio_seek", { station_id: sid, position: audioRef.currentTime });
  };

  // --- Controls ---
  const handlePauseBtn = () => {
    const sid = stationId();
    if (!sid || !audioRef) return;
    send("radio_pause", { station_id: sid, position: audioRef.currentTime });
  };

  const handleResumeBtn = () => {
    const sid = stationId();
    const p = pb();
    if (!sid || !p) return;
    // Re-play the same playlist from current position
    send("radio_seek", { station_id: sid, position: p.position });
    // Actually we need to unpause — send a play with the same playlist
    // The simplest approach: send radio_play again (restarts from beginning)
    // Better: add a resume op. For now, toggle playing via seek + position update.
    // Let's just change the pause state via the server
    send("radio_pause", { station_id: sid, position: p.position });
  };

  const handleNext = () => {
    const sid = stationId();
    if (sid) send("radio_next", { station_id: sid });
  };

  const handleStop = () => {
    const sid = stationId();
    if (sid) send("radio_stop", { station_id: sid });
  };

  const handleClose = () => setTunedStationId(null);

  const handleDeleteStation = () => {
    const sid = stationId();
    if (!sid) return;
    if (confirm(`Delete station "${station()?.name}"?`)) {
      send("delete_radio_station", { station_id: sid });
      setTunedStationId(null);
    }
  };

  // --- Playlist management ---
  const handleCreatePlaylist = () => {
    const name = newPlaylistName().trim();
    if (!name) return;
    send("create_radio_playlist", { name });
    setNewPlaylistName("");
    setCreatingPlaylist(false);
  };

  const handleDeletePlaylist = (id: string) => {
    if (confirm("Delete this playlist and all its tracks?")) {
      send("delete_radio_playlist", { playlist_id: id });
    }
  };

  const handlePlayOnStation = (playlistId: string) => {
    const sid = stationId();
    if (!sid) return;
    send("radio_play", { station_id: sid, playlist_id: playlistId });
  };

  const handleUploadTrack = async (playlistId: string) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "audio/*";
    input.multiple = true;
    input.onchange = async () => {
      if (!input.files) return;
      setUploading(true);
      for (const file of input.files) {
        try {
          const result = await uploadRadioTrack(playlistId, file);
          // Add track to local playlist
          updatePlaylistTracks(playlistId, [
            ...(radioPlaylists().find((p) => p.id === playlistId)?.tracks || []),
            result,
          ]);
        } catch (e) {
          console.error("Upload failed:", e);
        }
      }
      setUploading(false);
    };
    input.click();
  };

  const handleDeleteTrack = async (playlistId: string, trackId: string) => {
    try {
      await deleteRadioTrack(trackId);
      const playlist = radioPlaylists().find((p) => p.id === playlistId);
      if (playlist) {
        updatePlaylistTracks(
          playlistId,
          playlist.tracks.filter((t) => t.id !== trackId)
        );
      }
    } catch (e) {
      console.error("Delete track failed:", e);
    }
  };

  const canManageStation = () => {
    const s = station();
    const user = currentUser();
    if (!s || !user) return false;
    return user.is_admin || s.created_by === user.id;
  };

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
        >
          {"\u266B"} {station()?.name || "Radio"}
        </span>
        <div style={{ display: "flex", gap: "2px", "flex-shrink": "0" }}>
          <button
            onClick={() => setExpanded((v) => !v)}
            style={{ padding: "1px 5px", "font-size": "10px", color: "var(--text-muted)" }}
          >
            {expanded() ? "[_]" : "[+]"}
          </button>
          <Show when={canManageStation()}>
            <button
              onClick={handleDeleteStation}
              style={{ padding: "1px 5px", "font-size": "10px", color: "var(--danger)" }}
              title="Delete station"
            >
              [DEL]
            </button>
          </Show>
          <button
            onClick={handleClose}
            style={{ padding: "1px 5px", "font-size": "10px", color: "var(--text-muted)" }}
          >
            [x]
          </button>
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: "1", overflow: "auto", "min-height": "0", position: "relative" }}>
        {/* Now playing */}
        <Show when={pb()}>
          <div style={{ padding: "8px 10px", "border-bottom": "1px solid rgba(201,168,76,0.15)" }}>
            <div style={{ "font-size": "12px", color: "var(--text-primary)", "font-weight": "600" }}>
              {pb()!.track?.filename || "Unknown track"}
            </div>
            <div style={{ "font-size": "10px", color: "var(--text-muted)", "margin-top": "2px" }}>
              DJ: {djName()}
            </div>

            {/* Controls — only for controller */}
            <Show when={isController()}>
              <div style={{ display: "flex", gap: "4px", "margin-top": "6px" }}>
                <Show when={pb()!.playing}>
                  <button onClick={handlePauseBtn} style={controlBtnStyle}>
                    [pause]
                  </button>
                </Show>
                <button onClick={handleNext} style={controlBtnStyle}>
                  [next]
                </button>
                <button onClick={handleStop} style={{ ...controlBtnStyle, color: "var(--danger)", "border-color": "var(--danger)" }}>
                  [stop]
                </button>
              </div>
            </Show>
          </div>
        </Show>

        <Show when={!pb()}>
          <div style={{ padding: "8px 10px", "font-size": "11px", color: "var(--text-muted)", "font-style": "italic" }}>
            Nothing playing — select a playlist below to start
          </div>
        </Show>

        {/* Hidden audio element */}
        <audio
          ref={audioRef}
          onEnded={handleEnded}
          onPause={handlePause}
          onPlay={handlePlay}
          onSeeked={handleSeeked}
          style={{ display: "none" }}
        />

        {/* Playlist section */}
        <div style={{ padding: "6px 10px" }}>
          <div
            onClick={() => setPlaylistOpen((v) => !v)}
            style={{
              display: "flex",
              "align-items": "center",
              "justify-content": "space-between",
              cursor: "pointer",
              "font-family": "var(--font-display)",
              "font-size": "11px",
              "font-weight": "600",
              "text-transform": "uppercase",
              "letter-spacing": "1px",
              color: "var(--text-muted)",
              "margin-bottom": "4px",
            }}
          >
            <span>{playlistOpen() ? "\u25BC" : "\u25B6"} My Playlists</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setCreatingPlaylist(true);
                setPlaylistOpen(true);
              }}
              style={{ "font-size": "14px", color: "var(--text-muted)", padding: "0 2px" }}
            >
              +
            </button>
          </div>

          <Show when={playlistOpen()}>
            <Show when={creatingPlaylist()}>
              <div style={{ padding: "4px 0" }}>
                <input
                  value={newPlaylistName()}
                  onInput={(e) => setNewPlaylistName(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleCreatePlaylist();
                    if (e.key === "Escape") setCreatingPlaylist(false);
                  }}
                  placeholder="Playlist name..."
                  autofocus
                  style={inputStyle}
                />
              </div>
            </Show>

            <For each={radioPlaylists()}>
              {(playlist) => (
                <PlaylistSection
                  playlist={playlist}
                  stationId={stationId()!}
                  onPlay={() => handlePlayOnStation(playlist.id)}
                  onUpload={() => handleUploadTrack(playlist.id)}
                  onDeleteTrack={(trackId) => handleDeleteTrack(playlist.id, trackId)}
                  onDelete={() => handleDeletePlaylist(playlist.id)}
                  uploading={uploading()}
                />
              )}
            </For>

            <Show when={radioPlaylists().length === 0 && !creatingPlaylist()}>
              <div style={{ "font-size": "11px", color: "var(--text-muted)", "font-style": "italic", padding: "4px 0" }}>
                No playlists yet — click + to create one
              </div>
            </Show>
          </Show>
        </div>

        {/* Resize handle */}
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

function PlaylistSection(props: {
  playlist: RadioPlaylist;
  stationId: string;
  onPlay: () => void;
  onUpload: () => void;
  onDeleteTrack: (trackId: string) => void;
  onDelete: () => void;
  uploading: boolean;
}) {
  const [open, setOpen] = createSignal(false);

  return (
    <div style={{ "margin-bottom": "4px", "border-bottom": "1px solid rgba(201,168,76,0.1)", "padding-bottom": "4px" }}>
      <div style={{ display: "flex", "align-items": "center", "justify-content": "space-between" }}>
        <span
          onClick={() => setOpen((v) => !v)}
          style={{
            "font-size": "12px",
            color: "var(--text-secondary)",
            cursor: "pointer",
            flex: "1",
            "min-width": "0",
            overflow: "hidden",
            "text-overflow": "ellipsis",
            "white-space": "nowrap",
          }}
        >
          {open() ? "\u25BC" : "\u25B6"} {props.playlist.name}
          <span style={{ color: "var(--text-muted)", "font-size": "10px" }}> ({props.playlist.tracks.length})</span>
        </span>
        <div style={{ display: "flex", gap: "2px", "flex-shrink": "0" }}>
          <Show when={props.playlist.tracks.length > 0}>
            <button
              onClick={props.onPlay}
              style={{ "font-size": "10px", color: "var(--success)", padding: "1px 4px" }}
              title="Play on this station"
            >
              [play]
            </button>
          </Show>
          <button
            onClick={props.onUpload}
            disabled={props.uploading}
            style={{ "font-size": "10px", color: "var(--accent)", padding: "1px 4px", opacity: props.uploading ? "0.5" : "1" }}
            title="Upload tracks"
          >
            {props.uploading ? "[...]" : "[+]"}
          </button>
          <button
            onClick={props.onDelete}
            style={{ "font-size": "10px", color: "var(--danger)", padding: "1px 4px" }}
            title="Delete playlist"
          >
            [x]
          </button>
        </div>
      </div>

      <Show when={open()}>
        <div style={{ "padding-left": "12px" }}>
          <For each={props.playlist.tracks}>
            {(track, i) => (
              <div
                style={{
                  display: "flex",
                  "align-items": "center",
                  "justify-content": "space-between",
                  padding: "2px 0",
                  "font-size": "11px",
                }}
              >
                <span
                  style={{
                    color: "var(--text-secondary)",
                    overflow: "hidden",
                    "text-overflow": "ellipsis",
                    "white-space": "nowrap",
                    flex: "1",
                    "min-width": "0",
                  }}
                  title={track.filename}
                >
                  {i() + 1}. {track.filename}
                </span>
                <button
                  onClick={() => props.onDeleteTrack(track.id)}
                  style={{ "font-size": "9px", color: "var(--text-muted)", padding: "0 3px", "flex-shrink": "0" }}
                >
                  [x]
                </button>
              </div>
            )}
          </For>
          <Show when={props.playlist.tracks.length === 0}>
            <div style={{ "font-size": "10px", color: "var(--text-muted)", "font-style": "italic", padding: "2px 0" }}>
              Empty — upload tracks with [+]
            </div>
          </Show>
        </div>
      </Show>
    </div>
  );
}

const controlBtnStyle = {
  "font-size": "10px",
  padding: "2px 8px",
  color: "var(--accent)",
  border: "1px solid var(--accent)",
  "background-color": "transparent",
} as const;

const inputStyle = {
  width: "100%",
  padding: "4px 8px",
  "font-size": "12px",
  "background-color": "var(--bg-primary)",
  color: "var(--text-primary)",
  border: "1px solid var(--border-gold)",
} as const;
