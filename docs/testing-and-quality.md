# Testing, Linting & Quality Plan

Comprehensive plan to add testing, linting, formatting, and CI to all three codebases: Go backend, SolidJS frontend, and Rust desktop.

**Current state:** Zero tests, zero linters, zero formatters, one CI workflow (Tauri desktop release only).

---

## Table of Contents

1. [Go Backend](#1-go-backend)
2. [SolidJS Frontend](#2-solidjs-frontend)
3. [Rust Desktop](#3-rust-desktop)
4. [CI/CD Pipeline](#4-cicd-pipeline)
5. [Makefile / Task Runner](#5-makefile--task-runner)
6. [Pre-commit Hooks](#6-pre-commit-hooks)
7. [Implementation Order](#7-implementation-order)

---

## 1. Go Backend

### 1.1 Linting — golangci-lint

**Tool:** [golangci-lint](https://golangci-lint.run/) (meta-linter, runs 50+ linters)

**Config:** `server/.golangci.yml`

```yaml
run:
  timeout: 3m

linters:
  enable:
    - errcheck        # unchecked errors
    - govet           # suspicious constructs
    - staticcheck     # comprehensive static analysis
    - unused          # unused code
    - ineffassign     # useless assignments
    - gosimple        # simplifications
    - gocritic        # opinionated style checks
    - misspell        # spelling in comments/strings
    - bodyclose       # unclosed HTTP response bodies
    - sqlclosecheck   # unclosed sql.Rows
    - exportloopref   # loop var capture bugs

linters-settings:
  gocritic:
    disabled-checks:
      - ifElseChain   # our WS handler switch is fine

issues:
  exclude-dirs:
    - static
```

**Command:** `cd server && golangci-lint run ./...`

**Install:** `go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest`

### 1.2 Formatting — gofmt / goimports

Already built into Go. Just enforce it.

**Commands:**
```bash
gofmt -l ./server/          # list unformatted files
goimports -l ./server/      # list files with bad imports
```

### 1.3 Unit Tests

The backend has tight coupling (handlers call DB directly, no interfaces). The strategy is to test at two levels: pure logic units (no refactoring needed) and integration tests against a real SQLite database (cheap, in-memory).

#### 1.3.1 Pure Unit Tests (no refactoring needed)

These functions have no external dependencies and can be tested immediately:

| Package | File | What to test |
|---------|------|--------------|
| `config` | `config.go` | `Parse()` with various flag/env combos, `EnsureDataDir` creates dirs |
| `api` | `ratelimit.go` | `IPRateLimiter` — burst, refill, different IPs, X-Forwarded-For |
| `api` | `middleware.go` | `AuthMiddleware` — missing header, bad token, valid token (needs mock DB) |
| `storage` | `files.go` | `DetectMIME` with various file headers, `IsAllowedMIME`, hash path generation |
| `db` | `migrations.go` | Migrations run cleanly on fresh DB, idempotent on existing |
| `ws` | `protocol.go` | `NewMessage` JSON marshaling round-trips correctly |

**Example test — `server/api/ratelimit_test.go`:**
```go
func TestIPRateLimiter_BurstAllowed(t *testing.T) {
    rl := NewIPRateLimiter(3, time.Minute)
    for i := 0; i < 3; i++ {
        if !rl.Allow("1.2.3.4") {
            t.Fatalf("request %d should be allowed", i+1)
        }
    }
    if rl.Allow("1.2.3.4") {
        t.Fatal("4th request should be rate limited")
    }
}

func TestIPRateLimiter_DifferentIPs(t *testing.T) {
    rl := NewIPRateLimiter(1, time.Minute)
    if !rl.Allow("1.1.1.1") { t.Fatal("first IP should pass") }
    if !rl.Allow("2.2.2.2") { t.Fatal("second IP should pass") }
}
```

#### 1.3.2 SQLite Integration Tests

SQLite is fast enough to use a real in-memory database in tests. No mocking needed.

| Package | File | What to test |
|---------|------|--------------|
| `db` | `users.go` | Create user, get by username/ID/token, duplicate username fails, delete user |
| `db` | `channels.go` | Create channel, delete, reorder (transactional), seed defaults |
| `db` | `messages.go` | Create message, cursor pagination (`before`), `GetMessagesAround` |
| `db` | `reactions.go` | Add/remove reaction, counts, duplicate add idempotent |
| `db` | `attachments.go` | Create, link to message, orphan cleanup (time-based) |
| `db` | `mentions.go` | Create mentions, retrieve by message |
| `db` | `notifications.go` | Create, get unread, mark read, mark all read |

**Test helper — `server/db/testutil_test.go`:**
```go
func testDB(t *testing.T) *sql.DB {
    t.Helper()
    db, err := sql.Open("sqlite", ":memory:")
    if err != nil {
        t.Fatal(err)
    }
    t.Cleanup(func() { db.Close() })
    // Run migrations
    if err := RunMigrations(db); err != nil {
        t.Fatal(err)
    }
    return db
}
```

**Example — `server/db/users_test.go`:**
```go
func TestCreateAndGetUser(t *testing.T) {
    db := testDB(t)
    d := &DB{db}

    user, err := d.CreateUser("alice", "hashed_pw")
    if err != nil { t.Fatal(err) }
    if user.Username != "alice" { t.Fatalf("got %q", user.Username) }

    got, err := d.GetUserByUsername("alice")
    if err != nil { t.Fatal(err) }
    if got.ID != user.ID { t.Fatal("ID mismatch") }
}

func TestDuplicateUsername(t *testing.T) {
    db := testDB(t)
    d := &DB{db}

    _, err := d.CreateUser("alice", "pw")
    if err != nil { t.Fatal(err) }

    _, err = d.CreateUser("alice", "pw2")
    if err == nil { t.Fatal("expected duplicate error") }
}
```

#### 1.3.3 HTTP Handler Tests

Use `net/http/httptest` to test REST endpoints end-to-end against a real in-memory SQLite DB.

| Package | File | What to test |
|---------|------|--------------|
| `api` | `auth.go` | Register (valid/invalid username, duplicate), login (correct/wrong password), password change |
| `api` | `messages.go` | Get history (pagination, empty channel, with attachments/reactions) |
| `api` | `channels.go` | List channels |
| `api` | `upload.go` | Upload valid file, reject oversized, reject bad MIME type |
| `api` | `admin.go` | List users (admin only), delete user, promote/demote, non-admin rejected |

**Example — `server/api/auth_test.go`:**
```go
func TestRegisterAndLogin(t *testing.T) {
    db := testDB(t)
    handler := NewAuthHandler(db)

    // Register
    body := `{"username":"alice","password":"secret123"}`
    req := httptest.NewRequest("POST", "/api/v1/auth/register", strings.NewReader(body))
    w := httptest.NewRecorder()
    handler.Register(w, req)

    if w.Code != 200 { t.Fatalf("register: got %d", w.Code) }
    var resp map[string]any
    json.Unmarshal(w.Body.Bytes(), &resp)
    token := resp["token"].(string)
    if token == "" { t.Fatal("no token returned") }

    // Login with same creds
    body = `{"username":"alice","password":"secret123"}`
    req = httptest.NewRequest("POST", "/api/v1/auth/login", strings.NewReader(body))
    w = httptest.NewRecorder()
    handler.Login(w, req)
    if w.Code != 200 { t.Fatalf("login: got %d", w.Code) }
}
```

#### 1.3.4 WebSocket Tests

WebSocket handlers are the most coupled part. Test the message dispatch layer by constructing a Hub with a real DB and simulating client messages.

| What to test | Approach |
|-------------|----------|
| `send_message` | Create hub + fake client, send message op, verify DB write + broadcast |
| `edit_message` | Send then edit, verify content change in DB |
| `delete_message` | Send then delete, verify removed from DB |
| `add_reaction` / `remove_reaction` | Verify reaction counts |
| `create_channel` / `delete_channel` | Verify DB mutation + broadcast |
| `join_voice` / `leave_voice` | Verify voice state broadcast (mock SFU or use noop) |
| Auth timeout | Connect, don't authenticate within 5s, verify disconnect |
| Rate limiting | Send >30 msgs/sec, verify disconnect |

**Approach:** Create a `testHub()` helper that wires a Hub to an in-memory DB and a no-op SFU. Use `nhooyr.io/websocket` test helpers or pipe-based connections.

#### 1.3.5 SFU Tests

The SFU is harder to unit test (requires Pion PeerConnections). Focus on:

| What to test | Approach |
|-------------|----------|
| Room creation/teardown | Create room, add peer, remove peer, verify room cleaned up |
| Peer voice state | Set mute/deafen/speaking, verify state changes |
| Renegotiation flag | Add two peers, verify renegotiation triggered |

Use Pion's `webrtc.NewAPI()` with `SettingEngine` for deterministic tests (no real network).

### 1.4 Test Commands

```bash
cd server && go test ./...                    # all tests
cd server && go test ./db/...                 # just DB tests
cd server && go test ./api/... -run TestAuth  # specific test
cd server && go test -v -count=1 ./...        # verbose, no cache
cd server && go test -race ./...              # race detector
cd server && go test -cover ./...             # coverage summary
cd server && go test -coverprofile=cover.out ./... && go tool cover -html=cover.out  # coverage HTML
```

---

## 2. SolidJS Frontend

### 2.1 Linting — ESLint

**Tool:** ESLint 9 (flat config) with SolidJS plugin

**Install:**
```bash
cd client
npm install -D eslint @eslint/js typescript-eslint eslint-plugin-solid
```

**Config:** `client/eslint.config.js`
```js
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import solid from "eslint-plugin-solid/configs/typescript";

export default [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  solid,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "off",    // WS protocol uses `any`
      "@typescript-eslint/no-unused-vars": ["warn", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
      }],
      "no-console": "off",                            // we log intentionally
      "solid/reactivity": "warn",                     // catch reactivity bugs
      "solid/no-destructure": "warn",                 // props destructuring loses reactivity
      "solid/prefer-show": "off",                     // we use function children pattern intentionally
    },
  },
  {
    ignores: ["dist/", "node_modules/"],
  },
];
```

**Script in package.json:**
```json
{
  "scripts": {
    "lint": "eslint src/",
    "lint:fix": "eslint src/ --fix"
  }
}
```

### 2.2 Formatting — Prettier

**Install:**
```bash
cd client
npm install -D prettier
```

**Config:** `client/.prettierrc`
```json
{
  "semi": true,
  "singleQuote": false,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2
}
```

**Script:**
```json
{
  "scripts": {
    "format": "prettier --write src/",
    "format:check": "prettier --check src/"
  }
}
```

### 2.3 TypeScript Strict Checking

Already have `"strict": true` in tsconfig. Add a dedicated check script:

```json
{
  "scripts": {
    "typecheck": "tsc --noEmit"
  }
}
```

### 2.4 Unit Tests — Vitest

**Tool:** [Vitest](https://vitest.dev/) — Vite-native test runner, fastest for this stack.

**Install:**
```bash
cd client
npm install -D vitest @solidjs/testing-library jsdom
```

**Config:** add to `client/vite.config.ts`:
```ts
/// <reference types="vitest" />
export default defineConfig({
  // ... existing config
  test: {
    environment: "jsdom",
    globals: true,
    transformMode: { web: [/\.[jt]sx?$/] },
  },
});
```

#### What to Test

**Stores (pure signal logic — high value, easy to test):**

| Store | Tests |
|-------|-------|
| `auth.ts` | `login()` sets token + user, `logout()` clears both, token persists to localStorage |
| `channels.ts` | `setChannelList()` sorts by position, `addChannel()` inserts, `removeChannel()` removes, `selectedChannel()` derives correctly |
| `messages.ts` | `addMessage()` appends to correct channel, `updateMessage()` modifies content, `deleteMessage()` removes, `addReaction()` / `removeReaction()` toggle correctly, cursor pagination prepends |
| `users.ts` | `setOnlineUserList()` sets list + merges known, `addOnlineUser()` adds, `removeOnlineUser()` removes, `lookupUsername()` finds in known cache |
| `voice.ts` | `setVoiceStateList()` replaces, `updateVoiceState()` upserts, `getUsersInVoiceChannel()` filters correctly |
| `notifications.ts` | `addNotification()` prepends, `markRead()` by ID, `markAllRead()` clears all, `unreadCount()` computed correctly |
| `settings.ts` | `updateSettings()` merges partial, persists to localStorage, loads defaults on init |
| `responsive.ts` | `initResponsive()` sets mobile based on window width |

**Example — `client/src/stores/channels.test.ts`:**
```ts
import { describe, it, expect } from "vitest";
import { channels, setChannelList, addChannel, removeChannel, selectedChannel, setSelectedChannelId } from "./channels";

describe("channels store", () => {
  it("sorts channels by position", () => {
    setChannelList([
      { id: "2", name: "b", type: "text", position: 2 },
      { id: "1", name: "a", type: "text", position: 1 },
    ]);
    expect(channels()[0].id).toBe("1");
    expect(channels()[1].id).toBe("2");
  });

  it("addChannel inserts and re-sorts", () => {
    setChannelList([{ id: "1", name: "a", type: "text", position: 1 }]);
    addChannel({ id: "2", name: "b", type: "text", position: 0 });
    expect(channels()[0].id).toBe("2");
  });

  it("removeChannel removes by id", () => {
    setChannelList([
      { id: "1", name: "a", type: "text", position: 1 },
      { id: "2", name: "b", type: "text", position: 2 },
    ]);
    removeChannel("1");
    expect(channels().length).toBe(1);
    expect(channels()[0].id).toBe("2");
  });

  it("selectedChannel derives from selectedChannelId", () => {
    setChannelList([{ id: "1", name: "a", type: "text", position: 1 }]);
    setSelectedChannelId("1");
    expect(selectedChannel()?.name).toBe("a");
  });
});
```

**Lib utilities (pure functions — easy to test):**

| File | Tests |
|------|-------|
| `sounds.ts` | `playJoinSound()` / `playLeaveSound()` don't throw (mock AudioContext) |
| `devices.ts` | Speaking detection: feed known RMS values, verify speaking/not-speaking transitions |
| `ws.ts` | `onMessage()` registers/unregisters handlers, `send()` serializes correctly |
| `api.ts` | `request()` attaches Bearer token, handles error responses |

**Components (render tests — medium value):**

| Component | Tests |
|-----------|-------|
| `Login.tsx` | Renders login form, toggles to register, calls onLogin callback |
| `ChannelItem.tsx` | Renders channel name, applies selected style |
| `Message.tsx` | Renders username + content + timestamp, renders mentions as styled spans |
| `ReactionBar.tsx` | Renders emoji + count, click toggles reaction |
| `VoiceControls.tsx` | Shows mute/deafen buttons, shows stats when connected |
| `CreateChannel.tsx` | Expands form, validates name, sends WS op |

### 2.5 Test Commands

```bash
cd client && npx vitest              # watch mode
cd client && npx vitest run          # single run
cd client && npx vitest run --coverage  # with coverage
cd client && npx vitest run src/stores/  # just stores
```

---

## 3. Rust Desktop

### 3.1 Formatting — rustfmt

Already built into Rust toolchain.

**Config:** `desktop/src-tauri/rustfmt.toml`
```toml
edition = "2021"
max_width = 100
use_field_init_shorthand = true
```

**Command:** `cd desktop/src-tauri && cargo fmt -- --check`

### 3.2 Linting — Clippy

Already built into Rust toolchain.

**Config:** `desktop/src-tauri/clippy.toml` (or inline in Cargo.toml)

Add to `desktop/src-tauri/Cargo.toml`:
```toml
[lints.clippy]
pedantic = { level = "warn", priority = -1 }
module_name_repetitions = "allow"
cast_possible_truncation = "allow"
cast_sign_loss = "allow"
cast_precision_loss = "allow"
missing_errors_doc = "allow"
missing_panics_doc = "allow"
```

**Command:** `cd desktop/src-tauri && cargo clippy -- -D warnings`

### 3.3 Unit Tests

The voice module has several testable pure functions:

| File | What to test |
|------|-------------|
| `speaking.rs` | Feed silence → no speaking, feed loud signal → speaking, hold timer prevents chatter, state change returns `Some`, no change returns `None` |
| `resampler.rs` | Resample 48000→44100 and back, verify sample count ratio, verify no crash on short input |
| `audio_playback.rs` | `adapt_channels`: mono→stereo duplicates, stereo→mono averages, same→same passthrough |
| `types.rs` | Serde round-trip for all IPC types |

**Example — `desktop/src-tauri/src/voice/speaking.rs` (add at bottom):**
```rust
#[cfg(test)]
mod tests {
    use super::*;

    fn make_samples(amplitude: f32, count: usize) -> Vec<f32> {
        vec![amplitude; count]
    }

    #[test]
    fn silence_does_not_trigger() {
        let mut det = SpeakingDetector::new();
        // Feed 10 frames of silence
        for _ in 0..10 {
            let result = det.process(&make_samples(0.0, 960), 20.0);
            assert_ne!(result, Some(true));
        }
    }

    #[test]
    fn loud_signal_triggers_speaking() {
        let mut det = SpeakingDetector::new();
        let loud = make_samples(0.5, 960);
        let mut triggered = false;
        for _ in 0..20 {
            if det.process(&loud, 20.0) == Some(true) {
                triggered = true;
                break;
            }
        }
        assert!(triggered, "should detect speaking on loud signal");
    }

    #[test]
    fn hold_timer_prevents_chatter() {
        let mut det = SpeakingDetector::new();
        let loud = make_samples(0.5, 960);
        let silent = make_samples(0.0, 960);

        // Start speaking
        for _ in 0..20 {
            det.process(&loud, 20.0);
        }

        // Brief silence (< 250ms hold) should NOT stop speaking
        for _ in 0..5 {  // 5 * 20ms = 100ms < 250ms
            let result = det.process(&silent, 20.0);
            assert_ne!(result, Some(false), "should hold during brief silence");
        }
    }
}
```

**Example — `desktop/src-tauri/src/voice/audio_playback.rs` (add at bottom):**
```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mono_to_stereo() {
        let mono = vec![1.0, 2.0, 3.0];
        let stereo = adapt_channels(&mono, 1, 2);
        assert_eq!(stereo, vec![1.0, 1.0, 2.0, 2.0, 3.0, 3.0]);
    }

    #[test]
    fn stereo_to_mono() {
        let stereo = vec![1.0, 0.5, 2.0, 1.0];
        let mono = adapt_channels(&stereo, 2, 1);
        assert_eq!(mono, vec![0.75, 1.5]);
    }

    #[test]
    fn same_channels_passthrough() {
        let input = vec![1.0, 2.0, 3.0, 4.0];
        let output = adapt_channels(&input, 2, 2);
        assert_eq!(output, input);
    }
}
```

### 3.4 Test Commands

```bash
cd desktop/src-tauri && cargo test              # all tests
cd desktop/src-tauri && cargo test speaking      # just speaking tests
cd desktop/src-tauri && cargo test -- --nocapture  # see println output
```

**Note:** Tests that touch cpal or webrtc-rs require hardware or complex mocking. Keep those as integration/manual tests. Unit tests should focus on pure logic (speaking detection, resampling math, channel adaptation, serde).

---

## 4. CI/CD Pipeline

### 4.1 PR Check Workflow — `.github/workflows/check.yml`

Runs on every push and pull request. Fast feedback loop.

```yaml
name: Check
on:
  push:
    branches: [main]
  pull_request:

jobs:
  backend:
    name: Go Backend
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with:
          go-version: "1.24"
      - name: Lint
        uses: golangci/golangci-lint-action@v6
        with:
          working-directory: server
      - name: Format check
        run: |
          cd server
          test -z "$(gofmt -l .)"
      - name: Test
        run: cd server && go test -race -cover ./...

  frontend:
    name: SolidJS Frontend
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
          cache-dependency-path: client/package-lock.json
      - run: cd client && npm ci
      - name: Typecheck
        run: cd client && npx tsc --noEmit
      - name: Lint
        run: cd client && npm run lint
      - name: Format check
        run: cd client && npx prettier --check src/
      - name: Test
        run: cd client && npx vitest run

  desktop:
    name: Rust Desktop
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
        with:
          components: clippy, rustfmt
      - name: Install system deps
        run: |
          sudo apt-get update
          sudo apt-get install -y libopus-dev libasound2-dev \
            libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev
      - name: Format check
        run: cd desktop/src-tauri && cargo fmt -- --check
      - name: Clippy
        run: cd desktop/src-tauri && cargo clippy -- -D warnings
      - name: Test
        run: cd desktop/src-tauri && cargo test
```

### 4.2 Update Existing Publish Workflow

Modify `.github/workflows/publish.yml` to depend on checks passing:

```yaml
# Add at the top of publish.yml
on:
  push:
    tags:
      - "v*"

# Add needs: check (optional, since tags usually come from main)
```

---

## 5. Makefile / Task Runner

A root-level `Makefile` to unify all commands across the three codebases.

**File:** `Makefile`

```makefile
.PHONY: all lint test format check dev build deploy

# ── Lint ──────────────────────────────────────────
lint: lint-go lint-ts lint-rs

lint-go:
	cd server && golangci-lint run ./...

lint-ts:
	cd client && npx eslint src/

lint-rs:
	cd desktop/src-tauri && cargo clippy -- -D warnings

# ── Format ────────────────────────────────────────
format: format-go format-ts format-rs

format-go:
	cd server && gofmt -w .

format-ts:
	cd client && npx prettier --write src/

format-rs:
	cd desktop/src-tauri && cargo fmt

# ── Format Check (CI) ────────────────────────────
format-check: format-check-go format-check-ts format-check-rs

format-check-go:
	@cd server && test -z "$$(gofmt -l .)" || (gofmt -l . && exit 1)

format-check-ts:
	cd client && npx prettier --check src/

format-check-rs:
	cd desktop/src-tauri && cargo fmt -- --check

# ── Test ──────────────────────────────────────────
test: test-go test-ts test-rs

test-go:
	cd server && go test -race ./...

test-ts:
	cd client && npx vitest run

test-rs:
	cd desktop/src-tauri && cargo test

# ── Coverage ──────────────────────────────────────
cover-go:
	cd server && go test -coverprofile=cover.out ./... && go tool cover -html=cover.out -o cover.html

cover-ts:
	cd client && npx vitest run --coverage

# ── Typecheck ─────────────────────────────────────
typecheck:
	cd client && npx tsc --noEmit

# ── All checks (what CI runs) ────────────────────
check: format-check lint typecheck test

# ── Dev ───────────────────────────────────────────
dev-client:
	cd client && npm run dev

dev-server:
	cd server && go run . --dev --port 8080

# ── Build ─────────────────────────────────────────
build: build-client build-server

build-client:
	cd client && npm run build

build-server: build-client
	rm -rf server/static/assets/* server/static/index.html
	cp -r client/dist/* server/static/
	cd server && go build -o voicechat .

build-desktop:
	cd desktop && npx tauri build
```

---

## 6. Pre-commit Hooks

Use a lightweight git hook (no framework dependency) to catch issues before they're committed.

**File:** `.githooks/pre-commit`

```bash
#!/bin/bash
set -e

echo "Running pre-commit checks..."

# Go format check
if git diff --cached --name-only | grep -q '\.go$'; then
  echo "  Checking Go formatting..."
  cd server
  UNFORMATTED=$(gofmt -l $(git diff --cached --name-only --diff-filter=ACM -- '*.go' | sed 's|^server/||'))
  if [ -n "$UNFORMATTED" ]; then
    echo "  ERROR: Unformatted Go files: $UNFORMATTED"
    echo "  Run: make format-go"
    exit 1
  fi
  cd ..
fi

# TypeScript typecheck (only if TS files changed)
if git diff --cached --name-only | grep -q 'client/src/.*\.\(ts\|tsx\)$'; then
  echo "  Typechecking frontend..."
  cd client && npx tsc --noEmit
  cd ..
fi

# Rust format check (only if Rust files changed)
if git diff --cached --name-only | grep -q '\.rs$'; then
  echo "  Checking Rust formatting..."
  cd desktop/src-tauri && cargo fmt -- --check
  cd ../..
fi

echo "Pre-commit checks passed."
```

**Enable:** `git config core.hooksPath .githooks`

---

## 7. Implementation Order

Prioritized by value-to-effort ratio. Each phase is independently useful.

### Phase 1: Formatting & Linting (1-2 hours)

Low risk, immediate value. Catches bugs and enforces consistency.

1. Install golangci-lint, create `server/.golangci.yml`
2. Install ESLint + Prettier for frontend, create configs
3. Create `desktop/src-tauri/rustfmt.toml`
4. Add clippy lints to `desktop/src-tauri/Cargo.toml`
5. Run all formatters once to normalize existing code
6. Add `Makefile` with lint/format targets
7. Fix all lint warnings (or suppress intentional ones)

### Phase 2: Backend Tests (2-3 hours)

Highest value. The backend is the source of truth for data and logic.

1. Create `server/db/testutil_test.go` with `testDB()` helper
2. Write DB layer tests (users, channels, messages, reactions) — ~8 test files
3. Write rate limiter tests
4. Write HTTP handler tests (auth, messages, upload)
5. Target: **>70% coverage on `db/` and `api/`**

### Phase 3: Frontend Tests (2-3 hours)

Medium value. Stores are pure signal logic and easy to test.

1. Install Vitest + jsdom + @solidjs/testing-library
2. Configure Vitest in vite.config.ts
3. Write store tests (channels, messages, users, voice, notifications) — ~6 test files
4. Write lib utility tests (speaking detection, ws handler registration)
5. Write a few component render tests (Login, Message, ChannelItem)
6. Target: **>80% coverage on `stores/`, >50% on `lib/`**

### Phase 4: Rust Tests (1 hour)

Lower priority (desktop is less critical than web), but easy wins.

1. Add `#[cfg(test)]` modules to `speaking.rs`, `audio_playback.rs`, `resampler.rs`
2. Test pure functions only (no cpal/webrtc hardware deps)
3. Target: **speaking detection and channel adaptation fully covered**

### Phase 5: CI Pipeline (30 minutes)

Wire everything into GitHub Actions.

1. Create `.github/workflows/check.yml`
2. Verify all three jobs pass
3. Set up pre-commit hook script

### Phase 6: Coverage Tracking (optional, 30 minutes)

1. Add `go test -coverprofile` to CI, upload as artifact
2. Add `vitest --coverage` with c8/istanbul, upload as artifact
3. Consider Codecov or Coveralls integration if desired

---

## Summary

| Area | Tool | Command |
|------|------|---------|
| Go lint | golangci-lint | `cd server && golangci-lint run ./...` |
| Go format | gofmt | `cd server && gofmt -w .` |
| Go test | go test | `cd server && go test -race ./...` |
| TS lint | ESLint | `cd client && npx eslint src/` |
| TS format | Prettier | `cd client && npx prettier --write src/` |
| TS typecheck | tsc | `cd client && npx tsc --noEmit` |
| TS test | Vitest | `cd client && npx vitest run` |
| Rust lint | Clippy | `cd desktop/src-tauri && cargo clippy` |
| Rust format | rustfmt | `cd desktop/src-tauri && cargo fmt` |
| Rust test | cargo test | `cd desktop/src-tauri && cargo test` |
| All checks | make | `make check` |
| CI | GitHub Actions | `.github/workflows/check.yml` |
