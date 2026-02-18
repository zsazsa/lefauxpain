// Per-user audio playback via <audio> elements + Web Audio API analyser

import { settings } from "../stores/settings";

type UserAudioNode = {
  audio: HTMLAudioElement;
  source: MediaStreamAudioSourceNode;
  analyser: AnalyserNode;
  volume: number; // 0.0 - 2.0
  localMuted: boolean;
};

let audioContext: AudioContext | null = null;
const userNodes = new Map<string, UserAudioNode>();

function getAudioContext(): AudioContext {
  if (!audioContext) {
    audioContext = new AudioContext();
  }
  return audioContext;
}

export function setupAudioPipeline(stream: MediaStream, trackId: string) {
  const ctx = getAudioContext();

  // Resume context if suspended (browsers require user gesture)
  if (ctx.state === "suspended") {
    ctx.resume();
  }

  const s = settings();

  // Use an <audio> element for playback — works reliably on all platforms
  // including Windows where Web Audio API alone may not activate remote streams
  const audio = new Audio();
  audio.srcObject = stream;
  audio.autoplay = true;
  audio.volume = Math.min(s.masterVolume, 1.0);
  audio.play().catch(() => {});

  // Apply output device if set
  if (s.outputDeviceId && "setSinkId" in audio) {
    (audio as any).setSinkId(s.outputDeviceId).catch(() => {});
  }

  // Web Audio API analyser for speaking detection (not connected to destination)
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 256;
  source.connect(analyser);
  // Do NOT connect analyser to destination — <audio> element handles playback

  userNodes.set(trackId, {
    audio,
    source,
    analyser,
    volume: s.masterVolume,
    localMuted: false,
  });
}

export function cleanupAudioPipeline() {
  userNodes.forEach((node) => {
    node.audio.pause();
    node.audio.srcObject = null;
    node.source.disconnect();
    node.analyser.disconnect();
  });
  userNodes.clear();
}

export function setUserVolume(trackId: string, volume: number) {
  const node = userNodes.get(trackId);
  if (!node) return;
  node.volume = volume;
  if (!node.localMuted) {
    node.audio.volume = Math.min(volume, 1.0);
  }
}

export function setUserLocalMute(trackId: string, muted: boolean) {
  const node = userNodes.get(trackId);
  if (!node) return;
  node.localMuted = muted;
  node.audio.volume = muted ? 0 : Math.min(node.volume, 1.0);
}

export function setAllIncomingGain(multiplier: number) {
  userNodes.forEach((node) => {
    if (!node.localMuted) {
      node.audio.volume = multiplier === 0 ? 0 : Math.min(node.volume, 1.0);
    }
  });
}

export function applyMasterVolume(volume: number) {
  userNodes.forEach((node) => {
    node.volume = volume;
    if (!node.localMuted) {
      node.audio.volume = Math.min(volume, 1.0);
    }
  });
}

export async function setSpeaker(deviceId: string) {
  // Apply to all existing audio elements
  userNodes.forEach((node) => {
    if ("setSinkId" in node.audio) {
      (node.audio as any).setSinkId(deviceId).catch(() => {});
    }
  });
}
