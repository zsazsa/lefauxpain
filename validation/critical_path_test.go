package validation

import (
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"nhooyr.io/websocket"
)

// --- Shared state set up lazily by ensureAdmin / ensureUsers ---

var (
	adminOnce  sync.Once
	adminToken string
	adminID    string
	adminName  = "admin"
	adminPass  = "adminpass"

	usersOnce  sync.Once
	aliceToken string
	aliceID    string
	aliceName  string
	alicePass  = "alicepass"
	bobToken   string
	bobID      string
	bobName    string
	bobPass    = "bobpass"
)

const wait = 5 * time.Second

// ensureAdmin registers the first user (admin). Safe to call from any test.
func ensureAdmin(t *testing.T) {
	t.Helper()
	adminOnce.Do(func() {
		c := NewHTTPClient()
		status, body, err := c.Register(adminName, adminPass)
		if err != nil {
			t.Fatalf("admin register: %v", err)
		}
		if status != 201 {
			t.Fatalf("admin register: expected 201, got %d: %v", status, body)
		}
		user := jsonMap(body, "user")
		adminToken = jsonStr(body, "token")
		adminID = jsonStr(user, "id")
	})
	if adminToken == "" {
		t.Fatal("admin setup failed in a prior test")
	}
}

// ensureUsers creates alice and bob (approved). Safe to call from any test.
func ensureUsers(t *testing.T) {
	t.Helper()
	ensureAdmin(t)
	usersOnce.Do(func() {
		adminHTTP := NewHTTPClient()
		adminHTTP.Token = adminToken

		// Register alice
		c1 := NewHTTPClient()
		aliceName = uniqueName("alice")
		status, body, err := c1.Register(aliceName, alicePass)
		if err != nil {
			t.Fatalf("alice register: %v", err)
		}
		if status != 202 {
			t.Fatalf("alice register: expected 202, got %d: %v", status, body)
		}

		// Find alice's ID via admin endpoint
		_, users, err := adminHTTP.GetJSONArray("/api/v1/admin/users")
		if err != nil {
			t.Fatalf("list users: %v", err)
		}
		for _, u := range users {
			um := u.(map[string]any)
			if jsonStr(um, "username") == aliceName {
				aliceID = jsonStr(um, "id")
				break
			}
		}

		// Approve alice
		adminHTTP.PostJSON(fmt.Sprintf("/api/v1/admin/users/%s/approve", aliceID), nil)

		// Login alice
		c1Login := NewHTTPClient()
		status, body, err = c1Login.Login(aliceName, alicePass)
		if err != nil || status != 200 {
			t.Fatalf("alice login: status=%d err=%v", status, err)
		}
		aliceToken = jsonStr(body, "token")

		// Register bob
		c2 := NewHTTPClient()
		bobName = uniqueName("bob")
		c2.Register(bobName, bobPass)

		// Find bob's ID
		_, users, _ = adminHTTP.GetJSONArray("/api/v1/admin/users")
		for _, u := range users {
			um := u.(map[string]any)
			if jsonStr(um, "username") == bobName {
				bobID = jsonStr(um, "id")
				break
			}
		}

		// Approve bob
		adminHTTP.PostJSON(fmt.Sprintf("/api/v1/admin/users/%s/approve", bobID), nil)

		// Login bob
		c2Login := NewHTTPClient()
		status, body, err = c2Login.Login(bobName, bobPass)
		if err != nil || status != 200 {
			t.Fatalf("bob login: status=%d err=%v", status, err)
		}
		bobToken = jsonStr(body, "token")
	})
	if aliceToken == "" || bobToken == "" {
		t.Fatal("user setup failed in a prior test")
	}
}

// findTextChannel finds the first text channel in a ready payload.
func findTextChannel(ready map[string]any) string {
	for _, ch := range jsonArray(ready, "channels") {
		c := ch.(map[string]any)
		if jsonStr(c, "type") == "text" {
			return jsonStr(c, "id")
		}
	}
	return ""
}

// findVoiceChannel finds the first voice channel in a ready payload.
func findVoiceChannel(ready map[string]any) string {
	for _, ch := range jsonArray(ready, "channels") {
		c := ch.(map[string]any)
		if jsonStr(c, "type") == "voice" {
			return jsonStr(c, "id")
		}
	}
	return ""
}

// ============================================================
// AUTH SCENARIOS
// ============================================================

func TestScenario01_FirstUserBecomesAdmin(t *testing.T) {
	ensureAdmin(t)

	// Verify by logging in
	c := NewHTTPClient()
	status, body, err := c.Login(adminName, adminPass)
	if err != nil {
		t.Fatalf("login: %v", err)
	}
	if status != 200 {
		t.Fatalf("expected 200, got %d", status)
	}
	user := jsonMap(body, "user")
	if !jsonBool(user, "is_admin") {
		t.Error("first user should be admin")
	}
	if jsonStr(body, "token") == "" {
		t.Error("expected token in response")
	}
}

func TestScenario02_SubsequentUserPending(t *testing.T) {
	ensureAdmin(t)

	// Connect admin WS to catch notification
	adminWS, err := ConnectWS(adminToken)
	if err != nil {
		t.Fatalf("admin ws: %v", err)
	}
	defer adminWS.Close()

	// Register a new user
	c := NewHTTPClient()
	username := uniqueName("pending")
	status, body, err := c.Register(username, "pass")
	if err != nil {
		t.Fatalf("register: %v", err)
	}
	if status != 202 {
		t.Fatalf("expected 202, got %d: %v", status, body)
	}
	if !jsonBool(body, "pending") {
		t.Error("expected pending: true")
	}
	if _, hasToken := body["token"]; hasToken {
		t.Error("pending user should not receive a token")
	}

	// Admin should receive pending_user notification
	data, err := adminWS.WaitFor("notification_create", wait)
	if err != nil {
		t.Fatalf("no notification: %v", err)
	}
	notif := parseData(data)
	if jsonStr(notif, "type") != "pending_user" {
		t.Errorf("expected type pending_user, got %s", jsonStr(notif, "type"))
	}
}

