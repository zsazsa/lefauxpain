import { send } from "./ws";
import { isDesktop } from "./devices";

// Pending share track — stashed between voice_share_audio_start and the
// next webrtc_offer. attachPendingShareIfAny consumes it.
let pendingTrack: MediaStreamTrack | null = null;
// Active share sender on the current peer connection. Used to detach
// on stop without disturbing the mic sender.
let activeSender: RTCRtpSender | null = null;
// Whether we have a share request in flight. Starts true on user
// click, ends false when the share track is attached and flowing
// (or when an error tears it down).
let starting = false;

const [hasActiveShareGetter, hasActiveShareSetter] = (() => {
  let active = false;
  return [() => active, (v: boolean) => { active = v; }] as const;
})();

export const isSharingAudio = hasActiveShareGetter;

function inferLabel(track: MediaStreamTrack): string {
  // Browsers populate track.label with a useful descriptor for
  // getDisplayMedia audio tracks, e.g. "Tab audio (YouTube)".
  // Fall back to a generic label.
  const label = (track.label || "").trim();
  if (label) return label;
  return "Shared audio";
}

export async function startAudioShare(): Promise<void> {
  if (isDesktop) {
    // Desktop path is implemented by the native engine; not in v1 web build.
    throw new Error("audio share is web-only in v1");
  }
  if (starting || hasActiveShareGetter()) {
    return;
  }
  if (pendingTrack) {
    // Another start is mid-flight; abort.
    return;
  }

  starting = true;
  let stream: MediaStream;
  try {
    // Chrome requires video:true to allow audio:true on getDisplayMedia.
    // We immediately stop the video track and only publish the audio.
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: true,
    });
  } catch (err) {
    starting = false;
    // User cancelled the share dialog — not an error worth surfacing.
    if ((err as DOMException)?.name === "NotAllowedError") {
      return;
    }
    console.error("[audioShare] getDisplayMedia failed:", err);
    return;
  }

  const audioTracks = stream.getAudioTracks();
  if (audioTracks.length === 0) {
    starting = false;
    stream.getTracks().forEach((t) => t.stop());
    alert(
      "No audio captured. When sharing, tick the \"Share tab audio\" or \"Share system audio\" box.",
    );
    return;
  }

  // Stop and discard the video track — we only forward audio.
  stream.getVideoTracks().forEach((t) => t.stop());

  const audioTrack = audioTracks[0];
  pendingTrack = audioTrack;

  // Auto-stop when the user clicks the browser's "Stop sharing" bar
  // or when the source tab/window closes.
  audioTrack.onended = () => {
    stopAudioShare();
  };

  send("voice_share_audio_start", { label: inferLabel(audioTrack) });
  // attachPendingShareIfAny will be called from webrtc.ts during the
  // next renegotiation (which the server triggers on receipt of the
  // start op). starting flips off there.
}

export function stopAudioShare(): void {
  // Tear down local capture
  if (pendingTrack) {
    pendingTrack.onended = null;
    pendingTrack.stop();
    pendingTrack = null;
  }
  starting = false;

  if (activeSender) {
    activeSender.replaceTrack(null).catch(() => {});
    const track = activeSender.track;
    if (track) {
      track.onended = null;
      track.stop();
    }
    activeSender = null;
  }

  hasActiveShareSetter(false);
  send("voice_share_audio_stop", {});
}

// attachPendingShareIfAny is called from webrtc.handleWebRTCOffer after
// setRemoteDescription, before createAnswer. If a share track is
// pending, find the newly-added recvonly transceiver and attach the
// track to its sender. The answer will include the now-active sendonly
// direction for that m-line.
export async function attachPendingShareIfAny(
  pc: RTCPeerConnection,
): Promise<void> {
  if (!pendingTrack) return;

  const transceivers = pc.getTransceivers();
  // The new transceiver: audio kind, no sender track yet, not stopped.
  // The mic transceiver already has a track attached; skip it.
  const target = transceivers.find(
    (t) =>
      t.sender &&
      !t.sender.track &&
      (t.receiver?.track?.kind === "audio" ||
        // Some browsers expose the kind via the transceiver's mid-level details
        // only after the answer; fall back to direction heuristic.
        t.direction === "sendonly" ||
        t.direction === "sendrecv"),
  );

  if (!target) {
    console.warn(
      "[audioShare] no available transceiver to attach share track; aborting",
    );
    const t = pendingTrack;
    pendingTrack = null;
    starting = false;
    t.onended = null;
    t.stop();
    return;
  }

  try {
    await target.sender.replaceTrack(pendingTrack);
  } catch (err) {
    console.error("[audioShare] replaceTrack failed:", err);
    const t = pendingTrack;
    pendingTrack = null;
    starting = false;
    t.onended = null;
    t.stop();
    return;
  }

  activeSender = target.sender;
  starting = false;
  hasActiveShareSetter(true);
  pendingTrack = null;
}

// resetAudioShareState is called from webrtc.leaveVoice / resetVoiceState
// to drop any local capture when the peer connection goes away. The
// server will broadcast voice_audio_source_removed on its own.
export function resetAudioShareState(): void {
  if (pendingTrack) {
    pendingTrack.onended = null;
    pendingTrack.stop();
    pendingTrack = null;
  }
  if (activeSender?.track) {
    activeSender.track.onended = null;
    activeSender.track.stop();
  }
  activeSender = null;
  starting = false;
  hasActiveShareSetter(false);
}
