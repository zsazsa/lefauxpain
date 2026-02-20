package validation

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"nhooyr.io/websocket"
)

// serverURL is the base URL of the running server under test.
var serverURL string

func init() {
	serverURL = os.Getenv("SERVER_URL")
	if serverURL == "" {
		serverURL = "http://localhost:8080"
	}
}

// --- Unique name generation ---

var nameCounter atomic.Int64

func uniqueName(prefix string) string {
	n := nameCounter.Add(1)
	return fmt.Sprintf("%s_%d", prefix, n)
}

// --- HTTP Client ---

// HTTPClient wraps net/http with JSON helpers and auth.
type HTTPClient struct {
	Token  string
	FakeIP string // sent as X-Real-IP to isolate rate limits
	client *http.Client
}

func NewHTTPClient() *HTTPClient {
	return &HTTPClient{
		FakeIP: fmt.Sprintf("10.0.0.%d", nameCounter.Add(1)),
		client: &http.Client{Timeout: 10 * time.Second},
	}
}

func (c *HTTPClient) do(method, path string, body any) (*http.Response, error) {
	var bodyReader io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		bodyReader = bytes.NewReader(data)
	}

	req, err := http.NewRequest(method, serverURL+path, bodyReader)
	if err != nil {
		return nil, err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if c.Token != "" {
		req.Header.Set("Authorization", "Bearer "+c.Token)
	}
	if c.FakeIP != "" {
		req.Header.Set("X-Real-IP", c.FakeIP)
	}

	return c.client.Do(req)
}

func (c *HTTPClient) PostJSON(path string, body any) (int, map[string]any, error) {
	resp, err := c.do("POST", path, body)
	if err != nil {
		return 0, nil, err
	}
	defer resp.Body.Close()

	var result map[string]any
	json.NewDecoder(resp.Body).Decode(&result)
	return resp.StatusCode, result, nil
}

func (c *HTTPClient) GetJSON(path string) (int, map[string]any, error) {
	resp, err := c.do("GET", path, nil)
	if err != nil {
		return 0, nil, err
	}
	defer resp.Body.Close()

	var result map[string]any
	json.NewDecoder(resp.Body).Decode(&result)
	return resp.StatusCode, result, nil
}

func (c *HTTPClient) GetJSONArray(path string) (int, []any, error) {
	resp, err := c.do("GET", path, nil)
	if err != nil {
		return 0, nil, err
	}
	defer resp.Body.Close()

	var result []any
	json.NewDecoder(resp.Body).Decode(&result)
	return resp.StatusCode, result, nil
}

func (c *HTTPClient) DeleteJSON(path string) (int, map[string]any, error) {
	resp, err := c.do("DELETE", path, nil)
	if err != nil {
		return 0, nil, err
	}
	defer resp.Body.Close()

	var result map[string]any
	json.NewDecoder(resp.Body).Decode(&result)
	return resp.StatusCode, result, nil
}

func (c *HTTPClient) Register(username, password string) (int, map[string]any, error) {
	return c.PostJSON("/api/v1/auth/register", map[string]any{
		"username": username,
		"password": password,
	})
}

func (c *HTTPClient) Login(username, password string) (int, map[string]any, error) {
	return c.PostJSON("/api/v1/auth/login", map[string]any{
		"username": username,
		"password": password,
	})
}

// UploadFile sends a multipart file upload. Returns status, parsed JSON body, error.
func (c *HTTPClient) UploadFile(path, fieldName, filename string, data []byte, contentType string) (int, map[string]any, error) {
	body := &bytes.Buffer{}
	boundary := "----ValidationBoundary"
	body.WriteString("--" + boundary + "\r\n")
	body.WriteString(fmt.Sprintf("Content-Disposition: form-data; name=%q; filename=%q\r\n", fieldName, filename))
	body.WriteString(fmt.Sprintf("Content-Type: %s\r\n\r\n", contentType))
	body.Write(data)
	body.WriteString("\r\n--" + boundary + "--\r\n")

	req, err := http.NewRequest("POST", serverURL+path, body)
	if err != nil {
		return 0, nil, err
	}
	req.Header.Set("Content-Type", "multipart/form-data; boundary="+boundary)
	if c.Token != "" {
		req.Header.Set("Authorization", "Bearer "+c.Token)
	}
	if c.FakeIP != "" {
		req.Header.Set("X-Real-IP", c.FakeIP)
	}

	resp, err := c.client.Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer resp.Body.Close()

	var result map[string]any
	json.NewDecoder(resp.Body).Decode(&result)
	return resp.StatusCode, result, nil
}