func TestScenario03_AdminApprovesPendingUser(t *testing.T) {
	ensureAdmin(t)

	// Register a pending user
	c := NewHTTPClient()
	username := uniqueName("approveme")
	c.Register(username, "pass")

	// Find user ID
	adminHTTP := NewHTTPClient()
	adminHTTP.Token = adminToken
	_, users, _ := adminHTTP.GetJSONArray("/api/v1/admin/users")
	var userID string
	for _, u := range users {
		um := u.(map[string]any)
		if jsonStr(um, "username") == username {
			userID = jsonStr(um, "id")
			break
		}
	}
	if userID == "" {
		t.Fatal("could not find pending user")
	}

	// Login should fail while pending
	loginC := NewHTTPClient()
	status, body, err := loginC.Login(username, "pass")
	if err != nil {
		t.Fatalf("login: %v", err)
	}
	if status != 403 {
		t.Fatalf("expected 403 for pending user, got %d", status)
	}
	if !jsonBool(body, "pending") {
		t.Error("expected pending: true in 403 response")
	}

	// Connect admin WS to catch user_approved broadcast
	adminWS, err := ConnectWS(adminToken)
	if err != nil {
		t.Fatalf("admin ws: %v", err)
	}
	defer adminWS.Close()

	// Approve
	status, result, err := adminHTTP.PostJSON(fmt.Sprintf("/api/v1/admin/users/%s/approve", userID), nil)
	if err != nil {
		t.Fatalf("approve: %v", err)
	}
	if status != 200 {
		t.Fatalf("expected 200, got %d: %v", status, result)
	}

	// Should see user_approved broadcast
	data, err := adminWS.WaitFor("user_approved", wait)
	if err != nil {
		t.Fatalf("no user_approved: %v", err)
	}
	approved := parseData(data)
	approvedUser := jsonMap(approved, "user")
	if jsonStr(approvedUser, "username") != username {
		t.Errorf("expected username %s, got %s", username, jsonStr(approvedUser, "username"))
	}

	// Login should now succeed
	status, body, err = loginC.Login(username, "pass")
	if err != nil {
		t.Fatalf("login after approve: %v", err)
	}
	if status != 200 {
		t.Fatalf("expected 200 after approve, got %d", status)
	}
	if jsonStr(body, "token") == "" {
		t.Error("expected token after approval")
	}
}

func TestScenario04_LoginValidCredentials(t *testing.T) {
	ensureAdmin(t)

	c := NewHTTPClient()
	status, body, err := c.Login(adminName, adminPass)
	if err != nil {
		t.Fatalf("login: %v", err)
	}
	if status != 200 {
		t.Fatalf("expected 200, got %d", status)
	}
	user := jsonMap(body, "user")
	if jsonStr(user, "id") == "" {
		t.Error("expected user.id")
	}
	if jsonStr(user, "username") != adminName {
		t.Errorf("expected username %s, got %s", adminName, jsonStr(user, "username"))
	}
	if jsonStr(body, "token") == "" {
		t.Error("expected token")
	}
}

func TestScenario05_LoginInvalidCredentials(t *testing.T) {
	ensureAdmin(t)

	c := NewHTTPClient()

	// Wrong password
	status, _, err := c.Login(adminName, "wrongpass")
	if err != nil {
		t.Fatalf("login: %v", err)
	}
	if status != 401 {
		t.Fatalf("expected 401 for wrong password, got %d", status)
	}

	// Nonexistent user
	status, _, err = c.Login("nobody_exists", "pass")
	if err != nil {
		t.Fatalf("login: %v", err)
	}
	if status != 401 {
		t.Fatalf("expected 401 for nonexistent user, got %d", status)
	}
}

// ============================================================
// WEBSOCKET SCENARIOS
// ============================================================

func TestScenario06_WSAuthAndReady(t *testing.T) {
	ensureAdmin(t)

	ws, err := ConnectWS(adminToken)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer ws.Close()

	// Verify ready payload fields
	if ws.Ready == nil {
		t.Fatal("ready payload is nil")
	}
	user := jsonMap(ws.Ready, "user")
	if jsonStr(user, "username") != adminName {
		t.Errorf("ready user: expected %s, got %s", adminName, jsonStr(user, "username"))
	}
	if jsonArray(ws.Ready, "channels") == nil {
		t.Error("expected channels array")
	}
	if jsonArray(ws.Ready, "online_users") == nil {
		t.Error("expected online_users array")
	}
	if jsonArray(ws.Ready, "all_users") == nil {
		t.Error("expected all_users array")
	}
	if ws.Ready["server_time"] == nil {
		t.Error("expected server_time")
	}
}

func TestScenario07_WSRejectsInvalidToken(t *testing.T) {
	conn, ctx, cancel, err := DialWSRaw()
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer cancel()

	// Send bogus token
	authMsg, _ := json.Marshal(map[string]any{
		"op": "authenticate",
		"d":  map[string]any{"token": "bogus-token-12345"},
	})
	if err := conn.Write(ctx, websocket.MessageText, authMsg); err != nil {
		t.Fatalf("write: %v", err)
	}

	// Server should close the connection
	_, _, err = conn.Read(ctx)
	if err == nil {
		t.Fatal("expected connection to be closed, but read succeeded")
	}
}

// ============================================================
// CHANNEL & MESSAGING SCENARIOS
// ============================================================

func TestScenario08_CreateTextChannel(t *testing.T) {
	ensureAdmin(t)

	ws, err := ConnectWS(adminToken)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer ws.Close()

	name := uniqueName("chan")
	ws.Send("create_channel", map[string]any{"name": name, "type": "text"})

	data, err := ws.WaitFor("channel_create", wait)
	if err != nil {
		t.Fatalf("no channel_create: %v", err)
	}
	ch := parseData(data)
	if jsonStr(ch, "name") != name {
		t.Errorf("expected name %s, got %s", name, jsonStr(ch, "name"))
	}
	if jsonStr(ch, "type") != "text" {
		t.Error("expected type text")
	}
	if jsonStr(ch, "id") == "" {
		t.Error("expected channel id")
	}

	// Verify manager_ids includes creator
	managers := jsonArray(ch, "manager_ids")
	found := false
	for _, mid := range managers {
		if mid.(string) == adminID {
			found = true
			break
		}
	}
	if !found {
		t.Error("creator should be in manager_ids")
	}

	// Verify via REST
	adminHTTP := NewHTTPClient()
	adminHTTP.Token = adminToken
	_, channels, _ := adminHTTP.GetJSONArray("/api/v1/channels")
	foundInREST := false
	for _, c := range channels {
		cm := c.(map[string]any)
		if jsonStr(cm, "id") == jsonStr(ch, "id") {
			foundInREST = true
			break
		}
	}
	if !foundInREST {
		t.Error("channel should appear in GET /api/v1/channels")
	}
}

