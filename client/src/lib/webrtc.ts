import { send } from "./ws";
import {
  setJoinedVoiceChannel,
  setVoiceStats,
  currentVoiceChannelId,
  selfMute,
  selfDeafen,
  setVoiceLink,
  setMicWarning,
  micWarning,
  setMicLevel,
} from "../stores/voice";
import { setupAudioPipeline, cleanupAudioPipeline, cleanupTrack, setAllIncomingGain } from "./audio";
import { startSpeakingDetection, stopSpeakingDetection, isDesktop, tauriInvoke } from "./devices";
import { playJoinSound, playLeaveSound } from "./sounds";
import { settings } from "../stores/settings";
import { attachPendingShareIfAny, resetAudioShareState } from "./audioShare";

let peerConnection: RTCPeerConnection | null = null;
let localStream: MediaStream | null = null;
let micSender: RTCRtpSender | null = null;
let statsInterval: number | null = null;
let prevBytesSent = 0;
let prevTimestamp = 0;
// Track whether we're in a desktop voice session (Rust handles WebRTC)
let desktopVoiceActive = false;
// Queue ICE candidates received before remote description is set
let pendingIceCandidates: RTCIceCandidateInit[] = [];
let remoteDescriptionSet = false;

// --- Recovery state (spec: voice-resilience) ---
// Set while we asked the server to drop our peer ourselves (leave or
// rejoin), so our own leave broadcast is not mistaken for a server-side
// drop that needs a rejoin.
let leaveExpected = false;
let leaveExpectedTimer: number | null = null;
let rejoinAttempts = 0;
let rejoinTimer: number | null = null;
let disconnectedTimer: number | null = null;
const MAX_REJOIN_ATTEMPTS = 3;
const DISCONNECTED_GRACE_MS = 8000;

// --- Mic health state ---
let micMuteTimer: number | null = null;
const MIC_NOT_DELIVERING = "Mic is not delivering audio";
const MIC_FALLBACK = "Saved mic not found, using default";
const MIC_LOST = "Mic was lost";
const MIC_RETRYING = "Mic was lost, retrying…";

// --- Mic recovery state (spec: voice-resilience, mic recovery amendment) ---
// Recovery is a state, not a single call: it starts when the mic track ends
// or when the sender stops moving bytes, retries with backoff for as long as
// the user stays in voice, and ends when bytes flow again.
let micRecovering = false;
let micAttemptInFlight = false;
let micRetryTimer: number | null = null;
let micRetryAttempt = 0;
let micRecoveryFellBack = false;
let micStallPolls = 0;
const MIC_RETRY_DELAYS_MS = [2000, 4000, 8000];
const MIC_RETRY_PERIOD_MS = 15000;
const MIC_STALL_POLLS = 3; // consecutive 2 s stats polls with no bytes sent
const MIC_FATAL_ERRORS = new Set(["NotAllowedError", "SecurityError"]);

function errorName(err: unknown): string {
  return (err as DOMException)?.name || "Error";
}

