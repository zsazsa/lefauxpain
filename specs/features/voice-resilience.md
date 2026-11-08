# Feature: Voice Resilience

## Intent

A voice call should survive the ordinary failures of a home network and a
Windows audio stack without the user having to quit and rejoin, and when it
cannot recover it should say so. Today a user whose WebSocket blips, whose
peer connection fails, or whose microphone silently stops delivering audio
keeps seeing "VOICE CONNECTED" while nobody can hear them. The server logs
nothing that would distinguish these cases.

Observed in production (Oct 2026): one user rejoined six times in fifteen
minutes; the SFU received his mic track and renegotiated everyone else
successfully each time, yet the others could not hear him. The failure is on
the sending side and in recovery, not in signaling.

## Current Behavior

- Browser client takes the mic once with `getUserMedia` and never observes the
  local track's `mute` / `unmute` / `ended` events.
- `connectionState` changes on the voice peer connection are logged only.
- On WebSocket close the server removes the peer immediately and broadcasts
  the leave. On reconnect the client's `ready` handler skips rejoining when it
  still believes it is in voice, leaving a ghost call: local UI says
  connected, server has no peer.
- A `voice_state_update` with an empty `channel_id` for the client's own user
  only removes the row from the list; local voice state is untouched.
- The SFU advertises Opus `usedtx=1`; Chrome then stops sending packets when
  its voice detector classifies a quiet mic as silence.
- The per-publisher RTP forwarding goroutine returns on any `Write` error,
  including a single subscriber's closed pipe, so one publisher goes silent for
  everyone while still hearing everyone. Nothing is logged.
- `renegotiatePeer` checks the signaling state and then creates an offer
  without a lock spanning both steps, so two concurrent triggers can both
  observe "stable" and put two offers in flight for one peer.
- The server does not log WebSocket connects or disconnects, and never logs
  whether a publisher's packets keep flowing.

## New Behavior

### Client: microphone health

- The local mic track's `mute`, `unmute` and `ended` events are handled.
- `ended` (device removed or revoked): the client re-acquires the microphone
  with the current settings (falling back to the default device) and swaps it
  into the sender with `replaceTrack`. Speaking detection restarts on the new
  track.
- `mute` lasting longer than 1 s sets a mic warning. `unmute` clears it.
- A `micWarning` signal drives a line in the voice panel:
  "Mic is not delivering audio" with a `[RETRY MIC]` button that re-acquires.
- When `getUserMedia` falls back from the saved device to the default, the
  panel shows "Saved mic not found, using default" until the next join.
- The voice panel shows a small input level bar fed by the existing speaking
  detector (RMS level, 0 to 1), so a user can see their own signal.

### Client: recovery

- A `voiceLink` signal has values `connected`, `reconnecting`, `failed`.
- Peer connection `failed`, or `disconnected` for more than 8 s, triggers an
  automatic leave-and-rejoin of the same channel with backoff
  (2 s, 4 s, 8 s, max 3 attempts), status `reconnecting`. After the last
  failed attempt the status is `failed` and the panel offers `[REJOIN]`.
- On `ready` after a reconnect: if the client has a current voice channel but
  the server's `voice_states` do not list this user, the client tears down the
  local peer connection and rejoins that channel automatically.
- A `voice_state_update` that removes this user (empty `channel_id`) while
  the client believes it is in voice and did not initiate a leave triggers the
  same rejoin path.
- Desktop (Rust engine) path: the same rejoin logic applies at the
  `joinVoice` / `leaveVoice` level; mic health handling is browser-only.

### Client: stats

- The stats row gains `packets sent` from `outbound-rtp`. Existing fields are
  unchanged.

### Server: SFU

- The voice Opus parameters no longer include `usedtx=1`.
- Forwarding goroutines (voice mic, voice share, screen video, screen audio)
  stop only when the publisher's `track.Read` fails. Subscriber write errors
  are logged at most once per 10 s per track and otherwise ignored.
- Each `Peer` has a `negotiationMu` held from the signaling-state check through
  `SetLocalDescription` in `renegotiatePeer`, and across `SetRemoteDescription`
  plus the deferred-flag check in `HandleAnswer`. The existing
  `needsRenegotiation` deferral is kept. Screen viewers get the same treatment.