func TestScenario09_SendMessage(t *testing.T) {
	ensureAdmin(t)

	ws, err := ConnectWS(adminToken)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer ws.Close()

	channelID := findTextChannel(ws.Ready)
	if channelID == "" {
		t.Fatal("no text channel found")
	}

	ws.Send("send_message", map[string]any{
		"channel_id": channelID,
		"content":    "Hello world!",
	})

	data, err := ws.WaitFor("message_create", wait)
	if err != nil {
		t.Fatalf("no message_create: %v", err)
	}
	msg := parseData(data)
	if jsonStr(msg, "content") != "Hello world!" {
		t.Errorf("expected content 'Hello world!', got %q", jsonStr(msg, "content"))
	}
	if jsonStr(msg, "channel_id") != channelID {
		t.Error("channel_id mismatch")
	}
	author := jsonMap(msg, "author")
	if jsonStr(author, "username") != adminName {
		t.Error("author username mismatch")
	}
	if jsonStr(msg, "id") == "" {
		t.Error("expected message id")
	}
	if jsonStr(msg, "created_at") == "" {
		t.Error("expected created_at")
	}

	// Verify via REST
	adminHTTP := NewHTTPClient()
	adminHTTP.Token = adminToken
	_, messages, _ := adminHTTP.GetJSONArray(fmt.Sprintf("/api/v1/channels/%s/messages?limit=1", channelID))
	if len(messages) == 0 {
		t.Error("message should appear in history")
	}
}

func TestScenario10_ReplyToMessage(t *testing.T) {
	ensureAdmin(t)

	ws, err := ConnectWS(adminToken)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer ws.Close()

	channelID := findTextChannel(ws.Ready)

	// Send original
	ws.Send("send_message", map[string]any{
		"channel_id": channelID,
		"content":    "Original message",
	})
	data, err := ws.WaitFor("message_create", wait)
	if err != nil {
		t.Fatalf("no original: %v", err)
	}
	original := parseData(data)
	originalID := jsonStr(original, "id")

	// Send reply
	ws.Send("send_message", map[string]any{
		"channel_id":  channelID,
		"content":     "This is a reply",
		"reply_to_id": originalID,
	})
	data, err = ws.WaitFor("message_create", wait)
	if err != nil {
		t.Fatalf("no reply: %v", err)
	}
	reply := parseData(data)
	if jsonStr(reply, "content") != "This is a reply" {
		t.Error("reply content mismatch")
	}
	replyTo := jsonMap(reply, "reply_to")
	if replyTo == nil {
		t.Fatal("expected reply_to in reply message")
	}
	if jsonStr(replyTo, "id") != originalID {
		t.Error("reply_to.id should match original")
	}
	replyToAuthor := jsonMap(replyTo, "author")
	if jsonStr(replyToAuthor, "username") != adminName {
		t.Error("reply_to.author mismatch")
	}
}

func TestScenario11_EditMessage(t *testing.T) {
	ensureAdmin(t)

	ws, err := ConnectWS(adminToken)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer ws.Close()

	channelID := findTextChannel(ws.Ready)

	// Send
	ws.Send("send_message", map[string]any{
		"channel_id": channelID,
		"content":    "Typo here",
	})
	data, _ := ws.WaitFor("message_create", wait)
	msgID := jsonStr(parseData(data), "id")

	// Edit
	ws.Send("edit_message", map[string]any{
		"message_id": msgID,
		"content":    "Fixed text",
	})
	data, err = ws.WaitFor("message_update", wait)
	if err != nil {
		t.Fatalf("no message_update: %v", err)
	}
	updated := parseData(data)
	if jsonStr(updated, "content") != "Fixed text" {
		t.Error("expected updated content")
	}
	if jsonStr(updated, "edited_at") == "" {
		t.Error("expected edited_at timestamp")
	}
}

func TestScenario12_DeleteMessage(t *testing.T) {
	ensureAdmin(t)

	ws, err := ConnectWS(adminToken)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer ws.Close()

	channelID := findTextChannel(ws.Ready)

	// Send
	ws.Send("send_message", map[string]any{
		"channel_id": channelID,
		"content":    "Delete me",
	})
	data, _ := ws.WaitFor("message_create", wait)
	msg := parseData(data)
	msgID := jsonStr(msg, "id")

	// Delete
	ws.Send("delete_message", map[string]any{"message_id": msgID})
	data, err = ws.WaitFor("message_delete", wait)
	if err != nil {
		t.Fatalf("no message_delete: %v", err)
	}
	deleted := parseData(data)
	if jsonStr(deleted, "id") != msgID {
		t.Error("deleted message id mismatch")
	}
	if jsonStr(deleted, "channel_id") != channelID {
		t.Error("deleted channel_id mismatch")
	}
}

func TestScenario13_AddRemoveReaction(t *testing.T) {
	ensureAdmin(t)

	ws, err := ConnectWS(adminToken)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer ws.Close()

	channelID := findTextChannel(ws.Ready)

	// Send a message to react to
	ws.Send("send_message", map[string]any{
		"channel_id": channelID,
		"content":    "React to me",
	})
	data, _ := ws.WaitFor("message_create", wait)
	msgID := jsonStr(parseData(data), "id")

	// Add reaction
	ws.Send("add_reaction", map[string]any{
		"message_id": msgID,
		"emoji":      "\U0001F44D", // 👍
	})
	data, err = ws.WaitFor("reaction_add", wait)
	if err != nil {
		t.Fatalf("no reaction_add: %v", err)
	}
	reaction := parseData(data)
	if jsonStr(reaction, "message_id") != msgID {
		t.Error("reaction message_id mismatch")
	}
	if jsonStr(reaction, "emoji") != "\U0001F44D" {
		t.Error("reaction emoji mismatch")
	}

	// Remove reaction
	ws.Send("remove_reaction", map[string]any{
		"message_id": msgID,
		"emoji":      "\U0001F44D",
	})
	data, err = ws.WaitFor("reaction_remove", wait)
	if err != nil {
		t.Fatalf("no reaction_remove: %v", err)
	}
	removed := parseData(data)
	if jsonStr(removed, "message_id") != msgID {
		t.Error("removed reaction message_id mismatch")
	}
}