function startStatsPolling() {
  stopStatsPolling();
  prevBytesSent = 0;
  prevTimestamp = 0;
  micStallPolls = 0;
  statsInterval = window.setInterval(async () => {
    if (!peerConnection) return;
    const pc = peerConnection;
    const [stats, micStats] = await Promise.all([
      pc.getStats(),
      micSender ? micSender.getStats().catch(() => null) : Promise.resolve(null),
    ]);
    if (pc !== peerConnection) return; // torn down while we were waiting
    let rtt = 0;
    let jitter = 0;
    let packetsLost = 0;
    let packetsSent = 0;
    let bytesSent = 0;
    let timestamp = 0;
    let codec = "opus";

    stats.forEach((report) => {
      // ICE candidate pair gives the most reliable RTT (STUN keepalives)
      if (report.type === "candidate-pair" && report.state === "succeeded") {
        rtt = (report.currentRoundTripTime || 0) * 1000;
      }
      if (report.type === "remote-inbound-rtp" && report.kind === "audio") {
        jitter = (report.jitter || 0) * 1000;
        packetsLost = report.packetsLost || 0;
      }
    });
    // Outbound fields come from the mic sender itself so an active audio
    // share (a second outbound audio stream) cannot mask a silent mic.
    (micStats ?? stats).forEach((report) => {
      if (report.type === "outbound-rtp" && report.kind === "audio") {
        bytesSent = report.bytesSent || 0;
        timestamp = report.timestamp || 0;
        packetsSent = report.packetsSent || 0;
      }
    });
    const bytesAdvanced = bytesSent > prevBytesSent;

    let bitrate = 0;
    if (prevTimestamp > 0 && timestamp > prevTimestamp) {
      const deltaBits = (bytesSent - prevBytesSent) * 8;
      const deltaSec = (timestamp - prevTimestamp) / 1000;
      bitrate = Math.round(deltaBits / deltaSec / 1000); // kbps
    }
    prevBytesSent = bytesSent;
    prevTimestamp = timestamp;

    const lossPercent =
      packetsSent > 0
        ? Math.round((packetsLost / (packetsSent + packetsLost)) * 100)
        : 0;

    setVoiceStats({
      rtt: Math.round(rtt),
      jitter: Math.round(jitter * 10) / 10,
      packetLoss: Math.max(0, lossPercent),
      bitrate,
      codec,
      packetsSent,
    });

    checkMicFlow(pc, bytesAdvanced);
  }, 2000);
}

function stopStatsPolling() {
  if (statsInterval !== null) {
    clearInterval(statsInterval);
    statsInterval = null;
  }
  setVoiceStats(null);
}

// ---------------------------------------------------------------------
// Microphone acquisition and health
// ---------------------------------------------------------------------

/**
 * Get the microphone with the saved device, falling back to the default
 * device when the saved one is gone. `fellBack` tells the caller to show
 * the fallback warning.
 */
async function acquireMic(): Promise<{ stream: MediaStream; fellBack: boolean }> {
  const s = settings();
  const audioConstraints: MediaTrackConstraints = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  };
  console.log("[voice] acquireMic: isDesktop:", isDesktop, "inputDeviceId:", s.inputDeviceId);
  if (s.inputDeviceId && !isDesktop) {
    audioConstraints.deviceId = { exact: s.inputDeviceId };
  }
  console.log("[voice] getUserMedia constraints:", JSON.stringify(audioConstraints));
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
    return { stream, fellBack: false };
  } catch (err) {
    const name = (err as DOMException)?.name;
    if (audioConstraints.deviceId && (name === "OverconstrainedError" || name === "NotFoundError")) {
      console.warn("[voice] Saved device not found, falling back to default mic");
      delete audioConstraints.deviceId;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
      return { stream, fellBack: true };
    }
    throw err;
  }
}

function clearMicMuteTimer() {
  if (micMuteTimer !== null) {
    clearTimeout(micMuteTimer);
    micMuteTimer = null;
  }
}

/**
 * Watch the local mic track. On Windows a Bluetooth profile switch, a USB
 * re-enumeration or the OS privacy toggle leaves the track attached but
 * muted (Chrome sends silence) or ends it outright. Both used to go
 * unnoticed: the server kept "receiving" the track and nobody could hear
 * the user.
 */
function attachMicTrackHandlers(track: MediaStreamTrack) {
  track.onmute = () => {
    console.warn("[voice] local mic track muted by the system");
    if (micMuteTimer !== null) return;
    micMuteTimer = window.setTimeout(() => {
      micMuteTimer = null;
      if (track.muted && track.readyState === "live" && !micRecovering) {
        setMicWarning(MIC_NOT_DELIVERING);
      }
    }, 1000);
  };
  track.onunmute = () => {
    console.log("[voice] local mic track unmuted");
    clearMicMuteTimer();
    if (micWarning() === MIC_NOT_DELIVERING) setMicWarning(null);
  };
  track.onended = () => {
    // A track we already swapped out is not our concern any more.
    if (localStream?.getAudioTracks()[0] !== track) return;
    console.warn("[voice] local mic track ended");
    clearMicMuteTimer();
    if (micRecovering) {
      // The replacement died too; do not wait out the stall window.
      if (!micAttemptInFlight && micRetryTimer === null) {
        scheduleNextMicAttempt("replacement track ended");
      }
      return;
    }
    startMicRecovery("track ended");
  };
}

