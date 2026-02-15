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

export type ScreenShare = {
  user_id: string;
  channel_id: string;
};

const [voiceStates, setVoiceStates] = createSignal<VoiceState[]>([]);
const [currentVoiceChannelId, setCurrentVoiceChannelId] = createSignal<
  string | null
>(null);
const [selfMute, setSelfMute] = createSignal(false);
const [selfDeafen, setSelfDeafen] = createSignal(false);
const [voiceStats, setVoiceStats] = createSignal<VoiceStats | null>(null);
const [screenShares, setScreenShares] = createSignal<ScreenShare[]>([]);
const [watchingScreenShare, setWatchingScreenShare] = createSignal<ScreenShare | null>(null);
const [screenShareStream, setScreenShareStream] = createSignal<MediaStream | null>(null);
const [localScreenStream, setLocalScreenStream] = createSignal<MediaStream | null>(null);
const [desktopPresenting, setDesktopPresenting] = createSignal(false);
const [desktopPreviewUrl, setDesktopPreviewUrl] = createSignal<string | null>(null);

export {
  voiceStates,
  currentVoiceChannelId,
  selfMute,
  selfDeafen,
  setSelfMute,
  setSelfDeafen,
  voiceStats,
  setVoiceStats,
  screenShares,
  setScreenShares,
  watchingScreenShare,
  setWatchingScreenShare,
  screenShareStream,
  setScreenShareStream,
  localScreenStream,
  setLocalScreenStream,
  desktopPresenting,
  setDesktopPresenting,
  desktopPreviewUrl,
  setDesktopPreviewUrl,
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

export function addScreenShare(userId: string, channelId: string) {
  setScreenShares((prev) => {
    if (prev.some((s) => s.user_id === userId)) return prev;
    return [...prev, { user_id: userId, channel_id: channelId }];
  });
}

export function removeScreenShare(userId: string) {
  setScreenShares((prev) => prev.filter((s) => s.user_id !== userId));
}

export function getScreenShareForChannel(channelId: string): ScreenShare | undefined {
  return screenShares().find((s) => s.channel_id === channelId);
}
