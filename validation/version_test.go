package validation

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"

	"nhooyr.io/websocket"
)

// ============================================================
// VERSION HANDSHAKE SCENARIOS — specs/scenarios/version-handshake-scenarios.md
// ============================================================

func healthVersion(t *testing.T) string {
	t.Helper()
	c := NewHTTPClient()
	status, body, err := c.GetJSON("/api/v1/health")
	if err != nil || status != 200 {
		t.Fatalf("health: status=%d err=%v", status, err)
	}
	return jsonStr(body, "version")
}

// wsAuthCloseStatus authenticates with token and returns the close status the
// server used, or -1 if the connection produced a ready instead.
func wsAuthCloseStatus(t *testing.T, token string) (websocket.StatusCode, string) {
	t.Helper()
	conn, ctx, cancel, err := DialWSRaw()
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer cancel()
	msg, _ := json.Marshal(map[string]any{"op": "authenticate", "d": map[string]any{"token": token}})
	if err := conn.Write(ctx, websocket.MessageText, msg); err != nil {
		t.Fatalf("write: %v", err)
	}
	readCtx, readCancel := context.WithTimeout(ctx, wait)
	defer readCancel()
	_, data, err := conn.Read(readCtx)
	if err == nil {
		var ev WSEvent
		json.Unmarshal(data, &ev)
		return -1, ev.Op
	}
	var ce websocket.CloseError
	if !asCloseError(err, &ce) {
		return -2, err.Error()
	}
	return ce.Code, ce.Reason
}

func asCloseError(err error, ce *websocket.CloseError) bool {
	code := websocket.CloseStatus(err)
	if code == -1 {
		return false
	}
	ce.Code = code
	// CloseStatus drops the reason; recover it from the error text.
	ce.Reason = err.Error()
	return true
}

// Scenario V01: Health reports the build version
func TestScenarioV01_HealthVersion(t *testing.T) {
	v := healthVersion(t)
	if v == "" {
		t.Fatal("health has no version")
	}
	if v == "dev" {
		t.Fatal("validation build should be stamped with a git hash, got dev")
	}
}

// Scenario V02: ready carries the same version
func TestScenarioV02_ReadyServerVersion(t *testing.T) {
	ensureUsers(t)
	ws, err := ConnectWS(aliceToken)
	if err != nil {
		t.Fatalf("ws: %v", err)
	}
	defer ws.Close()
	if got, want := jsonStr(ws.Ready, "server_version"), healthVersion(t); got != want {
		t.Fatalf("ready.server_version=%q, health.version=%q", got, want)
	}
}

// Scenario V03: Invalid token closes the socket with 1008
func TestScenarioV03_InvalidTokenCloses1008(t *testing.T) {
	ensureUsers(t)
	code, reason := wsAuthCloseStatus(t, "not-a-real-token")
	if code != websocket.StatusPolicyViolation {
		t.Fatalf("expected close 1008, got %d (%s)", code, reason)
	}
	if !strings.Contains(reason, "token") {
		t.Fatalf("close reason should mention the token, got %q", reason)
	}
}

// Scenario V04: Pending account cannot log in and is told why
func TestScenarioV04_PendingAccountLoginBlocked(t *testing.T) {
	ensureAdmin(t)
	c := NewHTTPClient()
	name := uniqueName("pending")
	if status, _, _ := c.Register(name, "pendingpass"); status != 202 {
		t.Fatalf("register: expected 202, got %d", status)
	}
	status, body, _ := NewHTTPClient().Login(name, "pendingpass")
	if status == 200 {
		t.Fatal("unapproved user must not log in")
	}
	if !strings.Contains(strings.ToLower(fmt.Sprint(body)), "approv") {
		t.Fatalf("login refusal should mention approval, got %v", body)
	}
}

// Scenario V05: Deleted user is rejected on both transports
func TestScenarioV05_DeletedUserRejected(t *testing.T) {
	ensureAdmin(t)
	admin := NewHTTPClient()
	admin.Token = adminToken

	name := uniqueName("doomed")
	NewHTTPClient().Register(name, "doomedpass")
	_, users, _ := admin.GetJSONArray("/api/v1/admin/users")
	id := ""
	for _, u := range users {
		if jsonStr(u.(map[string]any), "username") == name {
			id = jsonStr(u.(map[string]any), "id")
		}
	}
	admin.PostJSON("/api/v1/admin/users/"+id+"/approve", nil)
	status, body, _ := NewHTTPClient().Login(name, "doomedpass")
	if status != 200 {
		t.Fatalf("login: %d %v", status, body)
	}
	token := jsonStr(body, "token")

	if status, _, _ := admin.DeleteJSON("/api/v1/admin/users/" + id); status != 200 {
		t.Fatalf("delete user: expected 200, got %d", status)
	}
	time.Sleep(200 * time.Millisecond)

	c := NewHTTPClient()
	c.Token = token
	if status, _, _ := c.GetJSON("/api/v1/channels"); status != 401 {
		t.Fatalf("REST after delete: expected 401, got %d", status)
	}
	if code, reason := wsAuthCloseStatus(t, token); code != websocket.StatusPolicyViolation {
		t.Fatalf("WS after delete: expected 1008, got %d (%s)", code, reason)
	}
}
