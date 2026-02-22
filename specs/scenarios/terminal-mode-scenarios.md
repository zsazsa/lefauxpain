# Scenarios: Terminal Mode

These scenarios validate the terminal mode feature. They are the
contract. Code must satisfy these — scenarios must not be modified to
accommodate code.

Note: Terminal mode is a frontend-only feature. These scenarios describe
observable user behavior. The backend, WS protocol, and REST API are
unchanged — all existing critical-path scenarios must continue to pass
unmodified.

---

## Mode Switching

### Scenario: User switches from standard to terminal mode via input
1. User is in standard mode (sidebar visible)
2. User types `/terminal` in the message input and presses Enter
3. Assert: the sidebar disappears
4. Assert: the terminal layout renders (full-width message area, status strip, input)
5. Assert: the title bar shows the current channel name
6. Assert: `/terminal` is NOT sent as a message to the channel
7. Assert: message history for the current channel is still visible

### Scenario: User switches from terminal to standard mode via command
1. User is in terminal mode
2. User types `/standard` and presses Enter
3. Assert: the sidebar reappears with all sections (channels, voice, members, radio, user bar)
4. Assert: the terminal-mode status strip disappears
5. Assert: `/standard` is NOT sent as a message to the channel
6. Assert: the current channel's messages remain visible

### Scenario: User switches to terminal mode via sidebar icon
1. User is in standard mode
2. User clicks the `[>_]` icon in the sidebar user bar
3. Assert: the sidebar disappears
4. Assert: terminal mode layout renders
5. Assert: behavior is identical to typing `/terminal`

### Scenario: Mode preference persists across page reloads
1. User switches to terminal mode
2. User reloads the page (full page refresh)
3. Assert: the app loads in terminal mode (not standard)
4. User switches back to standard mode
5. User reloads the page
6. Assert: the app loads in standard mode

### Scenario: New users start in standard mode
1. A new user registers and logs in for the first time
2. Assert: the app renders in standard mode (sidebar visible)
3. Assert: no terminal mode components are visible

### Scenario: /terminal in terminal mode is a no-op
1. User is already in terminal mode
2. User types `/terminal` and presses Enter
3. Assert: nothing changes — terminal mode remains active
4. Assert: `/terminal` is NOT sent as a message

### Scenario: /standard in standard mode is sent as a message
1. User is in standard mode
2. User types `/standard` in the message input and presses Enter
3. Assert: `/standard` IS sent as a regular message to the channel
4. Assert: the mode does not change (standard mode remains)

### Scenario: Only /terminal is intercepted in standard mode
1. User is in standard mode
2. User types `/join general` and presses Enter
3. Assert: `/join general` is sent as a regular message to the channel
4. Assert: no command is executed
5. User types `/help` and presses Enter
6. Assert: `/help` is sent as a regular message
7. User types `/mute` and presses Enter
8. Assert: `/mute` is sent as a regular message

---

## State Continuity

### Scenario: Voice connection survives mode switch
1. User is in standard mode and connected to a voice channel
2. User is unmuted and speaking
3. User types `/terminal`
4. Assert: voice connection remains active (no disconnect/reconnect)
5. Assert: status strip shows the voice channel name and participant count
6. Assert: other users do NOT see a voice_state_update (no leave/rejoin)

### Scenario: Radio playback survives mode switch
1. User is in standard mode and tuned into a radio station
2. Audio is playing
3. User types `/terminal`
4. Assert: radio playback continues uninterrupted
5. Assert: status strip shows the station name, track, and position
6. Assert: other users do NOT see a radio_listeners change

### Scenario: Current channel survives mode switch
1. User is in standard mode viewing text channel "dev"
2. User types `/terminal`
3. Assert: terminal mode shows "dev" as the current channel in the title bar
4. Assert: message history for "dev" is displayed
5. User types `/standard`
6. Assert: standard mode shows "dev" as the selected channel

### Scenario: Pending reply survives mode switch
1. User is in standard mode and has clicked "reply" on a message
2. The reply preview is showing above the input
3. User types `/terminal`
4. Assert: reply mode is still active in terminal mode
5. Assert: the quoted reply preview is visible above the terminal input

