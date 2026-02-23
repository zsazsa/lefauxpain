import { channels, selectedChannelId, setSelectedChannelId } from "../../stores/channels";
import { currentVoiceChannelId, selfDeafen, setSelfDeafen, voiceStats, screenShares, setWatchingScreenShare } from "../../stores/voice";
import { joinVoice, leaveVoice, toggleMute, toggleDeafen } from "../../lib/webrtc";
import { startScreenShare, stopScreenShare, getIsPresenting } from "../../lib/screenshare";
import { subscribeScreenShare } from "../../lib/screenshare";
import { send, connState, ping } from "../../lib/ws";
import { currentUser } from "../../stores/auth";
import { setSettingsOpen, setSettingsTab } from "../../stores/settings";
import { setTheme, themes, type ThemeId } from "../../stores/theme";
import { onlineUsers, allUsers } from "../../stores/users";
import { getChannelMessages, setReplyingTo } from "../../stores/messages";
import { setUIMode } from "../../stores/mode";

export type CommandContext = {
  openDialog: (id: string, props?: any) => void;
  closeDialog: () => void;
  setStatus: (msg: string) => void;
  onLogout: () => void;
  /** Set the input text (for edit mode) */
  setInputText?: (text: string) => void;
  /** Set editing message id */
  setEditingId?: (id: string | null) => void;
  /** Trigger file upload */
  triggerUpload?: () => void;
  /** Enter reply pick mode */
  startReplyPick?: () => void;
};

// Applet-registered command handlers
const registeredHandlers = new Map<string, (args: string, ctx: CommandContext) => void>();

/** Register a command handler (called by applet self-registration). */
export function registerCommandHandler(name: string, fn: (args: string, ctx: CommandContext) => void) {
  registeredHandlers.set(name, fn);
}

/**
 * Execute a terminal command by name.
 * Returns true if the command was handled, false if it should be sent as a message.
 */
