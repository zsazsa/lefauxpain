package validation

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

const shortNoEvent = 500 * time.Millisecond

// joinVoiceFor connects a user via WS, joins the given voice channel,
// drains the resulting voice_state_update + webrtc_offer, and returns
// the connected client. The caller is responsible for closing it.
func joinVoiceFor(t *testing.T, token string, voiceID string) *WSClient {
	t.Helper()
	ws, err := ConnectWS(token)
	if err != nil {
		t.Fatalf("ws connect: %v", err)
	}
	ws.Send("join_voice", map[string]any{"channel_id": voiceID})
	if _, err := ws.WaitFor("voice_state_update", wait); err != nil {
		t.Fatalf("no voice_state_update on join: %v", err)
	}
	// Drain the webrtc_offer that the SFU sends; we don't answer it
	// because validation tests don't run a real WebRTC peer.
	if _, err := ws.WaitFor("webrtc_offer", wait); err != nil {
		t.Fatalf("no webrtc_offer on join: %v", err)
	}
	return ws
}

// matchSource returns a predicate matching voice_audio_source_added /
// _removed events for the given user. Works for both events because
// both carry user_id at the top level.
func matchSource(userID string) func(json.RawMessage) bool {
	return func(raw json.RawMessage) bool {
		m := parseData(raw)
		return jsonStr(m, "user_id") == userID
	}
}

// ============================================================
// AUDIO SHARE SCENARIOS
// ============================================================

// Scenario 1: Alice starts a share, Bob receives voice_audio_source_added.
func TestScenarioAudioShare01_StartBroadcasts(t *testing.T) {
	ensureUsers(t)

	aliceWS, err := ConnectWS(aliceToken)
	if err != nil {
		t.Fatalf("alice ws: %v", err)
	}
	defer aliceWS.Close()

	voiceID := findVoiceChannel(aliceWS.Ready)
	aliceWS.Send("join_voice", map[string]any{"channel_id": voiceID})
	aliceWS.WaitFor("voice_state_update", wait)
	aliceWS.WaitFor("webrtc_offer", wait)

	bobWS := joinVoiceFor(t, bobToken, voiceID)
	defer bobWS.Close()

	// Drain alice's voice_state_update from bob's queue
	bobWS.WaitForMatch("voice_state_update", matchSource(aliceID), wait)

	aliceWS.Send("voice_share_audio_start", map[string]any{"label": "Spotify"})

	data, err := bobWS.WaitForMatch(
		"voice_audio_source_added", matchSource(aliceID), wait,
	)
	if err != nil {
		t.Fatalf("bob did not receive voice_audio_source_added: %v", err)
	}
	src := parseData(data)
	if jsonStr(src, "label") != "Spotify" {
		t.Errorf("expected label Spotify, got %q", jsonStr(src, "label"))
	}
	if jsonStr(src, "source_id") == "" {
		t.Error("expected non-empty source_id")
	}

	// Cleanup
	aliceWS.Send("leave_voice", map[string]any{})
	bobWS.Send("leave_voice", map[string]any{})
}

// Scenario 2: Alice stops a share, Bob receives voice_audio_source_removed.
func TestScenarioAudioShare02_StopBroadcasts(t *testing.T) {
	ensureUsers(t)

	aliceWS := joinVoiceFor(t, aliceToken, findVoiceChannelForToken(t, aliceToken))
	defer aliceWS.Close()
	bobWS := joinVoiceFor(t, bobToken, findVoiceChannelForToken(t, bobToken))
	defer bobWS.Close()

	aliceWS.Send("voice_share_audio_start", map[string]any{"label": "Spotify"})
	addedData, err := bobWS.WaitForMatch(
		"voice_audio_source_added", matchSource(aliceID), wait,
	)
	if err != nil {
		t.Fatalf("no voice_audio_source_added: %v", err)
	}
	addedSourceID := jsonStr(parseData(addedData), "source_id")

	aliceWS.Send("voice_share_audio_stop", map[string]any{})
	rmData, err := bobWS.WaitForMatch(
		"voice_audio_source_removed", matchSource(aliceID), wait,
	)
	if err != nil {
		t.Fatalf("no voice_audio_source_removed: %v", err)
	}
	if jsonStr(parseData(rmData), "source_id") != addedSourceID {
		t.Error("source_id mismatch between added and removed")
	}

	aliceWS.Send("leave_voice", map[string]any{})
	bobWS.Send("leave_voice", map[string]any{})
}