### Scenario: WebSocket connection is not disrupted by mode switch
1. User is in terminal mode
2. User types `/standard`
3. Assert: no WebSocket disconnect or reconnect occurs
4. Assert: the user does NOT appear to go offline and back online to other users

---

## Standard Mode Unchanged

### Scenario: Standard mode sidebar renders identically
1. User is in standard mode
2. Assert: sidebar contains voice channels section with channel list
3. Assert: sidebar contains text channels section with channel list
4. Assert: sidebar contains member list with online/offline indicators
5. Assert: sidebar contains radio stations section
6. Assert: sidebar contains user bar with username, settings gear, logout
7. Assert: sidebar contains notification bell
8. Assert: all sidebar items are clickable and function as before

### Scenario: Standard mode floating radio player still works
1. User is in standard mode
2. User clicks a radio station in the sidebar
3. Assert: floating radio player appears
4. Assert: playback controls (play, pause, skip, seek, volume) work
5. Assert: radio player is draggable and minimizable

### Scenario: Standard mode floating media player still works
1. User is in standard mode
2. User clicks a media item
3. Assert: floating media player appears
4. Assert: playback controls work
5. Assert: synchronized playback functions as before

### Scenario: Standard mode voice controls bar still works
1. User is in standard mode and joins a voice channel
2. Assert: voice controls bar appears at the bottom of the sidebar
3. Assert: mute, deafen, screen share, disconnect buttons all function
4. Assert: connection quality stats are displayed

### Scenario: Standard mode settings modal still works
1. User is in standard mode
2. User clicks the settings gear in the sidebar user bar
3. Assert: settings modal opens with all tabs (Account, Display, Audio, Admin, Email, App, About)
4. Assert: all settings are functional

---

## Terminal Mode Layout

### Scenario: Title bar shows current channel
1. User is in terminal mode viewing channel "general"
2. Assert: title bar displays "# general"
3. User runs `/join dev`
4. Assert: title bar updates to "# dev"

### Scenario: Title bar shows help shortcut
1. User is in terminal mode
2. Assert: title bar displays a `[?]` element
3. User clicks `[?]`
4. Assert: the help dialog opens (same as `/help`)

### Scenario: Message area renders messages identically to standard mode
1. User is in terminal mode viewing a channel with existing messages
2. Assert: messages show username, timestamp, and content
3. Assert: replies show quoted original message above
4. Assert: reactions display with emoji and count
5. Assert: URL unfurls render with box-drawing characters
6. Assert: attachments display with thumbnails
7. Assert: mentions are highlighted

### Scenario: Input line spans full width
1. User is in terminal mode
2. Assert: the text input spans the full width of the viewport
3. Assert: there is no sidebar consuming horizontal space

---

## Command Palette

### Scenario: Typing / opens the command palette
1. User is in terminal mode with an empty input
2. User types `/`
3. Assert: a floating overlay appears above the input
4. Assert: the overlay shows a list of available commands
5. Assert: each command shows its name, description, and argument hint

### Scenario: Command palette fuzzy-matches as user types
1. User is in terminal mode
2. User types `/j`
3. Assert: palette shows `/join` and any other commands starting with or containing "j"
4. User continues typing `/jo`
5. Assert: palette narrows to `/join` and `/logout` (or similar matches)
6. User types `/ra`
7. Assert: palette shows `/radio`, `/radio-create`, `/radio-tune`, and other radio commands

### Scenario: Arrow keys navigate the palette
1. User types `/` and the palette opens
2. Assert: the first command in the list is highlighted
3. User presses Down arrow
4. Assert: the second command is highlighted
5. User presses Up arrow
6. Assert: the first command is highlighted again

### Scenario: Enter selects a command from the palette
1. User types `/` and navigates to `/channels`
2. User presses Enter
3. Assert: the channels dialog opens
4. Assert: the command palette closes
5. Assert: the input is cleared

### Scenario: Escape dismisses the palette
1. User types `/` and the palette opens
2. User presses Escape
3. Assert: the palette closes
4. Assert: the input is cleared (or returns to empty state)

### Scenario: Typing a full command and pressing Enter works without palette selection
1. User types `/mute` and presses Enter (without using arrow keys)
2. Assert: the mute toggle executes immediately
3. Assert: no palette interaction was required

