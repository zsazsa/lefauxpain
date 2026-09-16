package api

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"

	"github.com/google/uuid"
	"github.com/kalman/voicechat/db"
	"github.com/kalman/voicechat/ws"
)

// MCPHandler exposes the server to AI assistants over the Model Context
// Protocol (Streamable HTTP transport, stateless mode). Every request is
// authenticated with a personal API key or session token, and every tool
// acts as that user with that user's channel permissions.
//
// Supported: initialize, ping, tools/list, tools/call, resources/list and
// prompts/list (both empty). GET (server-initiated SSE streams) is not
// offered; the spec allows a server to answer it with 405.
type MCPHandler struct {
	DB  *db.DB
	Hub *ws.Hub
}

const (
	mcpProtocolVersion = "2025-06-18"
	mcpServerName      = "lefauxpain"
	mcpServerVersion   = "1.0.0"
	mcpMaxBody         = 1 << 20
	mcpMaxContent      = 4000
)

// mcpSupportedVersions lists protocol versions we answer with verbatim; an
// unknown request version gets mcpProtocolVersion.
var mcpSupportedVersions = map[string]bool{
	"2024-11-05": true,
	"2025-03-26": true,
	"2025-06-18": true,
	"2025-11-25": true,
}

type jsonRPCRequest struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id,omitempty"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
}

type jsonRPCError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Data    any    `json:"data,omitempty"`
}

type jsonRPCResponse struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Result  any             `json:"result,omitempty"`
	Error   *jsonRPCError   `json:"error,omitempty"`
}

const (
	rpcParseError     = -32700
	rpcInvalidRequest = -32600
	rpcMethodNotFound = -32601
	rpcInvalidParams  = -32602
	rpcInternalError  = -32603
)

// mcpTool is one callable tool. run returns the text shown to the model and
// whether it represents a tool-level error (isError in the MCP result).
type mcpTool struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	InputSchema map[string]any `json:"inputSchema"`
	run         func(h *MCPHandler, user *db.User, args json.RawMessage) (string, bool)
}

func (h *MCPHandler) authenticate(r *http.Request) (*db.User, string) {
	auth := r.Header.Get("Authorization")
	if !strings.HasPrefix(auth, "Bearer ") {
		return nil, "missing bearer token"
	}
	secret := strings.TrimSpace(strings.TrimPrefix(auth, "Bearer "))
	var user *db.User
	var err error
	if strings.HasPrefix(secret, db.APIKeyPrefix) {
		user, err = h.DB.GetUserByAPIKey(secret)
	} else {
		user, err = h.DB.GetUserByToken(secret)
	}
	if err != nil {
		log.Printf("mcp auth: %v", err)
		return nil, "internal error"
	}
	if user == nil {
		return nil, "invalid token"
	}
	if !user.Approved {
		return nil, "account pending approval"
	}
	return user, ""
}

