import { onMessage, type WSMessage } from "./ws";
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
  addOnlineUser,
  removeOnlineUser,
} from "../stores/users";
import { setVoiceStateList, updateVoiceState, currentVoiceChannelId, voiceStates } from "../stores/voice";
import { handleWebRTCOffer, handleWebRTCICE } from "./webrtc";
import { playJoinSound, playLeaveSound } from "./sounds";

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

export function initEventHandlers() {
  return onMessage((msg: WSMessage) => {
    switch (msg.op) {
      case "ready":
        setUser(msg.d.user);
        setChannelList(msg.d.channels);
        setOnlineUserList(msg.d.online_users);
        setVoiceStateList(msg.d.voice_states || []);
        break;

      case "message_create":
        addMessage({
          ...msg.d,
          reactions: msg.d.reactions || [],
          mentions: msg.d.mentions || [],
          attachments: msg.d.attachments || [],
          edited_at: null,
        });
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
    }
  });
}
