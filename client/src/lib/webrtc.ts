import { send } from "./ws";
import { setJoinedVoiceChannel, setVoiceStats } from "../stores/voice";
import { setupAudioPipeline, cleanupAudioPipeline, setAllIncomingGain } from "./audio";
import { startSpeakingDetection, stopSpeakingDetection, isDesktop, tauriInvoke } from "./devices";
import { playJoinSound, playLeaveSound } from "./sounds";
import { settings } from "../stores/settings";

let peerConnection: RTCPeerConnection | null = null;
let localStream: MediaStream | null = null;
let statsInterval: number | null = null;
let prevBytesSent = 0;
let prevTimestamp = 0;
// Track whether we're in a desktop voice session (Rust handles WebRTC)
let desktopVoiceActive = false;
// Queue ICE candidates received before remote description is set
let pendingIceCandidates: RTCIceCandidateInit[] = [];
let remoteDescriptionSet = false;

function startStatsPolling() {
  stopStatsPolling();
  prevBytesSent = 0;
  prevTimestamp = 0;
  statsInterval = window.setInterval(async () => {
    if (!peerConnection) return;
    const stats = await peerConnection.getStats();
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
      if (report.type === "outbound-rtp" && report.kind === "audio") {
        bytesSent = report.bytesSent || 0;
        timestamp = report.timestamp || 0;
        packetsSent = report.packetsSent || 0;
      }
    });

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
    });
  }, 2000);
}

function stopStatsPolling() {
  if (statsInterval !== null) {
    clearInterval(statsInterval);
    statsInterval = null;
  }
  setVoiceStats(null);
}

export async function joinVoice(channelId: string) {
  // Leave current voice first
  if (peerConnection || desktopVoiceActive) {
    leaveVoice();
  }

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
      return;
    }
    desktopVoiceActive = true;
    sessionStorage.setItem("voice_channel", channelId);
    playJoinSound();
    setJoinedVoiceChannel(channelId);
    send("join_voice", { channel_id: channelId });
    return;
  }

  // Browser: existing WebRTC path
  try {
    const s = settings();
    const audioConstraints: MediaTrackConstraints = {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    };
    console.log("[voice] joinVoice: isDesktop:", isDesktop, "inputDeviceId:", s.inputDeviceId);
    if (s.inputDeviceId && !isDesktop) {
      audioConstraints.deviceId = { exact: s.inputDeviceId };
    }
    console.log("[voice] getUserMedia constraints:", JSON.stringify(audioConstraints));
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: audioConstraints,
    });
    const tracks = localStream.getAudioTracks();
    console.log("[voice] getUserMedia succeeded, tracks:", tracks.map(t => ({
      label: t.label,
      enabled: t.enabled,
      muted: t.muted,
      readyState: t.readyState,
      settings: t.getSettings(),
    })));
  } catch (err) {
    console.error("[voice] Failed to get microphone:", err);
    return;
  }

  // Start speaking detection on local stream
  startSpeakingDetection(localStream);

  sessionStorage.setItem("voice_channel", channelId);
  playJoinSound();
  setJoinedVoiceChannel(channelId);
  send("join_voice", { channel_id: channelId });
}

export function leaveVoice() {
  sessionStorage.removeItem("voice_channel");

  if (isDesktop && desktopVoiceActive) {
    // Desktop: tell Rust to tear down
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
  stopSpeakingDetection();

  // Send leave_voice BEFORE closing the PC so the server
  // can broadcast voice_state_update before the connection drops
  send("leave_voice", {});
  setJoinedVoiceChannel(null);

  stopStatsPolling();

  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }
  pendingIceCandidates = [];
  remoteDescriptionSet = false;

  if (localStream) {
    localStream.getTracks().forEach((t) => t.stop());
    localStream = null;
  }

  playLeaveSound();
  cleanupAudioPipeline();
}

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

    // Add local audio track with 128kbps bitrate
    localStream.getAudioTracks().forEach((track) => {
      console.log("[voice] Adding local track:", track.label, "enabled:", track.enabled);
      const sender = peerConnection!.addTrack(track, localStream!);
      // Set max bitrate to 128kbps
      const params = sender.getParameters();
      if (!params.encodings || params.encodings.length === 0) {
        params.encodings = [{}];
      }
      params.encodings[0].maxBitrate = 128000;
      sender.setParameters(params).catch(() => {});
    });

    // Handle incoming tracks from other users
    peerConnection.ontrack = (event) => {
      console.log("[voice] ontrack: streams:", event.streams.length, "track:", event.track.kind, event.track.id);
      if (event.streams.length > 0) {
        setupAudioPipeline(event.streams[0], event.track.id);
      } else {
        // Pion may not associate streams in renegotiation — create one from the track
        console.log("[voice] ontrack: no streams, creating MediaStream from track");
        const stream = new MediaStream([event.track]);
        setupAudioPipeline(stream, event.track.id);
      }
    };

    // Send ICE candidates
    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        console.log("[voice] ICE candidate:", event.candidate.candidate.slice(0, 60));
        send("webrtc_ice", { candidate: event.candidate.toJSON() });
      } else {
        console.log("[voice] ICE gathering complete");
      }
    };

    peerConnection.onconnectionstatechange = () => {
      console.log("[voice] Connection state:", peerConnection?.connectionState);
    };

    peerConnection.oniceconnectionstatechange = () => {
      console.log("[voice] ICE connection state:", peerConnection?.iceConnectionState);
    };

    startStatsPolling();
  }

  // Reset flag — candidates received during this negotiation must be queued
  remoteDescriptionSet = false;

  peerConnection
    .setRemoteDescription({ type: "offer", sdp })
    .then(() => {
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
  const sender = peerConnection
    .getSenders()
    .find((s) => s.track?.kind === "audio");

  if (sender) {
    await sender.replaceTrack(newTrack);
  }

  // Stop old track
  localStream.getAudioTracks().forEach((t) => t.stop());
  localStream = newStream;

  // Restart speaking detection with new stream
  stopSpeakingDetection();
  startSpeakingDetection(localStream);
}
