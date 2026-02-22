# Feature: Terminal Mode

## Intent

Add an optional **terminal mode** — an alternate interface that replaces the sidebar with a single-pane terminal. The entire application becomes a text box. There is no left menu, no sidebar, no clickable channel list. All navigation and actions are performed through `/` (slash) commands typed into the input. Commands either execute immediately or open a dialog box for interaction.

The current chat view remains — messages scroll above the input as they do now. But everything else (switching channels, joining voice, managing radio, admin tasks, settings) is accessed exclusively through slash commands.

Terminal mode should feel like an IRC client married to a BBS — you live in the terminal, and the terminal gives you everything.

## Current Behavior

The app has a persistent left sidebar containing: voice channels, text channels, member list, radio stations, voice controls, notifications bell, user bar, and settings. Users click sidebar items to navigate. The main area shows the selected channel's messages or voice view. This is the **standard mode** and must remain fully functional and unchanged.

## New Behavior

### Mode Switching

Users switch between **standard mode** (sidebar UI) and **terminal mode** (slash command UI) with a single command or action:

| Action | Effect |
|--------|--------|
| Type `/terminal` in the message input (either mode) | Switch to terminal mode |
| Type `/standard` in terminal mode input | Switch back to standard mode |
| Click the `[>_]` icon in the standard mode sidebar user bar | Switch to terminal mode |
| `/help` in standard mode | Shows terminal mode hint alongside other help |

**Persistence:** The selected mode is saved to `localStorage`. The app remembers which mode the user was in and restores it on next visit. New users start in standard mode.

**State continuity:** Switching modes does not disconnect voice, untune radio, or lose any state. The user's current channel, voice connection, radio playback, and all other state carries over seamlessly. Both modes read from and write to the same stores.

**Standard mode is untouched:** No existing component, layout, interaction, or behavior in standard mode changes. Terminal mode is a parallel layout that shares the same data stores and WebSocket connection. The sidebar, floating radio player, floating media player, notification bell, voice controls bar — all remain exactly as they are in standard mode.

### Terminal Mode Layout

```
┌──────────────────────────────────────────────────────┐
│ # general                                        [?] │
├──────────────────────────────────────────────────────┤
│                                                      │
│ kalman > hey everyone                                │
│ alice  > yo what's up                                │
│ bob    > check this out https://example.com          │
│                                                      │
│ ┌─ REMOTE ────────────────────────────────┐          │
│ │ example.com                             │          │
│ │ >> Example Domain                       │          │
│ └─────────────────────────────────────────┘          │
│                                                      │
│         ♦ voice-chat (3)  kalman 🔇  alice  bob      │
│                                                      │
├──────────────────────────────────────────────────────┤
│ /                                                    │
└──────────────────────────────────────────────────────┘
```

**Structure:**
- **Title bar:** Current channel name (or context label), help shortcut `[?]`
- **Message area:** Same message rendering as today — usernames, timestamps, reactions, unfurls, attachments, replies
- **Status strip:** Compact one-line indicators — active voice channel with participants, radio station if tuned, connection quality
- **Input line:** Single text input spanning the full width. When empty, shows `/` hint. Regular text sends a message to the current channel. Text starting with `/` triggers command mode.

### Command Palette

Typing `/` in the input opens a **command palette** — a floating overlay above the input showing matching commands as the user types. Arrow keys to navigate, Enter to select, Escape to dismiss. This is identical in feel to Discord's slash command picker or VS Code's command palette.

The palette shows:
- Command name (e.g. `/join`)
- One-line description (e.g. "Switch to a text channel")
- Required arguments hint (e.g. `<channel>`)

Fuzzy matching: typing `/j` shows `/join`, `/join-voice`. Typing `/ra` shows `/radio`, `/radio-tune`, etc.

### Commands

Every user-facing action maps to a slash command. Commands either execute immediately or open a **dialog box** — a modal overlay with the relevant UI (form fields, lists, toggles).

---

#### Navigation