// ServeHTTP handles POST /api/v1/mcp.
func (h *MCPHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodPost:
	case http.MethodDelete:
		// Stateless server: there is no session to terminate.
		w.WriteHeader(http.StatusNoContent)
		return
	case http.MethodGet:
		w.Header().Set("Allow", "POST")
		writeError(w, http.StatusMethodNotAllowed, "this MCP server does not offer a server-initiated event stream")
		return
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	user, authErr := h.authenticate(r)
	if user == nil {
		w.Header().Set("WWW-Authenticate", `Bearer realm="lefauxpain-mcp"`)
		writeError(w, http.StatusUnauthorized, authErr)
		return
	}

	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, mcpMaxBody))
	if err != nil {
		writeError(w, http.StatusRequestEntityTooLarge, "request body too large")
		return
	}
	body = []byte(strings.TrimSpace(string(body)))
	if len(body) == 0 {
		writeError(w, http.StatusBadRequest, "empty body")
		return
	}

	// A batch (JSON array) is handled element by element for older clients.
	if body[0] == '[' {
		var reqs []jsonRPCRequest
		if err := json.Unmarshal(body, &reqs); err != nil {
			h.writeRPC(w, http.StatusOK, rpcErrorResponse(nil, rpcParseError, "parse error"))
			return
		}
		var responses []jsonRPCResponse
		for i := range reqs {
			if resp := h.dispatch(user, &reqs[i]); resp != nil {
				responses = append(responses, *resp)
			}
		}
		if len(responses) == 0 {
			w.WriteHeader(http.StatusAccepted)
			return
		}
		h.writeRPC(w, http.StatusOK, responses)
		return
	}

	var req jsonRPCRequest
	if err := json.Unmarshal(body, &req); err != nil {
		h.writeRPC(w, http.StatusOK, rpcErrorResponse(nil, rpcParseError, "parse error"))
		return
	}
	resp := h.dispatch(user, &req)
	if resp == nil {
		// Notification or response from the client: acknowledge without a body.
		w.WriteHeader(http.StatusAccepted)
		return
	}
	h.writeRPC(w, http.StatusOK, resp)
}

func (h *MCPHandler) writeRPC(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func rpcErrorResponse(id json.RawMessage, code int, msg string) *jsonRPCResponse {
	if id == nil {
		id = json.RawMessage("null")
	}
	return &jsonRPCResponse{JSONRPC: "2.0", ID: id, Error: &jsonRPCError{Code: code, Message: msg}}
}

func rpcResult(id json.RawMessage, result any) *jsonRPCResponse {
	return &jsonRPCResponse{JSONRPC: "2.0", ID: id, Result: result}
}

// dispatch routes one JSON-RPC message. It returns nil for notifications.
func (h *MCPHandler) dispatch(user *db.User, req *jsonRPCRequest) *jsonRPCResponse {
	isNotification := len(req.ID) == 0 || string(req.ID) == "null"
	if req.JSONRPC != "2.0" || req.Method == "" {
		if isNotification {
			return nil
		}
		return rpcErrorResponse(req.ID, rpcInvalidRequest, "invalid request")
	}
	if strings.HasPrefix(req.Method, "notifications/") {
		return nil
	}
	if isNotification {
		return nil
	}

	switch req.Method {
	case "initialize":
		var p struct {
			ProtocolVersion string `json:"protocolVersion"`
		}
		_ = json.Unmarshal(req.Params, &p)
		version := mcpProtocolVersion
		if mcpSupportedVersions[p.ProtocolVersion] {
			version = p.ProtocolVersion
		}
		return rpcResult(req.ID, map[string]any{
			"protocolVersion": version,
			"capabilities": map[string]any{
				"tools": map[string]any{"listChanged": false},
			},
			"serverInfo": map[string]any{
				"name":    mcpServerName,
				"title":   "Le Faux Pain",
				"version": mcpServerVersion,
			},
			"instructions": fmt.Sprintf(
				"You are connected to a Le Faux Pain chat server as user %q. "+
					"Tools read and post on that user's behalf and respect their channel permissions. "+
					"Channels can be referenced by name (with or without #) or by id. "+
					"Messages you send appear under this user's name, so confirm with them before posting.",
				user.Username),
		})

	case "ping":
		return rpcResult(req.ID, map[string]any{})

	case "tools/list":
		return rpcResult(req.ID, map[string]any{"tools": mcpTools})

	case "tools/call":
		var p struct {
			Name      string          `json:"name"`
			Arguments json.RawMessage `json:"arguments"`
		}
		if err := json.Unmarshal(req.Params, &p); err != nil || p.Name == "" {
			return rpcErrorResponse(req.ID, rpcInvalidParams, "tools/call requires a name")
		}
		for i := range mcpTools {
			if mcpTools[i].Name != p.Name {
				continue
			}
			if len(p.Arguments) == 0 {
				p.Arguments = json.RawMessage("{}")
			}
			text, isErr := mcpTools[i].run(h, user, p.Arguments)
			return rpcResult(req.ID, map[string]any{
				"content": []map[string]any{{"type": "text", "text": text}},
				"isError": isErr,
			})
		}
		return rpcErrorResponse(req.ID, rpcInvalidParams, "unknown tool: "+p.Name)

	case "resources/list":
		return rpcResult(req.ID, map[string]any{"resources": []any{}})
	case "resources/templates/list":
		return rpcResult(req.ID, map[string]any{"resourceTemplates": []any{}})
	case "prompts/list":
		return rpcResult(req.ID, map[string]any{"prompts": []any{}})
	case "logging/setLevel":
		return rpcResult(req.ID, map[string]any{})
	}
	return rpcErrorResponse(req.ID, rpcMethodNotFound, "method not found: "+req.Method)
}

// --- tools ---

func toolText(v any) string {
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return fmt.Sprintf("%v", v)
	}
	return string(b)
}

