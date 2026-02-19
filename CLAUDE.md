# CLAUDE.md

## Context
This is a production codebase that was built iteratively without formal
specs or tests. It works. Our job is NOT to rewrite it. Our job is to:
1. Stabilize it with scenario validation
2. Evolve it through specs going forward
3. Never hand-write code again

## Rules
- Read the relevant spec in /specs/ before ANY code change
- Run `make validate` after ANY code change
- If scenarios fail after your change, fix YOUR change — do not modify scenarios
- Never delete or rewrite working code "to clean it up" unless a spec asks for it
- Ask the architect before making any structural/architectural changes

## How to Make Changes
1. Read the spec for the requested change
2. Understand the existing code in the affected area
3. Make the minimum change to satisfy the spec
4. Run `make validate`
5. Fix until green
6. Commit

## Critical: Do Not
- Refactor code that isn't related to the current spec
- Add unit tests (we use scenario validation instead)
- "Improve" code style on files you didn't need to change
- Break the existing app to make the new feature work

## What This Is

Self-hostable Discord alternative ("Le Faux Pain"). Single Go binary with an embedded SolidJS SPA. Text channels with replies/reactions/mentions/uploads, voice channels via Pion WebRTC SFU, radio stations, synchronized media player.

For full architecture, WS protocol, REST endpoints, DB schema, known fragile areas, and what works reliably, see **[specs/architecture/current-state.md](specs/architecture/current-state.md)**.

## Build & Dev Commands

```bash
# Dev mode (two terminals)
cd client && npm install && npm run dev          # Vite HMR on :5173
cd server && go run . --dev --port 8080          # Proxies frontend to Vite

# Production build (order matters: frontend first, then copy, then Go)
cd client && npm run build
rm -rf server/static/assets/* server/static/index.html
cp -r client/dist/* server/static/
cd server && go build -o voicechat .

# Validation (builds server, starts fresh instance, runs 35 scenarios)
make validate

# Desktop (Tauri) — requires libopus-dev, libasound2-dev
cd desktop && npm run tauri dev                  # Dev with hot reload
cd desktop && npm run tauri build                # Release build
```

## Validation

33 automated scenarios in `validation/` verify the critical path against a live server (Go tests using `net/http` + `nhooyr.io/websocket`). Covers auth, channels, messaging, reactions, mentions, file upload, voice state, presence, radio, admin, rate limiting, and permissions.

```bash
make validate    # Build server, start fresh instance, run scenarios, tear down
make lint        # TypeScript type check
make test        # Both
```

Scenario specs: `specs/scenarios/critical-path.md`

## Key Patterns (pitfall prevention)

**SolidJS `<Show>` pitfall**: `<Show>` without `keyed` uses truthiness equality — switching between two truthy values won't re-render. Use reactive function children `{() => { ... }}` or `<Show keyed>`.

**Attachment flow**: Upload via REST (returns attachment ID) → include ID in `send_message` WS op → server links attachment to message. Orphaned attachments (unlinked after 1 hour) cleaned up by background goroutine.

**Desktop `dist/index.html`**: This is the server selector page, NOT the SPA. Do NOT overwrite with `client/dist/`.
