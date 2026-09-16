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
// MCP SCENARIOS — specs/scenarios/mcp-scenarios.md
// ============================================================

// mcpCall posts one JSON-RPC request to /api/v1/mcp with the given bearer
// secret and returns the HTTP status and decoded response (nil for 202).
func mcpCall(t *testing.T, secret string, method string, params any) (int, map[string]any) {
	t.Helper()
	req := map[string]any{"jsonrpc": "2.0", "id": 1, "method": method}
	if params != nil {
		req["params"] = params
	}
	return mcpRaw(t, secret, req)
}

func mcpRaw(t *testing.T, secret string, payload any) (int, map[string]any) {
	t.Helper()
	data, _ := json.Marshal(payload)
	httpReq, _ := http.NewRequest("POST", serverURL+"/api/v1/mcp", bytes.NewReader(data))
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "application/json, text/event-stream")
	httpReq.Header.Set("X-Real-IP", fmt.Sprintf("10.9.0.%d", nameCounter.Add(1)%250+1))
	if secret != "" {
		httpReq.Header.Set("Authorization", "Bearer "+secret)
	}
	resp, err := (&http.Client{Timeout: 10 * time.Second}).Do(httpReq)
	if err != nil {
		t.Fatalf("mcp request: %v", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	var out map[string]any
	if len(bytes.TrimSpace(body)) > 0 {
		_ = json.Unmarshal(body, &out)
	}
	return resp.StatusCode, out
}

// mcpToolText calls a tool and returns the text content plus isError.
func mcpToolText(t *testing.T, secret, tool string, args map[string]any) (string, bool) {
	t.Helper()
	status, resp := mcpCall(t, secret, "tools/call", map[string]any{"name": tool, "arguments": args})
	if status != 200 {
		t.Fatalf("tools/call %s: expected 200, got %d: %v", tool, status, resp)
	}
	if e := jsonMap(resp, "error"); e != nil {
		t.Fatalf("tools/call %s: rpc error: %v", tool, e)
	}
	result := jsonMap(resp, "result")
	content := jsonArray(result, "content")
	if len(content) == 0 {
		t.Fatalf("tools/call %s: empty content", tool)
	}
	first := content[0].(map[string]any)
	return jsonStr(first, "text"), jsonBool(result, "isError")
}

// createAPIKey mints a personal key for the given session token.
func createAPIKey(t *testing.T, token, name string) string {
	t.Helper()
	c := NewHTTPClient()
	c.Token = token
	status, body, err := c.PostJSON("/api/v1/api-keys", map[string]any{"name": name})
	if err != nil || status != 201 {
		t.Fatalf("create api key: status=%d err=%v body=%v", status, err, body)
	}
	key := jsonStr(body, "key")
	if !strings.HasPrefix(key, "lfp_") {
		t.Fatalf("api key should start with lfp_, got %q", key)
	}
	return key
}

// Scenario MCP01: Users can mint, list and revoke personal API keys.
func TestScenarioMCP01_APIKeyLifecycle(t *testing.T) {
	ensureUsers(t)
	c := NewHTTPClient()
	c.Token = aliceToken

	status, body, _ := c.PostJSON("/api/v1/api-keys", map[string]any{"name": "lifecycle"})
	if status != 201 {
		t.Fatalf("create: expected 201, got %d: %v", status, body)
	}
	id := jsonStr(body, "id")
	if jsonStr(body, "key_prefix") == "" || jsonStr(body, "key") == "" {
		t.Fatalf("create response missing key fields: %v", body)
	}

	status, list, _ := c.GetJSONArray("/api/v1/api-keys")
	if status != 200 {
		t.Fatalf("list: expected 200, got %d", status)
	}
	found := false
	for _, k := range list {
		km := k.(map[string]any)
		if jsonStr(km, "id") == id {
			found = true
			if _, hasKey := km["key"]; hasKey {
				t.Fatal("list must not include the full key")
			}
		}
	}
	if !found {
		t.Fatal("created key not in list")
	}

	status, _, _ = c.DeleteJSON("/api/v1/api-keys/" + id)
	if status != 200 {
		t.Fatalf("revoke: expected 200, got %d", status)
	}
	status, _, _ = c.DeleteJSON("/api/v1/api-keys/" + id)
	if status != 404 {
		t.Fatalf("revoke twice: expected 404, got %d", status)
	}
}

// Scenario MCP02: A user cannot revoke another user's key.
func TestScenarioMCP02_CannotRevokeOthersKey(t *testing.T) {
	ensureUsers(t)
	alice := NewHTTPClient()
	alice.Token = aliceToken
	_, body, _ := alice.PostJSON("/api/v1/api-keys", map[string]any{"name": "mine"})
	id := jsonStr(body, "id")

	bob := NewHTTPClient()
	bob.Token = bobToken
	status, _, _ := bob.DeleteJSON("/api/v1/api-keys/" + id)
	if status != 404 {
		t.Fatalf("expected 404 for foreign key, got %d", status)
	}
	alice.DeleteJSON("/api/v1/api-keys/" + id)
}

// Scenario MCP03: The endpoint rejects missing, invalid and revoked credentials.
func TestScenarioMCP03_AuthRequired(t *testing.T) {
	ensureUsers(t)
	if status, _ := mcpCall(t, "", "ping", nil); status != 401 {
		t.Fatalf("no auth: expected 401, got %d", status)
	}
	if status, _ := mcpCall(t, "lfp_notarealkey", "ping", nil); status != 401 {
		t.Fatalf("bad key: expected 401, got %d", status)
	}

	key := createAPIKey(t, aliceToken, "revoke-me")
	if status, _ := mcpCall(t, key, "ping", nil); status != 200 {
		t.Fatalf("valid key: expected 200, got %d", status)
	}
	c := NewHTTPClient()
	c.Token = aliceToken
	_, list, _ := c.GetJSONArray("/api/v1/api-keys")
	for _, k := range list {
		km := k.(map[string]any)
		if jsonStr(km, "name") == "revoke-me" {
			c.DeleteJSON("/api/v1/api-keys/" + jsonStr(km, "id"))
		}
	}
	if status, _ := mcpCall(t, key, "ping", nil); status != 401 {
		t.Fatalf("revoked key: expected 401, got %d", status)
	}
}

// Scenario MCP04: initialize negotiates a protocol version and advertises tools.
func TestScenarioMCP04_InitializeAndToolsList(t *testing.T) {
	ensureUsers(t)
	key := createAPIKey(t, aliceToken, "init")

	status, resp := mcpCall(t, key, "initialize", map[string]any{
		"protocolVersion": "2025-06-18",
		"capabilities":    map[string]any{},
		"clientInfo":      map[string]any{"name": "validation", "version": "1"},
	})
	if status != 200 {
		t.Fatalf("initialize: expected 200, got %d", status)
	}
	result := jsonMap(resp, "result")
	if jsonStr(result, "protocolVersion") != "2025-06-18" {
		t.Fatalf("unexpected protocolVersion: %v", result)
	}
	if jsonStr(jsonMap(result, "serverInfo"), "name") != "lefauxpain" {
		t.Fatalf("unexpected serverInfo: %v", result)
	}
	if !strings.Contains(jsonStr(result, "instructions"), aliceName) {
		t.Fatalf("instructions should name the acting user: %v", result)
	}

	// notifications/initialized is a notification: 202 with no body.
	status, _ = mcpRaw(t, key, map[string]any{"jsonrpc": "2.0", "method": "notifications/initialized"})
	if status != 202 {
		t.Fatalf("notification: expected 202, got %d", status)
	}

	status, resp = mcpCall(t, key, "tools/list", nil)
	if status != 200 {
		t.Fatalf("tools/list: expected 200, got %d", status)
	}
	names := map[string]bool{}
	for _, tl := range jsonArray(jsonMap(resp, "result"), "tools") {
		tm := tl.(map[string]any)
		names[jsonStr(tm, "name")] = true
		if jsonMap(tm, "inputSchema") == nil {
			t.Fatalf("tool %s has no inputSchema", jsonStr(tm, "name"))
		}
	}
	for _, want := range []string{"list_channels", "read_messages", "search_messages", "send_message", "list_users", "list_documents", "read_document"} {
		if !names[want] {
			t.Fatalf("tools/list missing %s: %v", want, names)
		}
	}

	status, resp = mcpCall(t, key, "no/such/method", nil)
	if status != 200 || jsonMap(resp, "error") == nil {
		t.Fatalf("unknown method should return a JSON-RPC error, got %d %v", status, resp)
	}
	if code, _ := jsonMap(resp, "error")["code"].(float64); int(code) != -32601 {
		t.Fatalf("unknown method: expected -32601, got %v", resp)
	}
}

// Scenario MCP05: send_message posts as the key owner and is broadcast live.
func TestScenarioMCP05_SendMessageBroadcasts(t *testing.T) {
	ensureUsers(t)
	key := createAPIKey(t, aliceToken, "send")

	bobWS, err := ConnectWS(bobToken)
	if err != nil {
		t.Fatalf("bob ws: %v", err)
	}
	defer bobWS.Close()
	channelID := findTextChannel(bobWS.Ready)
	channelName := ""
	for _, ch := range jsonArray(bobWS.Ready, "channels") {
		c := ch.(map[string]any)
		if jsonStr(c, "id") == channelID {
			channelName = jsonStr(c, "name")
		}
	}

	marker := uniqueName("mcp_hello")
	text, isErr := mcpToolText(t, key, "send_message", map[string]any{"channel": "#" + channelName, "content": marker})
	if isErr {
		t.Fatalf("send_message failed: %s", text)
	}

	data, err := bobWS.WaitForMatch("message_create", func(raw json.RawMessage) bool {
		m := parseData(raw)
		return jsonStr(m, "content") == marker
	}, wait)
	if err != nil {
		t.Fatalf("bob did not receive the MCP message: %v", err)
	}
	m := parseData(data)
	if jsonStr(jsonMap(m, "author"), "username") != aliceName {
		t.Fatalf("message should be attributed to alice, got %v", m)
	}

	// read_messages by channel id sees it too.
	text, isErr = mcpToolText(t, key, "read_messages", map[string]any{"channel": channelID, "limit": 5})
	if isErr || !strings.Contains(text, marker) {
		t.Fatalf("read_messages did not return the sent message: err=%v text=%s", isErr, text)
	}

	// search_messages finds it.
	text, isErr = mcpToolText(t, key, "search_messages", map[string]any{"query": marker})
	if isErr || !strings.Contains(text, marker) {
		t.Fatalf("search_messages did not find the message: err=%v text=%s", isErr, text)
	}
}

// Scenario MCP06: send_message validates content.
func TestScenarioMCP06_SendMessageValidation(t *testing.T) {
	ensureUsers(t)
	key := createAPIKey(t, aliceToken, "validate")
	ws, _ := ConnectWS(aliceToken)
	defer ws.Close()
	channelID := findTextChannel(ws.Ready)

	if text, isErr := mcpToolText(t, key, "send_message", map[string]any{"channel": channelID, "content": "   "}); !isErr {
		t.Fatalf("empty content should be a tool error, got %s", text)
	}
	if text, isErr := mcpToolText(t, key, "send_message", map[string]any{"channel": channelID, "content": strings.Repeat("x", 4001)}); !isErr {
		t.Fatalf("4001 chars should be a tool error, got %s", text)
	}
	if text, isErr := mcpToolText(t, key, "send_message", map[string]any{"channel": "#no-such-channel-xyz", "content": "hi"}); !isErr {
		t.Fatalf("unknown channel should be a tool error, got %s", text)
	}
}

// Scenario MCP07: Private channels are invisible to non-members through MCP.
func TestScenarioMCP07_PrivateChannelScoped(t *testing.T) {
	ensureUsers(t)
	adminWS, err := ConnectWS(adminToken)
	if err != nil {
		t.Fatalf("admin ws: %v", err)
	}
	defer adminWS.Close()

	name := uniqueName("mcp_private")
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
		t.Fatalf("set invisible: expected 200, got %d: %v", status, body)
	}
	// alice is a member, bob is not
	if status, body, _ := adminHTTP.PostJSON("/api/v1/channels/"+channelID+"/members", map[string]any{"user_id": aliceID, "role": "member"}); status != 200 && status != 201 {
		t.Fatalf("add alice: expected 2xx, got %d: %v", status, body)
	}

	aliceKey := createAPIKey(t, aliceToken, "private-a")
	bobKey := createAPIKey(t, bobToken, "private-b")

	secret := uniqueName("secret_word")
	if text, isErr := mcpToolText(t, aliceKey, "send_message", map[string]any{"channel": channelID, "content": secret}); isErr {
		t.Fatalf("alice (member) should post: %s", text)
	}

	// bob: listing hides it, reading/searching/posting fail as "not found".
	if text, _ := mcpToolText(t, bobKey, "list_channels", nil); strings.Contains(text, channelID) {
		t.Fatal("bob's list_channels should not include the private channel")
	}
	if text, isErr := mcpToolText(t, bobKey, "read_messages", map[string]any{"channel": channelID}); !isErr || strings.Contains(text, secret) {
		t.Fatalf("bob should not read the private channel: err=%v text=%s", isErr, text)
	}
	if text, _ := mcpToolText(t, bobKey, "search_messages", map[string]any{"query": secret}); strings.Contains(text, secret) {
		t.Fatalf("bob's search should not surface private content: %s", text)
	}
	if _, isErr := mcpToolText(t, bobKey, "send_message", map[string]any{"channel": channelID, "content": "intruder"}); !isErr {
		t.Fatal("bob should not be able to post to the private channel")
	}

	// alice: everything works.
	if text, _ := mcpToolText(t, aliceKey, "list_channels", nil); !strings.Contains(text, channelID) {
		t.Fatal("alice's list_channels should include the private channel")
	}
	if text, isErr := mcpToolText(t, aliceKey, "search_messages", map[string]any{"query": secret}); isErr || !strings.Contains(text, secret) {
		t.Fatalf("alice's search should find private content: %s", text)
	}
}

