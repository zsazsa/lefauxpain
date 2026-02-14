import { createSignal } from "solid-js";
import { send } from "./ws";

export type MediaDeviceInfo2 = {
  deviceId: string;
  label: string;
  kind: string;
};

export type DesktopAudioDevice = {
  id: string;
  name: string;
  default: boolean;
};

const [microphones, setMicrophones] = createSignal<MediaDeviceInfo2[]>([]);
const [speakers, setSpeakers] = createSignal<MediaDeviceInfo2[]>([]);
const [desktopInputs, setDesktopInputs] = createSignal<DesktopAudioDevice[]>([]);
const [desktopOutputs, setDesktopOutputs] = createSignal<DesktopAudioDevice[]>([]);

export { microphones, speakers, desktopInputs, desktopOutputs };

export const isDesktop = !!(window as any).__DESKTOP__;

function tauriInvoke(cmd: string, args?: any): Promise<any> {
  const internals = (window as any).__TAURI_INTERNALS__;
  if (!internals?.invoke) return Promise.reject("no tauri");
  return internals.invoke(cmd, args);
}

export async function enumerateDevices() {
  // Desktop: read devices injected by Tauri UserScript at page load
  const injected = (window as any).__AUDIO_DEVICES__;
  if (injected && (injected.inputs?.length > 0 || injected.outputs?.length > 0)) {
    setDesktopInputs(injected.inputs || []);
    setDesktopOutputs(injected.outputs || []);
    return;
  }

  // Also try Tauri IPC if injected data wasn't available
  if (isDesktop) {
    try {
      const result = await tauriInvoke("list_audio_devices");
      if (result && (result.inputs?.length > 0 || result.outputs?.length > 0)) {
        setDesktopInputs(result.inputs || []);
        setDesktopOutputs(result.outputs || []);
        return;
      }
    } catch {
      // IPC not available, fall through to browser API
    }
  }

  // Browser API fallback
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    setMicrophones(
      devices
        .filter((d) => d.kind === "audioinput")
        .map((d) => ({
          deviceId: d.deviceId,
          label: d.label || `Microphone ${d.deviceId.slice(0, 4)}`,
          kind: d.kind,
        }))
    );
    setSpeakers(
      devices
        .filter((d) => d.kind === "audiooutput")
        .map((d) => ({
          deviceId: d.deviceId,
          label: d.label || `Speaker ${d.deviceId.slice(0, 4)}`,
          kind: d.kind,
        }))
    );
  } catch {
    // Permissions not granted yet
  }
}

export async function setDesktopDefaultDevice(id: string): Promise<boolean> {
  try {
    return await tauriInvoke("set_default_audio_device", { id });
  } catch {
    return false;
  }
}

export async function refreshDesktopDevices() {
  try {
    const result = await tauriInvoke("list_audio_devices");
    if (result) {
      setDesktopInputs(result.inputs || []);
      setDesktopOutputs(result.outputs || []);
    }
  } catch {
    // IPC not available
  }
}

// Speaking detection — RMS energy + EMA smoothing + hold time
//
// Instead of raw peak amplitude (noisy, picks up keyboard clicks),
// we compute RMS energy per frame, smooth it with an exponential
// moving average, and require sustained energy to trigger "speaking".
// A hold timer keeps the indicator on briefly after speech ends,
// preventing flickering during natural pauses.

let speakingInterval: number | null = null;
let speakingAnalyser: AnalyserNode | null = null;
let speakingContext: AudioContext | null = null;

// Tuning constants
const SPEAK_THRESHOLD = 0.015; // RMS level to trigger speaking (0–1 range)
const EMA_ATTACK = 0.4;        // Smoothing factor when level is rising (fast attack)
const EMA_RELEASE = 0.05;      // Smoothing factor when level is falling (slow release)
const HOLD_MS = 250;           // Keep "speaking" on for this long after dropping below threshold
const POLL_MS = 50;            // Sample interval

export function startSpeakingDetection(stream: MediaStream) {
  stopSpeakingDetection();

  speakingContext = new AudioContext();
  const source = speakingContext.createMediaStreamSource(stream);
  speakingAnalyser = speakingContext.createAnalyser();
  speakingAnalyser.fftSize = 256;
  source.connect(speakingAnalyser);

  const data = new Float32Array(speakingAnalyser.fftSize);
  let smoothedRms = 0;
  let wasSpeaking = false;
  let holdUntil = 0;

  speakingInterval = window.setInterval(() => {
    if (!speakingAnalyser) return;

    // Get time-domain samples as floats (-1 to 1)
    speakingAnalyser.getFloatTimeDomainData(data);

    // Compute RMS (root mean square) — measures sustained energy
    let sumSq = 0;
    for (let i = 0; i < data.length; i++) {
      sumSq += data[i] * data[i];
    }
    const rms = Math.sqrt(sumSq / data.length);

    // EMA smoothing — fast attack (voice onset feels instant),
    // slow release (brief pauses don't flicker)
    const alpha = rms > smoothedRms ? EMA_ATTACK : EMA_RELEASE;
    smoothedRms = alpha * rms + (1 - alpha) * smoothedRms;

    const now = performance.now();
    let isSpeaking: boolean;

    if (smoothedRms > SPEAK_THRESHOLD) {
      // Above threshold — speaking, extend hold timer
      isSpeaking = true;
      holdUntil = now + HOLD_MS;
    } else if (now < holdUntil) {
      // Below threshold but within hold window — still "speaking"
      isSpeaking = true;
    } else {
      isSpeaking = false;
    }

    if (isSpeaking !== wasSpeaking) {
      wasSpeaking = isSpeaking;
      send("voice_speaking", { speaking: isSpeaking });
    }
  }, POLL_MS);
}

export function stopSpeakingDetection() {
  if (speakingInterval !== null) {
    clearInterval(speakingInterval);
    speakingInterval = null;
  }
  if (speakingContext) {
    speakingContext.close();
    speakingContext = null;
  }
  speakingAnalyser = null;
}
