import { onMessage, send, type WSMessage } from "./ws";
import { setUser, currentUser } from "../stores/auth";
import {
  setChannelList,
  addChannel,
  removeChannel,
  reorderChannelList,
  updateChannel,
  setDeletedChannels,
  deletedChannels,
  channels,
  selectedChannelId,
  setUnreadCounts,
  incrementUnread,
} from "../stores/channels";
import {
  addMessage,
  updateMessage,
  deleteMessage,
  addReaction,
  removeReaction,
  setMessageUnfurls,
  addThreadMessage,
  updateThreadSummary,
} from "../stores/messages";
import {
  setOnlineUserList,
  setAllUserList,
  addOnlineUser,
  removeOnlineUser,
  addAllUser,
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
  setEnabledFeatures,
  toggleFeature,
} from "../stores/strudel";
import { handleWebRTCOffer, handleWebRTCICE, joinVoice } from "./webrtc";
import { handleScreenOffer, handleScreenICE, unsubscribeScreenShare } from "./screenshare";
import { playJoinSound, playLeaveSound } from "./sounds";
import { isDesktop } from "./devices";
import { dispatchReady, dispatchEvent } from "./appletRegistry";
import { showMentionNotification } from "./browserNotify";

// Ensure all applets register before events are dispatched
import "../applets";

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
        setDeletedChannels(msg.d.deleted_channels || []);
        if (msg.d.unread_counts) {
          setUnreadCounts(msg.d.unread_counts);
        }
        // Enabled features (core)
        setEnabledFeatures(msg.d.enabled_features || []);
        // Dispatch to applet ready handlers
        dispatchReady(msg.d);
        // Auto-rejoin voice if we were in a channel before refresh
        {
          const savedChannel = sessionStorage.getItem("voice_channel");
          if (savedChannel) {
            sessionStorage.removeItem("voice_channel");
            setTimeout(() => joinVoice(savedChannel), 500);
          }
        }
        break;

      case "message_create": {
        const newMsg = {
          ...msg.d,
          reactions: msg.d.reactions || [],
          mentions: msg.d.mentions || [],
          attachments: msg.d.attachments || [],
          edited_at: null,
          thread_id: msg.d.thread_id || null,
          thread_summary: null,
        };
        mergeKnownUsers([msg.d.author]);

        const threadId = msg.d.thread_id;
        if (threadId && threadId !== msg.d.id) {
          // Thread reply — don't add to main feed, route to thread panel
          addThreadMessage(newMsg);
          updateThreadSummary(msg.d.channel_id, threadId, msg.d.author.username);
        } else {
          // Standalone message or thread root — add to main feed
          addMessage(newMsg);
          if (msg.d.channel_id !== selectedChannelId()) {
            incrementUnread(msg.d.channel_id);
          }
        }
        break;
      }

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

      case "message_unfurls":
        setMessageUnfurls(msg.d.message_id, msg.d.channel_id, msg.d.unfurls || []);
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
        addChannel({ ...msg.d, manager_ids: msg.d.manager_ids || [] });
        break;

      case "channel_delete": {
        // If admin, move to deleted channels list
        const ch = channels().find((c) => c.id === msg.d.channel_id);
        if (ch && currentUser()?.is_admin) {
          setDeletedChannels((prev) => [...prev, ch]);
        }
        removeChannel(msg.d.channel_id);
        break;
      }

      case "channel_update":
        updateChannel({ ...msg.d, manager_ids: msg.d.manager_ids || [] });
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

      case "user_approved":
        addAllUser(msg.d.user);
        break;

      case "voice_state_update": {
        const myId = currentUser()?.id;
        const myChannel = currentVoiceChannelId();
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
        if (msg.d.type === "mention") {
          showMentionNotification(
            msg.d.data.author_username,
            msg.d.data.channel_name,
            msg.d.data.content_preview,
            msg.d.id,
          );
        }
        break;

      case "feature_toggled":
        toggleFeature(msg.d.feature, msg.d.enabled);
        break;

      case "channel_member_added": {
        // Re-fetch channels to get updated membership info
        // The simplest approach: the ready event already sends full channel list
        // For now, add the channel to our list if we don't have it
        const channelData = msg.d;
        if (channelData && channelData.channel) {
          addChannel(channelData.channel);
        }
        break;
      }

      case "channel_member_removed": {
        const channelData = msg.d;
        if (channelData && channelData.channel_id) {
          // Update channel to show as non-member, or remove if invisible
          const ch = channels().find(c => c.id === channelData.channel_id);
          if (ch && ch.visibility === "invisible") {
            removeChannel(channelData.channel_id);
          } else if (ch) {
            updateChannel({ ...ch, is_member: false, role: null });
          }
        }
        break;
      }

      default:
        // Dispatch to applet event handlers
        dispatchEvent(msg.op, msg.d);
        break;
    }
  });
}
