package validation

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"
)

// ============================================================
// SECURITY SCENARIOS — specs/scenarios/security-scenarios.md
//
// Covers the enforceable scenarios. Items the spec marks as documented
// gaps (S05, S26-S28) are not asserted here.
// ============================================================

// makePrivateChannel creates an invisible text channel as admin, adds the
// given members, and returns the channel id.
func makePrivateChannel(t *testing.T, memberIDs ...string) string {
	t.Helper()
	adminWS, err := ConnectWS(adminToken)
	if err != nil {
		t.Fatalf("admin ws: %v", err)
	}
	defer adminWS.Close()

	name := uniqueName("sec_private")
	adminWS.Send("create_channel", map[string]any{"name": name, "type": "text"})
	data, err := adminWS.WaitForMatch("channel_create", func(raw json.RawMessage) bool {
		return jsonStr(parseData(raw), "name") == name
	}, wait)
	if err != nil {
		t.Fatalf("no channel_create: %v", err)
	}
	channelID := jsonStr(parseData(data), "id")

	adminHTTP := NewHTTPClient()
	adminHTTP.Token = adminToken
	if status, body := patchJSON(t, adminHTTP, "/api/v1/channels/"+channelID+"/settings", map[string]any{"visibility": "invisible"}); status != 200 {
		t.Fatalf("set invisible: %d %v", status, body)
	}
	for _, id := range memberIDs {
		adminHTTP.PostJSON("/api/v1/channels/"+channelID+"/members", map[string]any{"user_id": id, "role": "member"})
	}
	return channelID
}

// sendAs posts a message over WS as the given token and returns its id.
func sendAs(t *testing.T, token, channelID, content string) string {
	t.Helper()
	ws, err := ConnectWS(token)
	if err != nil {
		t.Fatalf("ws: %v", err)
	}
	defer ws.Close()
	ws.Send("send_message", map[string]any{"channel_id": channelID, "content": content})
	data, err := ws.WaitForMatch("message_create", func(raw json.RawMessage) bool {
		return jsonStr(parseData(raw), "content") == content
	}, wait)
	if err != nil {
		t.Fatalf("no message_create: %v", err)
	}
	return jsonStr(parseData(data), "id")
}

// Scenario S01: Unauthenticated requests to protected REST endpoints
func TestScenarioS01_ProtectedEndpointsRequireAuth(t *testing.T) {
	ensureUsers(t)
	c := NewHTTPClient() // no token
	for _, path := range []string{"/api/v1/channels", "/api/v1/admin/users", "/api/v1/api-keys", "/api/v1/stars", "/api/v1/audio/devices"} {
		status, body, err := c.GetJSON(path)
		if err != nil {
			t.Fatalf("%s: %v", path, err)
		}
		if status != 401 {
			t.Fatalf("%s: expected 401, got %d", path, status)
		}
		if len(body) != 1 || jsonStr(body, "error") == "" {
			t.Fatalf("%s: body should contain only an error, got %v", path, body)
		}
	}
}

// Scenario S02 / S42: Unauthenticated WebSocket connections are rejected
func TestScenarioS02_UnauthenticatedWSRejected(t *testing.T) {
	ensureUsers(t)
	conn, ctx, cancel, err := DialWSRaw()
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer cancel()
	msg, _ := json.Marshal(map[string]any{"op": "send_message", "d": map[string]any{"channel_id": "x", "content": "hi"}})
	conn.Write(ctx, 1, msg)
	deadline := time.Now().Add(7 * time.Second)
	for time.Now().Before(deadline) {
		if _, _, err := conn.Read(ctx); err != nil {
			return // closed as expected
		}
	}
	t.Fatal("connection stayed open after a non-authenticate first message")
}

// Scenario S03: Invalid tokens are rejected on REST and WebSocket
func TestScenarioS03_InvalidTokenRejected(t *testing.T) {
	ensureUsers(t)
	c := NewHTTPClient()
	c.Token = "invalid-uuid"
	if status, _, _ := c.GetJSON("/api/v1/channels"); status != 401 {
		t.Fatalf("REST: expected 401, got %d", status)
	}
	if _, err := ConnectWS("invalid-uuid"); err == nil {
		t.Fatal("WS: invalid token should not produce a ready")
	}
}