export function executeCommand(name: string, args: string, ctx: CommandContext): boolean {
  switch (name) {
    // ── Navigation ──────────────────────────────
    case "channels":
      ctx.openDialog("channels");
      return true;

    case "join": {
      const channelName = args.trim();
      if (!channelName) {
        ctx.openDialog("channels");
        return true;
      }
      const ch = channels().find(
        (c) => c.type === "text" && c.name.toLowerCase() === channelName.toLowerCase()
      );
      if (ch) {
        setSelectedChannelId(ch.id);
      } else {
        ctx.setStatus(`Channel "${channelName}" not found`);
      }
      return true;
    }

    case "voice": {
      const vcName = args.trim();
      if (!vcName) {
        ctx.openDialog("voice");
        return true;
      }
      const vc = channels().find(
        (c) => c.type === "voice" && c.name.toLowerCase() === vcName.toLowerCase()
      );
      if (vc) {
        joinVoice(vc.id);
        setSelectedChannelId(vc.id);
      } else {
        ctx.setStatus(`Voice channel "${vcName}" not found`);
      }
      return true;
    }

    case "disconnect":
      if (currentVoiceChannelId()) {
        leaveVoice();
      }
      return true;

    case "members":
      ctx.openDialog("members");
      return true;

    case "notifications":
      ctx.openDialog("notifications");
      return true;

    // ── Chat ────────────────────────────────────
    case "reply": {
      if (ctx.startReplyPick) {
        ctx.startReplyPick();
        return true;
      }
      // Fallback: reply to last message
      const chId = selectedChannelId();
      if (!chId) return true;
      const msgs = getChannelMessages(chId);
      const lastMsg = [...msgs].reverse().find((m) => !m.deleted);
      if (lastMsg) {
        setReplyingTo(lastMsg);
      } else {
        ctx.setStatus("No message to reply to");
      }
      return true;
    }

    case "edit": {
      const chId = selectedChannelId();
      if (!chId) return true;
      const me = currentUser();
      if (!me) return true;
      const msgs = getChannelMessages(chId);
      const myMsg = [...msgs].reverse().find((m) => m.author.id === me.id && !m.deleted);
      if (myMsg && myMsg.content) {
        ctx.setEditingId?.(myMsg.id);
        ctx.setInputText?.(myMsg.content);
      } else {
        ctx.setStatus("No message to edit");
      }
      return true;
    }

    case "delete": {
      const chId = selectedChannelId();
      if (!chId) return true;
      const me = currentUser();
      if (!me) return true;
      const msgs = getChannelMessages(chId);
      const myMsg = [...msgs].reverse().find((m) => m.author.id === me.id && !m.deleted);
      if (myMsg) {
        if (confirm("Delete your last message?")) {
          send("delete_message", { message_id: myMsg.id, channel_id: chId });
        }
      } else {
        ctx.setStatus("No message to delete");
      }
      return true;
    }

    case "react": {
      const emoji = args.trim();
      if (!emoji) {
        ctx.setStatus("Usage: /react <emoji>");
        return true;
      }
      const chId = selectedChannelId();
      if (!chId) return true;
      const msgs = getChannelMessages(chId);
      const lastMsg = [...msgs].reverse().find((m) => !m.deleted);
      if (lastMsg) {
        send("add_reaction", { message_id: lastMsg.id, emoji });
      }
      return true;
    }

    case "upload":
      ctx.triggerUpload?.();
      return true;

    case "search":
      if (args.trim()) {
        ctx.openDialog("search", { query: args.trim() });
      } else {
        ctx.openDialog("search");
      }
      return true;

    // ── Voice ───────────────────────────────────
    case "mute":
      if (currentVoiceChannelId()) {
        toggleMute();
      }
      return true;

    case "deafen":
      if (currentVoiceChannelId()) {
        const newState = !selfDeafen();
        toggleDeafen(newState);
        setSelfDeafen(newState);
        send("voice_self_deafen", { deafen: newState });
      }
      return true;

    case "screen":
      if (currentVoiceChannelId()) {
        if (getIsPresenting()) {
          stopScreenShare();
        } else {
          startScreenShare();
        }
      }
      return true;

    case "watch": {
      const username = args.trim();
      if (!username) {
        ctx.setStatus("Usage: /watch <user>");
        return true;
      }
      const share = screenShares().find((s) => {
        const u = onlineUsers().find((u) => u.id === s.user_id);
        return u && u.username.toLowerCase() === username.toLowerCase();
      });
      if (share) {
        setWatchingScreenShare({ user_id: share.user_id, channel_id: share.channel_id });
        subscribeScreenShare(share.channel_id);
      } else {
        ctx.setStatus(`No screen share from "${username}"`);
      }
      return true;
    }

    case "volume":
      ctx.setStatus("Volume control coming soon");
      return true;

    // ── Settings ────────────────────────────────
    case "settings":
      setSettingsOpen(true);
      return true;

    case "theme": {
      const themeName = args.trim().toLowerCase();
      if (!themeName) {
        ctx.setStatus("Available: " + Object.keys(themes).join(", "));
        return true;
      }
      const match = (Object.keys(themes) as ThemeId[]).find(
        (k) => k === themeName || k.includes(themeName)
      );
      if (match) {
        setTheme(match);
        ctx.setStatus(`Theme: ${themes[match].name}`);
      } else {
        ctx.setStatus(`Unknown theme. Available: ${Object.keys(themes).join(", ")}`);
      }
      return true;
    }

    case "audio":
      setSettingsTab("audio");
      setSettingsOpen(true);
      return true;

    case "password":
      setSettingsTab("account");
      setSettingsOpen(true);
      return true;

    // ── Admin ───────────────────────────────────
    case "admin": {
      const me = currentUser();
      if (!me?.is_admin) {
        ctx.setStatus("Permission denied");
        return true;
      }
      setSettingsTab("admin");
      setSettingsOpen(true);
      return true;
    }

    case "approve": {
      const username = args.trim();
      if (!username) {
        ctx.setStatus("Usage: /approve <user>");
        return true;
      }
      const user = allUsers().find((u) => u.username.toLowerCase() === username.toLowerCase());
      if (user) {
        send("approve_user", { user_id: user.id });
        ctx.setStatus(`Approved ${user.username}`);
      } else {
        ctx.setStatus(`User "${username}" not found`);
      }
      return true;
    }

    case "reject": {
      const username = args.trim();
      if (!username) {
        ctx.setStatus("Usage: /reject <user>");
        return true;
      }
      const user = allUsers().find((u) => u.username.toLowerCase() === username.toLowerCase());
      if (user) {
        send("reject_user", { user_id: user.id });
        ctx.setStatus(`Rejected ${user.username}`);
      } else {
        ctx.setStatus(`User "${username}" not found`);
      }
      return true;
    }

    case "kick": {
      const username = args.trim();
      if (!username) {
        ctx.setStatus("Usage: /kick <user>");
        return true;
      }
      const user = allUsers().find((u) => u.username.toLowerCase() === username.toLowerCase());
      if (user) {
        if (confirm(`Delete user "${user.username}"?`)) {
          send("delete_user", { user_id: user.id });
          ctx.setStatus(`Kicked ${user.username}`);
        }
      } else {
        ctx.setStatus(`User "${username}" not found`);
      }
      return true;
    }

    case "server-mute": {
      const username = args.trim();
      if (!username) {
        ctx.setStatus("Usage: /server-mute <user>");
        return true;
      }
      const user = onlineUsers().find((u) => u.username.toLowerCase() === username.toLowerCase());
      if (user) {
        send("voice_server_mute", { user_id: user.id });
        ctx.setStatus(`Server-muted ${user.username}`);
      } else {
        ctx.setStatus(`User "${username}" not found or offline`);
      }
      return true;
    }

    // ── Channel Management ──────────────────────
    case "channel-create": {
      const parts = args.trim().split(/\s+/);
      if (parts.length < 2) {
        ctx.setStatus("Usage: /channel-create <text|voice> <name>");
        return true;
      }
      const type = parts[0];
      const chName = parts.slice(1).join(" ");
      if (type !== "text" && type !== "voice") {
        ctx.setStatus("Type must be 'text' or 'voice'");
        return true;
      }
      send("create_channel", { name: chName, type });
      return true;
    }

    case "channel-delete": {
      const chName = args.trim();
      const ch = channels().find((c) => c.name.toLowerCase() === chName.toLowerCase());
      if (ch) {
        if (confirm(`Delete channel "${ch.name}"?`)) {
          send("delete_channel", { channel_id: ch.id });
        }
      } else {
        ctx.setStatus(`Channel "${chName}" not found`);
      }
      return true;
    }

    case "channel-rename": {
      const parts = args.trim().split(/\s+/);
      if (parts.length < 2) {
        ctx.setStatus("Usage: /channel-rename <channel> <new-name>");
        return true;
      }
      const oldName = parts[0];
      const newName = parts.slice(1).join(" ");
      const ch = channels().find((c) => c.name.toLowerCase() === oldName.toLowerCase());
      if (ch) {
        send("rename_channel", { channel_id: ch.id, name: newName });
      } else {
        ctx.setStatus(`Channel "${oldName}" not found`);
      }
      return true;
    }

    case "channel-restore": {
      const chName = args.trim();
      if (!chName) {
        ctx.setStatus("Usage: /channel-restore <channel>");
        return true;
      }
      send("restore_channel", { name: chName });
      return true;
    }

    case "channel-managers":
      ctx.openDialog("channel-managers");
      return true;

    // ── System ──────────────────────────────────
    case "help":
      ctx.openDialog("help");
      return true;

    case "status": {
      const parts: string[] = [];
      parts.push(`WS: ${connState()}`);
      const p = ping();
      if (p !== null) parts.push(`Ping: ${p}ms`);
      const vs = voiceStats();
      if (vs) {
        parts.push(`Voice RTT: ${vs.rtt}ms`);
        parts.push(`Jitter: ${vs.jitter}ms`);
        parts.push(`Loss: ${vs.packetLoss}%`);
        parts.push(`Bitrate: ${vs.bitrate}kbps`);
        parts.push(`Codec: ${vs.codec}`);
      }
      ctx.setStatus(parts.join(" | "));
      return true;
    }

    case "standard":
      setUIMode("standard");
      return true;

    case "terminal":
      return true;

    case "logout":
      if (confirm("Log out?")) {
        ctx.onLogout();
      }
      return true;

    case "update":
      ctx.setStatus("Update check not available in browser");
      return true;

    default: {
      // Check applet-registered command handlers
      const handler = registeredHandlers.get(name);
      if (handler) {
        handler(args, ctx);
        return true;
      }
      return false;
    }
  }
}