### Scenario: Palette does not appear for regular messages
1. User is in terminal mode
2. User types "hello everyone" (no leading /)
3. Assert: no command palette appears
4. User presses Enter
5. Assert: "hello everyone" is sent as a message to the current channel

### Scenario: Command palette is instant with no network delay
1. User types `/`
2. Assert: palette appears immediately (within one animation frame)
3. Assert: no loading spinner or "fetching commands" state
4. User types characters to filter
5. Assert: filtering is immediate with no visible delay

---

## Navigation Commands

### Scenario: /channels opens channel list dialog
1. User types `/channels` and presses Enter
2. Assert: a dialog opens showing all text channels
3. Assert: channels with unread messages show an unread indicator
4. Assert: the dialog uses double-line box-drawing characters
5. User selects a channel
6. Assert: the dialog closes
7. Assert: the title bar and message area update to the selected channel

### Scenario: /join switches to a text channel by name
1. Text channels "general" and "dev" exist
2. User types `/join dev` and presses Enter
3. Assert: the view switches to the "dev" channel
4. Assert: message history for "dev" is displayed
5. Assert: the title bar shows "# dev"

### Scenario: /join autocompletes channel names
1. Text channels "general", "gaming", "dev" exist
2. User types `/join g`
3. Assert: autocomplete suggestions show "general" and "gaming"
4. User selects "gaming"
5. Assert: the view switches to "gaming"

### Scenario: /join with nonexistent channel shows error
1. User types `/join nonexistent` and presses Enter
2. Assert: an error message appears (inline or brief toast)
3. Assert: the current channel does not change

### Scenario: /voice opens voice channel dialog when no args given
1. Voice channels "Voice Chat" and "Music" exist, with 2 users in "Voice Chat"
2. User types `/voice` and presses Enter
3. Assert: a dialog opens listing all voice channels
4. Assert: "Voice Chat" shows participant count (2) and user names
5. Assert: "Music" shows empty or (0)

### Scenario: /voice with channel name joins immediately
1. User types `/voice Music` and presses Enter
2. Assert: user joins the "Music" voice channel
3. Assert: all clients receive voice_state_update
4. Assert: the status strip shows the voice channel

### Scenario: /disconnect leaves voice channel
1. User is in a voice channel
2. User types `/disconnect` and presses Enter
3. Assert: user leaves the voice channel
4. Assert: all clients receive voice_state_update with channel_id: ""
5. Assert: the voice segment disappears from the status strip

### Scenario: /disconnect when not in voice is a no-op
1. User is NOT in any voice channel
2. User types `/disconnect` and presses Enter
3. Assert: nothing happens, no error

### Scenario: /members opens member list dialog
1. Three users exist: Alice (online), Bob (online), Charlie (offline)
2. User types `/members` and presses Enter
3. Assert: a dialog opens showing all members
4. Assert: online users are listed first with a green indicator
5. Assert: offline users are listed after with a muted indicator

### Scenario: /notifications opens notification dialog
1. User has 3 unread notifications (2 mentions, 1 admin knock)
2. User types `/notifications` and presses Enter
3. Assert: a dialog opens showing all notifications
4. Assert: unread notifications are visually distinct
5. User clicks a mention notification
6. Assert: the dialog closes
7. Assert: the view navigates to the channel and message where the mention occurred

---

## Text Chat Commands

### Scenario: /reply enters reply mode for most recent message
1. Channel has messages, most recent is from Alice: "check this out"
2. User types `/reply` and presses Enter
3. Assert: reply mode activates — a quoted preview of Alice's message appears above the input
4. User types "cool!" and presses Enter
5. Assert: a message is sent with reply_to referencing Alice's message
6. Assert: all clients receive message_create with reply_to

### Scenario: /edit opens inline edit for user's last message
1. User previously sent "Hello wrold" in the current channel
2. User types `/edit` and presses Enter
3. Assert: the input is populated with "Hello wrold"
4. User changes it to "Hello world" and presses Enter
5. Assert: all clients receive message_update with content "Hello world"
6. Assert: the message shows an "edited" indicator

### Scenario: /edit when user has no messages is a no-op
1. User has never sent a message in the current channel
2. User types `/edit` and presses Enter
3. Assert: nothing happens or a brief "no message to edit" notice appears

