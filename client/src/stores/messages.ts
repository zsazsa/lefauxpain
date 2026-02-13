import { createSignal } from "solid-js";

export type Attachment = {
  id: string;
  filename: string;
  url: string;
  thumb_url: string | null;
  mime_type: string;
  width: number | null;
  height: number | null;
};

export type ReactionGroup = {
  emoji: string;
  count: number;
  user_ids: string[];
};

export type ReplyTo = {
  id: string;
  author: { id: string; username: string; avatar_url?: string | null };
  content: string | null;
};

export type Message = {
  id: string;
  channel_id: string;
  author: { id: string; username: string; avatar_url?: string | null };
  content: string | null;
  reply_to: ReplyTo | null;
  attachments: Attachment[];
  reactions: ReactionGroup[];
  mentions: string[];
  created_at: string;
  edited_at: string | null;
};

// Messages per channel
const [messagesByChannel, setMessagesByChannel] = createSignal<
  Record<string, Message[]>
>({});
const [replyingTo, setReplyingTo] = createSignal<Message | null>(null);

export { messagesByChannel, replyingTo, setReplyingTo };

export function setMessages(channelId: string, msgs: Message[]) {
  setMessagesByChannel((prev) => ({ ...prev, [channelId]: msgs }));
}

export function prependMessages(channelId: string, msgs: Message[]) {
  setMessagesByChannel((prev) => ({
    ...prev,
    [channelId]: [...msgs, ...(prev[channelId] || [])],
  }));
}

export function addMessage(msg: Message) {
  setMessagesByChannel((prev) => ({
    ...prev,
    [msg.channel_id]: [...(prev[msg.channel_id] || []), msg],
  }));
}

export function updateMessage(
  id: string,
  channelId: string,
  content: string,
  editedAt: string
) {
  setMessagesByChannel((prev) => ({
    ...prev,
    [channelId]: (prev[channelId] || []).map((m) =>
      m.id === id ? { ...m, content, edited_at: editedAt } : m
    ),
  }));
}

export function deleteMessage(id: string, channelId: string) {
  setMessagesByChannel((prev) => ({
    ...prev,
    [channelId]: (prev[channelId] || []).filter((m) => m.id !== id),
  }));
}

export function addReaction(
  messageId: string,
  userId: string,
  emoji: string
) {
  setMessagesByChannel((prev) => {
    const updated: Record<string, Message[]> = {};
    for (const [chId, msgs] of Object.entries(prev)) {
      updated[chId] = msgs.map((m) => {
        if (m.id !== messageId) return m;
        const existing = m.reactions.find((r) => r.emoji === emoji);
        if (existing) {
          if (existing.user_ids.includes(userId)) return m;
          return {
            ...m,
            reactions: m.reactions.map((r) =>
              r.emoji === emoji
                ? {
                    ...r,
                    count: r.count + 1,
                    user_ids: [...r.user_ids, userId],
                  }
                : r
            ),
          };
        }
        return {
          ...m,
          reactions: [
            ...m.reactions,
            { emoji, count: 1, user_ids: [userId] },
          ],
        };
      });
    }
    return updated;
  });
}

export function removeReaction(
  messageId: string,
  userId: string,
  emoji: string
) {
  setMessagesByChannel((prev) => {
    const updated: Record<string, Message[]> = {};
    for (const [chId, msgs] of Object.entries(prev)) {
      updated[chId] = msgs.map((m) => {
        if (m.id !== messageId) return m;
        return {
          ...m,
          reactions: m.reactions
            .map((r) =>
              r.emoji === emoji
                ? {
                    ...r,
                    count: r.count - 1,
                    user_ids: r.user_ids.filter((id) => id !== userId),
                  }
                : r
            )
            .filter((r) => r.count > 0),
        };
      });
    }
    return updated;
  });
}

export function getChannelMessages(channelId: string): Message[] {
  return messagesByChannel()[channelId] || [];
}