func TestScenario14_MentionNotification(t *testing.T) {
	ensureUsers(t)

	// Alice connects
	aliceWS, err := ConnectWS(aliceToken)
	if err != nil {
		t.Fatalf("alice ws: %v", err)
	}
	defer aliceWS.Close()

	// Bob connects
	bobWS, err := ConnectWS(bobToken)
	if err != nil {
		t.Fatalf("bob ws: %v", err)
	}
	defer bobWS.Close()

	channelID := findTextChannel(aliceWS.Ready)

	// Alice mentions Bob
	aliceWS.Send("send_message", map[string]any{
		"channel_id": channelID,
		"content":    fmt.Sprintf("Hey <@%s> check this", bobID),
	})

	// Bob should get notification
	data, err := bobWS.WaitFor("notification_create", wait)
	if err != nil {
		t.Fatalf("bob got no notification: %v", err)
	}
	notif := parseData(data)
	if jsonStr(notif, "type") != "mention" {
		t.Errorf("expected mention notification, got %s", jsonStr(notif, "type"))
	}
	notifData := jsonMap(notif, "data")
	if notifData == nil {
		t.Fatal("notification data is nil")
	}
	if jsonStr(notifData, "channel_id") != channelID {
		t.Error("notification channel_id mismatch")
	}
}

func TestScenario15_UploadAndAttach(t *testing.T) {
	ensureAdmin(t)

	adminHTTP := NewHTTPClient()
	adminHTTP.Token = adminToken

	// Upload a PNG image
	status, body, err := adminHTTP.UploadFile("/api/v1/upload", "file", "test.png", pngData, "image/png")
	if err != nil {
		t.Fatalf("upload: %v", err)
	}
	if status != 200 {
		t.Fatalf("expected 200, got %d: %v", status, body)
	}
	attachID := jsonStr(body, "id")
	if attachID == "" {
		t.Fatal("expected attachment id")
	}
	if jsonStr(body, "url") == "" {
		t.Error("expected url")
	}
	if jsonStr(body, "filename") == "" {
		t.Error("expected filename")
	}
	if jsonStr(body, "mime_type") == "" {
		t.Error("expected mime_type")
	}

	// Attach to a message via WS
	ws, err := ConnectWS(adminToken)
	if err != nil {
		t.Fatalf("ws connect: %v", err)
	}
	defer ws.Close()

	channelID := findTextChannel(ws.Ready)
	ws.Send("send_message", map[string]any{
		"channel_id":    channelID,
		"content":       "See attached",
		"attachment_ids": []string{attachID},
	})

	data, err := ws.WaitFor("message_create", wait)
	if err != nil {
		t.Fatalf("no message_create: %v", err)
	}
	msg := parseData(data)
	attachments := jsonArray(msg, "attachments")
	if len(attachments) == 0 {
		t.Fatal("expected attachments in message")
	}
	att := attachments[0].(map[string]any)
	if jsonStr(att, "id") != attachID {
		t.Error("attachment id mismatch")
	}
}

// ============================================================
// VOICE SCENARIOS
// ============================================================

func TestScenario16_JoinVoice(t *testing.T) {
	ensureAdmin(t)

	ws, err := ConnectWS(adminToken)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer ws.Close()

	voiceID := findVoiceChannel(ws.Ready)
	if voiceID == "" {
		t.Fatal("no voice channel found")
	}

	ws.Send("join_voice", map[string]any{"channel_id": voiceID})

	data, err := ws.WaitFor("voice_state_update", wait)
	if err != nil {
		t.Fatalf("no voice_state_update: %v", err)
	}
	state := parseData(data)
	if jsonStr(state, "user_id") != adminID {
		t.Error("user_id mismatch")
	}
	if jsonStr(state, "channel_id") != voiceID {
		t.Error("channel_id mismatch")
	}

	// Server also sends webrtc_offer (we just verify it arrives, don't answer)
	_, err = ws.WaitFor("webrtc_offer", wait)
	if err != nil {
		t.Fatalf("no webrtc_offer: %v", err)
	}

	// Clean up: leave voice
	ws.Send("leave_voice", map[string]any{})
	ws.WaitFor("voice_state_update", wait)
}

func TestScenario17_LeaveVoice(t *testing.T) {
	ensureAdmin(t)

	ws, err := ConnectWS(adminToken)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer ws.Close()

	voiceID := findVoiceChannel(ws.Ready)

	// Join
	ws.Send("join_voice", map[string]any{"channel_id": voiceID})
	ws.WaitFor("voice_state_update", wait)
	// Drain the webrtc_offer
	ws.WaitFor("webrtc_offer", wait)

	// Leave
	ws.Send("leave_voice", map[string]any{})
	data, err := ws.WaitFor("voice_state_update", wait)
	if err != nil {
		t.Fatalf("no voice_state_update on leave: %v", err)
	}
	state := parseData(data)
	if jsonStr(state, "channel_id") != "" {
		t.Error("expected empty channel_id after leave")
	}
}

func TestScenario18_MuteDeafen(t *testing.T) {
	ensureAdmin(t)

	ws, err := ConnectWS(adminToken)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer ws.Close()

	voiceID := findVoiceChannel(ws.Ready)
	ws.Send("join_voice", map[string]any{"channel_id": voiceID})
	ws.WaitFor("voice_state_update", wait)
	ws.WaitFor("webrtc_offer", wait)

	// Self mute
	ws.Send("voice_self_mute", map[string]any{"muted": true})
	data, err := ws.WaitFor("voice_state_update", wait)
	if err != nil {
		t.Fatalf("no voice_state_update for mute: %v", err)
	}
	state := parseData(data)
	if !jsonBool(state, "self_mute") {
		t.Error("expected self_mute: true")
	}

	// Self deafen
	ws.Send("voice_self_deafen", map[string]any{"deafened": true})
	data, err = ws.WaitFor("voice_state_update", wait)
	if err != nil {
		t.Fatalf("no voice_state_update for deafen: %v", err)
	}
	state = parseData(data)
	if !jsonBool(state, "self_deafen") {
		t.Error("expected self_deafen: true")
	}

	// Clean up
	ws.Send("leave_voice", map[string]any{})
	ws.WaitFor("voice_state_update", wait)
}

