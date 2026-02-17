import { onMessage, send, type WSMessage } from "./ws";
import { setUser, currentUser } from "../stores/auth";
import {
  setChannelList,
  addChannel,
  removeChannel,
  reorderChannelList,
} from "../stores/channels";
import {
  addMessage,
  updateMessage,
  deleteMessage,
  addReaction,
  removeReaction,
} from "../stores/messages";
import {
  setOnlineUserList,
  setAllUserList,
  addOnlineUser,
  removeOnlineUser,
  mergeKnownUsers,
} from "../stores/users";
import {
  setVoiceStateList,
  updateVoiceState,
  currentVoiceChannelId,
  voiceStates,
  addScreenShare,
  removeScreenShare,
  setScreenShares,
  watchingScreenShare,
  setWatchingScreenShare,
} from "../stores/voice";
import { setNotificationList, addNotification } from "../stores/notifications";
import {
  setMediaList,
  addMediaItem,
  removeMediaItem,
  setMediaPlayback,
  setWatchingMedia,
  mediaPlayback,
} from "../stores/media";
import { handleWebRTCOffer, handleWebRTCICE } from "./webrtc";
import { handleScreenOffer, handleScreenICE, unsubscribeScreenShare } from "./screenshare";
import { playJoinSound, playLeaveSound } from "./sounds";
import { isDesktop } from "./devices";

// Typing state: channelId -> { userId -> timeout }
type TypingState = Record<string, Record<string, number>>;
let typingState: TypingState = {};
let typingListeners: Array<() => void> = [];

export function getTypingUsers(channelId: string): string[] {
  const ch = typingState[channelId];
  return ch ? Object.keys(ch) : [];
}

export function onTypingChange(fn: () => void): () => void {
  typingListeners.push(fn);
  return () => {
    typingListeners = typingListeners.filter((f) => f !== fn);
  };
}

function notifyTyping() {
  typingListeners.forEach((fn) => fn());
}

/** Register Tauri event listeners for Rust→Frontend voice events. */
function initDesktopVoiceEvents() {
  if (!isDesktop) return;

  const internals = (window as any).__TAURI_INTERNALS__;
  if (!internals?.invoke) return;

  // Tauri 2 event listening via __TAURI_INTERNALS__
  const listen = (window as any).__TAURI_INTERNALS__?.plugins?.event?.listen;

  // Use the Tauri global API if available
  try {
    const tauriEvent = (window as any).__TAURI__?.event;
    if (tauriEvent?.listen) {
      // voice:ice_candidate → forward to server over WS
      tauriEvent.listen("voice:ice_candidate", (event: any) => {
        const { candidate, sdpMid, sdpMLineIndex } = event.payload;
        send("webrtc_ice", {
          candidate: { candidate, sdpMid, sdpMLineIndex },
        });
      });

      // voice:speaking → forward to server over WS
      tauriEvent.listen("voice:speaking", (event: any) => {
        send("voice_speaking", { speaking: event.payload.speaking });
      });

      // voice:connection_state → log for debugging
      tauriEvent.listen("voice:connection_state", (event: any) => {
        console.log("[voice] Native connection state:", event.payload.state);
      });

      // screen:ice_candidate → forward to server over WS (presenter role)
      tauriEvent.listen("screen:ice_candidate", (event: any) => {
        const { candidate, sdpMid, sdpMLineIndex } = event.payload;
        send("webrtc_screen_ice", {
          candidate: { candidate, sdpMid, sdpMLineIndex },
          role: "presenter",
        });
      });

      console.log("[voice] Desktop voice event listeners registered");
      return;
    }
  } catch {}

  // Fallback: use __TAURI_INTERNALS__.invoke to register listeners
  // Tauri 2 with withGlobalTauri exposes window.__TAURI_INTERNALS__
  // We use the core:event:listen command directly
  function tauriListen(eventName: string, handler: (payload: any) => void) {
    // Create a callback that Tauri can call
    const callbackId = `_${Math.random().toString(36).slice(2)}`;
    (window as any)[callbackId] = (event: any) => {
      handler(event.payload);
    };

    internals.invoke("plugin:event|listen", {
      event: eventName,
      target: { kind: "Any" },
      handler: { handler: callbackId },
    }).catch((e: any) => {
      console.warn(`[voice] Failed to listen for ${eventName}:`, e);
    });
  }

  tauriListen("voice:ice_candidate", (payload: any) => {
    send("webrtc_ice", {
      candidate: {
        candidate: payload.candidate,
        sdpMid: payload.sdpMid,
        sdpMLineIndex: payload.sdpMLineIndex,
      },
    });
  });

  tauriListen("voice:speaking", (payload: any) => {
    send("voice_speaking", { speaking: payload.speaking });
  });

  tauriListen("voice:connection_state", (payload: any) => {
    console.log("[voice] Native connection state:", payload.state);
  });

  tauriListen("screen:ice_candidate", (payload: any) => {
    send("webrtc_screen_ice", {
      candidate: {
        candidate: payload.candidate,
        sdpMid: payload.sdpMid,
        sdpMLineIndex: payload.sdpMLineIndex,
      },
      role: "presenter",
    });
  });

  console.log("[voice] Desktop voice event listeners registered (fallback)");
}

