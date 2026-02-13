import { createSignal } from "solid-js";

export type VoiceState = {
  user_id: string;
  channel_id: string;
  self_mute: boolean;
  self_deafen: boolean;
  server_mute: boolean;
  speaking: boolean;
};

export type VoiceStats = {
  rtt: number;       // round-trip time in ms (peer ↔ SFU)
  jitter: number;    // jitter in ms
  packetLoss: number; // percentage 0-100
  bitrate: number;   // send bitrate in kbps
  codec: string;     // codec name
};

const [voiceStates, setVoiceStates] = createSignal<VoiceState[]>([]);
const [currentVoiceChannelId, setCurrentVoiceChannelId] = createSignal<
  string | null
>(null);
const [selfMute, setSelfMute] = createSignal(false);
const [selfDeafen, setSelfDeafen] = createSignal(false);
const [voiceStats, setVoiceStats] = createSignal<VoiceStats | null>(null);

export {
  voiceStates,
  currentVoiceChannelId,
  selfMute,
  selfDeafen,
  setSelfMute,
  setSelfDeafen,
  voiceStats,
  setVoiceStats,
};

export function setVoiceStateList(states: VoiceState[]) {
  setVoiceStates(states);
}

export function updateVoiceState(state: VoiceState) {
  if (!state.channel_id) {
    // User left voice
    setVoiceStates((prev) => prev.filter((s) => s.user_id !== state.user_id));
    return;
  }

  setVoiceStates((prev) => {
    const existing = prev.findIndex((s) => s.user_id === state.user_id);
    if (existing >= 0) {
      const updated = [...prev];
      updated[existing] = state;
      return updated;
    }
    return [...prev, state];
  });
}

export function setJoinedVoiceChannel(channelId: string | null) {
  setCurrentVoiceChannelId(channelId);
  if (!channelId) {
    setSelfMute(false);
    setSelfDeafen(false);
  }
}

export function getUsersInVoiceChannel(channelId: string): VoiceState[] {
  return voiceStates().filter((s) => s.channel_id === channelId);
}
