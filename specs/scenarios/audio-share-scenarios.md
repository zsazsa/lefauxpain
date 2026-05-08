# Audio Share Scenarios

These scenarios describe the observable behavior of the live audio share
feature in voice channels. They cover the protocol-level contract that
applies to every capture surface (web, Windows desktop, Linux desktop).

The scenarios do **not** test platform-specific capture mechanisms
themselves (e.g., WASAPI process loopback). Those are validated by
desktop integration tests outside this suite. These scenarios validate
the WebSocket protocol, SFU multi-track behavior, and store / event
fan-out.

All scenarios assume two test clients (Alice, Bob) already authenticated
and connected via WebSocket, both joined to the same voice channel,
unless stated otherwise.

---

## Scenario 1: User starts audio share, peers receive notification

A user already in a voice channel begins sharing a second audio source.
All other users in the same channel are notified.

### Steps
1. Alice and Bob are both in voice channel `voice-1`
2. Alice sends WS op `voice_share_audio_start` with `{ "label": "Spotify" }`
3. Assert: server responds with no error
4. Assert: Bob receives WS event `voice_audio_source_added` with
   `user_id: <alice_id>`, `label: "Spotify"`, and a non-empty `source_id`
5. Assert: a third user Carol who is **not** in `voice-1` also receives
   the event (the indicator is broadcast globally, matching the
   existing `voice_state_update` pattern). Carol's UI is responsible
   for filtering to the channels she actually views.

---

## Scenario 2: User stops audio share, peers receive notification

### Steps
1. Alice has an active audio share in `voice-1` (from Scenario 1)
2. Alice sends WS op `voice_share_audio_stop` with `{}`
3. Assert: server responds with no error
4. Assert: Bob receives WS event `voice_audio_source_removed` with
   `user_id: <alice_id>` and `source_id` matching the one from Scenario 1

---

## Scenario 3: Stopping a share when none is active is a no-op

### Steps
1. Alice has no active audio share
2. Alice sends WS op `voice_share_audio_stop` with `{}`
3. Assert: server responds with no error
4. Assert: no `voice_audio_source_removed` event is broadcast

---

## Scenario 4: Starting a second share replaces the first

A user is allowed only one active share at a time. Starting a new one
ends the previous.

### Steps
1. Alice starts a share with label `"Spotify"` (Scenario 1)
2. Bob receives `voice_audio_source_added` with `source_id: A`
3. Alice sends WS op `voice_share_audio_start` with `{ "label": "Browser tab" }`
4. Assert: Bob receives WS event `voice_audio_source_removed` with
   `source_id: A`
5. Assert: Bob then receives WS event `voice_audio_source_added` with a
   new `source_id: B` (B != A) and `label: "Browser tab"`

---

## Scenario 5: Share auto-stops when user leaves voice channel

### Steps
1. Alice has an active share in `voice-1`
2. Alice sends WS op `leave_voice` with `{}`
3. Assert: Bob receives `voice_audio_source_removed` for Alice's source
4. Assert: Bob receives `voice_state_update` reflecting Alice has left
5. Assert: the order is "share removed before voice state update" — clients
   should learn the share is gone before they learn the user is gone

---

## Scenario 6: Share auto-stops when WebSocket disconnects

### Steps
1. Alice has an active share in `voice-1`
2. Alice's WebSocket connection closes (forcibly, simulating network loss)
3. Assert: within 5 seconds, Bob receives `voice_audio_source_removed`
   for Alice's source
4. Assert: Bob receives `voice_state_update` reflecting Alice has left voice

---

## Scenario 7: Share auto-stops when user joins a different voice channel

### Steps
1. Alice has an active share in `voice-1`
2. Alice sends WS op `join_voice` with `{ "channel_id": "voice-2" }`
3. Assert: Bob (still in `voice-1`) receives `voice_audio_source_removed`
   for Alice's source
4. Assert: Carol (in `voice-2`) does **not** receive
   `voice_audio_source_added` for Alice's previous source

---

## Scenario 8: Cannot start audio share when not in a voice channel

### Steps
1. Alice is connected via WS but not joined to any voice channel
2. Alice sends WS op `voice_share_audio_start` with `{ "label": "Spotify" }`
3. Assert: server returns an error event with a reason such as
   `"not in voice channel"`
4. Assert: no `voice_audio_source_added` is broadcast to anyone

---

## Scenario 9: Mic mute does not stop active audio share

The mic and the share are independent streams.

### Steps
1. Alice has an active share in `voice-1` and her mic is unmuted
2. Alice sends WS op `voice_self_mute` with `{ "muted": true }`
3. Assert: Bob receives `voice_state_update` showing Alice's `muted: true`
4. Assert: Bob does **not** receive `voice_audio_source_removed`
5. Assert: Alice's audio share track on Bob's peer connection is still
   active and forwarding RTP

---

## Scenario 10: Stopping audio share does not affect mic state

### Steps
1. Alice has an active share and is unmuted
2. Alice sends WS op `voice_share_audio_stop` with `{}`
3. Assert: Bob receives `voice_audio_source_removed`
4. Assert: Bob does **not** receive `voice_state_update` for Alice
5. Assert: Alice's mic track on Bob's peer connection is still active

---

## Scenario 11: Empty label is rejected

### Steps
1. Alice sends WS op `voice_share_audio_start` with `{ "label": "" }`
2. Assert: server returns an error event with a reason such as
   `"label required"`
3. Assert: no event is broadcast

---

## Scenario 12: Label is length-limited

### Steps
1. Alice sends WS op `voice_share_audio_start` with a `label` of
   200 characters
2. Assert: server either truncates to 64 characters and broadcasts the
   truncated value, or rejects with `"label too long"`
3. Assert: the documented behavior (truncate vs. reject) is consistent
   across runs

---

## Scenario 13: Ready state includes active shares for users in voice

A user who joins / reconnects should learn about ongoing shares from
other users in their voice channel.

### Steps
1. Alice is in `voice-1` with an active share `{ source_id: S, label: "Spotify" }`
2. Carol authenticates and connects via WS
3. Carol joins `voice-1`
4. Assert: Carol receives `voice_state_update` for all members
5. Assert: Carol receives `voice_audio_source_added` for Alice's share
   with `source_id: S` and `label: "Spotify"`

---

## Scenario 14: SFU forwards the audio share track as a separate inbound track

This scenario validates the multi-track SFU change. It exercises actual
WebRTC media, so it runs only when the test harness has a Pion-based
peer client available.

### Steps
1. Alice and Bob are in `voice-1`, both with mic tracks established
2. Alice adds a second outbound audio track to her peer connection
   (synthetic Opus payload, distinct SSRC from her mic)
3. Alice sends WS op `voice_share_audio_start` with `{ "label": "synth" }`
4. Alice and the server complete a renegotiation (`webrtc_offer` /
   `webrtc_answer`)
5. Assert: Bob's peer connection fires `ontrack` for a new inbound
   audio track with an SSRC distinct from Alice's mic track
6. Assert: Bob receives RTP packets on the new track within 2 seconds
7. Assert: Bob's `ontrack` track ID can be correlated to Alice's
   `source_id` from the `voice_audio_source_added` event (via WebRTC
   stream ID or a server-published mapping)
