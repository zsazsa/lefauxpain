export type CommandCategory =
  | "navigation"
  | "chat"
  | "voice"
  | "radio"
  | "settings"
  | "admin"
  | "channel"
  | "system";

export interface CommandDef {
  name: string;
  description: string;
  category: CommandCategory;
  args?: string;
  /** If true, only show for admins */
  adminOnly?: boolean;
}

export const commands: CommandDef[] = [
  // Navigation
  { name: "channels", description: "List all text channels", category: "navigation" },
  { name: "join", description: "Switch to a text channel", category: "navigation", args: "<channel>" },
  { name: "voice", description: "List or join a voice channel", category: "navigation", args: "[channel]" },
  { name: "disconnect", description: "Leave current voice channel", category: "navigation" },
  { name: "members", description: "Show online/offline member list", category: "navigation" },
  { name: "notifications", description: "Show notifications", category: "navigation" },

  // Chat
  { name: "reply", description: "Reply to the most recent message", category: "chat" },
  { name: "edit", description: "Edit your most recent message", category: "chat" },
  { name: "delete", description: "Delete your most recent message", category: "chat" },
  { name: "react", description: "React to the most recent message", category: "chat", args: "<emoji>" },
  { name: "upload", description: "Attach a file to your next message", category: "chat" },
{ name: "search", description: "Search messages in current channel", category: "chat", args: "<query>" },

  // Voice
  { name: "mute", description: "Toggle self-mute", category: "voice" },
  { name: "deafen", description: "Toggle self-deafen", category: "voice" },
  { name: "screen", description: "Toggle screen sharing", category: "voice" },
  { name: "watch", description: "Watch a user's screen share", category: "voice", args: "<user>" },
  { name: "volume", description: "Set per-user volume", category: "voice", args: "<user> <0-200>" },

  // Radio
  { name: "radio", description: "List all radio stations", category: "radio" },
  { name: "radio-create", description: "Create a new radio station", category: "radio", args: "<name>" },
  { name: "radio-delete", description: "Delete a radio station", category: "radio", args: "<station>" },
  { name: "radio-tune", description: "Tune into a station", category: "radio", args: "<station>" },
  { name: "radio-untune", description: "Stop listening to current station", category: "radio" },
  { name: "radio-play", description: "Start/resume playback", category: "radio" },
  { name: "radio-pause", description: "Pause playback", category: "radio" },
  { name: "radio-skip", description: "Skip to next track", category: "radio" },
  { name: "radio-stop", description: "Stop playback entirely", category: "radio" },
  { name: "radio-seek", description: "Seek to position", category: "radio", args: "<time>" },
  { name: "radio-upload", description: "Upload a track", category: "radio", args: "<station>" },
  { name: "radio-queue", description: "Show station playlist", category: "radio" },
  { name: "radio-mode", description: "Set playback mode", category: "radio", args: "<mode>" },
  { name: "radio-managers", description: "Manage station managers", category: "radio", args: "<station>" },
  { name: "radio-public", description: "Toggle public controls", category: "radio" },

  // Settings
  { name: "settings", description: "Open settings", category: "settings" },
  { name: "theme", description: "Switch theme", category: "settings", args: "<name>" },
  { name: "audio", description: "Open audio settings", category: "settings" },
  { name: "password", description: "Change your password", category: "settings" },

  // Admin
  { name: "admin", description: "Open admin panel", category: "admin", adminOnly: true },
  { name: "approve", description: "Approve a pending user", category: "admin", args: "<user>", adminOnly: true },
  { name: "reject", description: "Reject a pending user", category: "admin", args: "<user>", adminOnly: true },
  { name: "kick", description: "Delete a user account", category: "admin", args: "<user>", adminOnly: true },
  { name: "server-mute", description: "Server-mute a user in voice", category: "admin", args: "<user>", adminOnly: true },

  // Channel management
  { name: "channel-create", description: "Create a channel", category: "channel", args: "<type> <name>" },
  { name: "channel-delete", description: "Delete a channel", category: "channel", args: "<channel>" },
  { name: "channel-rename", description: "Rename a channel", category: "channel", args: "<channel> <new-name>" },
  { name: "channel-restore", description: "Restore a deleted channel", category: "channel", args: "<channel>" },
  { name: "channel-managers", description: "Manage channel managers", category: "channel", args: "<channel>" },

  // System
  { name: "help", description: "Show command reference", category: "system" },
  { name: "status", description: "Show connection info and voice stats", category: "system" },
  { name: "standard", description: "Switch to standard mode (sidebar)", category: "system" },
  { name: "logout", description: "Log out", category: "system" },
  { name: "update", description: "Check for desktop app updates", category: "system" },
];

export const categoryLabels: Record<CommandCategory, string> = {
  navigation: "Navigation",
  chat: "Chat",
  voice: "Voice",
  radio: "Radio",
  settings: "Settings",
  admin: "Admin",
  channel: "Channel Management",
  system: "System",
};
