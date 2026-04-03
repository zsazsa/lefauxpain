# Channel Membership — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add channel membership, roles (owner/member), and visibility (public/visible/invisible) to Le Faux Pain, with server-enforced access control.

**Architecture:** Add `visibility` and `description` to channels table, create `channel_members` table (replacing `channel_managers`), create `channel_access_requests` table. Server enforces access at every level. Channel settings modal for owners/admins.

**Tech Stack:** Go (backend), SQLite, SolidJS (frontend), WebSocket

**Codebase:** `~/projects/GamersGuild/`

---

## Task 1: Database Migration + DB Layer

**Files:**
- Modify: `server/db/migrations.go` — migration 23
- Modify: `server/db/channels.go` — replace manager functions with membership functions
- Modify: `server/db/users.go` — update Channel struct

### Migration 23

Add to the migrations slice:

```go
	// Version 23: Channel membership, roles, and visibility
	`ALTER TABLE channels ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public';
	ALTER TABLE channels ADD COLUMN description TEXT;

	CREATE TABLE channel_members (
		channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
		user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		role       TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('owner', 'member')),
		created_at DATETIME DEFAULT (datetime('now')),
		PRIMARY KEY (channel_id, user_id)
	);
	CREATE INDEX idx_channel_members_user ON channel_members(user_id);

	CREATE TABLE channel_access_requests (
		id         TEXT PRIMARY KEY,
		channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
		user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		status     TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'denied')),
		created_at DATETIME DEFAULT (datetime('now')),
		UNIQUE(channel_id, user_id)
	);
	CREATE INDEX idx_channel_requests_channel ON channel_access_requests(channel_id, status);

	-- Migrate existing channel_managers to channel_members as owners
	INSERT OR IGNORE INTO channel_members (channel_id, user_id, role)
		SELECT channel_id, user_id, 'owner' FROM channel_managers;`,
```

### Update Channel struct in users.go

Add `Visibility` and `Description` fields:

```go
type Channel struct {
	ID          string  `json:"id"`
	Name        string  `json:"name"`
	Type        string  `json:"type"`
	Position    int     `json:"position"`
	Visibility  string  `json:"visibility"`
	Description *string `json:"description"`
	CreatedBy   *string `json:"created_by"`
	DeletedAt   *string `json:"deleted_at"`
	CreatedAt   string  `json:"created_at"`
}
```

Update ALL queries that SELECT into Channel to include `visibility` and `description`.

### Update channels.go

Replace all `channel_managers` references with `channel_members`:
- `AddChannelManager` → `AddChannelMember(channelID, userID, role string)`
- `RemoveChannelManager` → `RemoveChannelMember(channelID, userID string)`
- `GetChannelManagers` → `GetChannelMembers(channelID string) ([]ChannelMember, error)`
- `IsChannelManager` → `IsChannelMember(channelID, userID string) (bool, error)` and `GetMemberRole(channelID, userID string) (string, error)`
- `GetAllChannelManagers` → `GetAllChannelMembers() (map[string][]ChannelMember, error)`

Add new struct:
```go
type ChannelMember struct {
	ChannelID string `json:"channel_id"`
	UserID    string `json:"user_id"`
	Username  string `json:"username"`
	Role      string `json:"role"`
	CreatedAt string `json:"created_at"`
}
```

Add new functions:
- `SetMemberRole(channelID, userID, role string) error`
- `GetChannelsForUser(userID string, isAdmin bool) ([]Channel, error)` — returns filtered channel list
- `CanAccessChannel(channelID, userID string, isAdmin bool) (bool, error)` — checks if user can read/write

Add access request functions:
- `CreateAccessRequest(id, channelID, userID string) error`
- `GetPendingRequests(channelID string) ([]AccessRequest, error)`
- `ApproveAccessRequest(requestID string) error` — approves and adds as member
- `DenyAccessRequest(requestID string) error`

Add struct:
```go
type AccessRequest struct {
	ID        string `json:"id"`
	ChannelID string `json:"channel_id"`
	UserID    string `json:"user_id"`
	Username  string `json:"username"`
	Status    string `json:"status"`
	CreatedAt string `json:"created_at"`
}
```

Update `CreateChannel` to use `channel_members` instead of `channel_managers`, and set default visibility.