/**
 * Re-acquire the microphone and swap it into the live sender. Resolves to
 * whether the acquire fell back to the default device, or null when voice
 * was left while the browser was still opening the device. Throws when the
 * device cannot be opened; the mic in use is left untouched in that case.
 */
async function swapInFreshMic(): Promise<boolean | null> {
  const old = localStream;
  if (!old) return null;
  const wasEnabled = old.getAudioTracks()[0]?.enabled ?? !selfMute();

  const { stream: newStream, fellBack } = await acquireMic();
  if (localStream !== old) {
    newStream.getTracks().forEach((t) => t.stop());
    return null;
  }
  const newTrack = newStream.getAudioTracks()[0];
  newTrack.enabled = wasEnabled;
  attachMicTrackHandlers(newTrack);

  if (micSender) {
    await micSender.replaceTrack(newTrack);
  }

  old.getTracks().forEach((t) => {
    t.onended = null;
    t.stop();
  });
  localStream = newStream;

  stopSpeakingDetection();
  startSpeakingDetection(localStream);
  console.log("[voice] mic re-acquired:", newTrack.label, fellBack ? "(fallback)" : "");
  return fellBack;
}

/** Begin a recovery: banner up, first attempt right away. */
function startMicRecovery(reason: string) {
  if (isDesktop || !localStream || micRecovering) return;
  console.warn("[voice] mic recovery started:", reason);
  micRecovering = true;
  micRetryAttempt = 0;
  micStallPolls = 0;
  micRecoveryFellBack = micWarning() === MIC_FALLBACK;
  clearMicMuteTimer();
  setMicWarning(MIC_RETRYING);
  void attemptMicRecovery();
}

function stopMicRecovery() {
  micRecovering = false;
  micRetryAttempt = 0;
  micStallPolls = 0;
  if (micRetryTimer !== null) {
    clearTimeout(micRetryTimer);
    micRetryTimer = null;
  }
}

/** Called by the stats poll once bytes are moving again. */
function finishMicRecovery() {
  console.log("[voice] mic recovery finished: audio is flowing");
  stopMicRecovery();
  setMicWarning(micRecoveryFellBack ? MIC_FALLBACK : null);
}

/** Backoff: 2 s, 4 s, 8 s, then every 15 s while the user stays in voice. */
function scheduleNextMicAttempt(reason: string) {
  const delay =
    micRetryAttempt < MIC_RETRY_DELAYS_MS.length
      ? MIC_RETRY_DELAYS_MS[micRetryAttempt]
      : MIC_RETRY_PERIOD_MS;
  micRetryAttempt++;
  console.warn(`[voice] mic recovery: ${reason}; next attempt in ${delay}ms`);
  if (micRetryTimer !== null) clearTimeout(micRetryTimer);
  micRetryTimer = window.setTimeout(() => {
    micRetryTimer = null;
    void attemptMicRecovery();
  }, delay);
}

/**
 * One recovery attempt. A throw schedules the next attempt (or stops on a
 * permission error). A resolve hands over to the stats poll, which either
 * finishes the recovery when bytes flow or schedules the next attempt when
 * the new track is silent too.
 */
async function attemptMicRecovery(): Promise<void> {
  if (micAttemptInFlight) return;
  if (micRetryTimer !== null) {
    clearTimeout(micRetryTimer);
    micRetryTimer = null;
  }
  if (!micRecovering || !localStream) return;
  micAttemptInFlight = true;
  try {
    const fellBack = await swapInFreshMic();
    if (fellBack === null || !micRecovering) return;
    micRecoveryFellBack = fellBack;
    micStallPolls = 0;
    console.log("[voice] mic recovery: new track in place, waiting for audio to flow");
  } catch (err) {
    if (!micRecovering) return;
    const name = errorName(err);
    if (MIC_FATAL_ERRORS.has(name)) {
      console.error("[voice] mic recovery stopped:", name, err);
      stopMicRecovery();
      setMicWarning(`${MIC_LOST} (${name})`);
      return;
    }
    console.warn("[voice] mic recovery attempt failed:", name, err);
    setMicWarning(`${MIC_RETRYING} (${name})`);
    scheduleNextMicAttempt(name);
  } finally {
    micAttemptInFlight = false;
  }
}