// Scenario 3: Stopping a share when none is active is a no-op.
func TestScenarioAudioShare03_StopWithoutActiveIsNoop(t *testing.T) {
	ensureUsers(t)

	aliceWS := joinVoiceFor(t, aliceToken, findVoiceChannelForToken(t, aliceToken))
	defer aliceWS.Close()
	bobWS := joinVoiceFor(t, bobToken, findVoiceChannelForToken(t, bobToken))
	defer bobWS.Close()

	bobWS.Drain()
	aliceWS.Send("voice_share_audio_stop", map[string]any{})

	// Bob should NOT receive voice_audio_source_removed within the
	// short wait window. We use a 500ms timeout via a tiny WaitFor
	// dance; if no event arrives, the test passes.
	if _, err := bobWS.WaitForMatch(
		"voice_audio_source_removed", matchSource(aliceID), shortNoEvent, // 500ms in ns
	); err == nil {
		t.Error("expected no removal event when no share was active")
	}

	aliceWS.Send("leave_voice", map[string]any{})
	bobWS.Send("leave_voice", map[string]any{})
}

// Scenario 4: Starting a second share fails (one share per user in v1).
func TestScenarioAudioShare04_DoubleStartFails(t *testing.T) {
	ensureUsers(t)

	aliceWS := joinVoiceFor(t, aliceToken, findVoiceChannelForToken(t, aliceToken))
	defer aliceWS.Close()

	aliceWS.Send("voice_share_audio_start", map[string]any{"label": "First"})
	if _, err := aliceWS.WaitForMatch(
		"voice_audio_source_added", matchSource(aliceID), wait,
	); err != nil {
		t.Fatalf("first start failed: %v", err)
	}

	aliceWS.Send("voice_share_audio_start", map[string]any{"label": "Second"})
	errData, err := aliceWS.WaitFor("error", wait)
	if err != nil {
		t.Fatalf("expected error event for second start, got: %v", err)
	}
	em := parseData(errData)
	if jsonStr(em, "op") != "voice_share_audio_start" {
		t.Errorf("unexpected error op: %q", jsonStr(em, "op"))
	}

	aliceWS.Send("voice_share_audio_stop", map[string]any{})
	aliceWS.Send("leave_voice", map[string]any{})
}

// Scenario 5: Share auto-stops when the user leaves voice.
func TestScenarioAudioShare05_AutoStopOnLeaveVoice(t *testing.T) {
	ensureUsers(t)

	aliceWS := joinVoiceFor(t, aliceToken, findVoiceChannelForToken(t, aliceToken))
	defer aliceWS.Close()
	bobWS := joinVoiceFor(t, bobToken, findVoiceChannelForToken(t, bobToken))
	defer bobWS.Close()

	aliceWS.Send("voice_share_audio_start", map[string]any{"label": "Spotify"})
	bobWS.WaitForMatch("voice_audio_source_added", matchSource(aliceID), wait)

	aliceWS.Send("leave_voice", map[string]any{})

	if _, err := bobWS.WaitForMatch(
		"voice_audio_source_removed", matchSource(aliceID), wait,
	); err != nil {
		t.Fatalf("bob did not see audio source removed on leave: %v", err)
	}
	bobWS.Send("leave_voice", map[string]any{})
}

// Scenario 6: Share auto-stops when WebSocket disconnects.
func TestScenarioAudioShare06_AutoStopOnDisconnect(t *testing.T) {
	ensureUsers(t)

	aliceWS := joinVoiceFor(t, aliceToken, findVoiceChannelForToken(t, aliceToken))
	bobWS := joinVoiceFor(t, bobToken, findVoiceChannelForToken(t, bobToken))
	defer bobWS.Close()

	aliceWS.Send("voice_share_audio_start", map[string]any{"label": "Spotify"})
	bobWS.WaitForMatch("voice_audio_source_added", matchSource(aliceID), wait)

	aliceWS.Close()

	if _, err := bobWS.WaitForMatch(
		"voice_audio_source_removed", matchSource(aliceID), wait,
	); err != nil {
		t.Fatalf("bob did not see audio source removed on disconnect: %v", err)
	}
	bobWS.Send("leave_voice", map[string]any{})
}