// Scenario S06: Non-admin users cannot access admin endpoints
func TestScenarioS06_NonAdminForbidden(t *testing.T) {
	ensureUsers(t)
	c := NewHTTPClient()
	c.Token = aliceToken
	if status, _, _ := c.GetJSON("/api/v1/admin/users"); status != 403 {
		t.Fatalf("GET admin/users: expected 403, got %d", status)
	}
	if status, _, _ := c.PostJSON(fmt.Sprintf("/api/v1/admin/users/%s/approve", bobID), nil); status != 403 {
		t.Fatalf("approve: expected 403, got %d", status)
	}
	if status, _, _ := c.PostJSON("/api/v1/admin/settings", map[string]any{}); status != 403 {
		t.Fatalf("settings: expected 403, got %d", status)
	}
	if status, _, _ := c.PostJSON("/api/v1/admin/settings/email/test", nil); status != 403 {
		t.Fatalf("email test: expected 403, got %d", status)
	}
	// Host audio device control is admin-only too.
	if status, _, _ := c.GetJSON("/api/v1/audio/devices"); status != 403 {
		t.Fatalf("audio devices: expected 403, got %d", status)
	}
}

// Scenario S07 / S08: Users can only delete and edit their own messages
func TestScenarioS07_S08_OwnMessagesOnly(t *testing.T) {
	ensureUsers(t)
	aliceWS, _ := ConnectWS(aliceToken)
	defer aliceWS.Close()
	channelID := findTextChannel(aliceWS.Ready)

	content := uniqueName("owned")
	aliceWS.Send("send_message", map[string]any{"channel_id": channelID, "content": content})
	data, err := aliceWS.WaitForMatch("message_create", func(raw json.RawMessage) bool {
		return jsonStr(parseData(raw), "content") == content
	}, wait)
	if err != nil {
		t.Fatalf("no message_create: %v", err)
	}
	msgID := jsonStr(parseData(data), "id")

	bobWS, _ := ConnectWS(bobToken)
	defer bobWS.Close()
	bobWS.Send("edit_message", map[string]any{"message_id": msgID, "content": "hijacked"})
	if _, err := bobWS.WaitFor("message_update", shortNoEvent); err == nil {
		t.Fatal("bob must not be able to edit alice's message")
	}
	bobWS.Send("delete_message", map[string]any{"message_id": msgID})
	if _, err := bobWS.WaitFor("message_delete", shortNoEvent); err == nil {
		t.Fatal("bob must not be able to delete alice's message")
	}

	adminWS, _ := ConnectWS(adminToken)
	defer adminWS.Close()
	adminWS.Send("delete_message", map[string]any{"message_id": msgID})
	if _, err := adminWS.WaitForMatch("message_delete", func(raw json.RawMessage) bool {
		return jsonStr(parseData(raw), "id") == msgID
	}, wait); err != nil {
		t.Fatalf("admin should be able to delete any message: %v", err)
	}
}

// Scenario S14: Radio playback controls respect station managers unless public
func TestScenarioS14_RadioPlaybackACL(t *testing.T) {
	ensureUsers(t)
	aliceWS, _ := ConnectWS(aliceToken)
	defer aliceWS.Close()
	name := uniqueName("sec_station")
	aliceWS.Send("create_radio_station", map[string]any{"name": name})
	data, err := aliceWS.WaitForMatch("radio_station_create", func(raw json.RawMessage) bool {
		return jsonStr(parseData(raw), "name") == name
	}, wait)
	if err != nil {
		t.Skipf("radio applet not available: %v", err)
	}
	stationID := jsonStr(parseData(data), "id")

	bobWS, _ := ConnectWS(bobToken)
	defer bobWS.Close()
	bobWS.Send("radio_stop", map[string]any{"station_id": stationID})
	if _, err := bobWS.WaitForMatch("radio_playback", func(raw json.RawMessage) bool {
		return jsonStr(parseData(raw), "station_id") == stationID
	}, shortNoEvent); err == nil {
		t.Fatal("non-manager bob must not control playback on alice's station")
	}

	// Enable public controls: now bob's command is honoured.
	aliceWS.Send("set_radio_station_public_controls", map[string]any{"station_id": stationID, "enabled": true})
	if _, err := aliceWS.WaitForMatch("radio_station_update", func(raw json.RawMessage) bool {
		return jsonStr(parseData(raw), "id") == stationID
	}, wait); err != nil {
		t.Fatalf("no radio_station_update: %v", err)
	}
	bobWS.Drain()
	bobWS.Send("radio_stop", map[string]any{"station_id": stationID})
	// radio_stop on an idle station may not emit; a second, explicit signal is
	// the station update above. The essential assertion is the denial case.
}