func TestScenario19_VoiceClearOnDisconnect(t *testing.T) {
	ensureUsers(t)

	// Alice joins voice
	aliceWS, err := ConnectWS(aliceToken)
	if err != nil {
		t.Fatalf("alice ws: %v", err)
	}

	voiceID := findVoiceChannel(aliceWS.Ready)
	aliceWS.Send("join_voice", map[string]any{"channel_id": voiceID})
	aliceWS.WaitFor("voice_state_update", wait)

	// Bob connects to observe
	bobWS, err := ConnectWS(bobToken)
	if err != nil {
		t.Fatalf("bob ws: %v", err)
	}
	defer bobWS.Close()

	// Alice disconnects abruptly
	aliceWS.Close()

	// Bob should see voice_state_update with empty channel_id
	data, err := bobWS.WaitForMatch("voice_state_update", func(raw json.RawMessage) bool {
		m := parseData(raw)
		return jsonStr(m, "user_id") == aliceID && jsonStr(m, "channel_id") == ""
	}, wait)
	if err != nil {
		t.Fatalf("bob didn't see alice leave voice: %v", err)
	}
	_ = data

	// Bob should also see user_offline
	_, err = bobWS.WaitForMatch("user_offline", func(raw json.RawMessage) bool {
		m := parseData(raw)
		return jsonStr(m, "user_id") == aliceID
	}, wait)
	if err != nil {
		t.Fatalf("bob didn't see alice go offline: %v", err)
	}
}

// ============================================================
// PAGINATION & CHANNEL MANAGEMENT
// ============================================================

func TestScenario20_MessagePagination(t *testing.T) {
	ensureAdmin(t)

	ws, err := ConnectWS(adminToken)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer ws.Close()

	// Create a fresh channel to avoid interference
	chanName := uniqueName("pagination")
	ws.Send("create_channel", map[string]any{"name": chanName, "type": "text"})
	chData, _ := ws.WaitFor("channel_create", wait)
	channelID := jsonStr(parseData(chData), "id")

	// Send messages in two batches with a 1.1s gap so they get distinct
	// created_at timestamps (SQLite datetime has 1-second resolution).
	// Batch 1: 3 "old" messages
	for i := 0; i < 3; i++ {
		ws.Send("send_message", map[string]any{
			"channel_id": channelID,
			"content":    fmt.Sprintf("Old %d", i+1),
		})
		ws.WaitFor("message_create", wait)
	}

	time.Sleep(1100 * time.Millisecond)

	// Batch 2: 2 "new" messages (different second)
	for i := 0; i < 2; i++ {
		ws.Send("send_message", map[string]any{
			"channel_id": channelID,
			"content":    fmt.Sprintf("New %d", i+1),
		})
		ws.WaitFor("message_create", wait)
	}

	// Fetch first page (2 most recent — should be the "new" batch)
	adminHTTP := NewHTTPClient()
	adminHTTP.Token = adminToken
	_, page1, err := adminHTTP.GetJSONArray(fmt.Sprintf("/api/v1/channels/%s/messages?limit=2", channelID))
	if err != nil {
		t.Fatalf("fetch page 1: %v", err)
	}
	if len(page1) != 2 {
		t.Fatalf("expected 2 messages in page 1, got %d", len(page1))
	}

	// Use the oldest from page 1 as cursor
	oldestInPage1 := page1[len(page1)-1].(map[string]any)
	cursor := jsonStr(oldestInPage1, "id")

	// Fetch second page (should be from the "old" batch)
	_, page2, err := adminHTTP.GetJSONArray(fmt.Sprintf("/api/v1/channels/%s/messages?limit=3&before=%s", channelID, cursor))
	if err != nil {
		t.Fatalf("fetch page 2: %v", err)
	}
	if len(page2) == 0 {
		t.Fatal("expected messages in page 2, got 0")
	}

	// Verify no overlap between pages
	page1IDs := map[string]bool{}
	for _, m := range page1 {
		page1IDs[jsonStr(m.(map[string]any), "id")] = true
	}
	for _, m := range page2 {
		id := jsonStr(m.(map[string]any), "id")
		if page1IDs[id] {
			t.Errorf("message %s appears in both pages", id)
		}
	}
}

func TestScenario21_ChannelRenameAndDelete(t *testing.T) {
	ensureAdmin(t)

	ws, err := ConnectWS(adminToken)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer ws.Close()

	// Create a channel
	name := uniqueName("renameme")
	ws.Send("create_channel", map[string]any{"name": name, "type": "text"})
	chData, _ := ws.WaitFor("channel_create", wait)
	channelID := jsonStr(parseData(chData), "id")

	// Rename
	newName := uniqueName("renamed")
	ws.Send("rename_channel", map[string]any{"channel_id": channelID, "name": newName})
	data, err := ws.WaitFor("channel_update", wait)
	if err != nil {
		t.Fatalf("no channel_update: %v", err)
	}
	updated := parseData(data)
	if jsonStr(updated, "name") != newName {
		t.Errorf("expected name %s, got %s", newName, jsonStr(updated, "name"))
	}

	// Delete
	ws.Send("delete_channel", map[string]any{"channel_id": channelID})
	data, err = ws.WaitFor("channel_delete", wait)
	if err != nil {
		t.Fatalf("no channel_delete: %v", err)
	}
	deleted := parseData(data)
	if jsonStr(deleted, "channel_id") != channelID {
		t.Error("channel_id mismatch in delete")
	}

	// Verify gone from REST
	adminHTTP := NewHTTPClient()
	adminHTTP.Token = adminToken
	_, channels, _ := adminHTTP.GetJSONArray("/api/v1/channels")
	for _, c := range channels {
		cm := c.(map[string]any)
		if jsonStr(cm, "id") == channelID {
			t.Error("deleted channel should not appear in channel list")
		}
	}
}

