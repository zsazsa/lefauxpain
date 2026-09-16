# Feature: Version Handshake and Session Rejection

## Intent

A browser tab left open across a deploy, or holding an expired session, must
recover on its own instead of sitting on "Waiting for connection" or failing
to load a feature. People should never need to clear site data by hand.

## Current Behavior

- No build identifier exists on either side.
- Deploys delete the previous hashed assets, so an open tab 404s on any
  chunk it has not loaded yet.
- The WebSocket client ignores close codes: a 1008 policy-violation close
  for an invalid or expired token is retried forever with exponential backoff.
- REST 401 responses throw but never end the session.

## New Behavior

### Build identifier
- Server: `main.Version` set with `-ldflags "-X main.Version=<git short hash>"`
  (`make build`, `make build-release`); defaults to `dev`.
- Client: `__APP_VERSION__` defined by Vite from `APP_VERSION` or `git rev-parse`.
- `GET /api/v1/health` includes `version`.
- The `ready` WebSocket payload includes `server_version`.

### Stale tab recovery
- On `ready`, if `server_version` differs from the client's and neither is
  `dev`, the client reloads once. A `sessionStorage` guard records the version
  it reloaded for; if the mismatch persists after that reload, a banner with a
  reload button is shown instead of looping.
- On `vite:preloadError` (a lazy chunk failed to load) the client reloads once
  per client version.
- Deploy procedure keeps assets younger than seven days instead of wiping the
  directory.

### Session rejection
- WebSocket close code 1008 stops reconnection, clears the session and shows a
  notice on the login screen derived from the close reason ("expired",
  "pending approval", or generic).
- A REST 401 while a token is present, on any path outside `/auth/`, does the
  same.

## Constraints
- Never reload in a loop: every automatic reload is guarded.
- `dev` builds never trigger reloads, so local development is unaffected.
- The server side stays additive: two new JSON fields, no protocol change.