// Scenario 7: Share auto-stops when user joins a different voice channel.
func TestScenarioAudioShare07_AutoStopOnChannelSwitch(t *testing.T) {
	ensureAdmin(t)
	ensureUsers(t)

	// We need two voice channels. The default seed setup has one;
	// admin creates a second.
	adminWS, err := ConnectWS(adminToken)
	if err != nil {
		t.Fatalf("admin ws: %v", err)
	}
	defer adminWS.Close()

	chName := uniqueName("voice2")
	adminWS.Send("create_channel", map[string]any{
		"name": chName,
		"type": "voice",
	})
	createdData, err := adminWS.WaitForMatch("channel_create", func(raw json.RawMessage) bool {
		m := parseData(raw)
		return jsonStr(m, "name") == chName
	}, wait)
	if err != nil {
		t.Fatalf("did not see new voice channel: %v", err)
	}
	voice2ID := jsonStr(parseData(createdData), "id")

	voice1ID := findVoiceChannelForToken(t, aliceToken)

	aliceWS := joinVoiceFor(t, aliceToken, voice1ID)
	defer aliceWS.Close()
	bobWS := joinVoiceFor(t, bobToken, voice1ID)
	defer bobWS.Close()

	aliceWS.Send("voice_share_audio_start", map[string]any{"label": "Spotify"})
	bobWS.WaitForMatch("voice_audio_source_added", matchSource(aliceID), wait)

	// Alice switches to a different voice channel
	aliceWS.Send("join_voice", map[string]any{"channel_id": voice2ID})

	if _, err := bobWS.WaitForMatch(
		"voice_audio_source_removed", matchSource(aliceID), wait,
	); err != nil {
		t.Fatalf("bob did not see audio source removed on channel switch: %v", err)
	}

	aliceWS.Send("leave_voice", map[string]any{})
	bobWS.Send("leave_voice", map[string]any{})
}

// Scenario 8: Cannot start audio share when not in a voice channel.
func TestScenarioAudioShare08_NotInVoiceFails(t *testing.T) {
	ensureUsers(t)

	aliceWS, err := ConnectWS(aliceToken)
	if err != nil {
		t.Fatalf("ws: %v", err)
	}
	defer aliceWS.Close()

	aliceWS.Send("voice_share_audio_start", map[string]any{"label": "Spotify"})
	errData, err := aliceWS.WaitFor("error", wait)
	if err != nil {
		t.Fatalf("expected error event, got: %v", err)
	}
	em := parseData(errData)
	if jsonStr(em, "op") != "voice_share_audio_start" {
		t.Errorf("wrong error op: %q", jsonStr(em, "op"))
	}
	if !strings.Contains(jsonStr(em, "reason"), "not in voice") {
		t.Errorf("expected 'not in voice' reason, got %q", jsonStr(em, "reason"))
	}
}

// Scenario 9: Mic mute does not stop active audio share.
func TestScenarioAudioShare09_MicMuteDoesNotStopShare(t *testing.T) {
	ensureUsers(t)

	aliceWS := joinVoiceFor(t, aliceToken, findVoiceChannelForToken(t, aliceToken))
	defer aliceWS.Close()
	bobWS := joinVoiceFor(t, bobToken, findVoiceChannelForToken(t, bobToken))
	defer bobWS.Close()

	aliceWS.Send("voice_share_audio_start", map[string]any{"label": "Spotify"})
	bobWS.WaitForMatch("voice_audio_source_added", matchSource(aliceID), wait)

	aliceWS.Send("voice_self_mute", map[string]any{"muted": true})
	if _, err := bobWS.WaitForMatch("voice_state_update", func(raw json.RawMessage) bool {
		m := parseData(raw)
		return jsonStr(m, "user_id") == aliceID && jsonBool(m, "self_mute")
	}, wait); err != nil {
		t.Fatalf("no voice_state_update for mute: %v", err)
	}

	if _, err := bobWS.WaitForMatch(
		"voice_audio_source_removed", matchSource(aliceID), shortNoEvent,
	); err == nil {
		t.Error("share should not be removed when mic is muted")
	}

	aliceWS.Send("leave_voice", map[string]any{})
	bobWS.Send("leave_voice", map[string]any{})
}

// Scenario 10: Stopping audio share does not affect mic state.
func TestScenarioAudioShare10_StopShareDoesNotAffectMic(t *testing.T) {
	ensureUsers(t)

	aliceWS := joinVoiceFor(t, aliceToken, findVoiceChannelForToken(t, aliceToken))
	defer aliceWS.Close()
	bobWS := joinVoiceFor(t, bobToken, findVoiceChannelForToken(t, bobToken))
	defer bobWS.Close()

	aliceWS.Send("voice_share_audio_start", map[string]any{"label": "Spotify"})
	bobWS.WaitForMatch("voice_audio_source_added", matchSource(aliceID), wait)

	bobWS.Drain()
	aliceWS.Send("voice_share_audio_stop", map[string]any{})
	if _, err := bobWS.WaitForMatch(
		"voice_audio_source_removed", matchSource(aliceID), wait,
	); err != nil {
		t.Fatalf("no removal: %v", err)
	}

	if _, err := bobWS.WaitForMatch("voice_state_update", matchSource(aliceID),
		shortNoEvent); err == nil {
		t.Error("voice_state_update should not be broadcast when share stops")
	}

	aliceWS.Send("leave_voice", map[string]any{})
	bobWS.Send("leave_voice", map[string]any{})
}