func TestScenario22_AdminRestoreChannel(t *testing.T) {
	ensureAdmin(t)

	ws, err := ConnectWS(adminToken)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer ws.Close()

	// Create and delete a channel
	name := uniqueName("restore")
	ws.Send("create_channel", map[string]any{"name": name, "type": "text"})
	chData, _ := ws.WaitFor("channel_create", wait)
	channelID := jsonStr(parseData(chData), "id")

	ws.Send("delete_channel", map[string]any{"channel_id": channelID})
	ws.WaitFor("channel_delete", wait)

	// Restore
	ws.Send("restore_channel", map[string]any{"channel_id": channelID})
	data, err := ws.WaitFor("channel_create", wait) // restore broadcasts channel_create
	if err != nil {
		t.Fatalf("no channel_create on restore: %v", err)
	}
	restored := parseData(data)
	if jsonStr(restored, "id") != channelID {
		t.Error("restored channel id mismatch")
	}

	// Verify back in REST
	adminHTTP := NewHTTPClient()
	adminHTTP.Token = adminToken
	_, channels, _ := adminHTTP.GetJSONArray("/api/v1/channels")
	found := false
	for _, c := range channels {
		cm := c.(map[string]any)
		if jsonStr(cm, "id") == channelID {
			found = true
			break
		}
	}
	if !found {
		t.Error("restored channel should appear in channel list")
	}
}

func TestScenario23_TypingIndicator(t *testing.T) {
	ensureUsers(t)

	aliceWS, err := ConnectWS(aliceToken)
	if err != nil {
		t.Fatalf("alice ws: %v", err)
	}
	defer aliceWS.Close()

	bobWS, err := ConnectWS(bobToken)
	if err != nil {
		t.Fatalf("bob ws: %v", err)
	}
	defer bobWS.Close()

	channelID := findTextChannel(aliceWS.Ready)

	// Alice starts typing
	aliceWS.Send("typing_start", map[string]any{"channel_id": channelID})

	// Bob should receive it
	data, err := bobWS.WaitFor("typing_start", wait)
	if err != nil {
		t.Fatalf("bob got no typing_start: %v", err)
	}
	typing := parseData(data)
	if jsonStr(typing, "user_id") != aliceID {
		t.Error("typing user_id should be alice")
	}
	if jsonStr(typing, "channel_id") != channelID {
		t.Error("typing channel_id mismatch")
	}

	// Alice should NOT receive her own typing
	_, err = aliceWS.WaitFor("typing_start", 500*time.Millisecond)
	if err == nil {
		t.Error("alice should not receive her own typing_start")
	}
}

func TestScenario24_OnlineOfflinePresence(t *testing.T) {
	ensureUsers(t)

	// Bob connects and waits for alice to come online
	bobWS, err := ConnectWS(bobToken)
	if err != nil {
		t.Fatalf("bob ws: %v", err)
	}
	defer bobWS.Close()

	// Alice connects — bob should see user_online
	aliceWS, err := ConnectWS(aliceToken)
	if err != nil {
		t.Fatalf("alice ws: %v", err)
	}

	data, err := bobWS.WaitForMatch("user_online", func(raw json.RawMessage) bool {
		m := parseData(raw)
		user := jsonMap(m, "user")
		return jsonStr(user, "id") == aliceID
	}, wait)
	if err != nil {
		t.Fatalf("bob didn't see alice online: %v", err)
	}
	_ = data

	// Alice's ready should include bob (who connected before her) in online_users.
	// Note: the server sends ready BEFORE registering the user in the hub,
	// so alice will NOT be in her own online_users list — that's correct behavior.
	onlineUsers := jsonArray(aliceWS.Ready, "online_users")
	foundBob := false
	for _, u := range onlineUsers {
		um := u.(map[string]any)
		if jsonStr(um, "id") == bobID {
			foundBob = true
			break
		}
	}
	if !foundBob {
		t.Error("bob should be in alice's online_users (bob connected first)")
	}

	// Alice disconnects — bob should see user_offline
	aliceWS.Close()

	_, err = bobWS.WaitForMatch("user_offline", func(raw json.RawMessage) bool {
		m := parseData(raw)
		return jsonStr(m, "user_id") == aliceID
	}, wait)
	if err != nil {
		t.Fatalf("bob didn't see alice offline: %v", err)
	}
}

// ============================================================
// RADIO SCENARIOS
// ============================================================

func TestScenario25_RadioStationLifecycle(t *testing.T) {
	ensureAdmin(t)

	ws, err := ConnectWS(adminToken)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer ws.Close()

	// Create station
	stationName := uniqueName("radio")
	ws.Send("create_radio_station", map[string]any{"name": stationName})
	data, err := ws.WaitFor("radio_station_create", wait)
	if err != nil {
		t.Fatalf("no radio_station_create: %v", err)
	}
	station := parseData(data)
	if jsonStr(station, "name") != stationName {
		t.Errorf("station name: expected %s, got %s", stationName, jsonStr(station, "name"))
	}
	stationID := jsonStr(station, "id")
	managers := jsonArray(station, "manager_ids")
	found := false
	for _, mid := range managers {
		if mid.(string) == adminID {
			found = true
		}
	}
	if !found {
		t.Error("creator should be station manager")
	}

	// Create playlist
	ws.Send("create_radio_playlist", map[string]any{
		"name":       "Test Playlist",
		"station_id": stationID,
	})
	data, err = ws.WaitFor("radio_playlist_created", wait)
	if err != nil {
		t.Fatalf("no radio_playlist_created: %v", err)
	}
	playlist := parseData(data)
	if jsonStr(playlist, "station_id") != stationID {
		t.Error("playlist station_id mismatch")
	}

	// Delete station
	ws.Send("delete_radio_station", map[string]any{"station_id": stationID})
	data, err = ws.WaitFor("radio_station_delete", wait)
	if err != nil {
		t.Fatalf("no radio_station_delete: %v", err)
	}
	deleted := parseData(data)
	if jsonStr(deleted, "station_id") != stationID {
		t.Error("deleted station_id mismatch")
	}
}