### Scenario: /delete deletes user's last message with confirmation
1. User previously sent "delete me" in the current channel
2. User types `/delete` and presses Enter
3. Assert: a confirmation prompt appears ("Delete your last message?")
4. User confirms
5. Assert: all clients receive message_delete
6. Assert: the message shows as deleted

### Scenario: /react adds reaction to most recent message
1. Channel has messages
2. User types `/react 👍` and presses Enter
3. Assert: a reaction is added to the most recent message
4. Assert: all clients receive reaction_add

### Scenario: /upload opens file picker
1. User types `/upload` and presses Enter
2. Assert: the browser file picker dialog opens
3. User selects an image file
4. Assert: a thumbnail preview appears above the input
5. User types "check this photo" and presses Enter
6. Assert: the message is sent with the image attachment

### Scenario: /search opens search dialog
1. Channel has messages including "hello world" and "hello there"
2. User types `/search hello` and presses Enter
3. Assert: a dialog opens showing messages matching "hello"
4. Assert: both "hello world" and "hello there" appear in results
5. User clicks on "hello world"
6. Assert: the dialog closes and the message list scrolls to that message

---

## Voice Commands

### Scenario: /mute toggles self-mute
1. User is in a voice channel and not muted
2. User types `/mute` and presses Enter
3. Assert: user is now muted
4. Assert: all clients receive voice_state_update with self_mute: true
5. Assert: status strip shows mute icon
6. User types `/mute` again
7. Assert: user is unmuted
8. Assert: status strip mute icon disappears

### Scenario: /deafen toggles self-deafen
1. User is in a voice channel and not deafened
2. User types `/deafen` and presses Enter
3. Assert: user is now deafened
4. Assert: all clients receive voice_state_update with self_deafen: true
5. Assert: status strip shows deafen icon

### Scenario: /mute when not in voice is a no-op
1. User is NOT in any voice channel
2. User types `/mute` and presses Enter
3. Assert: nothing happens, no error

### Scenario: /screen toggles screen sharing
1. User is in a voice channel
2. User types `/screen` and presses Enter
3. Assert: screen sharing initiates (on Linux desktop, PipeWire portal picker appears)
4. Assert: all clients receive screen_share_started

### Scenario: /watch opens another user's screen share
1. Alice is screen sharing in a voice channel
2. User types `/watch Alice` and presses Enter
3. Assert: screen share viewer opens showing Alice's screen

### Scenario: /volume sets per-user volume
1. User is in a voice channel with Alice
2. User types `/volume Alice 150` and presses Enter
3. Assert: Alice's audio volume is set to 150% locally
4. Assert: no WS event is broadcast (this is a local-only setting)

---

## Radio Commands

### Scenario: /radio opens station list dialog
1. Two radio stations exist: "Chill Beats" (playing, 3 listeners) and "Rock" (stopped)
2. User types `/radio` and presses Enter
3. Assert: a dialog opens listing both stations
4. Assert: "Chill Beats" shows playing status, listener count, and current track
5. Assert: "Rock" shows stopped status
6. User selects "Chill Beats"
7. Assert: user tunes into "Chill Beats"
8. Assert: dialog closes
9. Assert: all clients receive radio_listeners update

### Scenario: /radio-create creates a new station
1. User types `/radio-create Jazz Lounge` and presses Enter
2. Assert: all clients receive radio_station_create with name "Jazz Lounge"
3. Assert: the creating user is a manager of the new station

### Scenario: /radio-tune tunes into a station
1. User types `/radio-tune Chill Beats` and presses Enter
2. Assert: user is tuned into "Chill Beats"
3. Assert: status strip shows the station name and playback info
4. Assert: all clients receive radio_listeners update

### Scenario: /radio-untune stops listening
1. User is tuned into a station
2. User types `/radio-untune` and presses Enter
3. Assert: user is no longer tuned in
4. Assert: radio segment disappears from status strip
5. Assert: all clients receive radio_listeners update

### Scenario: /radio-play starts playback
1. User is a manager of a station with tracks loaded
2. User types `/radio-play` and presses Enter
3. Assert: all clients receive radio_playback with playing: true

