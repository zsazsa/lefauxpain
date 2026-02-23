# Applet Architecture

Le Faux Pain uses an **applet system** to keep optional features isolated from core functionality. Each applet is a self-contained module that registers its own WebSocket handlers, database schema, event handlers, sidebar UI, and slash commands — without modifying core switch statements or shared files.

Built-in applets: **Radio Stations**, **Media Library**, **Live Coding (Strudel)**.

## Overview

An applet has both a server-side and client-side component:

| Layer | What it does | Key file |
|-------|-------------|----------|
| **Server** | Registers WS op handlers, contributes to ReadyData, handles disconnect cleanup, declares DB migrations | `server/ws/applet_*.go` |
| **Client** | Registers event handlers, sidebar component, slash commands, ready/reconnect hooks | `client/src/applets/*.ts` |

Applets register themselves at startup. The core never hard-codes applet logic — it calls the registry, which dispatches to the right applet.

## Server-Side

### AppletDef

Every server-side applet exports a function that returns an `AppletDef`:

```go
// server/ws/plugin.go

type AppletHandlerFunc func(h *Hub, c *Client, data json.RawMessage)

type AppletDef struct {
    Name         string                                  // e.g. "radio"
    SettingKey   string                                  // e.g. "feature:strudel" — checked before dispatch (empty = always on)
    Handlers     map[string]AppletHandlerFunc            // WS op name → handler
    ReadyContrib func(h *Hub, c *Client) map[string]any // Data merged into "ready" payload
    OnDisconnect func(h *Hub, c *Client)                // Cleanup on client disconnect
    Migrations   []string                                // Per-applet versioned SQL migrations
}
```

### Registration

Applets register in `NewHub()`:

```go
func NewHub(db *db.DB) *Hub {
    h := &Hub{
        db:      db,
        applets: NewAppletRegistry(),
        // ...
    }
    h.applets.Register(RadioApplet())
    h.applets.Register(MediaApplet())
    h.applets.Register(StrudelApplet())
    return h
}
```

### Dispatch

In `HandleMessage`, after the core switch statement, unmatched ops fall through to the registry:

```go
func (h *Hub) HandleMessage(c *Client, op string, data json.RawMessage) {
    switch op {
    // ~36 core ops: messaging, channels, voice, screen share, admin, etc.
    case "send_message":
        h.handleSendMessage(c, data)
    // ...
    default:
        if !h.applets.Dispatch(h, c, op, data) {
            log.Printf("unknown op: %s", op)
        }
    }
}
```

`Dispatch` checks the applet's `SettingKey` (if set) before calling the handler. If the feature is disabled server-side, the op is silently dropped.

### ReadyData

When a client connects, the server builds the `ready` payload. Applets contribute their data:

```go
func (c *Client) sendReady() {
    // Build core ready data (channels, users, voice state, etc.)
    ready := map[string]any{
        "user":     user,
        "channels": channels,
        // ...
    }
    // Merge applet contributions
    for k, v := range c.hub.applets.ContributeReady(c.hub, c) {
        ready[k] = v
    }
    c.sendJSON("ready", ready)
}
```

### Disconnect

Applet cleanup runs on client disconnect:

```go
func (h *Hub) handleDisconnect(c *Client) {
    // Core cleanup (voice state, presence, etc.)
    // ...
    // Applet cleanup
    h.applets.OnDisconnect(h, c)
}
```

### Example: Radio Applet (Server)

```go
// server/ws/applet_radio.go

func RadioApplet() *AppletDef {
    return &AppletDef{
        Name: "radio",
        Handlers: map[string]AppletHandlerFunc{
            "create_radio_station":    handleCreateRadioStation,
            "delete_radio_station":    handleDeleteRadioStation,
            "upload_radio_track":      handleUploadRadioTrack,
            "delete_radio_track":      handleDeleteRadioTrack,
            "reorder_radio_tracks":    handleReorderRadioTracks,
            "tune_radio":             handleTuneRadio,
            "detune_radio":           handleDetuneRadio,
            "radio_listeners":        handleRadioListeners,
            "set_radio_public_controls": handleSetRadioPublicControls,
            // ... other radio ops
        },
        ReadyContrib: func(h *Hub, c *Client) map[string]any {
            stations := h.db.GetRadioStations()
            listeners := h.getRadioListeners()
            return map[string]any{
                "radio_stations":  stations,
                "radio_listeners": listeners,
            }
        },
        OnDisconnect: func(h *Hub, c *Client) {
            h.detuneRadio(c) // Remove from listener lists
        },
    }
}
```

