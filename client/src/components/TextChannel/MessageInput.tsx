import { createSignal, Show, For, onCleanup } from "solid-js";
import { send } from "../../lib/ws";
import { replyingTo, setReplyingTo, getChannelMessages } from "../../stores/messages";
import { uploadFile, uploadMedia, previewUnfurl } from "../../lib/api";
import { onlineUsers, allUsers } from "../../stores/users";
import { currentUser } from "../../stores/auth";
import { isMobile } from "../../stores/responsive";

interface MessageInputProps {
  channelId: string;
  channelName: string;
}

type PendingAttachment = {
  id: string;
  previewUrl: string;
};

export default function MessageInput(props: MessageInputProps) {
  const [text, setText] = createSignal("");
  const [attachments, setAttachments] = createSignal<PendingAttachment[]>([]);
  const [uploading, setUploading] = createSignal(false);
  const [dragActive, setDragActive] = createSignal(false);
  const [mentionQuery, setMentionQuery] = createSignal<string | null>(null);
  const [mentionIndex, setMentionIndex] = createSignal(0);
  const [urlPreview, setUrlPreview] = createSignal<{
    url: string;
    site_name: string;
    title: string | null;
    description: string | null;
  } | null>(null);
  const [previewLoading, setPreviewLoading] = createSignal(false);
  let fileInputRef: HTMLInputElement | undefined;
  let inputRef: HTMLInputElement | undefined;
  let typingTimeout: number | null = null;
  let previewAbort: AbortController | null = null;
  const pendingMentions = new Map<string, string>();

  const urlRegex = /https?:\/\/[^\s<>"'`]+/;

  function tryFetchPreview(value: string) {
    // Cancel any pending preview
    if (previewAbort) previewAbort.abort();

    const match = value.match(urlRegex);
    if (!match) {
      setUrlPreview(null);
      return;
    }

    // Strip trailing punctuation
    let url = match[0];
    while (url.length > 1 && /[.,;:!?)>\]]+$/.test(url)) {
      url = url.slice(0, -1);
    }

    // Don't re-fetch if we already have this URL
    const current = urlPreview();
    if (current && current.url === url) return;

    previewAbort = new AbortController();
    setPreviewLoading(true);
    previewUnfurl(url)
      .then((res) => {
        if (res.success) {
          setUrlPreview({
            url: res.url || url,
            site_name: res.site_name || "",
            title: res.title || null,
            description: res.description || null,
          });
        } else {
          setUrlPreview(null);
        }
      })
      .catch(() => setUrlPreview(null))
      .finally(() => setPreviewLoading(false));
  }

  // Cleanup preview URLs on unmount
  onCleanup(() => {
    attachments().forEach((a) => URL.revokeObjectURL(a.previewUrl));
  });

  const mentionableUsers = () => {
    const map = new Map<string, { id: string; username: string }>();
    for (const u of onlineUsers()) map.set(u.id, u);
    for (const u of allUsers()) if (!map.has(u.id)) map.set(u.id, u);
    for (const m of getChannelMessages(props.channelId))
      if (!map.has(m.author.id)) map.set(m.author.id, m.author);
    return Array.from(map.values());
  };

  const filteredUsers = () => {
    const q = mentionQuery();
    if (q === null) return [];
    const me = currentUser();
    const users = mentionableUsers().filter((u) => u.id !== me?.id);
    if (q === "") return users.slice(0, 10);
    const lower = q.toLowerCase();
    return users.filter((u) => u.username.toLowerCase().includes(lower)).slice(0, 10);
  };

  function updateMentionQuery(value: string, cursorPos: number) {
    const before = value.slice(0, cursorPos);
    const match = before.match(/@(\w*)$/);
    if (match) {
      setMentionQuery(match[1]);
      setMentionIndex(0);
    } else {
      setMentionQuery(null);
    }
  }

  function selectMention(userId: string, username: string) {
    const value = text();
    const cursorPos = inputRef?.selectionStart || value.length;
    const before = value.slice(0, cursorPos);
    const after = value.slice(cursorPos);
    const atIndex = before.lastIndexOf("@");
    if (atIndex === -1) return;
    pendingMentions.set(username, userId);
    const newText = before.slice(0, atIndex) + `@${username} ` + after;
    setText(newText);
    setMentionQuery(null);
    requestAnimationFrame(() => {
      if (inputRef) {
        inputRef.focus();
        const pos = atIndex + username.length + 2;
        inputRef.setSelectionRange(pos, pos);
      }
    });
  }

  const handleSend = () => {
    let content = text().trim();
    const atts = attachments();

    if (!content && atts.length === 0) return;

    for (const [username, userId] of pendingMentions) {
      content = content.replaceAll(`@${username}`, `<@${userId}>`);
    }

    send("send_message", {
      channel_id: props.channelId,
      content: content || null,
      reply_to_id: replyingTo()?.id || null,
      attachment_ids: atts.map((a) => a.id),
    });

    // Cleanup preview URLs
    atts.forEach((a) => URL.revokeObjectURL(a.previewUrl));
    setText("");
    setAttachments([]);
    setReplyingTo(null);
    setMentionQuery(null);
    setUrlPreview(null);
    pendingMentions.clear();
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (mentionQuery() !== null && filteredUsers().length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionIndex((i) => Math.min(i + 1, filteredUsers().length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const user = filteredUsers()[mentionIndex()];
        if (user) selectMention(user.id, user.username);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMentionQuery(null);
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
      return;
    }

    if (!typingTimeout) {
      send("typing_start", { channel_id: props.channelId });
      typingTimeout = window.setTimeout(() => {
        typingTimeout = null;
      }, 3000);
    }
  };

  const handleInput = (e: InputEvent & { currentTarget: HTMLInputElement }) => {
    const value = e.currentTarget.value;
    setText(value);
    updateMentionQuery(value, e.currentTarget.selectionStart || value.length);
  };

  const handleFiles = async (files: File[]) => {
    const imageFiles = files.filter((f) => f.type.startsWith("image/"));
    if (imageFiles.length === 0) return;

    setUploading(true);
    try {
      for (const file of imageFiles) {
        const previewUrl = URL.createObjectURL(file);
        const res = await uploadFile(file);
        setAttachments((prev) => [...prev, { id: res.id, previewUrl }]);
      }
    } catch {
      // ignore
    } finally {
      setUploading(false);
    }
  };

  const removeAttachment = (id: string) => {
    const att = attachments().find((a) => a.id === id);
    if (att) URL.revokeObjectURL(att.previewUrl);
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    if (!e.dataTransfer?.files) return;
    const files = Array.from(e.dataTransfer.files);

    const imageFiles = files.filter((f) => f.type.startsWith("image/"));
    const videoFiles = files.filter((f) => f.type.startsWith("video/"));

    if (imageFiles.length > 0) handleFiles(imageFiles);

    if (videoFiles.length > 0) {
      (async () => {
        for (const file of videoFiles) {
          try { await uploadMedia(file); } catch {}
        }
      })();
    }
  };

  return (
    <div
      style={{ padding: isMobile() ? "0 8px 8px" : "0 16px 16px", position: "relative" }}
      onDragOver={(e) => {
        e.preventDefault();
        setDragActive(true);
      }}
      onDragLeave={() => setDragActive(false)}
      onDrop={handleDrop}
    >
      {/* Mention autocomplete dropdown */}
      <Show when={mentionQuery() !== null && filteredUsers().length > 0}>
        <div
          style={{
            position: "absolute",
            bottom: "100%",
            left: isMobile() ? "8px" : "16px",
            right: isMobile() ? "8px" : "16px",
            "background-color": "var(--bg-secondary)",
            border: "1px solid var(--border-gold)",
            padding: "2px 0",
            "max-height": "200px",
            overflow: "auto",
            "z-index": "10",
          }}
        >
          <For each={filteredUsers()}>
            {(user, i) => (
              <div
                onClick={() => selectMention(user.id, user.username)}
                style={{
                  padding: "4px 12px",
                  cursor: "pointer",
                  display: "flex",
                  "align-items": "center",
                  gap: "8px",
                  "background-color": i() === mentionIndex()
                    ? "var(--accent-glow)"
                    : "transparent",
                  "font-size": "13px",
                  color: "var(--text-primary)",
                }}
                onMouseOver={() => setMentionIndex(i())}
              >
                <span style={{ color: "var(--cyan)" }}>@</span>
                <span>{user.username}</span>
              </div>
            )}
          </For>
        </div>
      </Show>

      {/* Reply indicator */}
      <Show when={replyingTo()}>
        <div
          style={{
            display: "flex",
            "align-items": "center",
            "justify-content": "space-between",
            padding: "4px 12px",
            "background-color": "var(--bg-secondary)",
            "border-top": "1px solid var(--border-gold)",
            "border-left": "1px solid var(--border-gold)",
            "border-right": "1px solid var(--border-gold)",
            "font-size": "12px",
            color: "var(--text-muted)",
          }}
        >
          <span>
            replying to{" "}
            <span style={{ color: "var(--cyan)" }}>
              @{replyingTo()!.author.username}
            </span>
          </span>
          <button
            onClick={() => setReplyingTo(null)}
            style={{
              color: "var(--text-muted)",
              "font-size": "12px",
              padding: "0 4px",
            }}
          >
            [x]
          </button>
        </div>
      </Show>

      {/* Attachment previews with thumbnails */}
      <Show when={attachments().length > 0}>
        <div
          style={{
            display: "flex",
            gap: "8px",
            padding: "8px 12px",
            "background-color": "var(--bg-secondary)",
            "border-left": "1px solid var(--border-gold)",
            "border-right": "1px solid var(--border-gold)",
            "flex-wrap": "wrap",
          }}
        >
          <For each={attachments()}>
            {(att) => (
              <div style={{ position: "relative", display: "inline-block" }}>
                <img
                  src={att.previewUrl}
                  style={{
                    "max-width": "80px",
                    "max-height": "80px",
                    "border-radius": "2px",
                    border: "1px solid var(--border-gold)",
                    display: "block",
                  }}
                />
                <button
                  onClick={() => removeAttachment(att.id)}
                  style={{
                    position: "absolute",
                    top: "-4px",
                    right: "-4px",
                    width: "16px",
                    height: "16px",
                    "border-radius": "50%",
                    "background-color": "var(--danger)",
                    color: "#fff",
                    "font-size": "10px",
                    "line-height": "16px",
                    "text-align": "center",
                    padding: "0",
                    border: "none",
                    cursor: "pointer",
                  }}
                >
                  x
                </button>
              </div>
            )}
          </For>
        </div>
      </Show>

      {/* URL preview */}
      <Show when={urlPreview() || previewLoading()}>
        <div
          style={{
            display: "flex",
            "align-items": "center",
            "justify-content": "space-between",
            padding: "4px 12px",
            "background-color": "var(--bg-secondary)",
            "border-left": "1px solid var(--border-gold)",
            "border-right": "1px solid var(--border-gold)",
            "font-size": "12px",
            color: "var(--text-muted)",
          }}
        >
          <Show when={previewLoading() && !urlPreview()}>
            <span style={{ "font-style": "italic" }}>fetching preview...</span>
          </Show>
          <Show when={urlPreview()}>
            {(() => {
              const p = urlPreview()!;
              return (
                <span>
                  <span>{"\u21B1"} </span>
                  <span>{p.site_name}</span>
                  <Show when={p.title}>
                    <span> {"\u2014"} </span>
                    <span style={{ color: "var(--text-secondary)" }}>{p.title}</span>
                  </Show>
                </span>
              );
            })()}
          </Show>
          <button
            onClick={() => setUrlPreview(null)}
            style={{
              color: "var(--text-muted)",
              "font-size": "12px",
              padding: "0 4px",
              "flex-shrink": "0",
            }}
          >
            [x]
          </button>
        </div>
      </Show>

      {/* Terminal prompt input */}
      <div
        style={{
          display: "flex",
          "align-items": "center",
          "background-color": dragActive()
            ? "var(--bg-secondary)"
            : "var(--bg-primary)",
          border: dragActive()
            ? "1px solid var(--cyan)"
            : "1px solid var(--border-gold)",
          padding: "6px 12px",
          "box-shadow": "0 0 6px rgba(201,168,76,0.08)",
        }}
      >
        <span style={{ "font-size": "13px", "flex-shrink": "0", "white-space": "nowrap" }}>
          <span style={{ color: "var(--accent)" }}>{currentUser()?.username || "anon"}</span>
          <span style={{ color: "var(--cyan)" }}>@{props.channelName}</span>
          <span style={{ color: "var(--border-gold)" }}> {">"} </span>
        </span>
        <input
          type="text"
          ref={inputRef}
          placeholder=""
          value={text()}
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          onPaste={(e) => {
            const items = e.clipboardData?.items;
            if (!items) return;
            const imageFiles: File[] = [];
            for (const item of items) {
              if (item.type.startsWith("image/")) {
                const file = item.getAsFile();
                if (file) imageFiles.push(file);
              }
            }
            if (imageFiles.length > 0) {
              e.preventDefault();
              handleFiles(imageFiles);
              return;
            }
            // Check pasted text for URLs — setTimeout so input value is updated first
            const pasted = e.clipboardData?.getData("text/plain") || "";
            if (pasted) {
              setTimeout(() => tryFetchPreview(text()), 0);
            }
          }}
          disabled={uploading()}
          style={{
            flex: "1",
            "font-size": "13px",
            color: "var(--text-primary)",
            "background-color": "transparent",
            "caret-color": "var(--accent)",
          }}
        />
        <button
          onClick={() => fileInputRef?.click()}
          style={{
            "font-size": "12px",
            color: "var(--text-muted)",
            padding: "0 6px",
            "flex-shrink": "0",
          }}
        >
          [ATT]
        </button>
        <input
          type="file"
          accept="image/*,video/*"
          multiple
          ref={fileInputRef}
          style={{ display: "none" }}
          onChange={(e) => {
            if (e.currentTarget.files) {
              const files = Array.from(e.currentTarget.files);
              const images = files.filter((f) => f.type.startsWith("image/"));
              const videos = files.filter((f) => f.type.startsWith("video/"));
              if (images.length > 0) handleFiles(images);
              if (videos.length > 0) {
                (async () => {
                  for (const file of videos) {
                    try { await uploadMedia(file); } catch {}
                  }
                })();
              }
              e.currentTarget.value = "";
            }
          }}
        />
      </div>
    </div>
  );
}