### Scenario: /radio-pause pauses playback
1. Station is playing
2. User types `/radio-pause` and presses Enter
3. Assert: all clients receive radio_playback with playing: false

### Scenario: /radio-skip advances to next track
1. Station is playing track 1 of 3
2. User types `/radio-skip` and presses Enter
3. Assert: all clients receive radio_playback with the next track

### Scenario: /radio-stop stops playback entirely
1. Station is playing
2. User types `/radio-stop` and presses Enter
3. Assert: all clients receive radio_playback with stopped: true

### Scenario: /radio-seek jumps to position
1. Station is playing a 4-minute track
2. User types `/radio-seek 2:30` and presses Enter
3. Assert: playback jumps to 2 minutes 30 seconds
4. Assert: all clients receive updated position

### Scenario: /radio-mode changes playback mode
1. User is a manager of a station
2. User types `/radio-mode loop-all` and presses Enter
3. Assert: all clients receive radio_station_update with playback_mode "loop_all"

### Scenario: /radio-public toggles public controls
1. User is a manager of a station
2. User types `/radio-public` and presses Enter
3. Assert: all clients receive radio_station_update with public_controls toggled
4. Assert: non-manager users can now control playback (if toggled on)

### Scenario: Radio commands require appropriate permissions
1. User is NOT a manager or admin
2. Station does NOT have public controls enabled
3. User types `/radio-play` and presses Enter
4. Assert: command fails with a permission error
5. Assert: no radio_playback event is broadcast

---

## Settings Commands

### Scenario: /settings opens the full settings modal
1. User types `/settings` and presses Enter
2. Assert: the settings modal opens
3. Assert: all tabs are present (Account, Display, Audio, Admin for admins, etc.)
4. Assert: the modal is the same settings component used in standard mode

### Scenario: /theme switches theme immediately
1. User types `/theme` and sees autocomplete of available themes
2. User types `/theme neon` and presses Enter
3. Assert: the theme changes immediately
4. Assert: CSS variables update across the entire UI
5. Assert: no dialog opens — the change is instant

### Scenario: /audio opens audio settings dialog
1. User types `/audio` and presses Enter
2. Assert: a dialog opens with input device picker, output device picker, and volume sliders
3. Assert: mic test functionality is available

### Scenario: /password opens password change dialog
1. User types `/password` and presses Enter
2. Assert: a dialog opens with current password, new password, and confirm password fields

---

## Admin Commands

### Scenario: /admin opens admin panel dialog
1. Admin user types `/admin` and presses Enter
2. Assert: a dialog opens showing the admin panel
3. Assert: pending users section is visible with approve/reject actions
4. Assert: approved users section is visible with admin toggle and delete options

### Scenario: /admin is rejected for non-admin users
1. Non-admin user types `/admin` and presses Enter
2. Assert: command fails with a permission error or the command is not shown in the palette

### Scenario: /approve approves a pending user
1. User "charlie" is pending approval
2. Admin types `/approve charlie` and presses Enter
3. Assert: charlie is approved
4. Assert: all clients receive user_approved event

### Scenario: /reject rejects a pending user
1. User "charlie" is pending approval
2. Admin types `/reject charlie` and presses Enter
3. Assert: charlie is rejected
4. Assert: charlie cannot log in

### Scenario: /kick deletes a user with confirmation
1. Admin types `/kick bob` and presses Enter
2. Assert: a confirmation prompt appears
3. Admin confirms
4. Assert: bob's account is deleted
5. Assert: bob's WS connection is forcibly closed

### Scenario: /server-mute mutes a user in voice
1. Admin types `/server-mute bob` and presses Enter
2. Assert: all clients receive voice_state_update with server_mute: true for bob

---

## Channel Management Commands

### Scenario: /channel-create creates a text channel
1. User types `/channel-create text announcements` and presses Enter
2. Assert: all clients receive channel_create with name "announcements" and type "text"
3. Assert: the new channel appears in /channels dialog

### Scenario: /channel-create creates a voice channel
1. User types `/channel-create voice meeting-room` and presses Enter
2. Assert: all clients receive channel_create with name "meeting-room" and type "voice"

### Scenario: /channel-delete deletes a channel with confirmation
1. User is a manager of channel "old-channel"
2. User types `/channel-delete old-channel` and presses Enter
3. Assert: a confirmation prompt appears
4. User confirms
5. Assert: all clients receive channel_delete

