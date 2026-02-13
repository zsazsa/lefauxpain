import { createSignal } from "solid-js";

export type VoiceState = {
  user_id: string;
  channel_id: string;
  self_mute: boolean;
  self_deafen: boolean;
  server_mute: boolean;
  speaking: boolean;
};

const [voiceStates, setVoiceStates] = createSignal<VoiceState[]>([]);
const [currentVoiceChannelId, setCurrentVoiceChannelId] = createSignal<
  string | null
>(null);
const [selfMute, setSelfMute] = createSignal(false);
const [selfDeafen, setSelfDeafen] = createSignal(false);

export {
  voiceStates,
  currentVoiceChannelId,
  selfMute,
  selfDeafen,
  setSelfMute,
  setSelfDeafen,
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
