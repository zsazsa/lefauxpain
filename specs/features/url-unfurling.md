# Feature: URL Unfurling in Chat

## Intent

When a user posts a message containing a URL, the system detects it, fetches Open Graph metadata from the target page, and renders an inline preview in the chat. The preview follows the application's mainframe/terminal aesthetic — no modern card UIs, no rounded thumbnails, no shadows. It should feel like a remote system reporting back what it found at that address.

## Current Behavior

URLs posted in chat appear as plain text. They may or may not be clickable depending on the client. No metadata is fetched or displayed.

## New Behavior

### URL Detection

1. When a message is sent, the system scans the message body for URLs
2. URLs are detected using standard patterns (http://, https://, and bare domain patterns like youtube.com/...)
3. Multiple URLs in a single message are each unfurled independently
4. The original message text is preserved exactly as the user typed it — unfurl previews appear below the message, not replacing the URL in the text

### Metadata Fetching

1. For each detected URL, the server fetches the page and extracts Open Graph metadata:
   - `og:title` — the page/video/article title (required for unfurl to display)
   - `og:description` — page description (optional, shown if available)
   - `og:site_name` — the site's name, e.g. "YouTube", "GitHub" (optional, fall back to domain name)
   - `og:image` — preview image URL (optional, NOT displayed in v1 — mainframes don't render images)
2. If `og:title` is not present, fall back to the HTML `<title>` tag
3. If neither `og:title` nor `<title>` exists, display the URL's domain name only
4. Fetching must be server-side to avoid CORS issues and to cache results
5. Metadata is fetched **once** at message send time and stored with the message — not re-fetched on every view
6. Fetching must have a **5-second timeout** — if the target is slow or unreachable, the URL renders as a plain link with no unfurl

### Display Format — Mainframe Aesthetic

The unfurl renders as a terminal-style block below the message. Monospace font. Box-drawing characters. The entire block is a clickable link that opens the URL in a new tab.

```
┌─ REMOTE ─────────────────────────────────┐
│ youtube.com                              │
│ >> Never Gonna Give You Up               │
│    Rick Astley - Official Music Video    │
└──────────────────────────────────────────┘
```

**Structure:**
- **Header line:** `┌─ REMOTE ─` followed by box-drawing to close. "REMOTE" is the fixed label — this is a terminal fetching a remote resource.
- **Line 1: Domain or site name.** Use `og:site_name` if available (e.g. "YouTube"), otherwise extract the domain (e.g. "youtube.com"). Displayed in dimmed/muted text.
- **Line 2: Title.** Prefixed with `>>`. This is the primary content — `og:title` or `<title>`. Truncate with `...` if longer than the box width.
- **Line 3 (optional): Description.** First ~80 characters of `og:description`, indented to align with the title. Only shown if description exists and is non-empty. Displayed in dimmed/muted text.
- **Footer line:** standard box-drawing close.

**Styling rules:**
- Monospace font (inherit from the application's terminal theme)
- No images, no thumbnails, no favicons in v1
- No color beyond the existing terminal palette (green-on-black, amber-on-black, or whatever the app uses)
- The box width adapts to content but has a max width (e.g. 50 characters). Longer titles wrap or truncate.
- The entire box is a single clickable region — opens the URL in a new tab
- On hover: subtle highlight consistent with terminal selection (e.g. inverse video, slight brightness change)

### Multiple URLs in One Message

If a message contains multiple URLs, each gets its own unfurl block, stacked vertically below the message:

```
User123 > Check out these links https://youtube.com/... and https://github.com/...

┌─ REMOTE ─────────────────────────────────┐
│ YouTube                                  │
│ >> Some Video Title                      │
└──────────────────────────────────────────┘
┌─ REMOTE ─────────────────────────────────┐
│ GitHub                                   │
│ >> some-user/some-repo                   │
│    A cool open source project            │
└──────────────────────────────────────────┘
```

### Caching

- Metadata is stored with the message at send time (in the message record or a linked table)
- Once fetched, metadata is never re-fetched — the unfurl is a snapshot of the page at the time the link was shared
- If the same URL is posted again in a different message, it is fetched again (no global URL cache in v1 — keep it simple)

## Constraints

- Must not slow down message sending — metadata fetching happens asynchronously after the message is persisted. The message appears immediately; the unfurl appears when metadata arrives.
- Must not break if the target URL is down, returns an error, or has no OG metadata
- Must sanitize all fetched metadata before rendering (prevent XSS from malicious og:title values)
- Must respect robots.txt? No — Open Graph tags are explicitly intended for machine consumption. Fetch regardless.
- Must not follow more than **2 redirects** to prevent redirect loops
- Must set a recognizable User-Agent string (e.g. "YourAppName/1.0 LinkPreview")
- Server must not fetch URLs pointing to internal/private IP ranges (127.x, 10.x, 192.168.x, etc.) to prevent SSRF attacks
- Maximum metadata storage per URL: title (500 chars), description (1000 chars), site_name (200 chars), image URL (2000 chars — stored but not displayed in v1)

## Database Changes

- New table or JSON column on messages for unfurl metadata:
  - `url` — the original URL
  - `site_name` — og:site_name or extracted domain
  - `title` — og:title or HTML title
  - `description` — og:description (nullable)
  - `image_url` — og:image (nullable, stored for future use)
  - `fetched_at` — timestamp
  - `fetch_status` — success / timeout / error / no_metadata
- A single message can have multiple unfurl records (one per URL)

## Out of Scope

- Image/thumbnail rendering (stored for future use, not displayed in v1)
- oEmbed support (YouTube oEmbed, Twitter oEmbed, etc.) — OG tags are sufficient for v1
- Inline video playback or audio players
- URL unfurling in messages sent before this feature is deployed (no backfill)
- User preference to disable unfurling
- Per-domain custom rendering (e.g. special YouTube player, GitHub commit view)
- Global URL metadata cache (each message fetches independently)

## Resolved Decisions

1. **No images in v1** — mainframes don't render thumbnails. We store `og:image` for future use but don't display it.
2. **Server-side fetching at send time** — avoids CORS, enables caching with the message, and means the unfurl is ready when other users load the chat.
3. **SSRF protection is required** — the server must never fetch internal/private IPs, even if a user posts them.