// Scenario MCP08: A session token also authenticates the endpoint.
func TestScenarioMCP08_SessionTokenAccepted(t *testing.T) {
	ensureUsers(t)
	status, resp := mcpCall(t, aliceToken, "ping", nil)
	if status != 200 || jsonMap(resp, "result") == nil {
		t.Fatalf("session token: expected 200 with result, got %d %v", status, resp)
	}
	status, _ = mcpCall(t, "not-a-token", "ping", nil)
	if status != 401 {
		t.Fatalf("garbage token: expected 401, got %d", status)
	}
}

// Scenario MCP09: GET is refused (no server-initiated stream).
func TestScenarioMCP09_GetNotOffered(t *testing.T) {
	ensureUsers(t)
	req, _ := http.NewRequest("GET", serverURL+"/api/v1/mcp", nil)
	req.Header.Set("Authorization", "Bearer "+aliceToken)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != 405 {
		t.Fatalf("GET: expected 405, got %d", resp.StatusCode)
	}
}

// patchJSON sends a PATCH with a JSON body using the HTTPClient's auth and IP.
func patchJSON(t *testing.T, c *HTTPClient, path string, body any) (int, map[string]any) {
	t.Helper()
	resp, err := c.do("PATCH", path, body)
	if err != nil {
		t.Fatalf("patch %s: %v", path, err)
	}
	defer resp.Body.Close()
	var out map[string]any
	json.NewDecoder(resp.Body).Decode(&out)
	return resp.StatusCode, out
}
