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
let previewStream: MediaStream | null = null;
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
      video: {
        cursor: "always",
        frameRate: { ideal: 30 },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      } as any,
      audio: true,
    });
  } catch (err) {
    console.error("[screen] getDisplayMedia failed:", err);
    return;
  }

  // Hint the encoder to optimize for sharpness (text/UI) over motion smoothness
  const videoTrack = screenStream.getVideoTracks()[0];
  if (videoTrack) {
    (videoTrack as any).contentHint = "detail";

    // Auto-stop when user clicks browser's "Stop sharing" button
    videoTrack.onended = () => {
      stopScreenShare();
    };
  }

  isPresenting = true;
  // Clone stream for preview so display and WebRTC encoder don't contend for frames
  previewStream = screenStream.clone();
  setLocalScreenStream(previewStream);
  send("screen_share_start", {});
}

export function stopScreenShare() {
  if (!isPresenting) return;
  isPresenting = false;

  // Send WS stop BEFORE closing the peer connection to avoid race
  // where SFU sees PC disconnect and cleans up before the WS message arrives
  send("screen_share_stop", {});

  if (isDesktop) {
    // Desktop: stop native Rust screen capture
    setDesktopPresenting(false);
    setDesktopPreviewUrl(null);
    tauriInvoke("screen_stop").catch((err: any) => {
      console.error("[screen] screen_stop failed:", err);
    });
    return;
  }

  // Browser cleanup
  if (previewStream) {
    previewStream.getTracks().forEach((t) => t.stop());
    previewStream = null;
  }
  setLocalScreenStream(null);

  if (screenStream) {
    screenStream.getTracks().forEach((t) => t.stop());
    screenStream = null;
  }

  if (screenPC) {
    screenPC.close();
    screenPC = null;
  }
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
  if (isDesktop && isPresenting) {
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
      // Presenter: add screen tracks to PC and set bitrate
      screenStream.getTracks().forEach((track) => {
        const sender = screenPC!.addTrack(track, screenStream!);
        if (track.kind === "video") {
          // Set max bitrate for sharp screen content
          try {
            const params = sender.getParameters();
            if (!params.encodings || params.encodings.length === 0) {
              params.encodings = [{}];
            }
            params.encodings[0].maxBitrate = 6_000_000; // 6 Mbps
            sender.setParameters(params);
          } catch (e) {
            console.warn("[screen] setParameters failed:", e);
          }
        }
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
  if (isDesktop && isPresenting) {
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