## Client-Side

### Event Registry

```typescript
// client/src/lib/appletRegistry.ts

type ReadyHandler = (data: any) => void;
type EventHandler = (data: any) => void;
type ReconnectHandler = () => void;

const readyHandlers: ReadyHandler[] = [];
const eventHandlers: Map<string, EventHandler> = new Map();
const reconnectHandlers: ReconnectHandler[] = [];

export function registerReadyHandler(fn: ReadyHandler) {
    readyHandlers.push(fn);
}

export function registerEventHandler(op: string, fn: EventHandler) {
    eventHandlers.set(op, fn);
}

export function registerReconnectHandler(fn: ReconnectHandler) {
    reconnectHandlers.push(fn);
}

export function dispatchReady(data: any) {
    for (const fn of readyHandlers) fn(data);
}

export function dispatchEvent(op: string, data: any): boolean {
    const handler = eventHandlers.get(op);
    if (handler) { handler(data); return true; }
    return false;
}

export function dispatchReconnect() {
    for (const fn of reconnectHandlers) fn();
}
```

### Sidebar Component Registry

```typescript
// client/src/lib/appletComponents.ts
import { Component } from "solid-js";

type SidebarEntry = {
    id: string;
    component: Component;
    visible: () => boolean;
};

const sidebarApplets: SidebarEntry[] = [];

export function registerSidebarApplet(entry: SidebarEntry) {
    sidebarApplets.push(entry);
}

export function getSidebarApplets(): SidebarEntry[] {
    return sidebarApplets;
}
```

Used in `Sidebar.tsx`:

```tsx
import { Dynamic } from "solid-js/web";
import { getSidebarApplets } from "../../lib/appletComponents";

<For each={getSidebarApplets()}>
    {(applet) => (
        <Show when={applet.visible()}>
            <Dynamic component={applet.component} />
        </Show>
    )}
</For>
```

### Applet Self-Registration

Each client-side applet file registers everything at import time:

```typescript
// client/src/applets/radio.ts

import { registerReadyHandler, registerEventHandler, registerReconnectHandler } from "../lib/appletRegistry";
import { registerSidebarApplet } from "../lib/appletComponents";
import { registerApplet } from "../stores/applets";
import { isAppletEnabled } from "../stores/applets";
import RadioSidebar from "../components/Sidebar/RadioSidebar";
import {
    setRadioStations, setRadioListeners, /* ... */
} from "../stores/radio";

// Register applet definition (appears in Settings > Display)
registerApplet({ id: "radio", name: "Radio Stations" });

// Register sidebar component
registerSidebarApplet({
    id: "radio",
    component: RadioSidebar,
    visible: () => isAppletEnabled("radio"),
});

// Register ready handler (called when "ready" event arrives)
registerReadyHandler((data) => {
    if (data.radio_stations) setRadioStations(data.radio_stations);
    if (data.radio_listeners) setRadioListeners(data.radio_listeners);
});

// Register event handlers
registerEventHandler("radio_station_created", (d) => { /* ... */ });
registerEventHandler("radio_station_deleted", (d) => { /* ... */ });
registerEventHandler("radio_track_added", (d) => { /* ... */ });
// ... all radio_* events

// Register reconnect handler
registerReconnectHandler(() => {
    // Re-request state if needed
});
```

### Barrel Import

All applets are imported once via a barrel file:

```typescript
// client/src/applets/index.ts
import "./radio";
import "./media";
import "./strudel";
```

This barrel is imported from `events.ts` to ensure all applets are registered before any events arrive.

### Command Registration

Applets register their own slash commands:

```typescript
// In client/src/applets/radio.ts

import { registerCommands } from "../components/Terminal/commandRegistry";
import { registerCommandHandler } from "../components/Terminal/commandExecutor";

registerCommands([
    { name: "radio", description: "Open radio stations" },
    { name: "tune", description: "Tune into a station", args: "<station>" },
    { name: "detune", description: "Stop listening to radio" },
]);

registerCommandHandler("radio", (args, ctx) => {
    ctx.openDialog("radio");
});
registerCommandHandler("tune", (args, ctx) => { /* ... */ });
registerCommandHandler("detune", (args, ctx) => { /* ... */ });
```

