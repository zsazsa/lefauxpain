import { send } from "./ws";
import { setJoinedVoiceChannel } from "../stores/voice";
import { setupAudioPipeline, cleanupAudioPipeline, setAllIncomingGain } from "./audio";
import { startSpeakingDetection, stopSpeakingDetection } from "./devices";
import { playJoinSound, playLeaveSound } from "./sounds";
import { settings } from "../stores/settings";

let peerConnection: RTCPeerConnection | null = null;
let localStream: MediaStream | null = null;

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

    // Add local audio track
    localStream.getAudioTracks().forEach((track) => {
      peerConnection!.addTrack(track, localStream!);
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