| Command | Args | Behavior |
|---------|------|----------|
| `/channels` | — | **Dialog:** List of all text channels. Click or arrow-key select to switch. Shows unread indicators. |
| `/join` | `<channel>` | Switch to a text channel by name. Autocompletes from available channels. |
| `/voice` | `<channel>` | **Dialog** (no args): List voice channels with current occupants. Select to join. **Direct** (with arg): Join named voice channel immediately. |
| `/disconnect` | — | Leave current voice channel. |
| `/members` | — | **Dialog:** Online/offline member list with status indicators. Same info as current sidebar member list. |
| `/notifications` | — | **Dialog:** Notification list. Click to navigate to mentioned message. Mark read/mark all read actions. |

#### Text Chat

| Command | Args | Behavior |
|---------|------|----------|
| `/reply` | `<message>` | Enter reply mode targeting the most recent message, or a specific message if clicked/selected first. Shows quoted preview above input. Type response and send. |
| `/edit` | — | Edit your most recent message in the current channel. Opens inline edit in the input line with the original text pre-filled. |
| `/delete` | — | Delete your most recent message. Confirms with a brief prompt. |
| `/react` | `<emoji>` | Add a reaction to the most recent message (or a selected message). Autocomplete emoji names. |
| `/upload` | — | Opens file picker. Selected file is attached to the next message sent. Shows thumbnail preview above input. |
| `/mention` | `<user>` | Inserts `@username` at cursor position. Autocompletes from member list. (This already works by typing `@` — this command is an alias.) |
| `/search` | `<query>` | **Dialog:** Search messages in current channel. Results shown as scrollable list. Click to jump to message. |

#### Voice

| Command | Args | Behavior |
|---------|------|----------|
| `/mute` | — | Toggle self-mute. Immediate. Status strip updates. |
| `/deafen` | — | Toggle self-deafen. Immediate. Status strip updates. |
| `/screen` | — | Toggle screen sharing. On Linux desktop, opens PipeWire portal picker. |
| `/watch` | `<user>` | Watch a user's screen share. Opens screen share viewer. |
| `/volume` | `<user> <0-200>` | Set per-user volume for a specific user in voice. |

#### Radio

| Command | Args | Behavior |
|---------|------|----------|
| `/radio` | — | **Dialog:** List all radio stations with status (playing/stopped, listener count, current track). Select to tune in. |
| `/radio-create` | `<name>` | Create a new radio station. |
| `/radio-delete` | `<station>` | Delete a station (manager/admin only). Confirms. |
| `/radio-tune` | `<station>` | Tune into a station. Autocompletes station names. |
| `/radio-untune` | — | Stop listening to current station. |
| `/radio-play` | — | Start/resume playback on current station. |
| `/radio-pause` | — | Pause playback on current station. |
| `/radio-skip` | — | Skip to next track. |
| `/radio-stop` | — | Stop playback entirely. |
| `/radio-seek` | `<time>` | Seek to position (e.g. `1:30`, `90`). |
| `/radio-upload` | `<station>` | **Dialog:** Upload a track to a station playlist. File picker + progress bar. |
| `/radio-queue` | — | **Dialog:** Show current station's playlist/queue. Reorder, remove tracks. |
| `/radio-mode` | `<mode>` | Set playback mode: `play-all`, `loop-one`, `loop-all`, `single`. |
| `/radio-managers` | `<station>` | **Dialog:** Add/remove station managers (manager/admin only). |
| `/radio-public` | — | Toggle public controls on current station (manager/admin only). |

#### Settings

| Command | Args | Behavior |
|---------|------|----------|
| `/settings` | — | **Dialog:** Full settings modal (same tabs as current: Account, Display, Audio, Admin, Email, App, About). |
| `/theme` | `<name>` | Switch theme immediately. Autocompletes available theme names. |
| `/audio` | — | **Dialog:** Audio settings — input/output device selection, volume sliders, mic test. |
| `/password` | — | **Dialog:** Change password form. |

#### Admin

| Command | Args | Behavior |
|---------|------|----------|
| `/admin` | — | **Dialog:** Admin panel. Same as current admin tab — pending users, approved users, user management. |
| `/approve` | `<user>` | Approve a pending user. Autocompletes from pending list. |
| `/reject` | `<user>` | Reject a pending user. |
| `/kick` | `<user>` | Delete a user account (admin only). Confirms. |
| `/server-mute` | `<user>` | Server-mute a user in voice (admin only). |

#### Channel Management

