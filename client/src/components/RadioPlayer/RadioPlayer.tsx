import { createEffect, createSignal, For, Show, onCleanup, onMount } from "solid-js";
import { send } from "../../lib/ws";
import {
  radioStations,
  radioPlaylists,
  tunedStationId,
  setTunedStationId,
  getStationPlayback,
  getStationListeners,
  updatePlaylistTracks,
  type RadioPlayback,
  type RadioPlaylist,
} from "../../stores/radio";
import { currentUser } from "../../stores/auth";
import { lookupUsername, allUsers } from "../../stores/users";
import { uploadRadioTrack, deleteRadioTrack } from "../../lib/api";
import { isMobile } from "../../stores/responsive";
import Waveform from "./Waveform";

export default function RadioPlayer() {
  let audioRef: HTMLAudioElement | undefined;
  let containerRef: HTMLDivElement | undefined;
  let eqCanvasRef: HTMLCanvasElement | undefined;
  let ignoreEvents = false;
  let audioCtx: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  let sourceNode: MediaElementAudioSourceNode | null = null;
  const [currentTime, setCurrentTime] = createSignal(0);
  const [autoplayBlocked, setAutoplayBlocked] = createSignal(false);

  const [pos, setPos] = createSignal({ x: 16, y: 60 });
  const [size, setSize] = createSignal({ w: 360, h: 420 });
  const [dragging, setDragging] = createSignal(false);
  const [resizing, setResizing] = createSignal(false);
  const [expanded, setExpanded] = createSignal(false);
  const [minimized, setMinimized] = createSignal(true);
  const [playlistOpen, setPlaylistOpen] = createSignal(false);
  const [creatingPlaylist, setCreatingPlaylist] = createSignal(false);
  const [newPlaylistName, setNewPlaylistName] = createSignal("");
  const [uploading, setUploading] = createSignal(false);
  const [openPlaylists, setOpenPlaylists] = createSignal<Set<string>>(new Set());
  const [showManageMenu, setShowManageMenu] = createSignal(false);
  const togglePlaylist = (id: string) => {
    setOpenPlaylists((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  let dragOffset = { x: 0, y: 0 };
  let resizeStart = { x: 0, y: 0, w: 0, h: 0 };

  const stationId = () => tunedStationId();
  const station = () => radioStations().find((s) => s.id === stationId());
  const pb = (): RadioPlayback | null => {
    const sid = stationId();
    return sid ? getStationPlayback(sid) : null;
  };
  const isMyPlaylist = (pl: RadioPlaylist) => pl.user_id === currentUser()?.id;
  const myPlaylists = () => radioPlaylists().filter((p) => isMyPlaylist(p) && p.station_id === stationId());
  const otherPlaylists = () => radioPlaylists().filter((p) => !isMyPlaylist(p) && p.station_id === stationId());
  const djName = () => {
    const p = pb();
    return p ? lookupUsername(p.user_id) || "DJ" : null;
  };

  const listeners = () => {
    const sid = stationId();
    return sid ? getStationListeners(sid) : [];
  };

  // Send tune/untune to server when station changes
  createEffect(() => {
    const sid = stationId();
    if (sid) {
      send("radio_tune", { station_id: sid });
    } else {
      send("radio_untune", {});
    }
  });
  onCleanup(() => send("radio_untune", {}));

  // --- Drag ---
  const onDragDown = (e: PointerEvent) => {
    if (expanded()) return;
    if ((e.target as HTMLElement).tagName === "BUTTON") return;
    if ((e.target as HTMLElement).tagName === "INPUT") return;
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

  // --- Audio analyser setup ---
  const ensureAnalyser = () => {
    if (analyser || !audioRef) return;
    try {
      audioCtx = new AudioContext();
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.7;
      sourceNode = audioCtx.createMediaElementSource(audioRef);
      sourceNode.connect(analyser);
      analyser.connect(audioCtx.destination);
    } catch {}
  };

  // --- Progress tracking + EQ render ---
  const NUM_BARS = 24;
  const SEG_COUNT = 8;
  const eqFreqData = new Uint8Array(128);
  // Build logarithmic bin ranges: each bar averages a range of bins
  // Cap at ~55% of bins (~10kHz) so rightmost bars still have energy
  const barRanges: Array<[number, number]> = [];
  {
    const maxBin = Math.floor(128 * 0.55);
    for (let i = 0; i < NUM_BARS; i++) {
      const lo = Math.pow(i / NUM_BARS, 2) * maxBin;
      const hi = Math.pow((i + 1) / NUM_BARS, 2) * maxBin;
      barRanges.push([Math.floor(lo), Math.max(Math.floor(hi), Math.floor(lo) + 1)]);
    }
  }

  let rafId = 0;
  const tickProgress = () => {
    if (audioRef) setCurrentTime(audioRef.currentTime);
    // Draw EQ bars on canvas
    if (eqCanvasRef && analyser && minimized()) {
      const parent = eqCanvasRef.parentElement;
      if (parent) {
        const pw = parent.clientWidth;
        if (eqCanvasRef.width !== pw) eqCanvasRef.width = pw;
      }
      analyser.getByteFrequencyData(eqFreqData);
      const ctx = eqCanvasRef.getContext("2d");
      if (ctx) {
        const w = eqCanvasRef.width;
        const h = eqCanvasRef.height;
        ctx.clearRect(0, 0, w, h);
        const barW = w / NUM_BARS;
        const gap = 1;
        const segH = (h - 1) / SEG_COUNT;
        for (let i = 0; i < NUM_BARS; i++) {
          // Average all bins in this bar's range
          const [lo, hi] = barRanges[i];
          let sum = 0;
          for (let b = lo; b < hi; b++) sum += eqFreqData[b];
          const val = (sum / (hi - lo)) / 255;
          const litSegs = Math.round(val * SEG_COUNT);
          const x = Math.round(i * barW);
          const bw = Math.round(barW - gap * 2);
          for (let s = 0; s < SEG_COUNT; s++) {
            const y = h - (s + 1) * segH;
            if (s < litSegs) {
              if (s >= SEG_COUNT - 2) ctx.fillStyle = "#e84040";
              else if (s >= SEG_COUNT - 4) ctx.fillStyle = "#c9a84c";
              else ctx.fillStyle = "#4caf50";
            } else {
              ctx.fillStyle = "rgba(201,168,76,0.08)";
            }
            ctx.fillRect(x + gap, y + 1, bw, segH - 2);
          }
        }
      }
    }
    rafId = requestAnimationFrame(tickProgress);
  };
  rafId = requestAnimationFrame(tickProgress);
  onCleanup(() => cancelAnimationFrame(rafId));

  const trackDuration = () => pb()?.track?.duration || 0;
  const progress = () => {
    const dur = trackDuration();
    return dur > 0 ? Math.min(currentTime() / dur, 1) : 0;
  };

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  const handleWaveformSeek = (frac: number) => {
    const dur = trackDuration();
    if (dur > 0 && audioRef) {
      audioRef.currentTime = frac * dur;
      setCurrentTime(frac * dur);
    }
  };

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
      ensureAnalyser();
      audio.play().then(() => {
        setAutoplayBlocked(false);
      }).catch(() => {
        setAutoplayBlocked(true);
      }).finally(() => { ignoreEvents = false; });
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
    if (ignoreEvents || !audioRef) return;
    const sid = stationId();
    if (sid) send("radio_pause", { station_id: sid, position: audioRef.currentTime });
  };

  const handlePlay = () => {
    if (ignoreEvents || !audioRef) return;
    const sid = stationId();
    if (sid && pb()) send("radio_resume", { station_id: sid });
  };

  const handleSeeked = () => {
    if (ignoreEvents || !audioRef) return;
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
    if (!sid || !pb()) return;
    send("radio_resume", { station_id: sid });
  };

  const handleSkip = (delta: number) => {
    if (!audioRef) return;
    audioRef.currentTime = Math.max(0, audioRef.currentTime + delta);
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

  // --- Playlist management ---
  const handleCreatePlaylist = () => {
    const name = newPlaylistName().trim();
    if (!name) return;
    send("create_radio_playlist", { name, station_id: stationId() });
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
    return user.is_admin || s.manager_ids?.includes(user.id);
  };

  const handleStartStation = () => {
    const sid = stationId();
    if (!sid) return;
    const stationPlaylists = radioPlaylists().filter(
      (p) => p.station_id === sid && p.tracks.length > 0
    );
    if (stationPlaylists.length > 0) {
      send("radio_play", { station_id: sid, playlist_id: stationPlaylists[0].id });
      setPlaylistOpen(true);
    }
  };

  const startablePlaylists = () => {
    const sid = stationId();
    if (!sid) return [];
    return radioPlaylists().filter(
      (p) => p.station_id === sid && p.tracks.length > 0
    );
  };

  const containerHeight = () => {
    if (minimized()) return "70px";
    if (expanded()) return "100%";
    return `${size().h}px`;
  };

  const trackUrl = () => pb()?.track?.url || null;

  // Find the playlist that's playing for DJ info in minimized mode
  const playingPlaylist = () => {
    const p = pb();
    if (!p) return null;
    return radioPlaylists().find((pl) => pl.id === p.playlist_id);
  };

  return (
    <div
      ref={containerRef}
      style={{
        ...(expanded()
          ? { position: "fixed", top: "0", right: "0", width: "100%", height: "100%" }
          : isMobile()
            ? { position: "relative", width: "100%", height: containerHeight(), "flex-shrink": "0" }
            : { position: "fixed", top: `${pos().y}px`, right: `${pos().x}px`, width: `${size().w}px`, height: containerHeight() }
        ),
        "z-index": "50",
        "background-color": "var(--bg-secondary)",
        border: expanded() ? "none" : "1px solid var(--border-gold)",
        "box-shadow": expanded() ? "none" : "0 4px 20px rgba(0,0,0,0.5)",
        display: "flex",
        "flex-direction": "column",
        "user-select": interacting() ? "none" : "auto",
        overflow: "hidden",
      }}
    >
      {/* Audio element — always present */}
      <audio
        ref={audioRef}
        onEnded={handleEnded}
        onPause={handlePause}
        onPlay={handlePlay}
        onSeeked={handleSeeked}
        style={{ display: "none" }}
      />

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
        {/* Left: title text */}
        <Show when={minimized()} fallback={
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
        }>
          <div
            style={{
              display: "flex",
              "align-items": "center",
              gap: "6px",
              flex: "1",
              "min-width": "0",
              overflow: "hidden",
            }}
          >
            <span
              style={{
                "font-size": "11px",
                color: "var(--text-primary)",
                "font-weight": "600",
                overflow: "hidden",
                "text-overflow": "ellipsis",
                "white-space": "nowrap",
                "min-width": "0",
                "pointer-events": "none",
              }}
            >
              {pb()?.track?.filename || "No track"}
            </span>
            <Show when={djName() && playingPlaylist()}>
              <span
                style={{
                  "font-size": "10px",
                  color: "var(--text-muted)",
                  "white-space": "nowrap",
                  "pointer-events": "none",
                  "flex-shrink": "0",
                }}
              >
                {djName()}'s {playingPlaylist()!.name}
              </span>
            </Show>
          </div>
        </Show>

        {/* Right: buttons — extra buttons before arrow+close so arrow stays in place */}
        <div style={{ display: "flex", gap: "2px", "flex-shrink": "0" }}>
          <Show when={!minimized()}>
            <button
              onClick={() => setExpanded((v) => !v)}
              style={{ padding: "1px 5px", "font-size": "10px", color: "var(--text-muted)" }}
            >
              {expanded() ? "[_]" : "[+]"}
            </button>
            <Show when={canManageStation()}>
              <button
                onClick={() => setShowManageMenu((v) => !v)}
                style={{ padding: "1px 5px", "font-size": "10px", color: "var(--text-muted)" }}
                title="Manage station"
              >
                {"\u2699"}
              </button>
            </Show>
          </Show>
          <button
            onClick={() => {
              if (minimized()) { setMinimized(false); }
              else { setMinimized(true); setExpanded(false); }
            }}
            style={{ padding: "1px 5px", "font-size": "10px", color: "var(--text-muted)" }}
            title={minimized() ? "Expand" : "Minimize"}
          >
            {minimized() ? "\u25BC" : "\u25B2"}
          </button>
          <button
            onClick={handleClose}
            style={{ padding: "1px 5px", "font-size": "10px", color: "var(--text-muted)" }}
          >
            [x]
          </button>
        </div>
      </div>

      {/* Minimized view: EQ bars or energize button */}
      <Show when={minimized()}>
        <div style={{
          padding: "2px 6px 4px",
          "background-color": "rgba(0,0,0,0.3)",
        }}>
          <Show when={pb()} fallback={
            <div style={{ display: "flex", "align-items": "center", "justify-content": "center", height: "28px" }}>
              <Show when={startablePlaylists().length > 0} fallback={
                <span style={{ "font-size": "10px", color: "var(--text-muted)", "font-style": "italic" }}>No playlists</span>
              }>
                <button
                  onClick={handleStartStation}
                  style={{
                    "font-size": "10px",
                    color: "var(--accent)",
                    border: "1px solid var(--accent)",
                    "background-color": "transparent",
                    cursor: "pointer",
                    padding: "2px 10px",
                  }}
                >
                  [energize station]
                </button>
              </Show>
            </div>
          }>
            <Show when={autoplayBlocked()} fallback={
              <canvas
                ref={eqCanvasRef}
                width={320}
                height={28}
                style={{ width: "100%", height: "28px", display: "block" }}
              />
            }>
              <div style={{ display: "flex", "align-items": "center", "justify-content": "center", height: "28px" }}>
                <button
                  onClick={() => {
                    if (audioRef) {
                      ensureAnalyser();
                      audioRef.play().then(() => setAutoplayBlocked(false)).catch(() => {});
                    }
                  }}
                  style={{
                    "font-size": "10px",
                    color: "var(--accent)",
                    border: "1px solid var(--accent)",
                    "background-color": "transparent",
                    cursor: "pointer",
                    padding: "2px 10px",
                  }}
                >
                  [click to listen]
                </button>
              </div>
            </Show>
          </Show>
        </div>
      </Show>

      {/* Management menu */}
      <Show when={showManageMenu() && !minimized()}>
        <StationManageMenu
          station={station()!}
          onClose={() => setShowManageMenu(false)}
        />
      </Show>

      {/* Expanded/normal content */}
      <Show when={!minimized()}>
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

              <Show when={autoplayBlocked()}>
                <button
                  onClick={() => {
                    if (audioRef) {
                      ensureAnalyser();
                      audioRef.play().then(() => setAutoplayBlocked(false)).catch(() => {});
                    }
                  }}
                  style={{
                    "margin-top": "6px",
                    width: "100%",
                    padding: "4px 8px",
                    "font-size": "11px",
                    color: "var(--accent)",
                    border: "1px solid var(--accent)",
                    "background-color": "var(--bg-primary)",
                    cursor: "pointer",
                  }}
                >
                  [click to listen]
                </button>
              </Show>

              {/* Waveform progress */}
              <div style={{ "margin-top": "6px" }}>
                <Waveform
                  trackUrl={trackUrl()}
                  progress={progress()}
                  height={40}
                  onSeek={handleWaveformSeek}
                />
                <div style={{ display: "flex", "justify-content": "space-between", "margin-top": "2px" }}>
                  <span style={{ "font-size": "9px", color: "var(--text-muted)" }}>{formatTime(currentTime())}</span>
                  <span style={{ "font-size": "9px", color: "var(--text-muted)" }}>{formatTime(trackDuration())}</span>
                </div>
              </div>

              {/* Controls */}
              <div style={{ display: "flex", gap: "4px", "margin-top": "6px", "align-items": "center" }}>
                <button onClick={() => handleSkip(-10)} style={controlBtnStyle} title="Back 10s">
                  [&lt;&lt;10]
                </button>
                <Show when={pb()!.playing} fallback={
                  <button onClick={handleResumeBtn} style={controlBtnStyle}>
                    [play]
                  </button>
                }>
                  <button onClick={handlePauseBtn} style={controlBtnStyle}>
                    [pause]
                  </button>
                </Show>
                <button onClick={() => handleSkip(10)} style={controlBtnStyle} title="Forward 10s">
                  [10&gt;&gt;]
                </button>
                <button onClick={handleNext} style={controlBtnStyle} title="Next track">
                  [next]
                </button>
                <button onClick={handleStop} style={{ ...controlBtnStyle, color: "var(--danger)", "border-color": "var(--danger)" }} title="Stop">
                  [stop]
                </button>
              </div>
            </div>
          </Show>

          <Show when={!pb()}>
            <div style={{ padding: "12px 10px", display: "flex", "flex-direction": "column", "align-items": "center", gap: "8px" }}>
              <div style={{ "font-size": "11px", color: "var(--text-muted)", "font-style": "italic" }}>
                Nothing playing
              </div>
              <Show when={startablePlaylists().length > 0}>
                <button
                  onClick={handleStartStation}
                  style={{
                    padding: "4px 12px",
                    "font-size": "11px",
                    color: "var(--accent)",
                    border: "1px solid var(--accent)",
                    "background-color": "transparent",
                    cursor: "pointer",
                  }}
                >
                  [energize station]
                </button>
              </Show>
            </div>
          </Show>

          {/* My Playlists section */}
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
              <span>{(playlistOpen() || expanded()) ? "\u25BC" : "\u25B6"} My Playlists</span>
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

            <Show when={playlistOpen() || expanded()}>
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

              <For each={myPlaylists()}>
                {(playlist) => (
                  <PlaylistSection
                    playlist={playlist}
                    stationId={stationId()!}
                    editable={true}
                    open={openPlaylists().has(playlist.id)}
                    onToggle={() => togglePlaylist(playlist.id)}
                    onPlay={() => handlePlayOnStation(playlist.id)}
                    onUpload={() => handleUploadTrack(playlist.id)}
                    onDeleteTrack={(trackId) => handleDeleteTrack(playlist.id, trackId)}
                    onDelete={() => handleDeletePlaylist(playlist.id)}
                    uploading={uploading()}
                  />
                )}
              </For>

              <Show when={myPlaylists().length === 0 && !creatingPlaylist()}>
                <div style={{ "font-size": "11px", color: "var(--text-muted)", "font-style": "italic", padding: "4px 0" }}>
                  No playlists yet — click + to create one
                </div>
              </Show>
            </Show>
          </div>

          {/* Others' Playlists section */}
          <Show when={otherPlaylists().length > 0}>
            <div style={{ padding: "6px 10px" }}>
              <div
                style={{
                  "font-family": "var(--font-display)",
                  "font-size": "11px",
                  "font-weight": "600",
                  "text-transform": "uppercase",
                  "letter-spacing": "1px",
                  color: "var(--text-muted)",
                  "margin-bottom": "4px",
                }}
              >
                Others' Playlists
              </div>

              <For each={otherPlaylists()}>
                {(playlist) => (
                  <PlaylistSection
                    playlist={playlist}
                    stationId={stationId()!}
                    editable={false}
                    open={openPlaylists().has(playlist.id)}
                    onToggle={() => togglePlaylist(playlist.id)}
                    onPlay={() => handlePlayOnStation(playlist.id)}
                    onUpload={() => {}}
                    onDeleteTrack={() => {}}
                    onDelete={() => {}}
                    uploading={false}
                    ownerName={lookupUsername(playlist.user_id) || undefined}
                  />
                )}
              </For>
            </div>
          </Show>

          {/* Listeners */}
          <Show when={listeners().length > 0}>
            <div style={{ padding: "6px 10px", "border-top": "1px solid rgba(201,168,76,0.15)" }}>
              <div style={{
                "font-size": "10px",
                "font-weight": "600",
                "text-transform": "uppercase",
                "letter-spacing": "1px",
                color: "var(--text-muted)",
                "margin-bottom": "3px",
              }}>
                Listeners ({listeners().length})
              </div>
              <div style={{ "font-size": "11px", color: "var(--text-secondary)" }}>
                {listeners().map((uid) => lookupUsername(uid) || uid).join(", ")}
              </div>
            </div>
          </Show>

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
      </Show>
    </div>
  );
}

function PlaylistSection(props: {
  playlist: RadioPlaylist;
  stationId: string;
  editable: boolean;
  open: boolean;
  onToggle: () => void;
  onPlay: () => void;
  onUpload: () => void;
  onDeleteTrack: (trackId: string) => void;
  onDelete: () => void;
  uploading: boolean;
  ownerName?: string;
}) {
  return (
    <div style={{ "margin-bottom": "4px", "border-bottom": "1px solid rgba(201,168,76,0.1)", "padding-bottom": "4px" }}>
      <div style={{ display: "flex", "align-items": "center", "justify-content": "space-between" }}>
        <span
          onClick={props.onToggle}
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
          {props.open ? "\u25BC" : "\u25B6"} {props.playlist.name}
          <span style={{ color: "var(--text-muted)", "font-size": "10px" }}> ({props.playlist.tracks.length})</span>
          {props.ownerName && (
            <span style={{ color: "var(--text-muted)", "font-size": "10px" }}> — {props.ownerName}</span>
          )}
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
          <Show when={props.editable}>
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
          </Show>
        </div>
      </div>

      <Show when={props.open}>
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
                <Show when={props.editable}>
                  <button
                    onClick={() => props.onDeleteTrack(track.id)}
                    style={{ "font-size": "9px", color: "var(--text-muted)", padding: "0 3px", "flex-shrink": "0" }}
                  >
                    [x]
                  </button>
                </Show>
              </div>
            )}
          </For>
          <Show when={props.playlist.tracks.length === 0}>
            <div style={{ "font-size": "10px", color: "var(--text-muted)", "font-style": "italic", padding: "2px 0" }}>
              {props.editable ? "Empty — upload tracks with [+]" : "Empty playlist"}
            </div>
          </Show>
        </div>
      </Show>
    </div>
  );
}

function StationManageMenu(props: {
  station: { id: string; name: string; manager_ids?: string[]; playback_mode?: string };
  onClose: () => void;
}) {
  const [mode, setMode] = createSignal<"main" | "rename" | "managers" | "playback" | "confirmDelete">("main");
  const [renameValue, setRenameValue] = createSignal(props.station.name);
  const [confirmValue, setConfirmValue] = createSignal("");
  let menuRef: HTMLDivElement | undefined;

  const handleClickOutside = (e: MouseEvent) => {
    if (menuRef && !menuRef.contains(e.target as Node)) {
      props.onClose();
    }
  };

  onMount(() => {
    document.addEventListener("mousedown", handleClickOutside);
  });
  onCleanup(() => {
    document.removeEventListener("mousedown", handleClickOutside);
  });

  const handleRename = () => {
    const name = renameValue().trim();
    if (name && name.length <= 32) {
      send("rename_radio_station", { station_id: props.station.id, name });
      props.onClose();
    }
  };

  const handleDelete = () => {
    send("delete_radio_station", { station_id: props.station.id });
    setTunedStationId(null);
    props.onClose();
  };

  const handleAddManager = (userId: string) => {
    send("add_radio_station_manager", { station_id: props.station.id, user_id: userId });
  };

  const handleRemoveManager = (userId: string) => {
    send("remove_radio_station_manager", { station_id: props.station.id, user_id: userId });
  };

  const managerIds = () => props.station.manager_ids || [];

  const nonManagerUsers = () =>
    allUsers().filter(
      (u) => !managerIds().includes(u.id) && u.id !== currentUser()?.id
    );

  const managerUsers = () =>
    allUsers().filter((u) => managerIds().includes(u.id));

  return (
    <div
      ref={menuRef}
      style={{
        "background-color": "var(--bg-primary)",
        "border-bottom": "1px solid var(--border-gold)",
        "font-size": "12px",
      }}
    >
      <Show when={mode() === "main"}>
        <button
          onClick={() => setMode("rename")}
          style={manageMenuItemStyle}
          onMouseOver={(e) => (e.currentTarget.style.backgroundColor = "var(--accent-glow)")}
          onMouseOut={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
        >
          Rename
        </button>
        <button
          onClick={() => setMode("managers")}
          style={manageMenuItemStyle}
          onMouseOver={(e) => (e.currentTarget.style.backgroundColor = "var(--accent-glow)")}
          onMouseOut={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
        >
          Managers
        </button>
        <button
          onClick={() => setMode("playback")}
          style={manageMenuItemStyle}
          onMouseOver={(e) => (e.currentTarget.style.backgroundColor = "var(--accent-glow)")}
          onMouseOut={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
        >
          Playback Mode
        </button>
        <button
          onClick={() => setMode("confirmDelete")}
          style={{ ...manageMenuItemStyle, color: "var(--danger)" }}
          onMouseOver={(e) => (e.currentTarget.style.backgroundColor = "rgba(232,64,64,0.1)")}
          onMouseOut={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
        >
          Delete
        </button>
      </Show>

      <Show when={mode() === "rename"}>
        <div style={{ padding: "8px" }}>
          <input
            value={renameValue()}
            onInput={(e) => setRenameValue(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleRename();
              if (e.key === "Escape") props.onClose();
            }}
            maxLength={32}
            style={{
              width: "100%",
              padding: "4px 8px",
              "background-color": "var(--bg-secondary)",
              color: "var(--text-primary)",
              border: "1px solid var(--border-gold)",
              "font-size": "12px",
              "box-sizing": "border-box",
            }}
            autofocus
          />
          <div style={{ display: "flex", gap: "4px", "margin-top": "6px" }}>
            <button onClick={handleRename} style={manageActionBtnStyle}>
              [save]
            </button>
            <button
              onClick={() => setMode("main")}
              style={{ ...manageActionBtnStyle, color: "var(--text-muted)", border: "1px solid var(--text-muted)" }}
            >
              [back]
            </button>
          </div>
        </div>
      </Show>

      <Show when={mode() === "managers"}>
        <div style={{ padding: "8px", "max-height": "200px", overflow: "auto" }}>
          <div style={{
            "font-size": "10px",
            "text-transform": "uppercase",
            "letter-spacing": "1px",
            color: "var(--text-muted)",
            "margin-bottom": "6px",
          }}>
            Current Managers
          </div>
          <Show when={managerUsers().length === 0}>
            <div style={{ color: "var(--text-muted)", "font-size": "11px", "margin-bottom": "8px" }}>
              None
            </div>
          </Show>
          <For each={managerUsers()}>
            {(user) => (
              <div style={{
                display: "flex",
                "align-items": "center",
                "justify-content": "space-between",
                padding: "3px 0",
              }}>
                <span style={{ color: "var(--text-primary)", "font-size": "11px" }}>{user.username}</span>
                <button
                  onClick={() => handleRemoveManager(user.id)}
                  style={{ "font-size": "10px", color: "var(--danger)", padding: "0 4px" }}
                >
                  [x]
                </button>
              </div>
            )}
          </For>

          <Show when={nonManagerUsers().length > 0}>
            <div style={{
              "font-size": "10px",
              "text-transform": "uppercase",
              "letter-spacing": "1px",
              color: "var(--text-muted)",
              "margin-top": "8px",
              "margin-bottom": "6px",
            }}>
              Add Manager
            </div>
            <For each={nonManagerUsers()}>
              {(user) => (
                <button
                  onClick={() => handleAddManager(user.id)}
                  style={{
                    display: "block",
                    width: "100%",
                    "text-align": "left",
                    padding: "3px 4px",
                    color: "var(--text-secondary)",
                    "background-color": "transparent",
                    border: "none",
                    cursor: "pointer",
                    "font-size": "11px",
                  }}
                  onMouseOver={(e) => (e.currentTarget.style.backgroundColor = "var(--accent-glow)")}
                  onMouseOut={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                >
                  + {user.username}
                </button>
              )}
            </For>
          </Show>

          <div style={{ "margin-top": "8px" }}>
            <button
              onClick={() => setMode("main")}
              style={{ ...manageActionBtnStyle, color: "var(--text-muted)", border: "1px solid var(--text-muted)" }}
            >
              [back]
            </button>
          </div>
        </div>
      </Show>

      <Show when={mode() === "playback"}>
        <div style={{ padding: "8px" }}>
          <div style={{
            "font-size": "10px",
            "text-transform": "uppercase",
            "letter-spacing": "1px",
            color: "var(--text-muted)",
            "margin-bottom": "6px",
          }}>
            Playback Mode
          </div>
          <For each={[
            { value: "play_all", label: "Play All", desc: "All playlists in order, stop at end" },
            { value: "loop_one", label: "Loop Playlist", desc: "Loop current playlist endlessly" },
            { value: "loop_all", label: "Loop All", desc: "All playlists in order, loop back" },
            { value: "single", label: "Single Playlist", desc: "Current playlist once, then stop" },
          ]}>
            {(opt) => (
              <label style={{
                display: "flex",
                "align-items": "flex-start",
                gap: "6px",
                padding: "4px 0",
                cursor: "pointer",
                "font-size": "11px",
                color: "var(--text-secondary)",
              }}>
                <input
                  type="radio"
                  name="playback_mode"
                  checked={(props.station.playback_mode || "play_all") === opt.value}
                  onChange={() => {
                    send("set_radio_station_mode", { station_id: props.station.id, mode: opt.value });
                  }}
                  style={{ "margin-top": "2px", "flex-shrink": "0" }}
                />
                <div>
                  <div style={{ color: "var(--text-primary)", "font-weight": "600" }}>{opt.label}</div>
                  <div style={{ "font-size": "10px", color: "var(--text-muted)" }}>{opt.desc}</div>
                </div>
              </label>
            )}
          </For>
          <div style={{ "margin-top": "8px" }}>
            <button
              onClick={() => setMode("main")}
              style={{ ...manageActionBtnStyle, color: "var(--text-muted)", border: "1px solid var(--text-muted)" }}
            >
              [back]
            </button>
          </div>
        </div>
      </Show>

      <Show when={mode() === "confirmDelete"}>
        <div style={{ padding: "8px" }}>
          <div style={{ color: "var(--text-secondary)", "margin-bottom": "8px", "line-height": "1.4", "font-size": "11px" }}>
            Type <span style={{ color: "var(--danger)", "font-weight": "600" }}>{props.station.name}</span> to confirm deletion.
          </div>
          <input
            value={confirmValue()}
            onInput={(e) => setConfirmValue(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && confirmValue() === props.station.name) handleDelete();
              if (e.key === "Escape") { setConfirmValue(""); setMode("main"); }
            }}
            placeholder={props.station.name}
            style={{
              width: "100%",
              padding: "4px 8px",
              "background-color": "var(--bg-secondary)",
              color: "var(--text-primary)",
              border: "1px solid var(--danger)",
              "font-size": "12px",
              "box-sizing": "border-box",
              "margin-bottom": "6px",
            }}
            autofocus
          />
          <div style={{ display: "flex", gap: "4px" }}>
            <button
              onClick={handleDelete}
              disabled={confirmValue() !== props.station.name}
              style={{
                ...manageActionBtnStyle,
                color: confirmValue() === props.station.name ? "var(--danger)" : "var(--text-muted)",
                border: `1px solid ${confirmValue() === props.station.name ? "var(--danger)" : "var(--text-muted)"}`,
                opacity: confirmValue() === props.station.name ? "1" : "0.5",
                cursor: confirmValue() === props.station.name ? "pointer" : "not-allowed",
              }}
            >
              [delete]
            </button>
            <button
              onClick={() => { setConfirmValue(""); setMode("main"); }}
              style={{ ...manageActionBtnStyle, color: "var(--text-muted)", border: "1px solid var(--text-muted)" }}
            >
              [cancel]
            </button>
          </div>
        </div>
      </Show>
    </div>
  );
}

const manageMenuItemStyle = {
  display: "block",
  width: "100%",
  "text-align": "left",
  padding: "6px 10px",
  color: "var(--text-primary)",
  "background-color": "transparent",
  border: "none",
  "border-bottom": "1px solid rgba(201,168,76,0.1)",
  cursor: "pointer",
  "font-size": "11px",
} as const;

const manageActionBtnStyle = {
  "font-size": "10px",
  padding: "3px 10px",
  border: "1px solid var(--accent)",
  "background-color": "transparent",
  color: "var(--accent)",
  cursor: "pointer",
} as const;

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
