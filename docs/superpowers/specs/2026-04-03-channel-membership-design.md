# Channel Membership, Roles & Visibility — Design Spec

**Date:** 2026-04-03
**Product:** Le Faux Pain (GamersGuild)
**Status:** Approved for implementation

## Overview

Add channel-level membership, roles, and visibility controls to Le Faux Pain. Channels can be public (open to all), visible (everyone sees them but only members can participate), or invisible (only members know they exist). Channel owners manage members, approve access requests, and control settings via a modal.

## Design Principles

- Server enforces all access — the client is untrusted
- Public channels are backward compatible — existing behavior unchanged
- Bots are treated as regular members — must be explicitly added
- Admins can see and access everything regardless of membership

---

## Data Model

### Channels Table Changes (Migration 23)

```sql
ALTER TABLE channels ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public';
ALTER TABLE channels ADD COLUMN description TEXT;
```

Visibility values:
- `public` — everyone can see, join, read, write (current behavior)
- `visible` — everyone sees it in sidebar, only members can read/write, non-members can request access
- `invisible` — only members and admins see it in sidebar

### Channel Members Table

```sql
CREATE TABLE channel_members (
    channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role       TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('owner', 'member')),
    created_at DATETIME DEFAULT (datetime('now')),
    PRIMARY KEY (channel_id, user_id)
);
CREATE INDEX idx_channel_members_user ON channel_members(user_id);
```

### Channel Access Requests Table

```sql
CREATE TABLE channel_access_requests (
    id         TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status     TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'denied')),
    created_at DATETIME DEFAULT (datetime('now')),
    UNIQUE(channel_id, user_id)
);
CREATE INDEX idx_channel_requests_channel ON channel_access_requests(channel_id, status);
```

### Membership Rules

- Channel creator automatically becomes `owner`
- Any user can create channels — they become the owner
- Admins can see and access all channels regardless of membership (not stored as members)
- Bots must be added as members explicitly by an owner/admin
- Public channels have no membership requirements — everyone is implicitly a member

---

## Server Enforcement

### Channel Listing

`GetAllChannels()` accepts a user ID and admin flag, returns:
- All `public` channels
- All `visible` channels, each annotated with `is_member: true/false` and `role`
- `invisible` channels only if user is a member or admin

### Message Access

- `GetHistory`, `GetThreadHistory`: return 403 for non-members of `visible`/`invisible` channels
- `handleSendMessage`: silently reject messages from non-members in restricted channels

### WebSocket

- `ready` event: filter channels by membership (same logic as listing)
- `message_create` broadcast: for restricted channels, use `BroadcastToMembers` instead of `BroadcastAll`
- New events:
  - `channel_member_added` — sent to the added user so their sidebar updates
  - `channel_member_removed` — sent to the removed user so the channel disappears

### BroadcastToMembers

New method on Hub: fetches member list from DB and sends only to connected members + admins. Public channels continue to use `BroadcastAll`.

---

## API Endpoints

### Channel Settings (owner/admin only)

`PATCH /api/v1/channels/{id}/settings` — Update name, description, visibility
```json
{ "name": "new-name", "description": "About this channel", "visibility": "visible" }
```

### Member Management (owner/admin only)

`GET /api/v1/channels/{id}/members` — List members with roles
`POST /api/v1/channels/{id}/members` — Add a member: `{ "user_id": "...", "role": "member" }`
`DELETE /api/v1/channels/{id}/members/{userId}` — Remove a member
`PATCH /api/v1/channels/{id}/members/{userId}` — Change role: `{ "role": "owner" }`

### Access Requests

`POST /api/v1/channels/{id}/request-access` — Request access (any authenticated user)
`GET /api/v1/channels/{id}/access-requests` — List pending requests (owner/admin)
`POST /api/v1/channels/{id}/access-requests/{requestId}/approve` — Approve (owner/admin)
`POST /api/v1/channels/{id}/access-requests/{requestId}/deny` — Deny (owner/admin)

---

## Channel Settings Modal

Opens via gear icon `[⚙]` in channel header. Only visible to owners and admins.

### General Section
- Channel name (editable input)
- Description (editable text field)
- Visibility dropdown: Public / Visible / Invisible
- Save button

### Members Section
- List of current members: username, role badge (owner/member), joined date
- Remove button (not on yourself)
- Role toggle: promote member → owner, demote owner → member
- "Add Member" input: type username to add directly

### Pending Requests Section
- Only shown for `visible` channels
- List of pending requests: username, requested date
- Approve / Deny buttons

### Danger Zone
- Delete channel button (owner and admin only)

---

## Client-Side Changes

### Sidebar
- `visible` channels user is NOT a member of: shown with lock icon `[🔒]` and muted text
- `invisible` channels: not shown at all for non-members
- Admins see all channels (invisible ones shown with an eye icon)

### Channel View for Non-Members
When a non-member clicks a `visible` channel:
- No messages shown
- Display: channel name, description, "Request Access" button
- After requesting: button changes to "Access Requested" (disabled)

### Channel Header
- `[⚙]` gear icon for owners/admins — opens settings modal
- Lock icon for restricted channels (visual indicator)

### Notifications
- `channel_access_request` — sent to channel owner when someone requests access
- `channel_access_approved` — sent to requester when approved

---

## Files Changed

### Server (Go)

| File | Change |
|------|--------|
| `server/db/migrations.go` | Migration 23: visibility/description on channels, channel_members, channel_access_requests |
| `server/db/channels.go` | New: membership CRUD, access requests, filtered channel listing |
| `server/db/users.go` | Update Channel struct with Visibility, Description fields |
| `server/api/channels.go` | New: settings, members, access request handlers |
| `server/api/router.go` | Register new routes |
| `server/api/messages.go` | Add membership checks to GetHistory, GetThreadHistory |
| `server/ws/handlers.go` | Membership check on sendMessage, scoped broadcast, member events |
| `server/ws/hub.go` | Add BroadcastToMembers method |
| `server/ws/client.go` | Filter channels in sendReady |

### Client (SolidJS)

| File | Change |
|------|--------|
| `client/src/stores/channels.ts` | Add visibility, description, is_member, role to channel type |
| `client/src/lib/api.ts` | Add channel settings, member management, access request functions |
| `client/src/lib/events.ts` | Handle channel_member_added/removed events |
| `client/src/components/Sidebar/Sidebar.tsx` | Lock icon, hide invisible channels |
| `client/src/components/TextChannel/TextChannel.tsx` | Non-member view, gear icon |
| `client/src/components/TextChannel/ChannelSettingsModal.tsx` | New: settings modal |

---

## Backward Compatibility

- All existing channels default to `visibility = 'public'` — no membership required, no behavior change
- No existing functionality breaks — public channels work exactly as before
- Migration is additive (new columns with defaults, new tables)

## Success Criteria

- Public channels work identically to current behavior
- Visible channels show in sidebar for everyone but only members can read/write
- Invisible channels are hidden from non-members (except admins)
- Channel owners can manage members, visibility, and access requests via modal
- Bots must be explicitly added as members to restricted channels
- Server enforces all access — bypassing the client doesn't grant access
- All existing validation scenarios pass