func TestScenario26_RadioListenerTracking(t *testing.T) {
	ensureUsers(t)

	// Create a station
	adminWS, err := ConnectWS(adminToken)
	if err != nil {
		t.Fatalf("admin ws: %v", err)
	}
	defer adminWS.Close()

	stationName := uniqueName("listeners")
	adminWS.Send("create_radio_station", map[string]any{"name": stationName})
	data, _ := adminWS.WaitFor("radio_station_create", wait)
	stationID := jsonStr(parseData(data), "id")

	// Alice tunes in
	aliceWS, err := ConnectWS(aliceToken)
	if err != nil {
		t.Fatalf("alice ws: %v", err)
	}
	defer aliceWS.Close()

	aliceWS.Send("radio_tune", map[string]any{"station_id": stationID})

	// Admin should see listener update
	data, err = adminWS.WaitFor("radio_listeners", wait)
	if err != nil {
		t.Fatalf("no radio_listeners: %v", err)
	}
	listeners := parseData(data)
	userIDs := jsonArray(listeners, "user_ids")
	foundAlice := false
	for _, uid := range userIDs {
		if uid.(string) == aliceID {
			foundAlice = true
		}
	}
	if !foundAlice {
		t.Error("alice should be in listener list")
	}

	// Alice untunes
	aliceWS.Send("radio_untune", map[string]any{})
	data, err = adminWS.WaitFor("radio_listeners", wait)
	if err != nil {
		t.Fatalf("no radio_listeners after untune: %v", err)
	}
	listeners = parseData(data)
	userIDs = jsonArray(listeners, "user_ids")
	for _, uid := range userIDs {
		if uid.(string) == aliceID {
			t.Error("alice should not be in listener list after untune")
		}
	}

	// Clean up station
	adminWS.Send("delete_radio_station", map[string]any{"station_id": stationID})
	adminWS.WaitFor("radio_station_delete", wait)
}

// ============================================================
// MEDIA SCENARIO (requires video upload — partial test)
// ============================================================

func TestScenario27_MediaPlayback(t *testing.T) {
	t.Skip("requires video file fixture — media upload not yet covered")
}

// ============================================================
// ADMIN & SECURITY SCENARIOS
// ============================================================

func TestScenario28_AdminManagesUsers(t *testing.T) {
	ensureAdmin(t)

	adminHTTP := NewHTTPClient()
	adminHTTP.Token = adminToken

	// List users
	status, users, err := adminHTTP.GetJSONArray("/api/v1/admin/users")
	if err != nil {
		t.Fatalf("list users: %v", err)
	}
	if status != 200 {
		t.Fatalf("expected 200, got %d", status)
	}
	if len(users) == 0 {
		t.Fatal("expected at least one user")
	}

	// Verify user fields
	first := users[0].(map[string]any)
	if jsonStr(first, "id") == "" {
		t.Error("expected user id")
	}
	if jsonStr(first, "username") == "" {
		t.Error("expected username")
	}

	// Create a user to manage
	c := NewHTTPClient()
	username := uniqueName("managed")
	c.Register(username, "pass")

	// Find the user
	_, users, _ = adminHTTP.GetJSONArray("/api/v1/admin/users")
	var targetID string
	for _, u := range users {
		um := u.(map[string]any)
		if jsonStr(um, "username") == username {
			targetID = jsonStr(um, "id")
			break
		}
	}
	if targetID == "" {
		t.Fatal("could not find managed user")
	}

	// Approve
	status, _, _ = adminHTTP.PostJSON(fmt.Sprintf("/api/v1/admin/users/%s/approve", targetID), nil)
	if status != 200 {
		t.Fatalf("approve: expected 200, got %d", status)
	}

	// Set admin
	status, result, _ := adminHTTP.PostJSON(fmt.Sprintf("/api/v1/admin/users/%s/admin", targetID), map[string]any{"is_admin": true})
	if status != 200 {
		t.Fatalf("set admin: expected 200, got %d", status)
	}
	if !jsonBool(result, "is_admin") {
		t.Error("expected is_admin: true")
	}

	// Remove admin (so we can delete)
	adminHTTP.PostJSON(fmt.Sprintf("/api/v1/admin/users/%s/admin", targetID), map[string]any{"is_admin": false})

	// Delete user
	status, result, _ = adminHTTP.DeleteJSON(fmt.Sprintf("/api/v1/admin/users/%s", targetID))
	if status != 200 {
		t.Fatalf("delete: expected 200, got %d", status)
	}
	if jsonStr(result, "status") != "deleted" {
		t.Error("expected status: deleted")
	}
}

func TestScenario29_ChannelReorder(t *testing.T) {
	ensureAdmin(t)

	ws, err := ConnectWS(adminToken)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer ws.Close()

	// Create 3 channels
	var ids []string
	for i := 0; i < 3; i++ {
		name := uniqueName("order")
		ws.Send("create_channel", map[string]any{"name": name, "type": "text"})
		data, _ := ws.WaitFor("channel_create", wait)
		ids = append(ids, jsonStr(parseData(data), "id"))
	}

	// Reverse the order
	reversed := []string{ids[2], ids[0], ids[1]}
	ws.Send("reorder_channels", map[string]any{"channel_ids": reversed})

	data, err := ws.WaitFor("channel_reorder", wait)
	if err != nil {
		t.Fatalf("no channel_reorder: %v", err)
	}
	reorder := parseData(data)
	reorderedIDs := jsonArray(reorder, "channel_ids")

	// Verify the order matches what we sent
	if len(reorderedIDs) != len(reversed) {
		t.Fatalf("expected %d ids, got %d", len(reversed), len(reorderedIDs))
	}
	for i, id := range reversed {
		if reorderedIDs[i].(string) != id {
			t.Errorf("position %d: expected %s, got %s", i, id, reorderedIDs[i].(string))
		}
	}
}

func TestScenario30_DeleteVoiceChannelKicksUsers(t *testing.T) {
	ensureUsers(t)

	// Admin creates a voice channel
	adminWS, err := ConnectWS(adminToken)
	if err != nil {
		t.Fatalf("admin ws: %v", err)
	}
	defer adminWS.Close()

	chanName := uniqueName("vkick")
	adminWS.Send("create_channel", map[string]any{"name": chanName, "type": "voice"})
	chData, _ := adminWS.WaitFor("channel_create", wait)
	voiceID := jsonStr(parseData(chData), "id")

	// Alice joins voice
	aliceWS, err := ConnectWS(aliceToken)
	if err != nil {
		t.Fatalf("alice ws: %v", err)
	}
	defer aliceWS.Close()

	aliceWS.Send("join_voice", map[string]any{"channel_id": voiceID})
	aliceWS.WaitFor("voice_state_update", wait)

	// Admin deletes the voice channel
	adminWS.Send("delete_channel", map[string]any{"channel_id": voiceID})

	// Admin should see voice_state_update kicking alice (empty channel_id)
	_, err = adminWS.WaitForMatch("voice_state_update", func(raw json.RawMessage) bool {
		m := parseData(raw)
		return jsonStr(m, "user_id") == aliceID && jsonStr(m, "channel_id") == ""
	}, wait)
	if err != nil {
		t.Fatalf("no voice kick on channel delete: %v", err)
	}

	// And the channel_delete event
	_, err = adminWS.WaitFor("channel_delete", wait)
	if err != nil {
		t.Fatalf("no channel_delete: %v", err)
	}
}