/**
 * Watchdog fed by the stats poll every 2 s. A connected peer whose live,
 * enabled mic track has not moved bytesSent for MIC_STALL_POLLS polls is
 * treated like an ended track. Bytes flowing again is what ends a recovery.
 */
function checkMicFlow(pc: RTCPeerConnection, bytesAdvanced: boolean) {
  if (isDesktop) return;
  if (micRecovering) {
    if (micAttemptInFlight) return;
    if (bytesAdvanced) {
      finishMicRecovery();
    } else if (micRetryTimer === null) {
      // Verifying a swapped-in track: still silent after the stall window.
      micStallPolls++;
      if (micStallPolls >= MIC_STALL_POLLS) {
        micStallPolls = 0;
        scheduleNextMicAttempt("new track is silent");
      }
    }
    return;
  }
  const track = micSender?.track;
  if (
    pc.connectionState !== "connected" ||
    !track ||
    !track.enabled ||
    track.readyState !== "live"
  ) {
    micStallPolls = 0;
    return;
  }
  if (bytesAdvanced) {
    micStallPolls = 0;
    return;
  }
  micStallPolls++;
  if (micStallPolls >= MIC_STALL_POLLS) {
    micStallPolls = 0;
    startMicRecovery(`no audio sent for ${MIC_STALL_POLLS * 2} s`);
  }
}

/** A device appeared or vanished: if we are waiting to retry, retry now. */
function onDeviceChange() {
  if (!micRecovering || micAttemptInFlight) return;
  console.log("[voice] devices changed during mic recovery; retrying now");
  void attemptMicRecovery();
}

/**
 * [RETRY MIC]. During a recovery it cancels the pending timer and attempts
 * now. Outside one (fallback or not-delivering banner) it tries the saved
 * device once and keeps the mic in use, and the banner, on failure.
 */
export async function reacquireMic(): Promise<void> {
  if (isDesktop || !localStream || micAttemptInFlight) return;
  if (micRecovering) {
    await attemptMicRecovery();
    return;
  }
  try {
    const fellBack = await swapInFreshMic();
    if (fellBack === null) return;
    setMicWarning(fellBack ? MIC_FALLBACK : null);
  } catch (err) {
    const name = errorName(err);
    console.warn("[voice] retry mic failed:", name, err);
    const track = localStream?.getAudioTracks()[0];
    if (track && track.readyState !== "live") setMicWarning(`${MIC_LOST} (${name})`);
  }
}

// ---------------------------------------------------------------------
// Join / leave
// ---------------------------------------------------------------------

export async function joinVoice(channelId: string) {
  // Leave current voice first
  if (peerConnection || desktopVoiceActive) {
    leaveVoice();
  }
  clearRecoveryTimers();
  rejoinAttempts = 0;
  await startVoiceSession(channelId, { quiet: false });
}

/**
 * Acquire media and ask the server for a peer. Shared by the user-initiated
 * join and the automatic rejoin (which runs quietly: no join sound).
 */