| Command | Args | Behavior |
|---------|------|----------|
| `/channel-create` | `<type> <name>` | Create a channel. Type is `text` or `voice`. |
| `/channel-delete` | `<channel>` | Delete a channel (creator/admin only). Confirms. |
| `/channel-rename` | `<channel> <new-name>` | Rename a channel. |
| `/channel-restore` | `<channel>` | Restore a deleted channel. |
| `/channel-managers` | `<channel>` | **Dialog:** Add/remove channel managers. |

#### System

| Command | Args | Behavior |
|---------|------|----------|
| `/help` | — | **Dialog:** Full command reference grouped by category. |
| `/status` | — | Show connection status: ping, WebSocket state, voice stats (RTT, jitter, packet loss). |
| `/standard` | — | Switch back to standard mode (sidebar UI). |
| `/logout` | — | Log out. Confirms. |
| `/update` | — | Check for desktop app updates (desktop only). |

---

### Dialog Boxes

Dialogs are modal overlays that appear centered over the message area. They follow the terminal aesthetic:

```
╔══ CHANNELS ═══════════════════════════════╗
║                                           ║
║  # general              3 unread          ║
║  # random                                 ║
║  # dev                  1 unread          ║
║  # music                                  ║
║                                           ║
║  [↑↓ Navigate]  [Enter Select]  [Esc Close]  ║
╚═══════════════════════════════════════════╝
```

**Rules:**
- Double-line box-drawing for dialogs (to distinguish from message unfurls which use single-line)
- Keyboard navigable — arrow keys, enter to select, escape to close
- Mouse clickable as well — both input methods always work
- Dialogs dismiss when an action is taken (e.g. selecting a channel switches to it and closes the dialog)
- Only one dialog open at a time
- Dialog content is reactive — if data updates while open (e.g. new notification arrives), it appears live

### Status Strip

A compact single line between the message area and input, showing active state at a glance:

```
♦ voice-chat (3) 🔇 │ 📻 lofi-radio ▶ chill-track.mp3 2:31/4:05 │ ● 23ms
```

**Segments (shown only when relevant):**
- **Voice:** Channel name, participant count, mute/deafen icons
- **Radio:** Station name, play/pause icon, track name, position/duration
- **Connection:** Colored dot (green/yellow/red) + ping in ms

When no voice or radio is active, the strip shows only the connection indicator. If nothing is active, the strip is hidden entirely to maximize message space.

### Keyboard Shortcuts

The terminal interface is keyboard-first:

| Shortcut | Action |
|----------|--------|
| `/` | Focus input and enter command mode |
| `Escape` | Close dialog / exit command mode / cancel reply |
| `↑` | Edit last sent message (when input is empty) |
| `Ctrl+K` | Open command palette (same as typing `/`) |
| `Alt+↑` / `Alt+↓` | Switch to previous/next text channel |
| `Tab` | Accept autocomplete suggestion |
| `Ctrl+Shift+M` | Toggle mute |
| `Ctrl+Shift+D` | Toggle deafen |

### Mobile Behavior

On mobile, the layout is identical — full-width message area with input at bottom. The command palette opens as a bottom sheet instead of a floating overlay. Dialogs are full-screen overlays with a back button.

The status strip remains as a single tap-target line — tapping the voice segment opens voice controls, tapping radio opens radio controls.

### Message Interactions Without Commands

Not every action requires a slash command. Messages retain hover/tap actions:

- **Hover a message:** Shows action icons (reply, react, edit, delete) — same as current behavior
- **Click a reaction:** Toggles your reaction — same as current behavior
- **Click a mention:** Highlights the mentioned user
- **Click an unfurl:** Opens URL in new tab
- **Click an attachment:** Opens lightbox / downloads file

These keep the chat area interactive without forcing users into command mode for the most common actions.

## Constraints

- **Standard mode must not change.** No existing component, layout, behavior, or interaction in the sidebar UI is modified. Terminal mode is additive — a new parallel layout, not a modification of the existing one.
- In terminal mode, the sidebar is not rendered. All its functionality is accessed through slash commands and the status strip.
- The command palette must feel instant — no network round-trips for showing the command list. Commands are a static client-side registry.
- Autocomplete for dynamic data (channel names, usernames, station names) uses data already in the local stores — no new API calls.
- All existing WebSocket operations and REST endpoints remain unchanged. This is purely a frontend addition.
- The backend requires zero changes for this feature.
- The terminal aesthetic must be preserved in terminal mode — box-drawing, monospace, no rounded corners, no shadows, no modern card UI.
- Both modes share the same SolidJS stores, WebSocket connection, and auth state. Switching modes is a layout swap, not a reconnection.
- The `/terminal` command must work from the standard mode message input. It is the only slash command that standard mode recognizes. All other text starting with `/` in standard mode is sent as a regular message (preserving current behavior).