func TestScenario31_ScreenShare(t *testing.T) {
	t.Skip("requires WebRTC peer connection infrastructure")
}

func TestScenario32_DuplicateWSKicksOld(t *testing.T) {
	ensureUsers(t)

	// Alice connection A
	connA, err := ConnectWS(aliceToken)
	if err != nil {
		t.Fatalf("conn A: %v", err)
	}

	// Alice connection B (same token)
	connB, err := ConnectWS(aliceToken)
	if err != nil {
		t.Fatalf("conn B: %v", err)
	}
	defer connB.Close()

	// Connection A should be closed by server
	err = connA.WaitClosed(wait)
	if err != nil {
		t.Fatalf("connection A should have been closed: %v", err)
	}

	// Connection B should still work
	channelID := findTextChannel(connB.Ready)
	connB.Send("send_message", map[string]any{
		"channel_id": channelID,
		"content":    "Still connected",
	})
	_, err = connB.WaitFor("message_create", wait)
	if err != nil {
		t.Fatalf("connection B should work: %v", err)
	}
}

func TestScenario33_RateLimiting(t *testing.T) {
	// Use a dedicated IP for this test so prior registrations don't interfere
	c := NewHTTPClient()
	c.FakeIP = "10.99.99.99"

	// Make 3 registrations (the limit)
	for i := 0; i < 3; i++ {
		username := uniqueName("ratelimit")
		status, _, err := c.Register(username, "pass")
		if err != nil {
			t.Fatalf("register %d: %v", i, err)
		}
		if status == 429 {
			t.Fatalf("hit rate limit too early at request %d", i+1)
		}
	}

	// 4th should be rate limited
	username := uniqueName("ratelimit")
	status, _, err := c.Register(username, "pass")
	if err != nil {
		t.Fatalf("register 4: %v", err)
	}
	if status != 429 {
		t.Errorf("expected 429 on 4th request, got %d", status)
	}
}

func TestScenario34_PasswordChange(t *testing.T) {
	ensureAdmin(t)

	// Create a user for this test
	c := NewHTTPClient()
	username := uniqueName("pwchange")
	c.Register(username, "oldpass")

	// Approve via admin
	adminHTTP := NewHTTPClient()
	adminHTTP.Token = adminToken
	_, users, _ := adminHTTP.GetJSONArray("/api/v1/admin/users")
	var userID string
	for _, u := range users {
		um := u.(map[string]any)
		if jsonStr(um, "username") == username {
			userID = jsonStr(um, "id")
			break
		}
	}
	adminHTTP.PostJSON(fmt.Sprintf("/api/v1/admin/users/%s/approve", userID), nil)

	// Login to get token
	loginC := NewHTTPClient()
	_, body, _ := loginC.Login(username, "oldpass")
	userToken := jsonStr(body, "token")

	// Change password
	userHTTP := NewHTTPClient()
	userHTTP.Token = userToken
	status, result, err := userHTTP.PostJSON("/api/v1/auth/password", map[string]any{
		"current_password": "oldpass",
		"new_password":     "newpass",
	})
	if err != nil {
		t.Fatalf("change password: %v", err)
	}
	if status != 200 {
		t.Fatalf("expected 200, got %d: %v", status, result)
	}
	if jsonStr(result, "status") != "updated" {
		t.Error("expected status: updated")
	}

	// Old password should fail
	oldLoginC := NewHTTPClient()
	status, _, _ = oldLoginC.Login(username, "oldpass")
	if status != 401 {
		t.Errorf("old password should fail, got %d", status)
	}

	// New password should work
	newLoginC := NewHTTPClient()
	status, _, _ = newLoginC.Login(username, "newpass")
	if status != 200 {
		t.Errorf("new password should work, got %d", status)
	}
}

func TestScenario35_EditDeletePermissions(t *testing.T) {
	ensureUsers(t)

	// Alice sends a message
	aliceWS, err := ConnectWS(aliceToken)
	if err != nil {
		t.Fatalf("alice ws: %v", err)
	}
	defer aliceWS.Close()

	channelID := findTextChannel(aliceWS.Ready)
	aliceWS.Send("send_message", map[string]any{
		"channel_id": channelID,
		"content":    "Alice's message",
	})
	data, _ := aliceWS.WaitFor("message_create", wait)
	msgID := jsonStr(parseData(data), "id")

	// Bob tries to edit Alice's message — should fail (no message_update)
	bobWS, err := ConnectWS(bobToken)
	if err != nil {
		t.Fatalf("bob ws: %v", err)
	}
	defer bobWS.Close()
	// Drain any events from Bob connecting
	time.Sleep(200 * time.Millisecond)
	bobWS.Drain()

	bobWS.Send("edit_message", map[string]any{
		"message_id": msgID,
		"content":    "Bob's edit attempt",
	})
	_, err = bobWS.WaitFor("message_update", 1*time.Second)
	if err == nil {
		t.Error("bob should not be able to edit alice's message")
	}

	// Bob tries to delete Alice's message — should fail (bob is not admin)
	bobWS.Send("delete_message", map[string]any{"message_id": msgID})
	_, err = bobWS.WaitFor("message_delete", 1*time.Second)
	if err == nil {
		t.Error("bob should not be able to delete alice's message")
	}

	// Admin deletes Alice's message — should succeed
	adminWS, err := ConnectWS(adminToken)
	if err != nil {
		t.Fatalf("admin ws: %v", err)
	}
	defer adminWS.Close()
	time.Sleep(200 * time.Millisecond)
	adminWS.Drain()

	adminWS.Send("delete_message", map[string]any{"message_id": msgID})
	_, err = adminWS.WaitFor("message_delete", wait)
	if err != nil {
		t.Fatalf("admin should be able to delete: %v", err)
	}
}

// ============================================================
// HELPERS for checking if a string contains a substring
// (used by some match functions)
// ============================================================

func containsStr(haystack []any, needle string) bool {
	for _, v := range haystack {
		if s, ok := v.(string); ok && strings.Contains(s, needle) {
			return true
		}
	}
	return false
}