async function startVoiceSession(channelId: string, opts: { quiet: boolean }) {
  if (isDesktop) {
    // Desktop: Rust handles mic capture, WebRTC, and audio playback
    try {
      await tauriInvoke("voice_start");
      // Apply current settings to Rust engine
      const s = settings();
      if (s.masterVolume !== undefined) {
        tauriInvoke("voice_set_master_volume", { volume: s.masterVolume }).catch(() => {});
      }
      if (s.micGain !== undefined) {
        tauriInvoke("voice_set_mic_gain", { gain: s.micGain }).catch(() => {});
      }
    } catch (err) {
      console.error("[voice] Failed to start native voice engine:", err);
      if (opts.quiet) setVoiceLink("failed");
      return;
    }
    desktopVoiceActive = true;
    sessionStorage.setItem("voice_channel", channelId);
    if (!opts.quiet) playJoinSound();
    setJoinedVoiceChannel(channelId);
    if (!opts.quiet) setVoiceLink("connected");
    send("join_voice", { channel_id: channelId });
    resendSelfState();
    return;
  }

  // Browser: existing WebRTC path
  try {
    const { stream, fellBack } = await acquireMic();
    localStream = stream;
    if (fellBack) setMicWarning(MIC_FALLBACK);
    navigator.mediaDevices?.addEventListener?.("devicechange", onDeviceChange);
    const tracks = localStream.getAudioTracks();
    console.log("[voice] getUserMedia succeeded, tracks:", tracks.map(t => ({
      label: t.label,
      enabled: t.enabled,
      muted: t.muted,
      readyState: t.readyState,
      settings: t.getSettings(),
    })));
    if (tracks[0]) {
      tracks[0].enabled = !selfMute();
      attachMicTrackHandlers(tracks[0]);
    }
  } catch (err) {
    console.error("[voice] Failed to get microphone:", err);
    if (opts.quiet) setVoiceLink("failed");
    return;
  }

  // Start speaking detection on local stream
  startSpeakingDetection(localStream);

  sessionStorage.setItem("voice_channel", channelId);
  if (!opts.quiet) playJoinSound();
  setJoinedVoiceChannel(channelId);
  // A fresh join shows "connected" right away (as before); a rejoin stays
  // "reconnecting" until the new peer connection reports connected.
  if (!opts.quiet) setVoiceLink("connected");
  send("join_voice", { channel_id: channelId });
  resendSelfState();
}

/** After a (re)join the server peer is new: re-announce mute/deafen. */
function resendSelfState() {
  if (selfMute()) {
    send("voice_self_mute", { muted: true });
    if (isDesktop) {
      desktopMuted = true;
      tauriInvoke("voice_set_mute", { muted: true }).catch(() => {});
    }
  }
  if (selfDeafen()) {
    send("voice_self_deafen", { deafened: true });
    if (isDesktop) tauriInvoke("voice_set_deafen", { deafened: true }).catch(() => {});
    else setAllIncomingGain(0);
  }
}

function expectLeave() {
  leaveExpected = true;
  if (leaveExpectedTimer !== null) clearTimeout(leaveExpectedTimer);
  // Safety valve: never stay "expected" forever if the ack never comes.
  leaveExpectedTimer = window.setTimeout(() => {
    leaveExpected = false;
    leaveExpectedTimer = null;
  }, 10000);
}

/** True while our own leave broadcast is the result of something we asked for. */
export function isLeaveExpected(): boolean {
  return leaveExpected;
}

/** Called when the server confirms our join (own voice_state_update with a channel). */
export function markVoiceJoinAck() {
  leaveExpected = false;
  if (leaveExpectedTimer !== null) {
    clearTimeout(leaveExpectedTimer);
    leaveExpectedTimer = null;
  }
}

function clearRecoveryTimers() {
  if (rejoinTimer !== null) {
    clearTimeout(rejoinTimer);
    rejoinTimer = null;
  }
  if (disconnectedTimer !== null) {
    clearTimeout(disconnectedTimer);
    disconnectedTimer = null;
  }
}

/** Tear down browser media without touching the voice store. */
function teardownBrowserMedia() {
  stopSpeakingDetection();
  stopStatsPolling();
  clearMicMuteTimer();
  stopMicRecovery();
  navigator.mediaDevices?.removeEventListener?.("devicechange", onDeviceChange);

  if (peerConnection) {
    peerConnection.onconnectionstatechange = null;
    peerConnection.close();
    peerConnection = null;
  }
  micSender = null;
  pendingIceCandidates = [];
  remoteDescriptionSet = false;

  if (localStream) {
    localStream.getTracks().forEach((t) => t.stop());
    localStream = null;
  }

  resetAudioShareState();
  cleanupAudioPipeline();
  setMicLevel(0);
}