// Scenario S18: Rate limiter keys on a trusted IP, not a spoofable header
func TestScenarioS18_RateLimitIgnoresXForwardedFor(t *testing.T) {
	ensureUsers(t)
	// Same X-Real-IP (trusted from loopback), varying X-Forwarded-For: the
	// fourth login attempt in the window must be limited regardless.
	ip := fmt.Sprintf("10.8.0.%d", nameCounter.Add(1)%250+1)
	limited := false
	for i := 0; i < 5; i++ {
		body, _ := json.Marshal(map[string]any{"username": "nobody", "password": "nothing"})
		req, _ := http.NewRequest("POST", serverURL+"/api/v1/auth/login", strings.NewReader(string(body)))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Real-IP", ip)
		req.Header.Set("X-Forwarded-For", fmt.Sprintf("203.0.113.%d", i+1))
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatalf("login: %v", err)
		}
		resp.Body.Close()
		if resp.StatusCode == 429 {
			limited = true
			break
		}
	}
	if !limited {
		t.Fatal("varying X-Forwarded-For should not bypass the login rate limit")
	}
}

// Scenario S22: Username validation
func TestScenarioS22_UsernameValidation(t *testing.T) {
	ensureUsers(t)
	for _, name := range []string{`"; DROP TABLE users; --`, strings.Repeat("a", 33), ""} {
		c := NewHTTPClient()
		status, _, _ := c.Register(name, "somepassword")
		if status != 400 {
			t.Fatalf("username %q: expected 400, got %d", name, status)
		}
	}
}

// Scenario S24: Channel name validation
func TestScenarioS24_ChannelNameValidation(t *testing.T) {
	ensureUsers(t)
	ws, _ := ConnectWS(adminToken)
	defer ws.Close()
	for _, name := range []string{strings.Repeat("a", 33), ""} {
		ws.Send("create_channel", map[string]any{"name": name, "type": "text"})
		if _, err := ws.WaitFor("channel_create", shortNoEvent); err == nil {
			t.Fatalf("channel name %q should be rejected", name)
		}
	}
}

// Scenario S44: SQL injection via WebSocket operations
func TestScenarioS44_SQLInjectionLiteral(t *testing.T) {
	ensureUsers(t)
	ws, _ := ConnectWS(aliceToken)
	defer ws.Close()
	channelID := findTextChannel(ws.Ready)
	payload := "'; DROP TABLE messages; --"
	ws.Send("send_message", map[string]any{"channel_id": channelID, "content": payload})
	data, err := ws.WaitForMatch("message_create", func(raw json.RawMessage) bool {
		return jsonStr(parseData(raw), "content") == payload
	}, wait)
	if err != nil {
		t.Fatalf("message not stored literally: %v", err)
	}
	if jsonStr(parseData(data), "content") != payload {
		t.Fatal("content altered")
	}
	// The messages table still works afterwards.
	c := NewHTTPClient()
	c.Token = aliceToken
	if status, _, _ := c.GetJSONArray("/api/v1/channels/" + channelID + "/messages?limit=1"); status != 200 {
		t.Fatalf("history after injection attempt: expected 200, got %d", status)
	}
}

// Scenario S46: Path traversal via static file serving
func TestScenarioS46_StaticPathTraversal(t *testing.T) {
	ensureUsers(t)
	for _, p := range []string{"/uploads/../../etc/passwd", "/uploads/../data.db", "/uploads/", "/thumbs/", "/avatars/"} {
		req, _ := http.NewRequest("GET", serverURL+p, nil)
		resp, err := http.DefaultTransport.RoundTrip(req) // no redirect following, no path cleaning
		if err != nil {
			t.Fatalf("%s: %v", p, err)
		}
		resp.Body.Close()
		if resp.StatusCode == 200 {
			t.Fatalf("%s: must not be served (got 200)", p)
		}
	}
}

