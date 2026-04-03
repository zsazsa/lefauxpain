import { createEffect, createSignal, For, Show, onCleanup } from "solid-js";
import {
  threadPanelOpen, setThreadPanelOpen,
  activeThreadId,
  threadMessages, setThreadMessages,
  threadPanelTab, setThreadPanelTab,
  messagesByChannel,
  openThread,
  setScrollToMessageId,
} from "../../stores/messages";
import { getThreadMessages, getStarredMessages, starMessage, unstarMessage } from "../../lib/api";
import MessageItem from "./Message";

function findThreadRoot(threadId: string): any | null {
  const allChannels = messagesByChannel();
  for (const channelId in allChannels) {
    const msgs = allChannels[channelId];
    if (msgs) {
      const root = msgs.find((m: any) => m.id === threadId);
      if (root) return root;
    }
  }
  return null;
}

export default function ThreadPanel(props: { channelId: string; channelName: string; send: (op: string, data: any) => void }) {
  const [starredMessages, setStarredMessages] = createSignal<any[]>([]);
  const [threadInput, setThreadInput] = createSignal("");
  const [loading, setLoading] = createSignal(false);
  const [alsoSendToChannel, setAlsoSendToChannel] = createSignal(false);
  const [starredIds, setStarredIds] = createSignal<Set<string>>(new Set());
  let messagesEndRef: HTMLDivElement | undefined;

  createEffect(() => {
    const threadId = activeThreadId();
    if (threadId && threadPanelTab() === "thread") {
      setLoading(true);
      getThreadMessages(props.channelId, threadId)
        .then((msgs) => {
          setThreadMessages(msgs);
          setLoading(false);
          setTimeout(() => messagesEndRef?.scrollIntoView({ behavior: "smooth" }), 100);
        })
        .catch(() => setLoading(false));
    }
  });

  createEffect(() => {
    if (threadPanelOpen()) {
      getStarredMessages()
        .then((msgs) => {
          setStarredMessages(msgs);
          setStarredIds(new Set(msgs.map((m: any) => m.id)));
        })
        .catch(() => {});
    }
  });

  createEffect(() => {
    const msgs = threadMessages();
    if (msgs.length > 0 && threadPanelTab() === "thread") {
      setTimeout(() => messagesEndRef?.scrollIntoView({ behavior: "smooth" }), 50);
    }
  });

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape" && threadPanelOpen()) {
      setThreadPanelOpen(false);
    }
  };
  document.addEventListener("keydown", handleKeyDown);
  onCleanup(() => document.removeEventListener("keydown", handleKeyDown));

  const handleThreadSend = () => {
    const content = threadInput().trim();
    if (!content) return;
    const threadId = activeThreadId();
    if (!threadId) return;

    // Send to thread
    props.send("send_message", {
      channel_id: props.channelId,
      content,
      reply_to_id: null,
      thread_id: threadId,
      attachment_ids: [],
    });

    // Also send to channel if checked
    if (alsoSendToChannel()) {
      const threadContent = `replied to a thread\n${content}`;
      props.send("send_message", {
        channel_id: props.channelId,
        content: threadContent,
        reply_to_id: threadId,
        attachment_ids: [],
      });
    }

    setThreadInput("");
  };

  const toggleStar = async (messageId: string) => {
    if (starredIds().has(messageId)) {
      await unstarMessage(messageId);
      setStarredIds((prev) => { const next = new Set(prev); next.delete(messageId); return next; });
      setStarredMessages((prev) => prev.filter((m) => m.id !== messageId));
    } else {
      await starMessage(messageId);
      setStarredIds((prev) => new Set([...prev, messageId]));
      const msgs = await getStarredMessages();
      setStarredMessages(msgs);
    }
  };

  return (
    <Show when={threadPanelOpen()}>
      <div style={{
        width: "400px",
        "min-width": "400px",
        height: "100%",
        "border-left": "1px solid var(--border-gold)",
        "background-color": "var(--bg-secondary)",
        display: "flex",
        "flex-direction": "column",
      }}>
        {/* Header */}
        <div style={{
          display: "flex",
          "align-items": "center",
          "justify-content": "space-between",
          padding: "8px 12px",
          "border-bottom": "1px solid var(--border-gold)",
        }}>
          <div style={{ display: "flex", gap: "12px" }}>
            <button
              onClick={() => setThreadPanelTab("thread")}
              style={{
                "font-family": "var(--font-display)",
                "font-size": "11px",
                "letter-spacing": "1px",
                "text-transform": "uppercase",
                color: threadPanelTab() === "thread" ? "var(--accent)" : "var(--text-muted)",
                background: "none",
                border: "none",
                "border-bottom-width": "2px",
                "border-bottom-style": "solid",
                "border-bottom-color": threadPanelTab() === "thread" ? "var(--accent)" : "transparent",
                padding: "4px 0",
                cursor: "pointer",
              }}
            >
              Thread
            </button>
            <button
              onClick={() => setThreadPanelTab("starred")}
              style={{
                "font-family": "var(--font-display)",
                "font-size": "11px",
                "letter-spacing": "1px",
                "text-transform": "uppercase",
                color: threadPanelTab() === "starred" ? "var(--accent)" : "var(--text-muted)",
                background: "none",
                border: "none",
                "border-bottom-width": "2px",
                "border-bottom-style": "solid",
                "border-bottom-color": threadPanelTab() === "starred" ? "var(--accent)" : "transparent",
                padding: "4px 0",
                cursor: "pointer",
              }}
            >
              Starred
            </button>
          </div>
          <button
            onClick={() => setThreadPanelOpen(false)}
            style={{
              color: "var(--text-muted)",
              background: "none",
              border: "none",
              cursor: "pointer",
              "font-size": "14px",
            }}
          >
            [x]
          </button>
        </div>

        {/* Thread tab */}
        <Show when={threadPanelTab() === "thread"}>
          <div style={{ flex: "1", overflow: "auto", padding: "8px 12px" }}>
            {(() => {
              const tid = activeThreadId();
              const root = tid ? findThreadRoot(tid) : null;
              return (
                <Show when={root} fallback={
                  <div style={{ color: "var(--text-muted)", "font-size": "11px", padding: "8px 0" }}>
                    Thread
                  </div>
                }>
                  {(rootMsg) => (
                    <div style={{
                      "border-bottom": "1px solid var(--border-gold)",
                      "padding-bottom": "8px",
                      "margin-bottom": "8px",
                    }}>
                      <MessageItem message={rootMsg()} highlighted={false} />
                      <button
                        onClick={() => toggleStar(rootMsg().id)}
                        style={{
                          "font-size": "10px",
                          color: starredIds().has(rootMsg().id) ? "var(--danger)" : "var(--accent)",
                          background: "none",
                          border: `1px solid ${starredIds().has(rootMsg().id) ? "var(--danger)" : "var(--accent)"}`,
                          padding: "2px 6px",
                          cursor: "pointer",
                          "margin-top": "4px",
                          "margin-left": "60px",
                        }}
                      >
                        {starredIds().has(rootMsg().id) ? "[unstar]" : "[star]"}
                      </button>
                    </div>
                  )}
                </Show>
              );
            })()}

            <Show when={loading()}>
              <div style={{ color: "var(--text-muted)", "font-size": "11px", padding: "12px 0" }}>
                Loading thread...
              </div>
            </Show>
            <div class="thread-compact">
              <For each={threadMessages().filter((m) => m.id !== activeThreadId())}>
                {(msg) => <MessageItem message={msg} highlighted={false} />}
              </For>
            </div>
            <div ref={messagesEndRef} />
          </div>

          <div style={{
            padding: "8px 12px",
            "border-top": "1px solid var(--border-gold)",
          }}>
            <label style={{
              display: "flex",
              "align-items": "center",
              gap: "6px",
              "font-size": "11px",
              color: "var(--text-muted)",
              padding: "4px 0",
              cursor: "pointer",
            }}>
              <input
                type="checkbox"
                checked={alsoSendToChannel()}
                onChange={(e) => setAlsoSendToChannel(e.currentTarget.checked)}
                style={{ cursor: "pointer" }}
              />
              Also send to #{props.channelName}
            </label>
            <input
              type="text"
              placeholder="Reply in thread..."
              value={threadInput()}
              onInput={(e) => setThreadInput(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleThreadSend();
                }
              }}
              style={{
                width: "100%",
                padding: "6px 10px",
                "background-color": "var(--bg-tertiary)",
                color: "var(--text-primary)",
                border: "1px solid var(--border-gold)",
                "font-size": "12px",
                "font-family": "var(--font-mono)",
              }}
            />
          </div>
        </Show>

        {/* Starred tab */}
        <Show when={threadPanelTab() === "starred"}>
          <div style={{ flex: "1", overflow: "auto", padding: "8px 12px" }}>
            <Show when={starredMessages().length === 0}>
              <div style={{ color: "var(--text-muted)", "font-size": "11px", "font-style": "italic", padding: "12px 0" }}>
                No starred messages.
              </div>
            </Show>
            <For each={starredMessages()}>
              {(msg) => (
                <div style={{
                  "border-bottom": "1px solid rgba(201,168,76,0.1)",
                  padding: "8px 0",
                  cursor: "pointer",
                }}>
                  <div
                    onClick={() => {
                      // Always open in thread tab — the message becomes the thread root
                      openThread(msg.id);
                    }}
                  >
                    <div style={{ display: "flex", "justify-content": "space-between", "align-items": "center" }}>
                      <span style={{ "font-size": "12px", color: "var(--text-primary)" }}>
                        {msg.author_username || "unknown"}
                      </span>
                      <span style={{ "font-size": "10px", color: "var(--text-muted)" }}>
                        {new Date(msg.created_at).toLocaleDateString()}
                      </span>
                    </div>
                    <div style={{ "font-size": "11px", color: "var(--text-secondary)", "margin-top": "2px" }}>
                      {msg.content ? msg.content.slice(0, 100) + (msg.content.length > 100 ? "..." : "") : "[attachment]"}
                    </div>
                    <Show when={msg.thread_id && msg.thread_id === msg.id}>
                      <div style={{ "font-size": "10px", color: "var(--cyan)", "margin-top": "2px" }}>
                        Thread
                      </div>
                    </Show>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleStar(msg.id); }}
                    style={{
                      "font-size": "10px",
                      color: "var(--danger)",
                      background: "none",
                      border: "1px solid var(--danger)",
                      padding: "1px 4px",
                      cursor: "pointer",
                      "margin-top": "4px",
                    }}
                  >
                    [unstar]
                  </button>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>
    </Show>
  );
}