## Database Storage

Applets share the main SQLite database but manage their own schema independently.

### Per-Applet Migrations

Each applet declares its migrations as an ordered list of SQL statements:

```go
func MyApplet() *AppletDef {
    return &AppletDef{
        Name: "myapplet",
        Migrations: []string{
            // Version 1
            `CREATE TABLE myapplet_items (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                owner_id TEXT NOT NULL REFERENCES users(id),
                created_at DATETIME DEFAULT (datetime('now'))
            )`,
            // Version 2
            `ALTER TABLE myapplet_items ADD COLUMN description TEXT DEFAULT ''`,
        },
        // ...
    }
}
```

### Migration Tracking

A core table tracks which migrations each applet has applied:

```sql
CREATE TABLE IF NOT EXISTS applet_schema_version (
    applet_name TEXT NOT NULL,
    version     INTEGER NOT NULL,
    applied_at  DATETIME DEFAULT (datetime('now')),
    PRIMARY KEY (applet_name, version)
);
```

On startup, `AppletRegistry.ApplyMigrations(db)` iterates each applet's `Migrations` slice and applies any versions not yet recorded. Each applet's versioning is independent — applets don't coordinate migration numbering with each other or with core.

### Conventions

- **Table prefix**: All tables created by an applet MUST be prefixed with the applet name (e.g. `radio_stations`, `strudel_patterns`)
- **Foreign keys**: Applets can reference core tables (e.g. `owner_id REFERENCES users(id)`) since everything is in the same SQLite database
- **No cross-applet references**: Applets must NOT reference tables owned by other applets
- **WAL mode**: The database uses WAL mode with `MaxOpenConns(1)` — applet queries go through the same `*db.DB` connection pool

### Existing Applets

The built-in applets (Radio, Media, Strudel) have their initial migrations in the core migration array for backwards compatibility. Any NEW migrations for these applets use the per-applet system. Completely new applets use the per-applet system exclusively.

## Feature Flags

Applets can be gated behind an admin feature toggle:

```go
&AppletDef{
    Name:       "strudel",
    SettingKey:  "feature:strudel",  // Checked before dispatch
    // ...
}
```

When `SettingKey` is set:
- **Server**: `Dispatch` checks the setting before calling handlers. If the feature is disabled, ops are silently dropped.
- **Client**: The sidebar component's `visible()` function checks `isFeatureEnabled("strudel")`.
- **Admin UI**: Admins toggle features in Settings > Admin > Features.

Leave `SettingKey` empty for always-on applets (Radio, Media).

Users can also toggle sidebar visibility per-applet in Settings > Display, independent of the admin feature flag.

## Data Flow

### Startup

1. Server creates `AppletRegistry`, registers all applets
2. `ApplyMigrations()` runs — creates/updates applet tables
3. Client connects via WebSocket, sends auth
4. Server builds `ready` payload with core data + `ContributeReady()` from each applet
5. Client receives `ready`, `dispatchReady()` calls each applet's ready handler
6. Applet stores are populated, sidebar components render

### Runtime

1. User action → client sends WS op (e.g. `create_radio_station`)
2. Server `HandleMessage` → core switch misses → `applets.Dispatch()` matches → calls handler
3. Handler modifies DB, broadcasts event (e.g. `radio_station_created`) to relevant clients
4. Client `events.ts` → core switch misses → `dispatchEvent()` matches → calls applet handler
5. Applet handler updates SolidJS store → UI reactively updates

### Reconnect

1. WebSocket reconnects, new `ready` received
2. `dispatchReady()` re-initializes applet stores
3. `dispatchReconnect()` lets applets restore transient state (e.g. re-tune radio)

## Building a New Applet

### 1. Server: Create `server/ws/applet_yourname.go`