// --- WebSocket Client ---

// WSEvent is a single WebSocket protocol message.
type WSEvent struct {
	Op   string          `json:"op"`
	Data json.RawMessage `json:"d"`
}

// WSClient is a test WebSocket client that buffers incoming events.
type WSClient struct {
	conn   *websocket.Conn
	ctx    context.Context
	cancel context.CancelFunc
	Ready  map[string]any // parsed ready payload

	mu     sync.Mutex
	events []WSEvent
	notify chan struct{}
	done   chan struct{} // closed when readLoop exits
}

// ConnectWS authenticates via WebSocket and returns a client with the ready payload.
func ConnectWS(token string) (*WSClient, error) {
	wsURL := strings.Replace(serverURL, "http://", "ws://", 1)
	wsURL = strings.Replace(wsURL, "https://", "wss://", 1)
	wsURL += "/ws"

	ctx, cancel := context.WithCancel(context.Background())

	conn, _, err := websocket.Dial(ctx, wsURL, nil)
	if err != nil {
		cancel()
		return nil, fmt.Errorf("dial: %w", err)
	}

	// Increase read limit for large ready payloads
	conn.SetReadLimit(1 << 20) // 1MB

	w := &WSClient{
		conn:   conn,
		ctx:    ctx,
		cancel: cancel,
		notify: make(chan struct{}, 100),
		done:   make(chan struct{}),
	}

	// Send authenticate
	authMsg, _ := json.Marshal(map[string]any{
		"op": "authenticate",
		"d":  map[string]any{"token": token},
	})
	if err := conn.Write(ctx, websocket.MessageText, authMsg); err != nil {
		conn.Close(websocket.StatusNormalClosure, "")
		cancel()
		return nil, fmt.Errorf("auth write: %w", err)
	}

	// Read ready
	_, data, err := conn.Read(ctx)
	if err != nil {
		conn.Close(websocket.StatusNormalClosure, "")
		cancel()
		return nil, fmt.Errorf("ready read: %w", err)
	}

	var readyMsg WSEvent
	if err := json.Unmarshal(data, &readyMsg); err != nil {
		conn.Close(websocket.StatusNormalClosure, "")
		cancel()
		return nil, fmt.Errorf("ready parse: %w", err)
	}
	if readyMsg.Op != "ready" {
		conn.Close(websocket.StatusNormalClosure, "")
		cancel()
		return nil, fmt.Errorf("expected ready, got %s", readyMsg.Op)
	}

	var readyData map[string]any
	json.Unmarshal(readyMsg.Data, &readyData)
	w.Ready = readyData

	go w.readLoop()

	return w, nil
}

// DialWSRaw connects without authenticating — for testing auth failure.
func DialWSRaw() (*websocket.Conn, context.Context, context.CancelFunc, error) {
	wsURL := strings.Replace(serverURL, "http://", "ws://", 1)
	wsURL = strings.Replace(wsURL, "https://", "wss://", 1)
	wsURL += "/ws"

	ctx, cancel := context.WithCancel(context.Background())
	conn, _, err := websocket.Dial(ctx, wsURL, nil)
	if err != nil {
		cancel()
		return nil, nil, nil, err
	}
	return conn, ctx, cancel, nil
}