Update `GetAllChannels` to accept userID and isAdmin params for filtering.

Verify: `go build ./...`

Commit: `git add server/db/ && git commit -m "feat: add channel membership, roles, visibility DB layer (migration 23)"`

---

## Task 2: API + WebSocket Enforcement

**Files:**
- Create: `server/api/channels.go` — new handlers for settings, members, access requests
- Modify: `server/api/router.go` — register new routes
- Modify: `server/api/messages.go` — add membership checks
- Modify: `server/ws/handlers.go` — membership check on send, scoped broadcast, update create/delete/rename
- Modify: `server/ws/hub.go` — add BroadcastToMembers
- Modify: `server/ws/client.go` — filter channels in sendReady

### API Handlers (channels.go)

Create `server/api/channels.go`:

```go
type ChannelSettingsHandler struct {
	DB  *db.DB
	Hub *ws.Hub
}
```

Handlers:
- `UpdateSettings` — PATCH, validates owner/admin, updates name/description/visibility
- `ListMembers` — GET, returns member list
- `AddMember` — POST, owner/admin only, adds user as member
- `RemoveMember` — DELETE, owner/admin only
- `UpdateMemberRole` — PATCH, owner/admin only
- `RequestAccess` — POST, any authenticated user
- `ListAccessRequests` — GET, owner/admin only
- `ApproveRequest` — POST, owner/admin, adds user as member
- `DenyRequest` — POST, owner/admin

### Router Updates

Register routes inside the existing `/api/v1/channels/` handler. Expand the path matching:

```go
mux.HandleFunc("/api/v1/channels/", authMW.Wrap(func(w http.ResponseWriter, r *http.Request) {
    path := r.URL.Path
    if strings.HasSuffix(path, "/messages") {
        // ... existing message handling
    }
    if strings.HasSuffix(path, "/threads") {
        // ... existing threads handling
    }
    if strings.HasSuffix(path, "/settings") {
        channelSettingsHandler.UpdateSettings(w, r)
        return
    }
    if strings.Contains(path, "/members") {
        channelSettingsHandler.HandleMembers(w, r)
        return
    }
    if strings.Contains(path, "/request-access") {
        channelSettingsHandler.RequestAccess(w, r)
        return
    }
    if strings.Contains(path, "/access-requests") {
        channelSettingsHandler.HandleAccessRequests(w, r)
        return
    }
    http.NotFound(w, r)
}))
```

### Message Access Checks

In `messages.go`, add to `GetHistory` and `GetThreadHistory`:

```go
user := UserFromContext(r.Context())
canAccess, _ := h.DB.CanAccessChannel(channelID, user.ID, user.IsAdmin)
if !canAccess {
    writeError(w, http.StatusForbidden, "not a member of this channel")
    return
}
```

### WebSocket Changes

**handlers.go — handleSendMessage:**
Add after channel verification:
```go
if ch.Visibility != "public" {
    isMember, _ := h.DB.IsChannelMember(d.ChannelID, c.UserID)
    if !isMember && !c.User.IsAdmin {
        return // silently reject
    }
}
```

**handlers.go — handleCreateChannel:**
- Set default visibility to "public"
- Use `AddChannelMember` with role "owner" instead of `AddChannelManager`
- Include `visibility` and `description` in broadcast payload

**handlers.go — handleDeleteChannel, handleRenameChannel:**
- Update `canManageChannel` to check `channel_members` role = "owner" instead of `channel_managers`

**hub.go — add BroadcastToMembers:**
```go
func (h *Hub) BroadcastToMembers(msg []byte, channelID string) {
    members, _ := h.DB.GetChannelMemberIDs(channelID)
    memberSet := make(map[string]bool)
    for _, id := range members {
        memberSet[id] = true
    }
    h.mu.RLock()
    defer h.mu.RUnlock()
    for userID, client := range h.clients {
        if memberSet[userID] {
            client.Send(msg)
        } else {
            // Also send to admins
            if client.User != nil && client.User.IsAdmin {
                client.Send(msg)
            }
        }
    }
}
```

**handlers.go — message broadcast:**
For restricted channels, use `BroadcastToMembers` instead of `BroadcastAll`.

**client.go — sendReady:**
Filter channels using `GetChannelsForUser(c.UserID, c.User.IsAdmin)` instead of `GetAllChannels()`.