export function leaveVoice() {
  sessionStorage.removeItem("voice_channel");
  clearRecoveryTimers();
  rejoinAttempts = 0;
  setMicWarning(null);
  setVoiceLink("connected");

  if (isDesktop && desktopVoiceActive) {
    // Desktop: tell Rust to tear down
    expectLeave();
    send("leave_voice", {});
    setJoinedVoiceChannel(null);
    tauriInvoke("voice_stop").catch((e: any) =>
      console.error("[voice] voice_stop failed:", e)
    );
    desktopVoiceActive = false;
    playLeaveSound();
    return;
  }

  // Browser path
  // Send leave_voice BEFORE closing the PC so the server
  // can broadcast voice_state_update before the connection drops
  expectLeave();
  send("leave_voice", {});
  setJoinedVoiceChannel(null);

  teardownBrowserMedia();
  playLeaveSound();
}

/**
 * Drop the current peer (server-side and local) and join the same channel
 * again. Used when the peer connection fails, when the server reports it no
 * longer has a peer for us after a WebSocket reconnect, and by [REJOIN].
 */
export async function rejoinVoice(): Promise<void> {
  const channelId = currentVoiceChannelId();
  if (!channelId) return;
  clearRecoveryTimers();
  console.warn("[voice] rejoining", channelId, "attempt", rejoinAttempts);
  setVoiceLink("reconnecting");

  // Ask the server to drop any stale peer first; harmless if it already did.
  expectLeave();
  send("leave_voice", {});

  if (isDesktop && desktopVoiceActive) {
    desktopVoiceActive = false;
    try {
      await tauriInvoke("voice_stop");
    } catch (e) {
      console.error("[voice] voice_stop failed:", e);
    }
  } else {
    teardownBrowserMedia();
  }

  await startVoiceSession(channelId, { quiet: true });
}

/**
 * Schedule an automatic rejoin with backoff (2 s, 4 s, 8 s). After the last
 * attempt the panel shows "VOICE LOST" with a manual [REJOIN].
 */
function scheduleRejoin(reason: string) {
  if (!currentVoiceChannelId()) return;
  if (rejoinTimer !== null) return;
  if (rejoinAttempts >= MAX_REJOIN_ATTEMPTS) {
    console.error("[voice] giving up after", rejoinAttempts, "rejoin attempts");
    setVoiceLink("failed");
    return;
  }
  rejoinAttempts++;
  const delay = 1000 * Math.pow(2, rejoinAttempts);
  console.warn(`[voice] peer ${reason}; rejoin attempt ${rejoinAttempts} in ${delay}ms`);
  setVoiceLink("reconnecting");
  rejoinTimer = window.setTimeout(() => {
    rejoinTimer = null;
    rejoinVoice().catch((err) => {
      console.error("[voice] rejoin failed:", err);
      scheduleRejoin("rejoin error");
    });
  }, delay);
}

// ---------------------------------------------------------------------
// Signaling
// ---------------------------------------------------------------------