### Scenario: /channel-rename renames a channel
1. User is a manager of channel "old-name"
2. User types `/channel-rename old-name new-name` and presses Enter
3. Assert: all clients receive channel_update with name "new-name"
4. Assert: title bar updates if this was the current channel

### Scenario: /channel-restore restores a deleted channel
1. Channel "archived" was previously deleted
2. Admin types `/channel-restore archived` and presses Enter
3. Assert: all clients receive channel_create with the restored channel

---

## System Commands

### Scenario: /help opens command reference dialog
1. User types `/help` and presses Enter
2. Assert: a dialog opens showing all available commands
3. Assert: commands are grouped by category (Navigation, Chat, Voice, Radio, etc.)
4. Assert: each command shows its name, arguments, and description

### Scenario: /status shows connection information
1. User is connected and in a voice channel
2. User types `/status` and presses Enter
3. Assert: connection info is displayed: ping, WebSocket state
4. Assert: voice stats are shown: RTT, jitter, packet loss, codec, bitrate

### Scenario: /logout logs out with confirmation
1. User types `/logout` and presses Enter
2. Assert: a confirmation prompt appears
3. User confirms
4. Assert: user is logged out and returned to the login screen

---

## Dialog Boxes

### Scenario: Dialogs use double-line box-drawing characters
1. User opens any dialog (e.g. `/channels`)
2. Assert: the dialog border uses double-line box-drawing (╔ ═ ╗ ║ ╚ ╝)
3. Assert: this is visually distinct from message unfurls (which use single-line ┌ ─ ┐)

### Scenario: Dialogs are keyboard navigable
1. User opens the channels dialog
2. Assert: arrow keys move the selection highlight
3. Assert: Enter selects the highlighted item
4. Assert: Escape closes the dialog

### Scenario: Dialogs are mouse clickable
1. User opens the channels dialog
2. User clicks on a channel name
3. Assert: the channel is selected and the dialog closes
4. Assert: the view switches to the clicked channel

### Scenario: Only one dialog can be open at a time
1. User opens `/channels` dialog
2. User somehow triggers `/members` (e.g. via keyboard shortcut)
3. Assert: the channels dialog closes
4. Assert: the members dialog opens
5. Assert: only one dialog is visible

### Scenario: Dialog content is reactive
1. User opens `/notifications` dialog showing 2 notifications
2. While the dialog is open, another user mentions this user
3. Assert: the new notification appears in the open dialog without closing and reopening

### Scenario: Dialog dismisses after action
1. User opens `/channels` dialog
2. User selects a channel
3. Assert: the dialog closes automatically
4. Assert: the user does not need to press Escape or click a close button

---

## Status Strip

### Scenario: Status strip shows voice info when in a voice channel
1. User joins voice channel "Hangout" with 2 other users
2. Assert: status strip shows "♦ Hangout (3)" with participant count
3. User mutes
4. Assert: status strip shows mute icon next to voice info

### Scenario: Status strip shows radio info when tuned in
1. User tunes into "Chill Beats" which is playing "track.mp3" at 1:30/3:45
2. Assert: status strip shows station name, play icon, track name, and position/duration

### Scenario: Status strip shows connection quality
1. User is connected with 23ms ping
2. Assert: status strip shows a green dot and "23ms"
3. Connection degrades to 200ms
4. Assert: dot changes to yellow
5. Connection degrades to 500ms+
6. Assert: dot changes to red

### Scenario: Status strip is hidden when nothing is active
1. User is not in voice, not tuned to radio
2. Assert: only the connection indicator is shown (or strip is hidden entirely)
3. Assert: maximum vertical space is given to the message area

### Scenario: Status strip segments appear and disappear dynamically
1. User is not in voice and not tuned to radio — strip shows connection only
2. User joins a voice channel
3. Assert: voice segment appears in the strip
4. User tunes into a radio station
5. Assert: radio segment appears alongside voice segment
6. User leaves voice
7. Assert: voice segment disappears, radio segment remains

---

## Keyboard Shortcuts

### Scenario: Escape closes dialog
1. User has a dialog open
2. User presses Escape
3. Assert: the dialog closes
4. Assert: focus returns to the input