// Scenario 11: Empty label is rejected.
func TestScenarioAudioShare11_EmptyLabelRejected(t *testing.T) {
	ensureUsers(t)

	aliceWS := joinVoiceFor(t, aliceToken, findVoiceChannelForToken(t, aliceToken))
	defer aliceWS.Close()

	aliceWS.Send("voice_share_audio_start", map[string]any{"label": ""})
	errData, err := aliceWS.WaitFor("error", wait)
	if err != nil {
		t.Fatalf("expected error event: %v", err)
	}
	em := parseData(errData)
	if !strings.Contains(jsonStr(em, "reason"), "label required") {
		t.Errorf("expected 'label required', got %q", jsonStr(em, "reason"))
	}

	aliceWS.Send("leave_voice", map[string]any{})
}

// Scenario 12: Label longer than 64 chars is truncated.
func TestScenarioAudioShare12_LabelTruncated(t *testing.T) {
	ensureUsers(t)

	aliceWS := joinVoiceFor(t, aliceToken, findVoiceChannelForToken(t, aliceToken))
	defer aliceWS.Close()
	bobWS := joinVoiceFor(t, bobToken, findVoiceChannelForToken(t, bobToken))
	defer bobWS.Close()

	longLabel := strings.Repeat("x", 200)
	aliceWS.Send("voice_share_audio_start", map[string]any{"label": longLabel})
	data, err := bobWS.WaitForMatch(
		"voice_audio_source_added", matchSource(aliceID), wait,
	)
	if err != nil {
		t.Fatalf("no add event: %v", err)
	}
	got := jsonStr(parseData(data), "label")
	if len(got) != 64 {
		t.Errorf("expected label truncated to 64 chars, got len=%d (%q)", len(got), got)
	}

	aliceWS.Send("voice_share_audio_stop", map[string]any{})
	aliceWS.Send("leave_voice", map[string]any{})
	bobWS.Send("leave_voice", map[string]any{})
}

// Scenario 13: Ready snapshot includes active shares for the room.
func TestScenarioAudioShare13_ReadySnapshotIncludesShares(t *testing.T) {
	ensureUsers(t)

	aliceWS := joinVoiceFor(t, aliceToken, findVoiceChannelForToken(t, aliceToken))
	defer aliceWS.Close()

	aliceWS.Send("voice_share_audio_start", map[string]any{"label": "Spotify"})
	if _, err := aliceWS.WaitForMatch(
		"voice_audio_source_added", matchSource(aliceID), wait,
	); err != nil {
		t.Fatalf("alice did not see her own add: %v", err)
	}

	// Carol connects fresh — her ready payload should include the
	// active share.
	carolWS, err := ConnectWS(bobToken)
	if err != nil {
		t.Fatalf("carol ws: %v", err)
	}
	defer carolWS.Close()

	sources := jsonArray(carolWS.Ready, "audio_sources")
	found := false
	for _, s := range sources {
		m, _ := s.(map[string]any)
		if m == nil {
			continue
		}
		if jsonStr(m, "user_id") == aliceID {
			found = true
			if jsonStr(m, "label") != "Spotify" {
				t.Errorf("expected label Spotify, got %q", jsonStr(m, "label"))
			}
			if jsonStr(m, "source_id") == "" {
				t.Error("expected non-empty source_id in ready replay")
			}
		}
	}
	if !found {
		t.Errorf("active share not present in ready.audio_sources: %v", sources)
	}

	aliceWS.Send("voice_share_audio_stop", map[string]any{})
	aliceWS.Send("leave_voice", map[string]any{})
}

// findVoiceChannelForToken connects briefly to look up a voice channel ID
// from the given user's ready snapshot. Used in tests that only need
// the channel ID before starting their real WS dance.
func findVoiceChannelForToken(t *testing.T, token string) string {
	t.Helper()
	ws, err := ConnectWS(token)
	if err != nil {
		t.Fatalf("ws: %v", err)
	}
	defer ws.Close()
	id := findVoiceChannel(ws.Ready)
	if id == "" {
		t.Fatal("no voice channel in ready")
	}
	return id
}
