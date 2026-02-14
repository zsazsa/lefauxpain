# Security Hardening

## TL;DR

Updated Go to 1.24.13 (patched 16 stdlib CVEs), switched MIME detection from trusting client headers to sniffing actual file bytes, added per-user WebSocket rate limiting (30 msg/s), added HTTP server timeouts, enforced WebSocket origin checks in production, disabled directory listing on file routes, added emoji input validation, and deployed nginx security headers (HSTS, X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy).

---

## 1. Go Runtime Update

**go.mod**: `go 1.24.0` → `go 1.24.13`

`govulncheck` found 16 vulnerabilities in the Go 1.24.0 standard library affecting `net/http`, `crypto/x509`, `os`, and other packages. Updating to 1.24.13 resolved all of them. No code changes required.

## 2. MIME Type Detection

**Files**: `server/storage/files.go`, `server/api/upload.go`

**Before**: `DetectMIME` read the `Content-Type` header from the multipart form, which is set by the client and trivially spoofable. A user could upload an executable renamed to `.jpg` and the server would accept it if the browser sent `image/jpeg`.

**After**: `DetectMIME` reads the first 512 bytes of the actual file and passes them to `http.DetectContentType`, which inspects magic bytes to determine the real MIME type. The file seek position is reset afterward so downstream consumers (hashing, image decoding) aren't affected.

## 3. WebSocket Rate Limiting

**File**: `server/ws/client.go`

Added a per-user sliding window rate limiter in the WebSocket read loop. Each client is allowed 30 messages per second. If exceeded, the connection is closed and the event is logged. This prevents a single client from flooding the server with rapid-fire messages (chat spam, reaction spam, typing events).

## 4. HTTP Server Timeouts

**File**: `server/main.go`

Added `ReadHeaderTimeout: 10s` and `IdleTimeout: 120s` to the `http.Server`. These prevent slowloris-style attacks where a client holds a connection open indefinitely by sending headers very slowly.

`WriteTimeout` and `ReadTimeout` were intentionally omitted — they apply to the entire connection lifecycle and would kill long-lived WebSocket connections.

## 5. WebSocket Origin Enforcement

**Files**: `server/ws/hub.go`, `server/main.go`

The WebSocket accept options had `InsecureSkipVerify: true` hardcoded, which disables the Origin header check. This is needed in dev mode (frontend on `:5173`, backend on `:8080`), but in production behind nginx both are on the same origin.

Changed to `InsecureSkipVerify: h.DevMode` so production enforces that the Origin header matches the server. This mitigates cross-site WebSocket hijacking.

## 6. Directory Listing Disabled

**File**: `server/api/router.go`

The `/uploads/`, `/thumbs/`, and `/avatars/` routes used bare `http.FileServer`, which serves directory listings when a path ends with `/`. Added a `noDirectoryListing` middleware wrapper that returns 404 for directory paths, preventing enumeration of uploaded files.

The nginx config should also include `autoindex off` on these same locations.

## 7. Emoji Validation

**File**: `server/ws/handlers.go`

The `add_reaction` handler previously accepted any string as an emoji with no validation. Added `isValidEmoji` which checks that the emoji is 1–10 runes and at most 32 bytes. This prevents abuse like storing arbitrarily long strings as "emoji" reactions in the database.

## 8. Build Hardening

The Go binary is built with `-trimpath`, which strips local filesystem paths from the compiled binary. This removes information like source directory paths from stack traces and debug info that could be useful to an attacker.

## 9. Nginx Security Headers

Add the following headers to all nginx responses:

| Header | Value | Purpose |
|--------|-------|---------|
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains` | Force HTTPS for 2 years |
| `X-Content-Type-Options` | `nosniff` | Prevent browsers from MIME-sniffing responses |
| `X-Frame-Options` | `DENY` | Prevent the site from being embedded in iframes (clickjacking) |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Limit referrer leakage to external sites |
| `Permissions-Policy` | `camera=(), microphone=(self), geolocation=()` | Restrict browser API access; microphone allowed for voice chat |

Headers must be duplicated in `/uploads/`, `/thumbs/`, `/avatars/` location blocks because nginx's `add_header` in a location block overrides all parent-level `add_header` directives.

## What Was Already Good

The audit confirmed several existing practices were already solid:

- **SQL injection**: All queries use parameterized statements (`?` placeholders), no string concatenation
- **Password hashing**: bcrypt with default cost
- **Auth tokens**: Cryptographically random, checked via constant-time database lookup
- **Username validation**: Regex-enforced alphanumeric, 3–20 chars
- **Message length limits**: 4000 chars enforced server-side
- **File upload limits**: `MaxBytesReader` enforced, MIME whitelist (images only)
- **File storage**: SHA-256 hash-based paths prevent path traversal and enable deduplication
- **Rate limiting**: Already in place on register (3/min), login (5/min), upload (3/30s)
- **Single-writer SQLite**: `MaxOpenConns(1)` with WAL mode prevents corruption
