# Desktop OS Notifications Plan

## Plugin

`tauri-plugin-notification` (Rust) / `@tauri-apps/plugin-notification` (npm). Uses `notify-rust` under the hood, which delegates to platform-native APIs.

## Feature Support by Platform

| Feature | Linux (GNOME/KDE) | Windows | macOS |
|---------|-------------------|---------|-------|
| Title + body text | Notification bubble top-right, stays in notification tray | Toast popup bottom-right, stays in Action Center | Banner top-right, stays in Notification Center |
| Custom icon | Yes (freedesktop icon names) | Partial (WinRT images) | No — always shows app icon |
| Sound | Yes (`message-new-instant`, etc.) | Yes (`Default`, `Alarm2`, etc.) | Yes (`Ping`, `Glass`, etc.) |
| Grouping | DE-dependent | Minimal | Thread grouping via `group` field |
| Scheduled | Yes | Yes | Yes |

## Known Limitations

| Feature | Status | Details |
|---------|--------|---------|
| Click-to-navigate | Not supported | No callback fires when user clicks the notification. Open Tauri issue #3698 (since 2022, 42+ upvotes, no fix). Clicking just focuses the app window. |
| Action buttons (Reply, Mark Read) | Not supported | Plugin only exposes actions for mobile (iOS/Android). |
| Badge count (dock/taskbar) | Not supported | Not exposed by the plugin. Tauri issue #4489 tracks this. |
| Persistent/ongoing | Not supported | Mobile-only feature. |
| Windows dev mode | Broken branding | Shows "Windows PowerShell" as source. Must install the app via MSI/NSIS for correct app name/icon. |
| macOS dev mode | Broken icon | Shows terminal icon instead of app icon. |

## Planned Notifications

### 1. Mention notification

- **Trigger**: Another user @mentions you in a text channel
- **Title**: `"Le Faux Pain"`
- **Body**: `"@alice mentioned you in #general: hey check this out..."`
- **Sound**: Platform-specific message sound
- **When**: App is not focused or window is minimized
- **Group**: Channel ID (so multiple mentions in same channel stack)
- **Priority**: HIGH — most valuable notification for a chat app

### 2. Update available

- **Trigger**: Background update checker finds a new version
- **Title**: `"Le Faux Pain"`
- **Body**: `"Version 1.x.x is available. Open Settings to update."`
- **Sound**: Default
- **When**: Every 2 hours when update is detected
- **Priority**: MEDIUM — already have in-app banner, this adds OS-level visibility

### 3. Voice channel activity

- **Trigger**: Someone joins a voice channel you're currently in
- **Title**: `"Le Faux Pain"`
- **Body**: `"@charlie joined Salon Vocal"`
- **Sound**: Short notification sound
- **When**: App is not focused
- **Group**: Voice channel ID
- **Priority**: LOW — nice to have

### 4. Connection lost/restored

- **Trigger**: WebSocket disconnects while app is in background
- **Title**: `"Le Faux Pain"`
- **Body**: `"Connection lost — reconnecting..."` / `"Reconnected"`
- **Sound**: Silent (no sound for reconnection noise)
- **When**: App is in background and connection drops for >5 seconds
- **Priority**: LOW — only useful if user has minimized the app

## Implementation Notes

- Sound names are platform-specific. Need conditional logic:
  - Linux: `"message-new-instant"` (XDG Sound Naming Spec)
  - Windows: `"Default"` (UWP toast audio schema)
  - macOS: `"Ping"` (system sound name)
- Only send notifications when app is not focused (check `window.isFocused()` or Tauri window focus events)
- Respect a user preference toggle in Settings (e.g., "Enable desktop notifications")
- The click-to-navigate limitation means we cannot deep-link to a specific channel/message from a notification. If Tauri issue #3698 is resolved in the future, revisit this.

## Recommended Implementation Order

1. **Mentions** — highest value, most expected in a chat app
2. **Update available** — extends existing in-app banner to OS level
3. **Voice activity** — nice to have
4. **Connection status** — lowest priority, could be annoying
