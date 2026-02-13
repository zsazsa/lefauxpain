import { createEffect, createSignal, For, onCleanup, onMount } from "solid-js";
import { getChannelMessages, setMessages, prependMessages, scrollToMessageId, setScrollToMessageId } from "../../stores/messages";
import { getMessages, getMessagesAround } from "../../lib/api";
import { mergeKnownUsers } from "../../stores/users";
import MessageItem from "./Message";

interface MessageListProps {
  channelId: string;
}

export default function MessageList(props: MessageListProps) {
  let containerRef: HTMLDivElement | undefined;
  const [loading, setLoading] = createSignal(false);
  const [hasMore, setHasMore] = createSignal(true);
  const [initialLoad, setInitialLoad] = createSignal(true);
  const [highlightId, setHighlightId] = createSignal<string | null>(null);

  const messages = () => getChannelMessages(props.channelId);

  // Load initial messages when channel changes
  createEffect(() => {
    const chId = props.channelId;
    setInitialLoad(true);
    setHasMore(true);
    loadMessages(chId);
  });

  async function loadMessages(channelId: string, before?: string) {
    setLoading(true);
    try {
      const msgs = await getMessages(channelId, before);
      if (msgs.length < 50) setHasMore(false);
      // API returns newest first, reverse for display
      const reversed = [...msgs].reverse();
      mergeKnownUsers(reversed.map((m: any) => m.author));
      if (before) {
        prependMessages(channelId, reversed);
      } else {
        setMessages(channelId, reversed);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
      setInitialLoad(false);
    }
  }

  // Handle scroll-to-message
  createEffect(() => {
    const targetId = scrollToMessageId();
    if (!targetId) return;

    // Clear the signal so it doesn't retrigger
    setScrollToMessageId(null);

    const currentMessages = messages();
    const alreadyLoaded = currentMessages.some((m) => m.id === targetId);

    if (alreadyLoaded) {
      scrollAndHighlight(targetId);
    } else {
      // Load messages around the target
      loadMessagesAround(props.channelId, targetId);
    }
  });

  async function loadMessagesAround(channelId: string, messageId: string) {
    setLoading(true);
    try {
      const msgs = await getMessagesAround(channelId, messageId);
      // API returns newest first, reverse for display
      const reversed = [...msgs].reverse();
      mergeKnownUsers(reversed.map((m: any) => m.author));
      setMessages(channelId, reversed);
      setHasMore(true); // There may be more messages above/below
      // Wait for DOM to update, then scroll
      requestAnimationFrame(() => scrollAndHighlight(messageId));
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  function scrollAndHighlight(messageId: string) {
    requestAnimationFrame(() => {
      const el = containerRef?.querySelector(`[data-message-id="${messageId}"]`);
      if (el) {
        el.scrollIntoView({ block: "center", behavior: "smooth" });
        setHighlightId(messageId);
        setTimeout(() => setHighlightId(null), 2000);
      }
    });
  }

  // Auto-scroll to bottom on new messages
  createEffect(() => {
    const _ = messages();
    if (containerRef && !initialLoad()) {
      // Only scroll if already near bottom
      const { scrollTop, scrollHeight, clientHeight } = containerRef;
      if (scrollHeight - scrollTop - clientHeight < 200) {
        requestAnimationFrame(() => {
          containerRef!.scrollTop = containerRef!.scrollHeight;
        });
      }
    }
  });

  // Scroll to bottom on initial load
  createEffect(() => {
    if (!initialLoad() && containerRef) {
      requestAnimationFrame(() => {
        containerRef!.scrollTop = containerRef!.scrollHeight;
      });
    }
  });

  // Infinite scroll up for history
  const handleScroll = () => {
    if (!containerRef || loading() || !hasMore()) return;
    if (containerRef.scrollTop < 100) {
      const msgs = messages();
      if (msgs.length > 0) {
        const oldHeight = containerRef.scrollHeight;
        loadMessages(props.channelId, msgs[0].id).then(() => {
          // Preserve scroll position
          if (containerRef) {
            containerRef.scrollTop = containerRef.scrollHeight - oldHeight;
          }
        });
      }
    }
  };

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      style={{
        flex: "1",
        overflow: "auto",
        padding: "16px 0",
        display: "flex",
        "flex-direction": "column",
      }}
    >
      {loading() && messages().length === 0 && (
        <div
          style={{
            "text-align": "center",
            padding: "20px",
            color: "var(--text-muted)",
          }}
        >
          Loading...
        </div>
      )}
      <div style={{ "margin-top": "auto" }}>
        <For each={messages()}>
          {(msg) => (
            <MessageItem
              message={msg}
              highlighted={highlightId() === msg.id}
            />
          )}
        </For>
      </div>
    </div>
  );
}
