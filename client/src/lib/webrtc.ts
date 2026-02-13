import { send } from "./ws";
import { setJoinedVoiceChannel, setVoiceStats } from "../stores/voice";
import { setupAudioPipeline, cleanupAudioPipeline, setAllIncomingGain } from "./audio";
import { startSpeakingDetection, stopSpeakingDetection } from "./devices";
import { playJoinSound, playLeaveSound } from "./sounds";
import { settings } from "../stores/settings";

let peerConnection: RTCPeerConnection | null = null;
let localStream: MediaStream | null = null;
let statsInterval: number | null = null;
let prevBytesSent = 0;
let prevTimestamp = 0;

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
  if (peerConnection) {
    leaveVoice();
  }

  try {
    const s = settings();
    const audioConstraints: MediaTrackConstraints = {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    };
    if (s.inputDeviceId) {
      audioConstraints.deviceId = { exact: s.inputDeviceId };
    }
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: audioConstraints,
    });
  } catch (err) {
    console.error("Failed to get microphone:", err);
    return;
  }

  // Start speaking detection on local stream
  startSpeakingDetection(localStream);

  playJoinSound();
  setJoinedVoiceChannel(channelId);
  send("join_voice", { channel_id: channelId });
}

export function leaveVoice() {
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

  if (localStream) {
    localStream.getTracks().forEach((t) => t.stop());
    localStream = null;
  }

  playLeaveSound();
  cleanupAudioPipeline();
}

export function handleWebRTCOffer(sdp: string) {
  if (!localStream) return;

  // Create new peer connection if needed
  if (!peerConnection) {
    peerConnection = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });

    // Add local audio track with 128kbps bitrate
    localStream.getAudioTracks().forEach((track) => {
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
      if (event.streams.length > 0) {
        setupAudioPipeline(event.streams[0], event.track.id);
      }
    };

    // Send ICE candidates
    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        send("webrtc_ice", { candidate: event.candidate.toJSON() });
      }
    };

    startStatsPolling();
  }

  peerConnection
    .setRemoteDescription({ type: "offer", sdp })
    .then(() => peerConnection!.createAnswer())
    .then((answer) => peerConnection!.setLocalDescription(answer))
    .then(() => {
      // Wait for ICE gathering to complete before sending the answer
      const pc = peerConnection!;
      if (pc.iceGatheringState === "complete") {
        send("webrtc_answer", { sdp: pc.localDescription!.sdp });
      } else {
        pc.onicegatheringstatechange = () => {
          if (pc.iceGatheringState === "complete") {
            send("webrtc_answer", { sdp: pc.localDescription!.sdp });
            pc.onicegatheringstatechange = null;
          }
        };
      }
    })
    .catch((err) => console.error("WebRTC offer handling failed:", err));
}

export function handleWebRTCICE(candidate: RTCIceCandidateInit) {
  if (peerConnection) {
    peerConnection.addIceCandidate(candidate).catch(() => {});
  }
}

export function toggleMute(): boolean {
  if (!localStream) return false;
  const tracks = localStream.getAudioTracks();
  const newMuted = tracks[0]?.enabled ?? false;
  tracks.forEach((t) => (t.enabled = !newMuted));
  send("voice_self_mute", { muted: newMuted });
  return newMuted;
}

export function toggleDeafen(deafened: boolean) {
  setAllIncomingGain(deafened ? 0 : 1);
  send("voice_self_deafen", { deafened });
}

export async function switchMicrophone(deviceId: string) {
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
