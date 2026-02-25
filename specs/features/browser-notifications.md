# Feature: Browser Notifications for @Mentions

## Intent

Le Faux Pain has a full in-app notification system for @mentions: the server detects `<@uuid>` in messages, creates notification rows in the DB, sends `notification_create` via WebSocket, and the client shows an unread badge on the sidebar bell with a dropdown listing notifications. However, if the user is in another tab or has the window minimized, they have no way to know they were mentioned. This feature adds browser notifications (via the Web Notification API) so users get a desktop popup when mentioned while the tab is in the background.

## Current Behavior

- User is @mentioned in a message
- Server sends `notification_create` WS event with type `"mention"`
- Client adds the notification to the in-app bell dropdown
- Unread badge count increments on the sidebar bell icon
- If the user's tab is not visible, they have no indication until they switch back

## New Behavior

### Notification Settings (LocalStorage)

Extend the existing `AppSettings` type in `client/src/stores/settings.ts`:

| Field | Type | Default | Purpose |
|-------|------|---------|---------|
| `browserNotifications` | `boolean` | `false` | Whether to show browser notification popups for @mentions |

Default is `false`. The setting is only enabled after the user explicitly grants browser notification permission. Stored in localStorage alongside existing settings (masterVolume, micGain, etc.) — no server-side storage needed.

### Browser Notification Helper

New file: `client/src/lib/browserNotify.ts`

Three exported functions:

1. **`requestNotificationPermission(): Promise<boolean>`** — Calls `Notification.requestPermission()`. Returns `true` if granted.

2. **`getNotificationPermission(): NotificationPermission | "unsupported"`** — Returns current permission state: `"granted"`, `"denied"`, `"default"`, or `"unsupported"` if `window.Notification` is undefined.

3. **`showMentionNotification(author: string, channel: string, preview: string): void`** — Shows a browser notification if all conditions are met:
   - `browserNotifications` setting is `true`
   - Permission is `"granted"`
   - `document.hasFocus()` returns `false` (tab is background)

Key behaviors:
- Uses `new Notification(title, { body, tag })` — the `tag` field deduplicates rapid mentions
- On click: `window.focus()` to bring the tab forward, then `notification.close()`
- Auto-close after 5 seconds via `setTimeout` + `notification.close()`
- No icon (uses browser default)
- No sound

### Notification Format

- **Title**: `@{author_username} in #{channel_name}`
- **Body**: `{content_preview}` (already capped at 80 chars server-side)
- **Tag**: `mention-{notification_id}` (prevents duplicate popups for rapid mentions from same context)

### Integration Point

In `client/src/lib/events.ts`, the `notification_create` case currently calls `addNotification(msg.d)`. Add the browser notification call immediately after:

```
case "notification_create":
  addNotification(msg.d);
  // Fire browser notification for mentions
  if (msg.d.type === "mention") {
    showMentionNotification(
      msg.d.data.author_username,
      msg.d.data.channel_name,
      msg.d.data.content_preview
    );
  }
  break;
```

The `showMentionNotification` function internally checks settings, permission, and focus state before showing anything. Non-mention notification types (e.g., `"pending_user"`) do not trigger browser notifications.

### Settings UI

Add a "Notifications" section to the Settings panel in `client/src/components/Settings/SettingsPanel.tsx`.

The section contains:
- **Toggle**: "Browser notifications for @mentions" — checkbox or toggle switch
- **Status text**: Shows current permission state and guides the user

| Permission State | UI Behavior |
|-----------------|-------------|
| `"default"` (never asked) | Toggle click triggers `requestNotificationPermission()`. If granted, setting saves as `true`. If denied, toggle stays OFF. |
| `"granted"` | Toggle is functional, directly toggles the setting |
| `"denied"` | Toggle is disabled. Text shows: "Blocked by browser — check site permissions" |
| `"unsupported"` | Toggle is disabled. Text shows: "Not supported in this browser" |

### Files to Create

| File | Purpose |
|------|---------|
| `client/src/lib/browserNotify.ts` | Permission request, show notification, focus check |

### Files to Modify

| File | Change |
|------|--------|
| `client/src/stores/settings.ts` | Add `browserNotifications: boolean` to `AppSettings` with default `false` |
| `client/src/lib/events.ts` | Add `showMentionNotification()` call in `notification_create` case |
| `client/src/components/Settings/SettingsPanel.tsx` | Add "Notifications" section with toggle + permission status |

### Files NOT Modified

- No server changes — the existing `notification_create` WS event already carries all necessary data
- No database changes — settings stored in localStorage
- No new WebSocket operations — purely client-side feature

## Constraints

- Must not affect the existing in-app notification bell — it always works regardless of browser notification setting
- Must not show browser notifications when the tab is focused (would be redundant and annoying)
- Must respect the browser's permission state — never attempt to call `new Notification()` if permission is not `"granted"`
- Must degrade gracefully when `window.Notification` is undefined (some WebViews, older browsers)
- The `browserNotifications` setting defaults to `false` — users must opt in
- Only `"mention"` type notifications trigger browser popups — other notification types (e.g., `"pending_user"`) do not

## Out of Scope

- Notification sounds (user chose silent — visual only)
- Push notifications via service workers (requires HTTPS + service worker infrastructure)
- Per-channel mute or notification settings
- Email notifications for mentions
- @everyone / @here mention types
- Server-side notification preferences (localStorage is sufficient per user choice)
- Desktop app (Tauri) notifications — this spec covers the web browser only

## Resolved Decisions

1. **Background only** — Browser notifications fire only when the tab is hidden or unfocused. The in-app bell always works regardless.
2. **No sound** — Keep it silent. Just the visual bell badge and optional browser notification popup.
3. **LocalStorage for settings** — No server changes needed. Settings are per-browser and do not roam across devices. This extends the existing `AppSettings` pattern.