func (w *WSClient) readLoop() {
	defer close(w.done)
	for {
		_, data, err := w.conn.Read(w.ctx)
		if err != nil {
			return
		}
		var ev WSEvent
		if err := json.Unmarshal(data, &ev); err != nil {
			continue
		}
		if ev.Op == "pong" {
			continue // ignore pongs
		}
		w.mu.Lock()
		w.events = append(w.events, ev)
		w.mu.Unlock()
		select {
		case w.notify <- struct{}{}:
		default:
		}
	}
}

// Send marshals and sends a WS op.
func (w *WSClient) Send(op string, data any) error {
	msg, _ := json.Marshal(map[string]any{"op": op, "d": data})
	return w.conn.Write(w.ctx, websocket.MessageText, msg)
}

// WaitFor waits for the first event matching the given op.
func (w *WSClient) WaitFor(op string, timeout time.Duration) (json.RawMessage, error) {
	deadline := time.After(timeout)
	for {
		w.mu.Lock()
		for i, ev := range w.events {
			if ev.Op == op {
				w.events = append(w.events[:i], w.events[i+1:]...)
				w.mu.Unlock()
				return ev.Data, nil
			}
		}
		w.mu.Unlock()

		select {
		case <-w.notify:
			continue
		case <-deadline:
			return nil, fmt.Errorf("timeout waiting for op %q (%v)", op, timeout)
		}
	}
}

// WaitForMatch waits for an event with matching op where the predicate returns true.
func (w *WSClient) WaitForMatch(op string, match func(json.RawMessage) bool, timeout time.Duration) (json.RawMessage, error) {
	deadline := time.After(timeout)
	for {
		w.mu.Lock()
		for i, ev := range w.events {
			if ev.Op == op && match(ev.Data) {
				w.events = append(w.events[:i], w.events[i+1:]...)
				w.mu.Unlock()
				return ev.Data, nil
			}
		}
		w.mu.Unlock()

		select {
		case <-w.notify:
			continue
		case <-deadline:
			return nil, fmt.Errorf("timeout waiting for op %q match (%v)", op, timeout)
		}
	}
}

// Drain clears all buffered events.
func (w *WSClient) Drain() {
	w.mu.Lock()
	w.events = nil
	w.mu.Unlock()
}

// WaitClosed waits for the server to close this connection.
func (w *WSClient) WaitClosed(timeout time.Duration) error {
	select {
	case <-w.done:
		return nil
	case <-time.After(timeout):
		return fmt.Errorf("timeout waiting for connection close")
	}
}

// Close shuts down the client.
func (w *WSClient) Close() {
	w.cancel()
	w.conn.Close(websocket.StatusNormalClosure, "")
}

// --- JSON helpers ---

// jsonStr extracts a string from a parsed JSON map.
func jsonStr(m map[string]any, key string) string {
	v, _ := m[key].(string)
	return v
}

// jsonBool extracts a bool from a parsed JSON map.
func jsonBool(m map[string]any, key string) bool {
	v, _ := m[key].(bool)
	return v
}

// jsonMap extracts a nested map from a parsed JSON map.
func jsonMap(m map[string]any, key string) map[string]any {
	v, _ := m[key].(map[string]any)
	return v
}

// jsonArray extracts a slice from a parsed JSON map.
func jsonArray(m map[string]any, key string) []any {
	v, _ := m[key].([]any)
	return v
}

// parseData unmarshals a json.RawMessage into a map.
func parseData(data json.RawMessage) map[string]any {
	var m map[string]any
	json.Unmarshal(data, &m)
	return m
}

// --- Test fixture: 1x1 white PNG ---

var pngData = []byte{
	0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
	0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
	0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, // 1x1
	0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, // 8-bit RGB
	0xDE, 0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41, // IDAT chunk
	0x54, 0x08, 0xD7, 0x63, 0xF8, 0xCF, 0xC0, 0x00,
	0x00, 0x00, 0x02, 0x00, 0x01, 0xE2, 0x21, 0xBC,
	0x33, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, // IEND chunk
	0x44, 0xAE, 0x42, 0x60, 0x82,
}