```go
package ws

import "encoding/json"

func YourApplet() *AppletDef {
    return &AppletDef{
        Name: "yourname",
        Migrations: []string{
            `CREATE TABLE yourname_items (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                owner_id TEXT NOT NULL REFERENCES users(id),
                created_at DATETIME DEFAULT (datetime('now'))
            )`,
        },
        Handlers: map[string]AppletHandlerFunc{
            "yourname_create": handleYourCreate,
            "yourname_delete": handleYourDelete,
            "yourname_list":   handleYourList,
        },
        ReadyContrib: func(h *Hub, c *Client) map[string]any {
            items, _ := h.db.Query("SELECT id, name FROM yourname_items")
            // ... scan items
            return map[string]any{"yourname_items": items}
        },
        OnDisconnect: nil, // Only if cleanup needed
    }
}

func handleYourCreate(h *Hub, c *Client, data json.RawMessage) {
    // Parse data, validate, insert into DB, broadcast
}
```

### 2. Server: Register in `NewHub()`

```go
h.applets.Register(YourApplet())
```

### 3. Client: Create `client/src/applets/yourname.ts`

```typescript
import { createSignal } from "solid-js";
import { registerReadyHandler, registerEventHandler } from "../lib/appletRegistry";
import { registerSidebarApplet } from "../lib/appletComponents";
import { registerApplet } from "../stores/applets";
import { registerCommands, registerCommandHandler } from "../components/Terminal/commandRegistry";

// Store
const [items, setItems] = createSignal([]);
export { items };

// Registration
registerApplet({ id: "yourname", name: "Your Feature" });

registerSidebarApplet({
    id: "yourname",
    component: YourSidebar,  // Your sidebar component
    visible: () => isAppletEnabled("yourname"),
});

registerReadyHandler((data) => {
    if (data.yourname_items) setItems(data.yourname_items);
});

registerEventHandler("yourname_created", (d) => {
    setItems((prev) => [...prev, d]);
});

registerCommands([
    { name: "yourname", description: "Open your feature" },
]);

registerCommandHandler("yourname", (args, ctx) => {
    ctx.openDialog("yourname");
});
```

### 4. Client: Add to barrel

```typescript
// client/src/applets/index.ts
import "./yourname";
```

### 5. Test

- `make validate` — all existing scenarios must still pass
- Manual test your applet's WS ops and UI

## Security: Iframe Sandbox

Applets that evaluate user-provided code (like Strudel) MUST run in a sandboxed iframe to prevent:

- **Session theft**: User code reading `localStorage` or cookies
- **API impersonation**: User code calling the WS/REST API as the logged-in user
- **Data exfiltration**: User code sending data to external servers

### How It Works

The applet's code execution runs inside `<iframe sandbox="allow-scripts">`. Without `allow-same-origin`, the iframe gets an **opaque origin** — no access to the parent's storage, cookies, or DOM.

Communication happens via `window.postMessage()`:
- Parent sends commands (evaluate code, stop, set tempo)
- Iframe sends state back (playing, errors, code changes)
- WS coordination stays in the parent — the iframe is offline

### CSP (Content Security Policy)

The sandbox HTML includes a CSP meta tag restricting `connect-src` to known safe domains (GitHub raw content, FreeSounds, strudel.cc). User code cannot `fetch()` from arbitrary domains.

### Building a Sandboxed Applet

If your applet evaluates user-provided code:
1. Create a separate HTML entry point (e.g., `client/yourapplet-sandbox.html`)
2. Add it as a Vite multi-page entry in `vite.config.ts`
3. Embed via `<iframe sandbox="allow-scripts" src="/yourapplet-sandbox.html">`
4. Use `postMessage` for all parent ↔ iframe communication
5. Add a CSP `connect-src` allowlist to your sandbox HTML

## Safety Guarantees

- **Pure refactor**: Existing handler code is moved into applet files — not rewritten. The exact same functions run, just dispatched via registry instead of switch statement.
- **Existing migrations untouched**: Radio/Strudel migrations stay in the core migration array. The `applet_schema_version` table is additive only.
- **No protocol changes**: WS op names, payload shapes, and event names are identical before and after. Clients and servers remain wire-compatible.
- **Feature flags preserved**: The `set_feature` / `feature_toggled` mechanism works exactly as before.
- **Incremental extraction**: Each applet is moved one at a time with `make validate` after each step.
- **No cross-applet dependencies**: Applets cannot import from or reference each other's tables, stores, or components.