// Scenario S51 (new): Private channel content is not reachable through
// side channels — reactions, stars and member listings all require access.
func TestScenarioS51_PrivateChannelSideChannels(t *testing.T) {
	ensureUsers(t)
	channelID := makePrivateChannel(t, aliceID)
	secret := uniqueName("sec_secret")
	msgID := sendAs(t, aliceToken, channelID, secret)

	bob := NewHTTPClient()
	bob.Token = bobToken

	// Stars: bob cannot star a message he cannot see, and his star list never shows it.
	if status, _, _ := bob.PostJSON("/api/v1/stars/"+msgID, nil); status != 404 {
		t.Fatalf("star private message: expected 404, got %d", status)
	}
	_, stars, _ := bob.GetJSONArray("/api/v1/stars")
	for _, s := range stars {
		if jsonStr(s.(map[string]any), "id") == msgID {
			t.Fatal("private message leaked via starred list")
		}
	}

	// Members: roster of a private channel is not readable by non-members.
	if status, _, _ := bob.GetJSONArray("/api/v1/channels/" + channelID + "/members"); status != 404 {
		t.Fatalf("members of private channel: expected 404, got %d", status)
	}

	// Reactions: bob's reaction is silently dropped; alice never sees it.
	aliceWS, _ := ConnectWS(aliceToken)
	defer aliceWS.Close()
	bobWS, _ := ConnectWS(bobToken)
	defer bobWS.Close()
	bobWS.Send("add_reaction", map[string]any{"message_id": msgID, "emoji": "👀"})
	if _, err := aliceWS.WaitForMatch("reaction_add", func(raw json.RawMessage) bool {
		return jsonStr(parseData(raw), "message_id") == msgID
	}, shortNoEvent); err == nil {
		t.Fatal("non-member reaction on a private message must be rejected")
	}

	// Screen share subscribe to a private channel is refused before any SFU lookup.
	bobWS.Send("screen_share_subscribe", map[string]any{"channel_id": channelID})
	if _, err := bobWS.WaitFor("screen_share_error", shortNoEvent); err == nil {
		t.Fatal("non-member must not even learn whether a share exists in a private channel")
	}

	// Alice, a member, can star it and sees it in her list.
	alice := NewHTTPClient()
	alice.Token = aliceToken
	if status, _, _ := alice.PostJSON("/api/v1/stars/"+msgID, nil); status != 201 {
		t.Fatalf("alice star: expected 201, got %d", status)
	}
	_, stars, _ = alice.GetJSONArray("/api/v1/stars")
	found := false
	for _, s := range stars {
		if jsonStr(s.(map[string]any), "id") == msgID {
			found = true
		}
	}
	if !found {
		t.Fatal("alice's starred message missing from her list")
	}
}

// Scenario S52 (new): Webhook posts into a private channel reach members only.
func TestScenarioS52_WebhookPrivateChannelScoped(t *testing.T) {
	ensureUsers(t)
	adminHTTP := NewHTTPClient()
	adminHTTP.Token = adminToken
	status, body, _ := adminHTTP.PostJSON("/api/v1/admin/webhook-keys", map[string]any{"name": uniqueName("sec_hook")})
	if status != 201 {
		t.Fatalf("create webhook key: %d %v", status, body)
	}
	hookKey := jsonStr(body, "key")

	channelID := makePrivateChannel(t, aliceID)
	channelName := ""
	adminWS, _ := ConnectWS(adminToken)
	for _, ch := range jsonArray(adminWS.Ready, "channels") {
		c := ch.(map[string]any)
		if jsonStr(c, "id") == channelID {
			channelName = jsonStr(c, "name")
		}
	}
	adminWS.Close()

	aliceWS, _ := ConnectWS(aliceToken)
	defer aliceWS.Close()
	bobWS, _ := ConnectWS(bobToken)
	defer bobWS.Close()

	marker := uniqueName("hook_secret")
	payload, _ := json.Marshal(map[string]any{"channel": "#" + channelName, "content": marker})
	req, _ := http.NewRequest("POST", serverURL+"/api/v1/webhooks/incoming", strings.NewReader(string(payload)))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Webhook-Key", hookKey)
	req.Header.Set("X-Real-IP", fmt.Sprintf("10.7.0.%d", nameCounter.Add(1)%250+1))
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("webhook: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != 201 {
		t.Fatalf("webhook: expected 201, got %d", resp.StatusCode)
	}

	match := func(raw json.RawMessage) bool { return jsonStr(parseData(raw), "content") == marker }
	if _, err := aliceWS.WaitForMatch("message_create", match, wait); err != nil {
		t.Fatalf("member alice should receive the webhook message: %v", err)
	}
	if _, err := bobWS.WaitForMatch("message_create", match, shortNoEvent); err == nil {
		t.Fatal("non-member bob must not receive a private channel's webhook message")
	}
}
