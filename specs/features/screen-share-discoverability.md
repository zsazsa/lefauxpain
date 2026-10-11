# Feature: Screen Share Discoverability

## Intent

When someone in your voice channel starts sharing their screen, it should be
obvious that it is happening and obvious where to click to watch. Today the
only click target is the username row in the MEMBRES list, marked with a
10px monitor glyph, with no hover state or label. The user tiles in the
channel view and the rows under the voice channel in the sidebar look
identical but do nothing, and the viewer's `[SHARE]` button is merely greyed
out. On mobile there is no entry point without opening the sidebar.

## Current Behavior

- `screen_share_started` adds the share to the store. The sidebar MEMBRES row
  for that user becomes clickable (`cursor: pointer`, no other change).
- `VoiceUser` tiles show no sharing state and are not clickable.
- `VoiceControls` disables `[SHARE]` with the title "Someone else is sharing".
- `ScreenShareView` closes with a red `[X]` for viewers and `[STOP SHARING]`
  for the presenter. The presenter does not know how many people are watching.

## New Behavior

### One rule

Anywhere a user is marked as sharing, clicking that mark watches the share.

### Watch banner (voice channel view)

When another user in the viewed voice channel is sharing, a full-width banner
sits between the channel header and the user tiles:

```
🖥 spacenoise is sharing their screen          [ WATCH SCREEN ]
```

The button uses the same green treatment as `[join voice]`. Clicking it
subscribes and opens the watch view. If the viewer is not in that voice
channel, the button is still shown; watching does not require being in voice
(unchanged from today).

### User tile

The sharing user's tile shows a gold `SHARING` badge on its status line, has
`cursor: pointer`, a gold hover outline, and opens the watch view on click.
Your own tile shows the badge but is not clickable.

### Voice panel

When another user in your channel is sharing, the `[SHARE]` button is replaced
by a green `[WATCH]` that opens the watch view. While watching, it reads
`[STOP WATCHING]` and closes the view. While you present it stays `[STOP]`.

### Sidebar

Both lists (users under the voice channel, and MEMBRES) render the monitor
glyph at 12px in the accent color for a sharing user, the row has
`cursor: pointer`, a hover background, and a trailing `watch` hint in the
accent color. Clicking either row watches.

### Watch view

- Viewer close button reads `[STOP WATCHING]` (red border kept, since it ends
  something).
- Presenter header shows `· N watching`, updated live.

### Toast

When a share starts in the channel the user is currently in voice with, and
the user is not the presenter, a toast appears bottom-right for 8 s:
"spacenoise started sharing · click to watch". Clicking it opens the watch
view. Only one toast is visible at a time; a new one replaces it.

### Protocol addition

New server→client event `screen_share_viewers`:

```json
{ "user_id": "<presenter>", "channel_id": "<channel>", "count": 2 }
```

Broadcast to all clients whenever a viewer is added or removed from a screen
room, and with `count: 0` when the share stops. The `ready` snapshot is
unchanged; the count starts at 0 on load and corrects on the next change.

## Out of Scope

- Multiple simultaneous shares per channel.
- Watching from the desktop app's native player (unchanged).

## Validation

- `make validate` stays green; no scenario is modified.
- Manual, two browsers: B shares. A sees the banner, the tile badge, `[WATCH]`
  in the panel, both sidebar rows highlighted, and the toast. Each of the five
  targets opens the watch view. B's header shows `· 1 watching` while A
  watches and `· 0 watching` after A clicks `[STOP WATCHING]`.