### Scenario: Escape cancels command mode
1. User has typed `/jo` in the input with palette visible
2. User presses Escape
3. Assert: the command palette closes
4. Assert: the input is cleared

### Scenario: Ctrl+K opens command palette
1. User is in terminal mode with cursor in input
2. User presses Ctrl+K
3. Assert: the command palette opens (same as typing `/`)

### Scenario: Alt+Up/Down switches channels
1. Text channels exist in order: general, dev, random
2. User is viewing "dev"
3. User presses Alt+Down
4. Assert: view switches to "random" (next channel)
5. User presses Alt+Up
6. Assert: view switches back to "dev"

### Scenario: Up arrow edits last message when input is empty
1. User's last message in the current channel was "typo here"
2. User's input is empty
3. User presses Up arrow
4. Assert: the input is populated with "typo here" in edit mode

### Scenario: Tab accepts autocomplete suggestion
1. User types `/join g` and "general" is suggested
2. User presses Tab
3. Assert: the input completes to `/join general`

---

## Message Interactions Without Commands

### Scenario: Hover actions work on messages in terminal mode
1. User is in terminal mode
2. User hovers over a message
3. Assert: action icons appear (reply, react, edit if own message, delete if own/admin)
4. User clicks the reply icon
5. Assert: reply mode activates with quoted preview above input

### Scenario: Clicking a reaction toggles it in terminal mode
1. User is in terminal mode
2. A message has a 👍 reaction from another user
3. User clicks the 👍 reaction
4. Assert: user's reaction is added
5. Assert: all clients receive reaction_add

### Scenario: Clicking an unfurl opens URL in terminal mode
1. User is in terminal mode
2. A message has an unfurl block
3. User clicks the unfurl block
4. Assert: the URL opens in a new tab

### Scenario: Clicking an attachment opens lightbox in terminal mode
1. User is in terminal mode
2. A message has an image attachment
3. User clicks the image
4. Assert: lightbox or full-size view opens

---

## Mobile Behavior

### Scenario: Command palette opens as bottom sheet on mobile
1. User is in terminal mode on a mobile viewport
2. User types `/`
3. Assert: the command palette appears as a bottom sheet (sliding up from bottom)
4. Assert: the palette is not a floating overlay in the center

### Scenario: Dialogs are full-screen on mobile
1. User is in terminal mode on a mobile viewport
2. User runs `/channels`
3. Assert: the channels dialog fills the entire screen
4. Assert: a back button or close button is visible at the top

### Scenario: Mode switching works on mobile
1. User is on a mobile viewport in standard mode
2. User types `/terminal` in the input
3. Assert: terminal mode renders full-width with no sidebar
4. Assert: the input and command palette are usable on touch

---

## Edge Cases

### Scenario: Sending a regular message still works in terminal mode
1. User is in terminal mode in channel "general"
2. User types "hello everyone" and presses Enter
3. Assert: message "hello everyone" is sent to "general"
4. Assert: all clients receive message_create
5. Assert: no command is triggered

### Scenario: Message starting with / that is not a valid command
1. User is in terminal mode
2. User types `/shrug` and presses Enter
3. Assert: `/shrug` is sent as a regular message to the channel
4. Assert: no error about unknown command

### Scenario: Empty /command (just /) is not sent as a message
1. User is in terminal mode
2. User types `/` and then presses Escape to dismiss the palette
3. Assert: nothing is sent to the channel
4. Assert: the input returns to empty state

### Scenario: Rapid mode switching does not corrupt state
1. User rapidly types `/terminal`, then `/standard`, then `/terminal`
2. Assert: the final state is terminal mode
3. Assert: no duplicate WebSocket connections
4. Assert: no missing or duplicate UI elements
5. Assert: stores are consistent

### Scenario: Commands with extra whitespace are handled gracefully
1. User types `/join   general  ` (extra spaces) and presses Enter
2. Assert: the command is parsed correctly
3. Assert: the view switches to "general"

### Scenario: Command autocomplete uses local store data
1. User types `/join` and sees channel name suggestions
2. Assert: suggestions match the channels already loaded in the store
3. Assert: no new HTTP or WS request is made to fetch channel data
