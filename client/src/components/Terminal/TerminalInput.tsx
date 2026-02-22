import { createSignal, Show, For, onCleanup } from "solid-js";
import { send } from "../../lib/ws";
import { replyingTo, setReplyingTo, getChannelMessages, setScrollToMessageId } from "../../stores/messages";
import { uploadFile } from "../../lib/api";
import { onlineUsers, allUsers } from "../../stores/users";
import { currentUser } from "../../stores/auth";
import { channels, selectedChannelId, setSelectedChannelId } from "../../stores/channels";
import { setUIMode } from "../../stores/mode";
import CommandPalette, { getFilteredCommands } from "./CommandPalette";
import { commands, type CommandDef } from "./commandRegistry";
import { executeCommand, type CommandContext } from "./commandExecutor";
import { isMobile } from "../../stores/responsive";
import { isDesktop, tauriInvoke } from "../../lib/devices";

type PendingAttachment = {
  id: string;
  previewUrl: string;
};

interface TerminalInputProps {
  channelId: string | null;
  commandCtx: CommandContext;
  dialogOpen?: boolean;
  inputRef?: (el: HTMLInputElement) => void;
}

export default function TerminalInput(props: TerminalInputProps) {
  const [text, setText] = createSignal("");
  const [attachments, setAttachments] = createSignal<PendingAttachment[]>([]);
  const [uploading, setUploading] = createSignal(false);
  const [paletteIndex, setPaletteIndex] = createSignal(0);
  const [editingId, setEditingId] = createSignal<string | null>(null);
  const [mentionQuery, setMentionQuery] = createSignal<string | null>(null);
  const [mentionIndex, setMentionIndex] = createSignal(0);
  // When browsing with arrows, this holds the user's original typed prefix for filtering
  const [browsePrefix, setBrowsePrefix] = createSignal<string | null>(null);
  let fileInputRef: HTMLInputElement | undefined;
  let inputRef: HTMLInputElement | undefined;
  let typingTimeout: number | null = null;
  const pendingMentions = new Map<string, string>();

  // ── Reply pick mode ────────────────────────
  const [replyPickMode, setReplyPickMode] = createSignal(false);
  const [replyPickIdx, setReplyPickIdx] = createSignal(0);

  const replyableMessages = () => {
    if (!props.channelId) return [];
    return getChannelMessages(props.channelId).filter((m) => !m.deleted);
  };

  const pickedMessage = () => {
    const msgs = replyableMessages();
    if (!msgs.length) return null;
    return msgs[msgs.length - 1 - replyPickIdx()] || null;
  };

  const startReplyPick = () => {
    const msgs = replyableMessages();
    if (!msgs.length) {
      props.commandCtx.setStatus("No messages to reply to");
      return;
    }
    setReplyPickMode(true);
    setReplyPickIdx(0);
    const lastMsg = msgs[msgs.length - 1];
    if (lastMsg) setScrollToMessageId(lastMsg.id);
  };

  const paletteQuery = () => {
    // Use browse prefix if actively navigating, otherwise use text
    const prefix = browsePrefix();
    const t = prefix !== null ? prefix : text();
    if (!t.startsWith("/")) return "";
    const spaceIdx = t.indexOf(" ");
    if (spaceIdx === -1) return t.slice(1);
    return "";
  };

  const paletteVisible = () => {
    // Visible if browsing OR if text starts with / and no space
    if (browsePrefix() !== null) return true;
    const t = text();
    if (!t.startsWith("/")) return false;
    return t.indexOf(" ") === -1 && mentionQuery() === null;
  };

  const paletteCommands = () => {
    if (!paletteVisible()) return [];
    const isAdmin = currentUser()?.is_admin ?? false;
    return getFilteredCommands(paletteQuery(), isAdmin);
  };

  // Set up command context extensions
  const extendedCtx = (): CommandContext => ({
    ...props.commandCtx,
    setInputText: (t: string) => {
      setText(t);
      requestAnimationFrame(() => inputRef?.focus());
    },
    setEditingId: (id: string | null) => setEditingId(id),
    triggerUpload: () => fileInputRef?.click(),
    startReplyPick,
  });

  // ── Mention autocomplete ──────────────────────
  const mentionableUsers = () => {
    const map = new Map<string, { id: string; username: string }>();
    for (const u of onlineUsers()) map.set(u.id, u);
    for (const u of allUsers()) if (!map.has(u.id)) map.set(u.id, u);
    if (props.channelId) {
      for (const m of getChannelMessages(props.channelId))
        if (!map.has(m.author.id)) map.set(m.author.id, m.author);
    }
    return Array.from(map.values());
  };

  const filteredMentions = () => {
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

  // ── Handlers ──────────────────────────────────
  const handleSend = () => {
    const content = text().trim();
    const atts = attachments();

    if (!content && atts.length === 0) return;

    // Mode switch: /terminal is no-op (already in terminal)
    if (content === "/terminal") {
      setText("");
      return;
    }

    // Handle commands
    if (content.startsWith("/")) {
      const spaceIdx = content.indexOf(" ");
      const cmdName = spaceIdx === -1
        ? content.slice(1)
        : content.slice(1, spaceIdx);
      const cmdArgs = spaceIdx === -1 ? "" : content.slice(spaceIdx + 1);

      if (cmdName) {
        const handled = executeCommand(cmdName, cmdArgs, extendedCtx());
        if (handled) {
          setText("");
          setEditingId(null);
          return;
        }
      }
      // Unknown command — fall through and send as message
    }

    // Edit mode
    const eid = editingId();
    if (eid) {
      let finalContent = content;
      for (const [username, userId] of pendingMentions) {
        finalContent = finalContent.replaceAll(`@${username}`, `<@${userId}>`);
      }
      send("edit_message", {
        message_id: eid,
        channel_id: props.channelId,
        content: finalContent,
      });
      setText("");
      setEditingId(null);
      pendingMentions.clear();
      return;
    }

    // Regular message
    if (!props.channelId) return;

    let finalContent = content;
    for (const [username, userId] of pendingMentions) {
      finalContent = finalContent.replaceAll(`@${username}`, `<@${userId}>`);
    }

    send("send_message", {
      channel_id: props.channelId,
      content: finalContent || null,
      reply_to_id: replyingTo()?.id || null,
      attachment_ids: atts.map((a) => a.id),
    });

    atts.forEach((a) => URL.revokeObjectURL(a.previewUrl));
    setText("");
    setAttachments([]);
    setReplyingTo(null);
    setMentionQuery(null);
    pendingMentions.clear();
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    // Skip all keyboard handling when a dialog is open
    if (props.dialogOpen) return;

    // Reply pick mode — arrow keys navigate messages
    if (replyPickMode()) {
      const msgs = replyableMessages();
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setReplyPickIdx((i) => Math.min(i + 1, msgs.length - 1));
        const picked = pickedMessage();
        if (picked) setScrollToMessageId(picked.id);
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setReplyPickIdx((i) => Math.max(i - 1, 0));
        const picked = pickedMessage();
        if (picked) setScrollToMessageId(picked.id);
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const picked = pickedMessage();
        if (picked) setReplyingTo(picked);
        setReplyPickMode(false);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setReplyPickMode(false);
        return;
      }
      return;
    }

    // Mention autocomplete
    if (mentionQuery() !== null && filteredMentions().length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionIndex((i) => Math.min(i + 1, filteredMentions().length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const user = filteredMentions()[mentionIndex()];
        if (user) selectMention(user.id, user.username);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMentionQuery(null);
        return;
      }
    }

    // Command palette navigation
    if (paletteVisible() && paletteCommands().length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        // Start browsing — lock the filter to what user typed
        if (browsePrefix() === null) setBrowsePrefix(text());
        const cmds = paletteCommands();
        const newIdx = Math.min(paletteIndex() + 1, cmds.length - 1);
        setPaletteIndex(newIdx);
        const cmd = cmds[newIdx];
        if (cmd) setText(`/${cmd.name}`);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        if (browsePrefix() === null) setBrowsePrefix(text());
        const cmds = paletteCommands();
        const newIdx = Math.max(paletteIndex() - 1, 0);
        setPaletteIndex(newIdx);
        const cmd = cmds[newIdx];
        if (cmd) setText(`/${cmd.name}`);
        return;
      }
      if (e.key === "Tab" || e.key === "ArrowRight") {
        e.preventDefault();
        const cmd = paletteCommands()[paletteIndex()];
        if (cmd) {
          setText(`/${cmd.name}${cmd.args ? " " : ""}`);
        }
        setBrowsePrefix(null);
        setPaletteIndex(0);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        // Restore original prefix or clear
        const prefix = browsePrefix();
        setText(prefix !== null ? prefix : "");
        setBrowsePrefix(null);
        setPaletteIndex(0);
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const cmd = paletteCommands()[paletteIndex()];
        if (cmd) {
          setBrowsePrefix(null);
          handlePaletteSelect(cmd);
        }
        return;
      }
    }

    // Ctrl+K opens command palette
    if (e.key === "k" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      setText("/");
      setPaletteIndex(0);
      return;
    }

    // Escape: cancel edit/reply/palette
    if (e.key === "Escape") {
      if (editingId()) {
        setEditingId(null);
        setText("");
        return;
      }
      if (replyingTo()) {
        setReplyingTo(null);
        return;
      }
      return;
    }

    // Alt+Up/Down: switch channels
    if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      const textChs = channels().filter((c) => c.type === "text");
      const currentIdx = textChs.findIndex((c) => c.id === props.channelId);
      if (currentIdx === -1) return;
      const newIdx = e.key === "ArrowDown"
        ? Math.min(currentIdx + 1, textChs.length - 1)
        : Math.max(currentIdx - 1, 0);
      setSelectedChannelId(textChs[newIdx].id);
      return;
    }

    // Up arrow: edit last message when input is empty
    if (e.key === "ArrowUp" && !text()) {
      e.preventDefault();
      const me = currentUser();
      if (!me || !props.channelId) return;
      const msgs = getChannelMessages(props.channelId);
      const myMsg = [...msgs].reverse().find((m) => m.author.id === me.id && !m.deleted);
      if (myMsg && myMsg.content) {
        setEditingId(myMsg.id);
        setText(myMsg.content);
      }
      return;
    }

    // Ctrl+Shift+M: toggle mute
    if (e.key === "M" && e.ctrlKey && e.shiftKey) {
      e.preventDefault();
      executeCommand("mute", "", extendedCtx());
      return;
    }

    // Ctrl+Shift+D: toggle deafen
    if (e.key === "D" && e.ctrlKey && e.shiftKey) {
      e.preventDefault();
      executeCommand("deafen", "", extendedCtx());
      return;
    }

    // Enter: send
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
      return;
    }

    // Typing indicator
    if (props.channelId && !typingTimeout) {
      send("typing_start", { channel_id: props.channelId });
      typingTimeout = window.setTimeout(() => {
        typingTimeout = null;
      }, 3000);
    }
  };

  const handleInput = (e: InputEvent & { currentTarget: HTMLInputElement }) => {
    const value = e.currentTarget.value;
    setText(value);
    setBrowsePrefix(null);
    setPaletteIndex(0);
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

  onCleanup(() => {
    attachments().forEach((a) => URL.revokeObjectURL(a.previewUrl));
  });

  const handlePaletteSelect = (cmd: CommandDef) => {
    if (cmd.args) {
      // Command needs arguments — fill input and let user type args
      setText(`/${cmd.name} `);
      setPaletteIndex(0);
      requestAnimationFrame(() => {
        if (inputRef) {
          inputRef.focus();
          const len = cmd.name.length + 2; // "/" + name + " "
          inputRef.setSelectionRange(len, len);
        }
      });
      return;
    }
    // No args needed — execute immediately
    executeCommand(cmd.name, "", extendedCtx());
    setText("");
    setPaletteIndex(0);
    requestAnimationFrame(() => inputRef?.focus());
  };

  return (
    <div style={{ position: "relative", padding: "0 12px 12px" }}>
      {/* Mention autocomplete */}
      <Show when={mentionQuery() !== null && filteredMentions().length > 0}>
        <div
          style={{
            position: "absolute",
            bottom: "100%",
            left: "12px",
            right: "12px",
            "background-color": "var(--bg-secondary)",
            border: "1px solid var(--border-gold)",
            padding: "2px 0",
            "max-height": "200px",
            overflow: "auto",
            "z-index": "50",
          }}
        >
          <For each={filteredMentions()}>
            {(user, i) => (
              <div
                onClick={() => selectMention(user.id, user.username)}
                onMouseOver={() => setMentionIndex(i())}
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
              >
                <span style={{ color: "var(--cyan)" }}>@</span>
                <span>{user.username}</span>
              </div>
            )}
          </For>
        </div>
      </Show>

      {/* Command palette */}
      <Show when={paletteVisible()}>
        <CommandPalette
          query={paletteQuery()}
          selectedIndex={paletteIndex()}
          onSelect={handlePaletteSelect}
          onHover={(i) => setPaletteIndex(i)}
        />
      </Show>

      {/* Reply pick mode */}
      <Show when={replyPickMode()}>
        <div
          style={{
            display: "flex",
            "align-items": "center",
            "justify-content": "space-between",
            padding: "4px 12px",
            "background-color": "var(--bg-secondary)",
            "border-top": "1px solid var(--accent)",
            "border-left": "1px solid var(--accent)",
            "border-right": "1px solid var(--accent)",
            "font-size": "12px",
            color: "var(--text-secondary)",
          }}
        >
          <span style={{ overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap", flex: "1" }}>
            <span style={{ color: "var(--text-muted)" }}>[{"\u2191\u2193"}]</span>{" "}
            {(() => {
              const msg = pickedMessage();
              if (!msg) return "No messages";
              const content = msg.content || "(attachment)";
              const truncated = content.length > 60 ? content.slice(0, 60) + "..." : content;
              return (
                <>
                  <span style={{ color: "var(--cyan)" }}>@{msg.author.username}</span>
                  {": "}{truncated}
                </>
              );
            })()}
          </span>
          <span style={{ color: "var(--text-muted)", "font-size": "11px", "white-space": "nowrap", "margin-left": "8px" }}>
            Enter=reply Esc=cancel
          </span>
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
          <span style={{ overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap", flex: "1" }}>
            replying to{" "}
            <span style={{ color: "var(--cyan)" }}>
              @{replyingTo()!.author.username}
            </span>
            {(() => {
              const content = replyingTo()!.content;
              if (!content) return null;
              const truncated = content.length > 50 ? content.slice(0, 50) + "..." : content;
              return <span style={{ color: "var(--text-muted)", "margin-left": "6px" }}>"{truncated}"</span>;
            })()}
          </span>
          <button
            onClick={() => setReplyingTo(null)}
            style={{ color: "var(--text-muted)", "font-size": "12px", padding: "0 4px", "flex-shrink": "0" }}
          >
            [x]
          </button>
        </div>
      </Show>

      {/* Edit indicator */}
      <Show when={editingId()}>
        <div
          style={{
            padding: "4px 12px",
            "background-color": "var(--bg-secondary)",
            "border-top": "1px solid var(--border-gold)",
            "border-left": "1px solid var(--border-gold)",
            "border-right": "1px solid var(--border-gold)",
            "font-size": "12px",
            color: "var(--accent)",
          }}
        >
          editing message — Escape to cancel
        </div>
      </Show>

      {/* Attachment previews */}
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

      {/* Input line */}
      <div
        style={{
          display: "flex",
          "align-items": "center",
          "background-color": "var(--bg-primary)",
          border: "1px solid var(--border-gold)",
          padding: "6px 12px",
        }}
      >
        <span style={{ "font-size": "13px", "flex-shrink": "0", "white-space": "nowrap" }}>
          <span style={{ color: "var(--accent)" }}>{currentUser()?.username || "anon"}</span>
          <span style={{ color: "var(--cyan)" }}>@{(() => {
            if (!props.channelId) return "~";
            const ch = channels().find((c) => c.id === props.channelId);
            return ch?.name || "~";
          })()}</span>
          <span style={{ color: "var(--border-gold)" }}>{" > "}</span>
        </span>
        <input
          type="text"
          ref={(el) => { inputRef = el; props.inputRef?.(el); }}
          placeholder=""
          value={text()}
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          onPaste={(e) => {
            const items = e.clipboardData?.items;
            if (items) {
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
            }
            const files = e.clipboardData?.files;
            if (files && files.length > 0) {
              const imageFiles = Array.from(files).filter((f) => f.type.startsWith("image/"));
              if (imageFiles.length > 0) {
                e.preventDefault();
                handleFiles(imageFiles);
                return;
              }
            }
            if (isDesktop) {
              const pastedText = e.clipboardData?.getData("text/plain") || "";
              e.preventDefault();
              tauriInvoke("read_clipboard_image")
                .then((base64: string | null) => {
                  if (base64) {
                    const binary = atob(base64);
                    const bytes = new Uint8Array(binary.length);
                    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
                    let mime = "image/png", ext = "png";
                    if (bytes[0] === 0xFF && bytes[1] === 0xD8) { mime = "image/jpeg"; ext = "jpg"; }
                    else if (bytes[0] === 0x47 && bytes[1] === 0x49) { mime = "image/gif"; ext = "gif"; }
                    const file = new File([bytes], `clipboard.${ext}`, { type: mime });
                    handleFiles([file]);
                  } else if (pastedText) {
                    const el = inputRef;
                    if (el) {
                      const start = el.selectionStart ?? text().length;
                      const end = el.selectionEnd ?? text().length;
                      const cur = text();
                      const newText = cur.slice(0, start) + pastedText + cur.slice(end);
                      setText(newText);
                      requestAnimationFrame(() => {
                        el.selectionStart = el.selectionEnd = start + pastedText.length;
                      });
                    }
                  }
                })
                .catch(() => {
                  if (pastedText) setText((prev) => prev + pastedText);
                });
              return;
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
          accept="image/*"
          multiple
          ref={fileInputRef}
          style={{ display: "none" }}
          onChange={(e) => {
            if (e.currentTarget.files) {
              const files = Array.from(e.currentTarget.files);
              const images = files.filter((f) => f.type.startsWith("image/"));
              if (images.length > 0) handleFiles(images);
              e.currentTarget.value = "";
            }
          }}
        />
      </div>
    </div>
  );
}
