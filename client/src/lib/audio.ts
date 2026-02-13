// Per-user audio chain: MediaStream → GainNode → AnalyserNode → destination

import { settings } from "../stores/settings";

type UserAudioNode = {
  source: MediaStreamAudioSourceNode;
  gain: GainNode;
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

  // Apply output device if set
  const s = settings();
  if (s.outputDeviceId && "setSinkId" in ctx) {
    (ctx as any).setSinkId(s.outputDeviceId).catch(() => {});
  }

  const source = ctx.createMediaStreamSource(stream);
  const gain = ctx.createGain();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 256;

  // Apply master volume
  gain.gain.value = s.masterVolume;

  source.connect(gain);
  gain.connect(analyser);
  analyser.connect(ctx.destination);

  userNodes.set(trackId, {
    source,
    gain,
    analyser,
    volume: s.masterVolume,
    localMuted: false,
  });
}

export function cleanupAudioPipeline() {
  userNodes.forEach((node) => {
    node.source.disconnect();
    node.gain.disconnect();
    node.analyser.disconnect();
  });
  userNodes.clear();
}

export function setUserVolume(trackId: string, volume: number) {
  const node = userNodes.get(trackId);
  if (!node) return;
  node.volume = volume;
  if (!node.localMuted) {
    node.gain.gain.value = volume;
  }
}

export function setUserLocalMute(trackId: string, muted: boolean) {
  const node = userNodes.get(trackId);
  if (!node) return;
  node.localMuted = muted;
  node.gain.gain.value = muted ? 0 : node.volume;
}

export function setAllIncomingGain(multiplier: number) {
  userNodes.forEach((node) => {
    if (!node.localMuted) {
      node.gain.gain.value = multiplier === 0 ? 0 : node.volume;
    }
  });
}

export function applyMasterVolume(volume: number) {
  userNodes.forEach((node) => {
    node.volume = volume;
    if (!node.localMuted) {
      node.gain.gain.value = volume;
    }
  });
}

export async function setSpeaker(deviceId: string) {
  const ctx = getAudioContext();
  if ("setSinkId" in ctx) {
    await (ctx as any).setSinkId(deviceId);
  }
}
