import { createSignal, Show } from "solid-js";
import { send } from "../../lib/ws";
import { replyingTo, setReplyingTo } from "../../stores/messages";
import { uploadFile } from "../../lib/api";

interface MessageInputProps {
  channelId: string;
  channelName: string;
}

export default function MessageInput(props: MessageInputProps) {
  const [text, setText] = createSignal("");
  const [attachmentIds, setAttachmentIds] = createSignal<string[]>([]);
  const [uploading, setUploading] = createSignal(false);
  const [dragActive, setDragActive] = createSignal(false);
  let fileInputRef: HTMLInputElement | undefined;
  let typingTimeout: number | null = null;

  const handleSend = () => {
    const content = text().trim();
    const attIds = attachmentIds();

    if (!content && attIds.length === 0) return;

    send("send_message", {
      channel_id: props.channelId,
      content: content || null,
      reply_to_id: replyingTo()?.id || null,
      attachment_ids: attIds,
    });

    setText("");
    setAttachmentIds([]);
    setReplyingTo(null);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
      return;
    }

    // Typing indicator (throttled to 3s)
    if (!typingTimeout) {
      send("typing_start", { channel_id: props.channelId });
      typingTimeout = window.setTimeout(() => {
        typingTimeout = null;
      }, 3000);
    }
  };

  const handleFiles = async (files: File[]) => {
    const imageFiles = files.filter((f) => f.type.startsWith("image/"));
    if (imageFiles.length === 0) return;

    setUploading(true);
    try {
      for (const file of imageFiles) {
        const res = await uploadFile(file);
        setAttachmentIds((prev) => [...prev, res.id]);
      }
    } catch {
      // ignore
    } finally {
      setUploading(false);
    }
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    if (e.dataTransfer?.files) {
      handleFiles(Array.from(e.dataTransfer.files));
    }
  };

  return (
    <div
      style={{ padding: "0 16px 16px" }}
      onDragOver={(e) => {
        e.preventDefault();
        setDragActive(true);
      }}
      onDragLeave={() => setDragActive(false)}
      onDrop={handleDrop}
    >
      {/* Reply indicator */}
      <Show when={replyingTo()}>
        <div
          style={{
            display: "flex",
            "align-items": "center",
            "justify-content": "space-between",
            padding: "6px 12px",
            "background-color": "var(--bg-secondary)",
            "border-radius": "4px 4px 0 0",
            "font-size": "13px",
            color: "var(--text-secondary)",
          }}
        >
          <span>
            Replying to{" "}
            <strong style={{ color: "var(--text-primary)" }}>
              @{replyingTo()!.author.username}
            </strong>
          </span>
          <button
            onClick={() => setReplyingTo(null)}
            style={{
              color: "var(--text-muted)",
              "font-size": "14px",
              padding: "0 4px",
            }}
          >
            x
          </button>
        </div>
      </Show>

      {/* Attachment preview */}
      <Show when={attachmentIds().length > 0}>
        <div
          style={{
            padding: "6px 12px",
            "background-color": "var(--bg-secondary)",
            "font-size": "13px",
            color: "var(--text-muted)",
          }}
        >
          {attachmentIds().length} file(s) attached
        </div>
      </Show>

      {/* Input area */}
      <div
        style={{
          display: "flex",
          "align-items": "center",
          gap: "8px",
          "background-color": dragActive()
            ? "var(--bg-secondary)"
            : "var(--bg-tertiary)",
          "border-radius": replyingTo() || attachmentIds().length > 0
            ? "0 0 4px 4px"
            : "4px",
          padding: "8px 12px",
          border: dragActive() ? "2px dashed var(--accent)" : "2px solid transparent",
        }}
      >
        <button
          onClick={() => fileInputRef?.click()}
          style={{
            "font-size": "18px",
            color: "var(--text-muted)",
            padding: "0 4px",
          }}
        >
          +
        </button>
        <input
          type="file"
          accept="image/*"
          multiple
          ref={fileInputRef}
          style={{ display: "none" }}
          onChange={(e) => {
            if (e.currentTarget.files) {
              handleFiles(Array.from(e.currentTarget.files));
              e.currentTarget.value = "";
            }
          }}
        />
        <input
          type="text"
          placeholder={`Message #${props.channelName}`}
          value={text()}
          onInput={(e) => setText(e.currentTarget.value)}
          onKeyDown={handleKeyDown}
          disabled={uploading()}
          style={{
            flex: "1",
            "font-size": "14px",
            color: "var(--text-primary)",
            "background-color": "transparent",
          }}
        />
        <button
          onClick={handleSend}
          disabled={uploading() && !text().trim() && attachmentIds().length === 0}
          style={{
            padding: "4px 12px",
            "font-size": "13px",
            color: "var(--text-muted)",
            "border-radius": "3px",
          }}
        >
          {uploading() ? "..." : "Send"}
        </button>
      </div>
    </div>
  );
}