Add `GetChannelMemberIDs` to db layer:
```go
func (d *DB) GetChannelMemberIDs(channelID string) ([]string, error) {
    rows, err := d.Query(`SELECT user_id FROM channel_members WHERE channel_id = ?`, channelID)
    // ... scan and return []string
}
```

Verify: `go build ./...`
Run: `make validate`

Commit: `git add server/ && git commit -m "feat: add channel membership enforcement — API, WebSocket, broadcasting"`

---

## Task 3: Frontend — Types, API, Store Updates

**Files:**
- Modify: `client/src/stores/channels.ts` — add visibility, is_member, role fields
- Modify: `client/src/lib/api.ts` — add channel settings and membership API functions
- Modify: `client/src/lib/events.ts` — handle member_added/removed events

### Channel type update

```typescript
type Channel = {
  id: string;
  name: string;
  type: "voice" | "text";
  position: number;
  visibility: "public" | "visible" | "invisible";
  description: string | null;
  is_member: boolean;
  role: string | null;
  manager_ids: string[]; // keep for backward compat
};
```

### API functions

```typescript
export function updateChannelSettings(channelId: string, data: { name?: string; description?: string; visibility?: string }) {
  return request(`/channels/${channelId}/settings`, { method: "PATCH", body: JSON.stringify(data) });
}
export function getChannelMembers(channelId: string) { return request(`/channels/${channelId}/members`); }
export function addChannelMember(channelId: string, userId: string, role: string) {
  return request(`/channels/${channelId}/members`, { method: "POST", body: JSON.stringify({ user_id: userId, role }) });
}
export function removeChannelMember(channelId: string, userId: string) {
  return request(`/channels/${channelId}/members/${userId}`, { method: "DELETE" });
}
export function updateMemberRole(channelId: string, userId: string, role: string) {
  return request(`/channels/${channelId}/members/${userId}`, { method: "PATCH", body: JSON.stringify({ role }) });
}
export function requestChannelAccess(channelId: string) {
  return request(`/channels/${channelId}/request-access`, { method: "POST" });
}
export function getAccessRequests(channelId: string) { return request(`/channels/${channelId}/access-requests`); }
export function approveAccessRequest(channelId: string, requestId: string) {
  return request(`/channels/${channelId}/access-requests/${requestId}/approve`, { method: "POST" });
}
export function denyAccessRequest(channelId: string, requestId: string) {
  return request(`/channels/${channelId}/access-requests/${requestId}/deny`, { method: "POST" });
}
```

### Events

Handle new WebSocket events:
- `channel_member_added` — re-fetch channels (user now has access to a new channel)
- `channel_member_removed` — remove channel from store, deselect if active

Commit: `git add client/src/ && git commit -m "feat: add channel membership types, API functions, and event handling"`

---

## Task 4: Frontend — UI Components

**Files:**
- Modify: `client/src/components/Sidebar/Sidebar.tsx` — lock icon, hide invisible
- Modify: `client/src/components/TextChannel/TextChannel.tsx` — non-member view, gear icon
- Create: `client/src/components/TextChannel/ChannelSettingsModal.tsx` — settings modal

### Sidebar changes

- Filter out `invisible` channels where `is_member === false` (unless admin)
- Show lock icon `🔒` on `visible` channels where `is_member === false`
- Mute text color for non-member visible channels

### TextChannel changes

- If user is not a member of a `visible` channel, show a "restricted" view:
  - Channel name + description
  - "Request Access" button
  - No message list, no input
- Add `[⚙]` gear icon in header for owners/admins

### ChannelSettingsModal

New modal component with sections:
- **General:** name input, description textarea, visibility dropdown, save button
- **Members:** list with role badges, add/remove/promote/demote
- **Pending Requests:** approve/deny buttons (only for visible channels)
- **Danger Zone:** delete channel

Use existing modal patterns from SettingsModal.tsx (inline styles, CSS variables, gold/dark theme).

Build: `cd client && npm run build`

Commit: `git add client/src/ && git commit -m "feat: add channel settings modal, sidebar access control, non-member restricted view"`

---

## Task 5: Validation + Deploy

- Run `make validate` — all scenarios must pass
- Build frontend + backend
- Deploy to production
- Restart nanobot (bot needs to be added as member to restricted channels)