// resolveChannel finds a text channel by id or name that the user may read.
// Inaccessible and non-existent channels both come back as "not found" so the
// tool never confirms that a private channel exists.
func (h *MCPHandler) resolveChannel(user *db.User, ref string) (*db.Channel, string) {
	ref = strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(ref), "#"))
	if ref == "" {
		return nil, "channel is required"
	}
	var ch *db.Channel
	var err error
	if _, perr := uuid.Parse(ref); perr == nil {
		ch, err = h.DB.GetChannelByID(ref)
	} else {
		ch, err = h.DB.GetChannelByName(ref)
	}
	if err != nil {
		log.Printf("mcp resolve channel: %v", err)
		return nil, "internal error"
	}
	if ch == nil || ch.DeletedAt != nil {
		return nil, "channel not found"
	}
	ok, err := h.DB.CanAccessChannel(ch.ID, user.ID, user.IsAdmin)
	if err != nil || !ok {
		return nil, "channel not found"
	}
	return ch, ""
}

func schema(props map[string]any, required ...string) map[string]any {
	s := map[string]any{"type": "object", "properties": props}
	if len(required) > 0 {
		s["required"] = required
	}
	return s
}

var mcpTools = []mcpTool{
	{
		Name:        "list_channels",
		Description: "List the text channels this user can read, with ids, visibility and descriptions.",
		InputSchema: schema(map[string]any{}),
		run: func(h *MCPHandler, user *db.User, _ json.RawMessage) (string, bool) {
			chans, err := h.DB.GetChannelsForUser(user.ID, user.IsAdmin)
			if err != nil {
				return "internal error", true
			}
			type item struct {
				ID          string  `json:"id"`
				Name        string  `json:"name"`
				Type        string  `json:"type"`
				Visibility  string  `json:"visibility"`
				Description *string `json:"description,omitempty"`
				IsMember    bool    `json:"is_member"`
			}
			out := []item{}
			for _, c := range chans {
				if c.Type != "text" {
					continue
				}
				// "visible" channels are listed but only members can read them.
				if c.Visibility != "public" && !c.IsMember && !user.IsAdmin {
					continue
				}
				out = append(out, item{ID: c.ID, Name: c.Name, Type: c.Type, Visibility: c.Visibility, Description: c.Description, IsMember: c.IsMember})
			}
			return toolText(out), false
		},
	},
	{
		Name:        "read_messages",
		Description: "Read recent messages from a channel, newest first. Use `before` (a message id) to page further back.",
		InputSchema: schema(map[string]any{
			"channel": map[string]any{"type": "string", "description": "Channel name (with or without #) or channel id"},
			"limit":   map[string]any{"type": "integer", "minimum": 1, "maximum": 100, "default": 30},
			"before":  map[string]any{"type": "string", "description": "Only return messages older than this message id"},
		}, "channel"),
		run: func(h *MCPHandler, user *db.User, args json.RawMessage) (string, bool) {
			var a struct {
				Channel string  `json:"channel"`
				Limit   int     `json:"limit"`
				Before  *string `json:"before"`
			}
			if err := json.Unmarshal(args, &a); err != nil {
				return "invalid arguments", true
			}
			ch, msg := h.resolveChannel(user, a.Channel)
			if ch == nil {
				return msg, true
			}
			if ch.Type != "text" {
				return "not a text channel", true
			}
			if a.Limit <= 0 {
				a.Limit = 30
			}
			msgs, err := h.DB.GetMessages(ch.ID, a.Limit, a.Before)
			if err != nil {
				return "internal error", true
			}
			type item struct {
				ID        string  `json:"id"`
				Author    string  `json:"author"`
				Content   *string `json:"content"`
				ReplyToID *string `json:"reply_to_id,omitempty"`
				ThreadID  *string `json:"thread_id,omitempty"`
				CreatedAt string  `json:"created_at"`
				EditedAt  *string `json:"edited_at,omitempty"`
			}
			out := []item{}
			for _, m := range msgs {
				if m.DeletedAt != nil {
					continue
				}
				out = append(out, item{ID: m.ID, Author: m.AuthorUsername, Content: m.Content, ReplyToID: m.ReplyToID, ThreadID: m.ThreadID, CreatedAt: m.CreatedAt, EditedAt: m.EditedAt})
			}
			return toolText(map[string]any{"channel": ch.Name, "channel_id": ch.ID, "messages": out}), false
		},
	},
	{
		Name:        "search_messages",
		Description: "Case-insensitive substring search across messages this user can read. Optionally restrict to one channel.",
		InputSchema: schema(map[string]any{
			"query":   map[string]any{"type": "string", "minLength": 1},
			"channel": map[string]any{"type": "string", "description": "Optional channel name or id"},
			"limit":   map[string]any{"type": "integer", "minimum": 1, "maximum": 100, "default": 25},
		}, "query"),
		run: func(h *MCPHandler, user *db.User, args json.RawMessage) (string, bool) {
			var a struct {
				Query   string `json:"query"`
				Channel string `json:"channel"`
				Limit   int    `json:"limit"`
			}
			if err := json.Unmarshal(args, &a); err != nil || strings.TrimSpace(a.Query) == "" {
				return "query is required", true
			}
			channelID := ""
			if strings.TrimSpace(a.Channel) != "" {
				ch, msg := h.resolveChannel(user, a.Channel)
				if ch == nil {
					return msg, true
				}
				channelID = ch.ID
			}
			results, err := h.DB.SearchMessages(user.ID, user.IsAdmin, strings.TrimSpace(a.Query), channelID, a.Limit)
			if err != nil {
				return "internal error", true
			}
			return toolText(results), false
		},
	},
	{
		Name:        "send_message",
		Description: "Post a message to a text channel as this user. The message is attributed to the user, so confirm with them first.",
		InputSchema: schema(map[string]any{
			"channel": map[string]any{"type": "string", "description": "Channel name (with or without #) or channel id"},
			"content": map[string]any{"type": "string", "minLength": 1, "maxLength": mcpMaxContent},
		}, "channel", "content"),
		run: func(h *MCPHandler, user *db.User, args json.RawMessage) (string, bool) {
			var a struct {
				Channel string `json:"channel"`
				Content string `json:"content"`
			}
			if err := json.Unmarshal(args, &a); err != nil {
				return "invalid arguments", true
			}
			content := strings.TrimSpace(a.Content)
			if content == "" {
				return "content is required", true
			}
			if len(content) > mcpMaxContent {
				return fmt.Sprintf("content exceeds %d characters", mcpMaxContent), true
			}
			ch, msg := h.resolveChannel(user, a.Channel)
			if ch == nil {
				return msg, true
			}
			if ch.Type != "text" {
				return "not a text channel", true
			}
			// Members-only channels also require membership to post (matches the WS path).
			if ch.Visibility != "public" && !user.IsAdmin {
				isMember, err := h.DB.IsChannelMember(ch.ID, user.ID)
				if err != nil || !isMember {
					return "channel not found", true
				}
			}

			msgID := uuid.New().String()
			created, err := h.DB.CreateMessage(msgID, ch.ID, user.ID, &content, nil)
			if err != nil {
				log.Printf("mcp create message: %v", err)
				return "failed to create message", true
			}
			broadcast, _ := ws.NewMessage("message_create", ws.MessageCreatePayload{
				ID:          created.ID,
				ChannelID:   created.ChannelID,
				Author:      ws.UserPayload{ID: user.ID, Username: user.Username},
				Content:     created.Content,
				Attachments: []ws.AttachmentPayload{},
				Mentions:    []string{},
				CreatedAt:   created.CreatedAt,
			})
			if ch.Visibility != "public" {
				h.Hub.BroadcastToMembers(broadcast, ch.ID)
			} else {
				h.Hub.BroadcastAll(broadcast)
			}
			return toolText(map[string]any{"id": created.ID, "channel": ch.Name, "channel_id": ch.ID, "created_at": created.CreatedAt}), false
		},
	},
	{
		Name:        "list_users",
		Description: "List approved users on the server and whether each is currently online.",
		InputSchema: schema(map[string]any{}),
		run: func(h *MCPHandler, user *db.User, _ json.RawMessage) (string, bool) {
			users, err := h.DB.GetAllUsers()
			if err != nil {
				return "internal error", true
			}
			online := map[string]bool{}
			for _, u := range h.Hub.OnlineUsers() {
				online[u.ID] = true
			}
			type item struct {
				ID       string `json:"id"`
				Username string `json:"username"`
				IsAdmin  bool   `json:"is_admin"`
				Online   bool   `json:"online"`
			}
			out := []item{}
			for _, u := range users {
				if !u.Approved || u.ID == db.BotUserID {
					continue
				}
				out = append(out, item{ID: u.ID, Username: u.Username, IsAdmin: u.IsAdmin, Online: online[u.ID]})
			}
			return toolText(out), false
		},
	},
	{
		Name:        "list_documents",
		Description: "List the markdown documents attached to a channel.",
		InputSchema: schema(map[string]any{
			"channel": map[string]any{"type": "string"},
		}, "channel"),
		run: func(h *MCPHandler, user *db.User, args json.RawMessage) (string, bool) {
			var a struct {
				Channel string `json:"channel"`
			}
			if err := json.Unmarshal(args, &a); err != nil {
				return "invalid arguments", true
			}
			ch, msg := h.resolveChannel(user, a.Channel)
			if ch == nil {
				return msg, true
			}
			docs, err := h.DB.ListDocuments(ch.ID, "")
			if err != nil {
				return "internal error", true
			}
			if docs == nil {
				docs = []db.DocumentMeta{}
			}
			return toolText(map[string]any{"channel": ch.Name, "documents": docs}), false
		},
	},
	{
		Name:        "read_document",
		Description: "Read one channel document by path.",
		InputSchema: schema(map[string]any{
			"channel": map[string]any{"type": "string"},
			"path":    map[string]any{"type": "string", "description": "Document path as returned by list_documents"},
		}, "channel", "path"),
		run: func(h *MCPHandler, user *db.User, args json.RawMessage) (string, bool) {
			var a struct {
				Channel string `json:"channel"`
				Path    string `json:"path"`
			}
			if err := json.Unmarshal(args, &a); err != nil || strings.TrimSpace(a.Path) == "" {
				return "channel and path are required", true
			}
			ch, msg := h.resolveChannel(user, a.Channel)
			if ch == nil {
				return msg, true
			}
			doc, err := h.DB.GetDocument(ch.ID, strings.TrimSpace(a.Path))
			if err != nil || doc == nil {
				return "document not found", true
			}
			return doc.Content, false
		},
	},
}
