import { send } from "./ws";
import {
  setWatchingScreenShare,
  setScreenShareStream,
  setLocalScreenStream,
  setDesktopPresenting,
  setDesktopPreviewUrl,
  watchingScreenShare,
} from "../stores/voice";
import { isDesktop, tauriInvoke } from "./devices";

let screenPC: RTCPeerConnection | null = null;
let screenStream: MediaStream | null = null;
let isPresenting = false;

export function getIsPresenting() {
  return isPresenting;
}

export async function startScreenShare() {
  if (isDesktop) {
    // Desktop: use native Rust screen capture via Tauri IPC
    try {
      await tauriInvoke("screen_start");
    } catch (err) {
      console.error("[screen] screen_start failed:", err);
      return;
    }
    isPresenting = true;
    setDesktopPresenting(true);
    send("screen_share_start", {});
    return;
  }

  // Browser: use getDisplayMedia
  try {
    screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: { cursor: "always" } as any,
      audio: true,
    });
  } catch (err) {
    console.error("[screen] getDisplayMedia failed:", err);
    return;
  }

  // Auto-stop when user clicks browser's "Stop sharing" button
  const videoTrack = screenStream.getVideoTracks()[0];
  if (videoTrack) {
    videoTrack.onended = () => {
      stopScreenShare();
    };
  }

  isPresenting = true;
  setLocalScreenStream(screenStream);
  send("screen_share_start", {});
}

export function stopScreenShare() {
  if (!isPresenting) return;
  isPresenting = false;

  if (isDesktop) {
    // Desktop: stop native Rust screen capture
    setDesktopPresenting(false);
    setDesktopPreviewUrl(null);
    tauriInvoke("screen_stop").catch((err: any) => {
      console.error("[screen] screen_stop failed:", err);
    });
    send("screen_share_stop", {});
    return;
  }

  // Browser cleanup
  setLocalScreenStream(null);

  if (screenStream) {
    screenStream.getTracks().forEach((t) => t.stop());
    screenStream = null;
  }

  if (screenPC) {
    screenPC.close();
    screenPC = null;
  }

  send("screen_share_stop", {});
}

export function subscribeScreenShare(channelId: string) {
  send("screen_share_subscribe", { channel_id: channelId });
}

export function unsubscribeScreenShare() {
  const watching = watchingScreenShare();
  if (!watching) return;

  if (screenPC) {
    screenPC.close();
    screenPC = null;
  }

  setScreenShareStream(null);
  send("screen_share_unsubscribe", { channel_id: watching.channel_id });
  setWatchingScreenShare(null);
}

export async function handleScreenOffer(sdp: string) {
  if (isDesktop) {
    // Desktop presenter: forward SDP to Rust, get answer back
    try {
      const result = await tauriInvoke("screen_handle_offer", { sdp });
      send("webrtc_screen_answer", { sdp: result.sdp });
    } catch (err) {
      console.error("[screen] screen_handle_offer failed:", err);
    }
    return;
  }

  // Browser: create RTCPeerConnection
  if (!screenPC) {
    screenPC = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });

    screenPC.onicecandidate = (event) => {
      if (event.candidate) {
        send("webrtc_screen_ice", { candidate: event.candidate.toJSON() });
      }
    };

    screenPC.onconnectionstatechange = () => {
      console.log("[screen] Connection state:", screenPC?.connectionState);
    };

    if (isPresenting && screenStream) {
      // Presenter: add screen tracks to PC
      screenStream.getTracks().forEach((track) => {
        screenPC!.addTrack(track, screenStream!);
      });
    } else {
      // Viewer: receive tracks
      const stream = new MediaStream();
      screenPC.ontrack = (event) => {
        console.log("[screen] ontrack:", event.track.kind, event.track.id);
        stream.addTrack(event.track);
        setScreenShareStream(new MediaStream(stream.getTracks()));
      };
    }
  }

  await screenPC.setRemoteDescription({ type: "offer", sdp });
  const answer = await screenPC.createAnswer();
  await screenPC.setLocalDescription(answer);
  send("webrtc_screen_answer", { sdp: answer.sdp });
}

export function handleScreenICE(candidate: RTCIceCandidateInit) {
  if (isDesktop) {
    // Desktop presenter: forward ICE to Rust
    tauriInvoke("screen_handle_ice", {
      candidate: candidate.candidate,
      sdpMid: candidate.sdpMid,
      sdpMlineIndex: candidate.sdpMLineIndex,
    }).catch((err: any) => {
      console.error("[screen] screen_handle_ice failed:", err);
    });
    return;
  }

  // Browser
  if (screenPC) {
    screenPC.addIceCandidate(candidate).catch((err) => {
      console.error("[screen] addIceCandidate failed:", err);
    });
  }
}

export function cleanupScreenShare() {
  if (isPresenting) {
    stopScreenShare();
  } else {
    unsubscribeScreenShare();
  }
}