## Architecture

### Mode Store

A new store (`client/src/stores/mode.ts`) holds the current UI mode:

```ts
type UIMode = "standard" | "terminal";
```

Persisted to `localStorage`. Defaults to `"standard"`. The root `App.tsx` reads this store and renders either the standard layout (existing `Sidebar` + main area) or the terminal layout (terminal-mode components). Both layouts mount the same shared stores.

### Component Structure

**Existing components — unchanged:**
- `Sidebar.tsx` — rendered only in standard mode, exactly as today
- `RadioSidebar.tsx` — rendered only in standard mode
- `Message.tsx` — shared by both modes (message rendering)
- `MessageList.tsx` — shared by both modes
- `TextChannel.tsx` — shared by both modes (or wrapped by terminal layout)
- `VoiceChannel.tsx` — shared by both modes
- `RadioPlayer.tsx` — floating window in standard mode, dialog in terminal mode
- `MediaPlayer.tsx` — floating window in standard mode, dialog in terminal mode
- `SettingsModal.tsx` — triggered by gear icon in standard mode, `/settings` in terminal mode
- `NotificationDropdown.tsx` — bell icon in standard mode, `/notifications` dialog in terminal mode

**New components (terminal mode only):**
- `TerminalLayout.tsx` — top-level layout for terminal mode (title bar + message area + status strip + input)
- `TerminalInput.tsx` — enhanced input with slash command detection and command palette trigger
- `CommandPalette.tsx` — fuzzy-matching command picker overlay
- `CommandRegistry.ts` — static registry of all slash commands with metadata (name, description, args, handler)
- `StatusStrip.tsx` — compact one-line voice/radio/connection status
- `ChannelDialog.tsx` — channel list picker
- `MembersDialog.tsx` — member list
- `VoiceDialog.tsx` — voice channel picker
- `RadioDialog.tsx` — radio station list/controls
- `HelpDialog.tsx` — command reference

**Modified components (minimal changes):**
- `App.tsx` — conditional render: standard layout vs terminal layout based on mode store
- `MessageInput.tsx` — intercept `/terminal` command in standard mode to trigger mode switch (single `if` check, no other changes)

## Out of Scope

- Custom user-defined slash commands or macros
- Scriptable/programmable terminal (no piping, no variables, no shell features)
- Command history persistence across sessions (in-memory history per session is fine)
- Slash commands for message formatting (bold, italic, code) — use markdown as today
- Bot/webhook integration via slash commands
- Split-pane or multi-channel views
- Tab completion for message content (only for command arguments)
- Slash commands in standard mode (other than `/terminal` to switch) — standard mode input behavior is unchanged
- Per-user mode sync across devices — mode is local to the browser/device
- Any modification to existing standard mode components or behavior

## Resolved Decisions

1. **Optional, not a replacement** — terminal mode is an alternate interface. Standard mode (sidebar UI) remains the default and is completely unchanged. Users opt in to terminal mode.
2. **Dialogs over inline rendering** — commands that show lists (channels, members, stations) open modal dialogs rather than rendering inline in the chat. This keeps the message stream clean.
3. **Command palette, not raw CLI parsing** — typing `/` opens a visual picker with fuzzy matching. Users don't need to memorize exact command syntax. But exact typing works too for speed.
4. **Status strip over persistent panels** — voice and radio state is shown in a single compact line, not dedicated panels. Expand via commands when you need detail.
5. **Backend unchanged** — all changes are frontend-only. The WS protocol and REST API stay exactly as they are.
6. **Shared stores, separate layouts** — both modes use the same SolidJS stores and WebSocket connection. Switching is instant with no state loss. This is a layout swap, not a mode that requires reconnection or data reload.
7. **`/terminal` is the only standard-mode command** — to avoid breaking existing behavior where users might type `/shrug` or `/me` as message content, the standard mode input only intercepts `/terminal`. Everything else is sent as a message, exactly as today.