- Each room logs once every 30 s, while it has peers, one line per publisher:
  `sfu: room <id> user <id> rx_packets=<n> (30s)`. A connected publisher at 0
  indicates a silent mic; a count that stops after a subscriber left indicates
  a dead forwarder.

### Server: WebSocket

- On successful authenticate: `ws: connected user=<username> id=<id>`.
- On read loop exit: `ws: disconnected user=<username> id=<id> reason=<err>`.

## Out of Scope

- A server-side grace period that keeps the peer alive across a socket blip.
- ICE restart in place (the client rejoins instead).
- Single-port UDP mux, ICE-TCP fallback, TURN.

## Validation

- `make validate` stays green; no scenario is modified.
- Manual: two browsers in a voice channel. Kill one browser's WebSocket
  (devtools offline for 3 s): the call comes back by itself within 10 s and
  the other side hears audio again. Block UDP for 35 s: the panel shows
  "Reconnecting voice…" and recovers. Unplug the mic: the panel shows the mic
  warning, replug: audio resumes.

## Amendment (Nov 2026): microphone recovery retries

### Observed

Production, Oct 17 to Nov 8 2026, one browser user on Windows: the SFU's
30-second counters show his mic falling to 0 packets for 30 s to 14 min,
several times per session, while every other publisher stays at 1500 per
window and his peer connection stays `connected`. Three consecutive joins on
Nov 5 never delivered a single packet. The panel showed "Mic was lost" and he
quit and rejoined to recover. Server and network are not involved.

### Current Behavior

- `ended` triggers exactly one re-acquire, immediately. A device that is
  re-enumerating, changing format, or held by another application refuses
  that attempt; nothing tries again, so the user sends silence until he
  clicks `[RETRY MIC]` or rejoins.
- `[RETRY MIC]` clears the warning before it tries and only logs on failure,
  so a failed retry leaves no banner while the mic is still dead.
- A capture that stalls without ending the track (a live, enabled track whose
  sender stops sending bytes) is not detected at all.
- Nothing tells us why the re-acquire failed.

### New Behavior (browser only)

- Mic recovery is a state, not a single call. It starts when the local track
  ends, or when the stats poll sees the mic sender's `bytesSent` unchanged
  for 3 consecutive polls (6 s) while the peer connection is `connected` and
  the track is live and enabled (not self-muted).
- While recovering the banner reads "Mic was lost, retrying…". Each attempt
  re-acquires with the current settings (the existing default-device
  fallback applies) and swaps the new track in with `replaceTrack`.
- An attempt that throws schedules the next one: 2 s, 4 s, 8 s, then every
  15 s for as long as the user stays in voice. The banner carries the error
  name, e.g. "Mic was lost, retrying… (NotReadableError)".
- An attempt that resolves but whose track is still silent after the stall
  window counts as a failure and follows the same schedule.
- `NotAllowedError` and `SecurityError` stop the schedule: the banner reads
  "Mic was lost (NotAllowedError)" and only `[RETRY MIC]` remains.
- A `devicechange` event during recovery runs the next attempt at once.
- Recovery ends when the stats poll sees `bytesSent` increase again, whether
  from the swapped-in track or because the device recovered on its own. The
  banner then clears, or shows "Saved mic not found, using default" when the
  last successful acquire fell back.
- `[RETRY MIC]` during recovery cancels the pending timer and attempts now.
  Outside recovery (fallback or not-delivering banners) it attempts once; on
  failure the mic in use is untouched and the banner stays, gaining the error
  name only if the current track has ended.
- The stats row's outbound fields (`bitrate`, `packets sent`) come from the
  mic sender's own stats, so an active audio share cannot mask a silent mic.
- Leaving voice, rejoining, or a successful mic switch in Settings cancels
  any recovery in progress.
- The "Mic is not delivering audio" mute warning is not raised while
  recovery is active.

### Validation

- `make validate` stays green; no scenario is modified.
- Manual: in voice in a browser, open the mic in exclusive mode from another
  application, or unplug a USB mic. Within a few seconds the banner shows
  "Mic was lost, retrying… (NotReadableError)" (or NotFoundError). Release
  the device: audio resumes within 15 s without clicking anything and the
  banner clears. Revoke mic permission in the site settings instead: the
  banner reads "Mic was lost (NotAllowedError)" and stays until
  `[RETRY MIC]` or a rejoin.