export function initEventHandlers() {
  // Set up desktop voice event listeners (Rust → Frontend)
  initDesktopVoiceEvents();

  return onMessage((msg: WSMessage) => {
    switch (msg.op) {
      case "ready":
        setUser(msg.d.user);
        setChannelList(msg.d.channels);
        setOnlineUserList(msg.d.online_users);
        setAllUserList(msg.d.all_users || []);
        mergeKnownUsers([msg.d.user]);
        setVoiceStateList(msg.d.voice_states || []);
        setNotificationList(msg.d.notifications || []);
        setScreenShares(msg.d.screen_shares || []);
        setMediaList(msg.d.media_list || []);
        setMediaPlayback(msg.d.media_playback || null);
        break;

      case "message_create":
        addMessage({
          ...msg.d,
          reactions: msg.d.reactions || [],
          mentions: msg.d.mentions || [],
          attachments: msg.d.attachments || [],
          edited_at: null,
        });
        mergeKnownUsers([msg.d.author]);
        break;

      case "message_update":
        updateMessage(
          msg.d.id,
          msg.d.channel_id,
          msg.d.content,
          msg.d.edited_at
        );
        break;

      case "message_delete":
        deleteMessage(msg.d.id, msg.d.channel_id);
        break;

      case "reaction_add":
        addReaction(msg.d.message_id, msg.d.user_id, msg.d.emoji);
        break;

      case "reaction_remove":
        removeReaction(msg.d.message_id, msg.d.user_id, msg.d.emoji);
        break;

      case "typing_start": {
        const { channel_id, user_id } = msg.d;
        if (!typingState[channel_id]) typingState[channel_id] = {};
        clearTimeout(typingState[channel_id][user_id]);
        typingState[channel_id][user_id] = window.setTimeout(() => {
          delete typingState[channel_id][user_id];
          notifyTyping();
        }, 5000);
        notifyTyping();
        break;
      }

      case "channel_create":
        addChannel(msg.d);
        break;

      case "channel_delete":
        removeChannel(msg.d.channel_id);
        break;

      case "channel_reorder":
        reorderChannelList(msg.d.channel_ids);
        break;

      case "user_online":
        addOnlineUser(msg.d.user);
        break;

      case "user_offline":
        removeOnlineUser(msg.d.user_id);
        break;

      case "voice_state_update": {
        const myId = currentUser()?.id;
        const myChannel = currentVoiceChannelId();
        // Play sounds only when a user actually joins or leaves our channel,
        // not on mute/deafen/speaking state changes
        if (msg.d.user_id !== myId && myChannel) {
          const wasInChannel = voiceStates().some(
            (s) => s.user_id === msg.d.user_id && s.channel_id === myChannel
          );
          if (msg.d.channel_id === myChannel && !wasInChannel) {
            playJoinSound();
          } else if (!msg.d.channel_id && wasInChannel) {
            playLeaveSound();
          }
        }
        updateVoiceState(msg.d);
        break;
      }

      case "webrtc_offer":
        handleWebRTCOffer(msg.d.sdp);
        break;

      case "webrtc_ice":
        handleWebRTCICE(msg.d.candidate);
        break;

      case "screen_share_started":
        addScreenShare(msg.d.user_id, msg.d.channel_id);
        break;

      case "screen_share_stopped":
        removeScreenShare(msg.d.user_id);
        if (watchingScreenShare()?.user_id === msg.d.user_id) {
          unsubscribeScreenShare();
          setWatchingScreenShare(null);
        }
        break;

      case "webrtc_screen_offer":
        handleScreenOffer(msg.d.sdp, msg.d.role);
        break;

      case "webrtc_screen_ice":
        handleScreenICE(msg.d.candidate, msg.d.role);
        break;

      case "screen_share_error":
        console.error("[screen] Share rejected:", msg.d.error);
        break;

      case "notification_create":
        addNotification(msg.d);
        break;

      case "media_added":
        addMediaItem(msg.d);
        break;

      case "media_removed":
        removeMediaItem(msg.d.id);
        // If the removed video was playing, stop watching
        if (mediaPlayback()?.video_id === msg.d.id) {
          setMediaPlayback(null);
          setWatchingMedia(false);
        }
        break;

      case "media_playback":
        setMediaPlayback(msg.d || null);
        // If playback stopped (null), close player for everyone
        if (!msg.d) {
          setWatchingMedia(false);
        }
        break;
    }
  });
}
