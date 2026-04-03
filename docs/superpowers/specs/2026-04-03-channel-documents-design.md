# Channel Documents — Design Spec

**Date:** 2026-04-03
**Product:** Le Faux Pain (GamersGuild)
**Status:** Approved for implementation

## Overview

Add a per-channel document workspace to Le Faux Pain. Each channel gets its own folder structure where users and bots can create, read, edit, and organize markdown documents. Documents are stored in the database, accessed via REST API, and browsed/edited through a "Docs" tab in the right panel.

## Design Principles

- Documents are channel-scoped — same membership rules as messages
- Both humans and bots use the same REST API
- Markdown is the native format — no binary files
- Folder structure is path-based (virtual, not filesystem)
- Last-write-wins for concurrent edits (acceptable for current scale)
- Document paths in chat messages are clickable links

---

## Data Model

### Documents Table (Migration 25)

```sql
CREATE TABLE documents (
    id          TEXT PRIMARY KEY,
    channel_id  TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    path        TEXT NOT NULL,
    content     TEXT NOT NULL DEFAULT '',
    created_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
    updated_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at  DATETIME DEFAULT (datetime('now')),
    updated_at  DATETIME DEFAULT (datetime('now')),
    UNIQUE(channel_id, path)
);
CREATE INDEX idx_documents_channel ON documents(channel_id);
```

**Path conventions:**
- Paths use `/` separators: `/marketing/launch-plan.md`
- Must start with `/`
- File names end with `.md`
- Folders are implicit — derived from paths (no separate folder table)
- Path is case-sensitive

---

## REST API

All endpoints require authentication. Channel membership is checked — non-members of restricted channels get 403.

### List Documents

`GET /api/v1/channels/{channelId}/docs`

Returns a flat list of all documents in the channel:
```json
[
  {
    "id": "uuid",
    "path": "/marketing/launch-plan.md",
    "created_by": "user-id",
    "updated_by": "user-id",
    "created_at": "...",
    "updated_at": "..."
  }
]
```

Optional query param: `?prefix=/marketing/` to filter by folder.

### Get Document

`GET /api/v1/channels/{channelId}/docs?path=/marketing/launch-plan.md`

Returns the full document:
```json
{
  "id": "uuid",
  "path": "/marketing/launch-plan.md",
  "content": "# Launch Plan\n\n...",
  "created_by": "user-id",
  "updated_by": "user-id",
  "created_at": "...",
  "updated_at": "..."
}
```

### Create/Update Document

`PUT /api/v1/channels/{channelId}/docs`

```json
{
  "path": "/marketing/launch-plan.md",
  "content": "# Launch Plan\n\nUpdated content..."
}
```

Creates the document if it doesn't exist, updates if it does. Returns 200 with the document.

### Delete Document

`DELETE /api/v1/channels/{channelId}/docs?path=/marketing/launch-plan.md`

Returns 200 `{"status": "deleted"}`.

---

## UI — Docs Tab in Right Panel

A new **Docs** tab alongside Thread / Threads / Starred.

### Folder/File Browser

- Shows a tree view of all documents in the channel
- Folders are collapsible
- Files show name and last updated date
- Click a file to open it in the editor
- "New Document" button at the top

### Document Editor

- File path shown at top (editable for new documents)
- Textarea for markdown content
- Save button
- Delete button (with confirmation)
- Back button to return to file list

### Create New Document

- Input for path (e.g. `/marketing/new-doc.md`)
- Empty textarea
- Save creates the document

---

## Document Links in Chat

When a message contains a path like `/marketing/plan.md`, render it as a clickable link that opens the Docs tab to that document.

Detection: match paths starting with `/` and ending with `.md` in message content.

In `renderContent()` (Message.tsx), add a regex for doc paths alongside the existing mention and URL patterns.

---

## Bot Access

The bot accesses documents via curl using the webhook API key or its WebSocket auth token:

```bash
# List docs
curl -H "Authorization: Bearer $TOKEN" \
  https://lefauxpain.com/api/v1/channels/{id}/docs

# Read doc
curl -H "Authorization: Bearer $TOKEN" \
  "https://lefauxpain.com/api/v1/channels/{id}/docs?path=/marketing/plan.md"

# Write doc
curl -X PUT -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"path":"/marketing/plan.md","content":"# Plan\n..."}' \
  https://lefauxpain.com/api/v1/channels/{id}/docs
```

No changes to the Docker container or nanobot code needed — the bot uses its existing curl/HTTP capabilities.

---

## Files Changed

### Server (Go)

| File | Change |
|------|--------|
| `server/db/migrations.go` | Migration 25: documents table |
| `server/db/documents.go` | New: CRUD functions for documents |
| `server/api/documents.go` | New: REST handlers for docs |
| `server/api/router.go` | Register `/docs` routes under channels |

### Client (SolidJS)

| File | Change |
|------|--------|
| `client/src/lib/api.ts` | Add docs API functions |
| `client/src/stores/messages.ts` | Add "docs" to panel tab type |
| `client/src/components/TextChannel/ThreadPanel.tsx` | Add Docs tab with file browser and editor |
| `client/src/components/TextChannel/Message.tsx` | Render doc path links in messages |
| `client/src/components/TextChannel/TextChannel.tsx` | Add Docs button to header |

---

## Success Criteria

- Users can create, read, edit, and delete markdown documents per channel
- Documents are organized in a folder structure via path conventions
- The Docs tab in the right panel provides a file browser and textarea editor
- The bot can read/write documents via REST API
- Document paths in chat messages are clickable links
- Document access follows channel membership rules
- All existing validation scenarios pass