export async function handleWebRTCOffer(sdp: string) {
  if (isDesktop && desktopVoiceActive) {
    // Desktop: forward SDP to Rust, send answer back over WS
    try {
      const result = await tauriInvoke("voice_handle_offer", { sdp });
      console.log("[voice] Native offer handled, sending answer");
      send("webrtc_answer", { sdp: result.sdp });
    } catch (err) {
      console.error("[voice] Native voice_handle_offer failed:", err);
    }
    return;
  }

  // Browser path
  console.log("[voice] handleWebRTCOffer called, localStream:", !!localStream);
  if (!localStream) return;

  // Create new peer connection if needed
  if (!peerConnection) {
    try {
      peerConnection = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      });
    } catch (err) {
      console.error("[voice] Failed to create RTCPeerConnection:", err);
      return;
    }
    console.log("[voice] PeerConnection created");
    const pc = peerConnection;

    // Add local audio track with 128kbps bitrate
    localStream.getAudioTracks().forEach((track) => {
      console.log("[voice] Adding local track:", track.label, "enabled:", track.enabled);
      const sender = pc.addTrack(track, localStream!);
      micSender = sender;
      // Set max bitrate to 128kbps
      const params = sender.getParameters();
      if (!params.encodings || params.encodings.length === 0) {
        params.encodings = [{}];
      }
      params.encodings[0].maxBitrate = 128000;
      sender.setParameters(params).catch(() => {});
    });

    // Handle incoming tracks from other users
    pc.ontrack = (event) => {
      console.log("[voice] ontrack: streams:", event.streams.length, "track:", event.track.kind, event.track.id);
      const track = event.track;
      let stream: MediaStream;
      if (event.streams.length > 0) {
        stream = event.streams[0];
      } else {
        // Pion may not associate streams in renegotiation — create one from the track
        console.log("[voice] ontrack: no streams, creating MediaStream from track");
        stream = new MediaStream([track]);
      }
      setupAudioPipeline(stream, track.id);

      // Clean up when the remote track ends (peer left / renegotiation replaced it)
      track.onended = () => {
        console.log("[voice] remote track ended:", track.id);
        cleanupTrack(track.id);
      };
      track.onmute = () => {
        console.log("[voice] remote track muted:", track.id);
      };
      track.onunmute = () => {
        console.log("[voice] remote track unmuted:", track.id);
      };
    };

    // Send ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        console.log("[voice] ICE candidate:", event.candidate.candidate.slice(0, 60));
        send("webrtc_ice", { candidate: event.candidate.toJSON() });
      } else {
        console.log("[voice] ICE gathering complete");
      }
    };

    // Recovery: a failed peer, or one disconnected for longer than the
    // grace period, is dropped and rejoined automatically.
    pc.onconnectionstatechange = () => {
      if (pc !== peerConnection) return; // stale PC
      const state = pc.connectionState;
      console.log("[voice] Connection state:", state);
      if (state === "connected") {
        if (disconnectedTimer !== null) {
          clearTimeout(disconnectedTimer);
          disconnectedTimer = null;
        }
        rejoinAttempts = 0;
        setVoiceLink("connected");
      } else if (state === "disconnected") {
        if (disconnectedTimer === null) {
          disconnectedTimer = window.setTimeout(() => {
            disconnectedTimer = null;
            if (pc === peerConnection && pc.connectionState === "disconnected") {
              scheduleRejoin("disconnected");
            }
          }, DISCONNECTED_GRACE_MS);
        }
      } else if (state === "failed") {
        if (disconnectedTimer !== null) {
          clearTimeout(disconnectedTimer);
          disconnectedTimer = null;
        }
        scheduleRejoin("failed");
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log("[voice] ICE connection state:", pc.iceConnectionState);
    };

    startStatsPolling();
  }

  // Reset flag — candidates received during this negotiation must be queued
  remoteDescriptionSet = false;

  peerConnection
    .setRemoteDescription({ type: "offer", sdp })
    .then(async () => {
      console.log("[voice] Remote description set, creating answer...");
      // Flush any ICE candidates that arrived before remote description was set
      remoteDescriptionSet = true;
      if (pendingIceCandidates.length > 0) {
        console.log(`[voice] Flushing ${pendingIceCandidates.length} queued ICE candidates`);
        for (const c of pendingIceCandidates) {
          peerConnection!.addIceCandidate(c).catch((err) => {
            console.error("[voice] addIceCandidate (queued) failed:", err);
          });
        }
        pendingIceCandidates = [];
      }
      // If the user just started an audio share, the server will have
      // added a recvonly audio transceiver for it. Attach the share
      // track to the new transceiver before we answer so the answer's
      // SDP reflects the active sendonly direction.
      await attachPendingShareIfAny(peerConnection!);
      return peerConnection!.createAnswer();
    })
    .then((answer) => {
      console.log("[voice] Answer created, setting local description...");
      return peerConnection!.setLocalDescription(answer);
    })
    .then(() => {
      console.log("[voice] Sending answer to server");
      send("webrtc_answer", { sdp: peerConnection!.localDescription!.sdp });
    })
    .catch((err) => console.error("[voice] WebRTC offer handling failed:", err));
}

