package validation

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"
)

// ============================================================
// MCP RADIO SCENARIOS — specs/scenarios/mcp-scenarios.md (R01-R08)
// ============================================================

// fakeMP3 is sniffed as audio/mpeg by http.DetectContentType (ID3 header).
func fakeMP3(seed byte) []byte {
	b := make([]byte, 4096)
	copy(b, "ID3\x03\x00\x00\x00\x00\x00\x00")
	for i := 10; i < len(b); i++ {
		b[i] = seed
	}
	return b
}

// uploadTrack posts an audio file with an explicit duration to a playlist.
func uploadTrack(t *testing.T, token, playlistID, filename string, data []byte, duration float64) string {
	t.Helper()
	status, id, raw := uploadTrackRaw(token, playlistID, filename, data, duration)
	if status != 201 && status != 200 {
		t.Fatalf("upload track: expected 2xx, got %d: %s", status, raw)
	}
	return id
}

// uploadTrackRaw is uploadTrack without assertions; returns status, id, body.
func uploadTrackRaw(token, playlistID, filename string, data []byte, duration float64) (int, string, string) {
	body := &bytes.Buffer{}
	boundary := "----RadioBoundary"
	body.WriteString("--" + boundary + "\r\n")
	body.WriteString("Content-Disposition: form-data; name=\"duration\"\r\n\r\n")
	body.WriteString(fmt.Sprintf("%g", duration))
	body.WriteString("\r\n--" + boundary + "\r\n")
	body.WriteString(fmt.Sprintf("Content-Disposition: form-data; name=\"file\"; filename=%q\r\n", filename))
	body.WriteString("Content-Type: audio/mpeg\r\n\r\n")
	body.Write(data)
	body.WriteString("\r\n--" + boundary + "--\r\n")

	req, _ := http.NewRequest("POST", serverURL+"/api/v1/radio/playlists/"+playlistID+"/tracks", body)
	req.Header.Set("Content-Type", "multipart/form-data; boundary="+boundary)
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("X-Real-IP", fmt.Sprintf("10.6.0.%d", nameCounter.Add(1)%250+1))
	resp, err := (&http.Client{Timeout: 15 * time.Second}).Do(req)
	if err != nil {
		return 0, "", err.Error()
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	var out map[string]any
	json.Unmarshal(raw, &out)
	return resp.StatusCode, jsonStr(out, "id"), string(raw)
}

// radioJSON decodes a tool's text result.
func radioJSON(t *testing.T, text string) map[string]any {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal([]byte(text), &m); err != nil {
		t.Fatalf("tool result is not JSON: %s", text)
	}
	return m
}

// setupStation creates a station with one playlist holding two tracks as
// alice, and returns (aliceKey, stationID, playlistID, trackIDs).
func setupStation(t *testing.T) (string, string, string, []string) {
	t.Helper()
	ensureUsers(t)
	key := createAPIKey(t, aliceToken, "radio")
	name := uniqueName("mcp_station")

	text, isErr := mcpToolText(t, key, "create_station", map[string]any{"name": name})
	if isErr {
		t.Fatalf("create_station: %s", text)
	}
	st := radioJSON(t, text)
	stationID := jsonStr(st, "id")
	if !jsonBool(st, "you_can_manage") {
		t.Fatalf("creator should manage the station: %s", text)
	}

	text, isErr = mcpToolText(t, key, "create_playlist", map[string]any{"station": name, "name": "Set A"})
	if isErr {
		t.Fatalf("create_playlist: %s", text)
	}
	playlistID := jsonStr(radioJSON(t, text), "id")

	t1 := uploadTrack(t, aliceToken, playlistID, "one.mp3", fakeMP3(1), 120)
	t2 := uploadTrack(t, aliceToken, playlistID, "two.mp3", fakeMP3(2), 90)
	return key, stationID, playlistID, []string{t1, t2}
}

// Scenario R01: Station and playlist creation through MCP, visible in status.
func TestScenarioMCPR01_CreateAndStatus(t *testing.T) {
	key, stationID, playlistID, tracks := setupStation(t)

	text, isErr := mcpToolText(t, key, "station_status", map[string]any{"station": stationID})
	if isErr {
		t.Fatalf("station_status: %s", text)
	}
	st := radioJSON(t, text)
	pls := jsonArray(st, "playlists")
	if len(pls) != 1 {
		t.Fatalf("expected 1 playlist, got %d: %s", len(pls), text)
	}
	pl := pls[0].(map[string]any)
	if jsonStr(pl, "id") != playlistID || len(jsonArray(pl, "tracks")) != 2 {
		t.Fatalf("playlist/tracks mismatch: %s", text)
	}
	if st["playback"] != nil {
		t.Fatalf("new station should be idle: %s", text)
	}
	_ = tracks

	text, _ = mcpToolText(t, key, "list_stations", nil)
	if !strings.Contains(text, stationID) {
		t.Fatalf("list_stations missing the new station: %s", text)
	}
}

// Scenario R02: Play, pause, resume, seek, next, stop round trip.
func TestScenarioMCPR02_PlaybackRoundTrip(t *testing.T) {
	key, stationID, _, tracks := setupStation(t)

	// A listener tuned to the station receives the playback events.
	bobWS, _ := ConnectWS(bobToken)
	defer bobWS.Close()
	bobWS.Send("radio_tune", map[string]any{"station_id": stationID})
	bobWS.WaitFor("radio_listeners", wait)

	text, isErr := mcpToolText(t, key, "radio_play", map[string]any{"station": stationID})
	if isErr {
		t.Fatalf("radio_play: %s", text)
	}
	res := radioJSON(t, text)
	pb := jsonMap(res, "playback")
	if !jsonBool(pb, "playing") || jsonStr(pb, "track_id") != tracks[0] {
		t.Fatalf("expected first track playing: %s", text)
	}
	if _, err := bobWS.WaitForMatch("radio_playback", func(raw json.RawMessage) bool {
		return jsonStr(parseData(raw), "station_id") == stationID && jsonBool(parseData(raw), "playing")
	}, wait); err != nil {
		t.Fatalf("listener did not get radio_playback: %v", err)
	}

	text, isErr = mcpToolText(t, key, "radio_pause", map[string]any{"station": stationID})
	if isErr || jsonBool(jsonMap(radioJSON(t, text), "playback"), "playing") {
		t.Fatalf("radio_pause: err=%v %s", isErr, text)
	}

	text, isErr = mcpToolText(t, key, "radio_seek", map[string]any{"station": stationID, "position": 42})
	if isErr {
		t.Fatalf("radio_seek: %s", text)
	}
	if pos, _ := jsonMap(radioJSON(t, text), "playback")["position_seconds"].(float64); pos < 41.9 || pos > 42.1 {
		t.Fatalf("seek position not applied: %s", text)
	}

	text, isErr = mcpToolText(t, key, "radio_resume", map[string]any{"station": stationID})
	if isErr || !jsonBool(jsonMap(radioJSON(t, text), "playback"), "playing") {
		t.Fatalf("radio_resume: err=%v %s", isErr, text)
	}

	text, isErr = mcpToolText(t, key, "radio_next", map[string]any{"station": stationID})
	if isErr {
		t.Fatalf("radio_next: %s", text)
	}
	if jsonStr(jsonMap(radioJSON(t, text), "playback"), "track_id") != tracks[1] {
		t.Fatalf("expected second track after next: %s", text)
	}

	text, isErr = mcpToolText(t, key, "radio_stop", map[string]any{"station": stationID})
	if isErr || radioJSON(t, text)["playback"] != "stopped" {
		t.Fatalf("radio_stop: err=%v %s", isErr, text)
	}
	if _, err := bobWS.WaitForMatch("radio_playback", func(raw json.RawMessage) bool {
		m := parseData(raw)
		return jsonStr(m, "station_id") == stationID && jsonBool(m, "stopped")
	}, wait); err != nil {
		t.Fatalf("listener did not get stopped event: %v", err)
	}

	// Controls on an idle station report clearly.
	if text, isErr := mcpToolText(t, key, "radio_pause", map[string]any{"station": stationID}); !isErr {
		t.Fatalf("pause on idle station should be a tool error, got %s", text)
	}
}

// Scenario R03: Non-managers are refused until public controls are enabled.
func TestScenarioMCPR03_PlaybackACL(t *testing.T) {
	aliceKey, stationID, _, _ := setupStation(t)
	bobKey := createAPIKey(t, bobToken, "radio-bob")

	if text, isErr := mcpToolText(t, bobKey, "radio_play", map[string]any{"station": stationID}); !isErr || !strings.Contains(text, "not a manager") {
		t.Fatalf("bob should be refused: err=%v %s", isErr, text)
	}
	if text, isErr := mcpToolText(t, bobKey, "set_public_controls", map[string]any{"station": stationID, "enabled": true}); !isErr {
		t.Fatalf("bob must not toggle public controls: %s", text)
	}
	if text, isErr := mcpToolText(t, bobKey, "set_station_mode", map[string]any{"station": stationID, "mode": "loop_all"}); !isErr {
		t.Fatalf("bob must not change the mode: %s", text)
	}

	text, isErr := mcpToolText(t, aliceKey, "set_public_controls", map[string]any{"station": stationID, "enabled": true})
	if isErr || !jsonBool(radioJSON(t, text), "public_controls") {
		t.Fatalf("alice set_public_controls: err=%v %s", isErr, text)
	}
	text, isErr = mcpToolText(t, bobKey, "radio_play", map[string]any{"station": stationID})
	if isErr {
		t.Fatalf("bob should control a public station: %s", text)
	}
	mcpToolText(t, aliceKey, "radio_stop", map[string]any{"station": stationID})
}

// Scenario R04: Playback mode is validated and applied.
func TestScenarioMCPR04_PlaybackMode(t *testing.T) {
	key, stationID, _, _ := setupStation(t)
	if text, isErr := mcpToolText(t, key, "set_station_mode", map[string]any{"station": stationID, "mode": "shuffle"}); !isErr {
		t.Fatalf("invalid mode accepted: %s", text)
	}
	text, isErr := mcpToolText(t, key, "set_station_mode", map[string]any{"station": stationID, "mode": "loop_one"})
	if isErr || jsonStr(radioJSON(t, text), "playback_mode") != "loop_one" {
		t.Fatalf("set_station_mode: err=%v %s", isErr, text)
	}
	// loop_one: skipping past the last track restarts the playlist instead of stopping.
	mcpToolText(t, key, "radio_play", map[string]any{"station": stationID})
	mcpToolText(t, key, "radio_next", map[string]any{"station": stationID})
	text, _ = mcpToolText(t, key, "radio_next", map[string]any{"station": stationID})
	pb := jsonMap(radioJSON(t, text), "playback")
	if pb == nil || int(pb["track_index"].(float64)) != 0 {
		t.Fatalf("loop_one should restart at track 0: %s", text)
	}
	mcpToolText(t, key, "radio_stop", map[string]any{"station": stationID})
}

// Scenario R05: Reorder validates the id set and applies the new order.
func TestScenarioMCPR05_ReorderTracks(t *testing.T) {
	key, stationID, playlistID, tracks := setupStation(t)
	if text, isErr := mcpToolText(t, key, "reorder_tracks", map[string]any{"station": stationID, "playlist": playlistID, "track_ids": []string{tracks[0]}}); !isErr {
		t.Fatalf("partial track list accepted: %s", text)
	}
	text, isErr := mcpToolText(t, key, "reorder_tracks", map[string]any{"station": stationID, "playlist": "Set A", "track_ids": []string{tracks[1], tracks[0]}})
	if isErr {
		t.Fatalf("reorder_tracks: %s", text)
	}
	got := jsonArray(radioJSON(t, text), "tracks")
	if len(got) != 2 || jsonStr(got[0].(map[string]any), "id") != tracks[1] {
		t.Fatalf("order not applied: %s", text)
	}

	bobKey := createAPIKey(t, bobToken, "radio-bob2")
	if text, isErr := mcpToolText(t, bobKey, "reorder_tracks", map[string]any{"station": stationID, "playlist": playlistID, "track_ids": []string{tracks[0], tracks[1]}}); !isErr {
		t.Fatalf("bob must not reorder alice's playlist: %s", text)
	}
}

// Scenario R06: Names resolve case-insensitively; unknown stations error.
func TestScenarioMCPR06_NameResolution(t *testing.T) {
	key, stationID, _, _ := setupStation(t)
	text, _ := mcpToolText(t, key, "station_status", map[string]any{"station": stationID})
	name := jsonStr(radioJSON(t, text), "name")
	text, isErr := mcpToolText(t, key, "station_status", map[string]any{"station": strings.ToUpper(name)})
	if isErr || jsonStr(radioJSON(t, text), "id") != stationID {
		t.Fatalf("case-insensitive name lookup failed: %s", text)
	}
	if text, isErr := mcpToolText(t, key, "station_status", map[string]any{"station": "no-such-station-xyz"}); !isErr {
		t.Fatalf("unknown station accepted: %s", text)
	}
	if text, isErr := mcpToolText(t, key, "create_station", map[string]any{"name": name}); !isErr {
		t.Fatalf("duplicate station name accepted: %s", text)
	}
}

// Scenario R07: Playing an empty playlist is refused with a clear message.
func TestScenarioMCPR07_EmptyPlaylist(t *testing.T) {
	ensureUsers(t)
	key := createAPIKey(t, aliceToken, "radio-empty")
	name := uniqueName("mcp_empty")
	mcpToolText(t, key, "create_station", map[string]any{"name": name})
	mcpToolText(t, key, "create_playlist", map[string]any{"station": name, "name": "Nothing"})
	if text, isErr := mcpToolText(t, key, "radio_play", map[string]any{"station": name}); !isErr || !strings.Contains(text, "no playlist with tracks") {
		t.Fatalf("expected empty-station error: err=%v %s", isErr, text)
	}
	if text, isErr := mcpToolText(t, key, "radio_play", map[string]any{"station": name, "playlist": "Nothing"}); !isErr || !strings.Contains(text, "no tracks") {
		t.Fatalf("expected empty-playlist error: err=%v %s", isErr, text)
	}
}

// Scenario R08: Radio tools are advertised by tools/list.
func TestScenarioMCPR08_ToolsAdvertised(t *testing.T) {
	ensureUsers(t)
	key := createAPIKey(t, aliceToken, "radio-list")
	_, resp := mcpCall(t, key, "tools/list", nil)
	names := map[string]bool{}
	for _, tl := range jsonArray(jsonMap(resp, "result"), "tools") {
		names[jsonStr(tl.(map[string]any), "name")] = true
	}
	for _, want := range []string{"list_stations", "station_status", "create_station", "create_playlist", "radio_play", "radio_pause", "radio_resume", "radio_next", "radio_seek", "radio_stop", "set_station_mode", "set_public_controls", "reorder_tracks"} {
		if !names[want] {
			t.Fatalf("tools/list missing %s", want)
		}
	}
}

// Scenario R09: API keys add and remove tracks over REST.
func TestScenarioMCPR09_APIKeyTrackUpload(t *testing.T) {
	aliceKey, _, playlistID, _ := setupStation(t)
	bobKey := createAPIKey(t, bobToken, "radio-bob3")

	status, trackID, raw := uploadTrackRaw(aliceKey, playlistID, "three.mp3", fakeMP3(3), 60)
	if status != 200 || trackID == "" {
		t.Fatalf("alice key upload: expected 200, got %d: %s", status, raw)
	}
	if status, _, _ := uploadTrackRaw(bobKey, playlistID, "evil.mp3", fakeMP3(4), 60); status != 403 {
		t.Fatalf("bob key upload to alice's playlist: expected 403, got %d", status)
	}
	if status, _, _ := uploadTrackRaw("lfp_doesnotexist", playlistID, "x.mp3", fakeMP3(5), 60); status != 401 {
		t.Fatalf("unknown key: expected 401, got %d", status)
	}

	c := NewHTTPClient()
	c.Token = aliceKey
	if status, _, _ := c.DeleteJSON("/api/v1/radio/tracks/" + trackID); status != 200 {
		t.Fatalf("alice key delete track: expected 200, got %d", status)
	}
	if status, _, _ := c.GetJSON("/api/v1/channels"); status != 401 {
		t.Fatalf("api key on unrelated REST endpoint: expected 401, got %d", status)
	}
}