export async function handleWebRTCICE(candidate: RTCIceCandidateInit) {
  if (isDesktop && desktopVoiceActive) {
    // Desktop: forward ICE candidate to Rust
    try {
      await tauriInvoke("voice_handle_ice", {
        candidate: candidate.candidate,
        sdpMid: candidate.sdpMid,
        sdpMlineIndex: candidate.sdpMLineIndex,
      });
    } catch (err) {
      console.error("[voice] Native voice_handle_ice failed:", err);
    }
    return;
  }

  // Browser path
  if (!peerConnection) return;

  if (!remoteDescriptionSet) {
    console.log("[voice] Queueing ICE candidate (remote description not set yet)");
    pendingIceCandidates.push(candidate);
    return;
  }

  peerConnection.addIceCandidate(candidate).catch((err) => {
    console.error("[voice] addIceCandidate failed:", err);
  });
}

export function toggleMute(): boolean {
  if (isDesktop && desktopVoiceActive) {
    // For desktop, we need to track mute state ourselves
    // since there's no localStream to check
    const wasMuted = desktopMuted;
    desktopMuted = !wasMuted;
    tauriInvoke("voice_set_mute", { muted: desktopMuted }).catch(() => {});
    send("voice_self_mute", { muted: desktopMuted });
    return desktopMuted;
  }

  if (!localStream) return false;
  const tracks = localStream.getAudioTracks();
  const newMuted = tracks[0]?.enabled ?? false;
  tracks.forEach((t) => (t.enabled = !newMuted));
  send("voice_self_mute", { muted: newMuted });
  return newMuted;
}
let desktopMuted = false;

// Temporarily mute/unmute the channel mic (for mic test in settings)
let preMuteState: boolean | null = null;

export function muteChannelMic() {
  if (!localStream) return;
  const tracks = localStream.getAudioTracks();
  if (tracks.length === 0) return;
  preMuteState = tracks[0].enabled;
  tracks.forEach((t) => (t.enabled = false));
}

export function unmuteChannelMic() {
  if (!localStream || preMuteState === null) return;
  localStream.getAudioTracks().forEach((t) => (t.enabled = preMuteState!));
  preMuteState = null;
}

export function toggleDeafen(deafened: boolean) {
  if (isDesktop && desktopVoiceActive) {
    tauriInvoke("voice_set_deafen", { deafened }).catch(() => {});
    send("voice_self_deafen", { deafened });
    return;
  }

  setAllIncomingGain(deafened ? 0 : 1);
  send("voice_self_deafen", { deafened });
}

/**
 * Reset local voice state without sending leave_voice to server.
 * Used when another device takes over voice (server already handled it).
 */
export function resetVoiceState() {
  sessionStorage.removeItem("voice_channel");
  clearRecoveryTimers();
  rejoinAttempts = 0;
  setMicWarning(null);
  setVoiceLink("connected");

  if (isDesktop && desktopVoiceActive) {
    setJoinedVoiceChannel(null);
    tauriInvoke("voice_stop").catch((e: any) =>
      console.error("[voice] voice_stop failed:", e)
    );
    desktopVoiceActive = false;
    return;
  }

  // Browser path
  setJoinedVoiceChannel(null);
  teardownBrowserMedia();
}

export async function switchMicrophone(deviceId: string) {
  if (isDesktop) {
    // Desktop: tell Rust to switch input device
    await tauriInvoke("voice_set_input_device", { deviceName: deviceId });
    return;
  }

  if (!localStream || !peerConnection) return;

  const newStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: { exact: deviceId },
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });

  const newTrack = newStream.getAudioTracks()[0];
  newTrack.enabled = localStream.getAudioTracks()[0]?.enabled ?? true;
  attachMicTrackHandlers(newTrack);
  const sender =
    micSender ||
    peerConnection.getSenders().find((s) => s.track?.kind === "audio");

  if (sender) {
    await sender.replaceTrack(newTrack);
  }

  // Stop old track
  localStream.getAudioTracks().forEach((t) => {
    t.onended = null;
    t.stop();
  });
  localStream = newStream;
  // The user picked a mic that opened: any mic banner or recovery is stale.
  stopMicRecovery();
  setMicWarning(null);

  // Restart speaking detection with new stream
  stopSpeakingDetection();
  startSpeakingDetection(localStream);
}
