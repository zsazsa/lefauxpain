# Scenarios: URL Unfurling in Chat

These scenarios validate the URL unfurling feature. They are the
contract. Code must satisfy these — scenarios must not be modified to
accommodate code.

---

## URL Detection

### Scenario: Standard HTTPS URL is detected and unfurled
1. User sends message: "check this out https://www.youtube.com/watch?v=F_2MKt7yj3w"
2. Assert: message is displayed with original text intact
3. Assert: an unfurl block appears below the message
4. Assert: unfurl shows the domain or site name
5. Assert: unfurl shows the video/page title

### Scenario: HTTP URL is detected and unfurled
1. User sends message: "found this http://example.com/article"
2. Assert: URL is detected and unfurl is attempted

### Scenario: Multiple URLs in one message each get unfurled
1. User sends message: "compare https://youtube.com/watch?v=abc and https://github.com/user/repo"
2. Assert: two separate unfurl blocks appear below the message
3. Assert: each unfurl corresponds to the correct URL
4. Assert: unfurl blocks are stacked vertically

### Scenario: Message with no URL shows no unfurl
1. User sends message: "just a regular message with no links"
2. Assert: message renders normally
3. Assert: no unfurl block appears

### Scenario: URL in the middle of text is detected
1. User sends message: "I found https://example.com/page really useful for this"
2. Assert: URL is detected and unfurled
3. Assert: full original message text is preserved exactly as typed

### Scenario: Original message text is never modified by unfurling
1. User sends message: "look at https://example.com/page"
2. Assert: the message body still reads exactly "look at https://example.com/page"
3. Assert: the URL in the message text is NOT replaced or altered
4. Assert: the unfurl block appears as a separate element below

---

## Metadata Fetching

### Scenario: Open Graph title is displayed
1. User posts a URL to a page with `og:title` set to "My Great Article"
2. Assert: unfurl block shows "My Great Article" as the title line (prefixed with >>)

### Scenario: Falls back to HTML title when no OG title exists
1. User posts a URL to a page with no `og:title` but `<title>` is "Page Title"
2. Assert: unfurl block shows "Page Title" as the title line

### Scenario: Falls back to domain only when no title exists at all
1. User posts a URL to a page with no `og:title` and no `<title>`
2. Assert: unfurl block shows only the domain name
3. Assert: no title line with >> prefix is shown

### Scenario: OG site_name is used when available
1. User posts a YouTube URL where `og:site_name` is "YouTube"
2. Assert: unfurl block shows "YouTube" as the site identifier (not "youtube.com")

### Scenario: Domain name is used when og:site_name is absent
1. User posts a URL to a page with no `og:site_name`
2. Assert: unfurl block shows the extracted domain (e.g. "example.com")

### Scenario: Description is shown when available
1. User posts a URL to a page with `og:description` set to "A short summary of the page"
2. Assert: unfurl block includes the description below the title, in dimmed/muted text
3. Assert: description is truncated to ~80 characters if longer

### Scenario: Description is omitted when not available
1. User posts a URL to a page with no `og:description`
2. Assert: unfurl block shows site name and title only
3. Assert: no empty line or placeholder where description would be

### Scenario: Metadata is fetched once and stored
1. User posts a URL
2. Assert: metadata is stored with the message
3. User (or another user) reloads the chat
4. Assert: unfurl displays instantly from stored metadata — no re-fetch occurs

### Scenario: og:image URL is stored but not displayed
1. User posts a URL to a page with `og:image` set
2. Assert: image URL is stored in the unfurl metadata record
3. Assert: no image or thumbnail is rendered in the unfurl block

---

## Display — Mainframe Aesthetic

### Scenario: Unfurl renders with box-drawing characters
1. User posts a URL that successfully unfurls
2. Assert: unfurl block uses box-drawing characters (┌ ─ ┐ │ └ ┘)
3. Assert: the header contains "REMOTE" as a fixed label
4. Assert: monospace font is used for the entire block

### Scenario: Title is prefixed with >>
1. User posts a URL with og:title "Example Title"
2. Assert: the title line in the unfurl reads ">> Example Title"

### Scenario: Entire unfurl block is a clickable link
1. User posts a URL that unfurls successfully
2. Assert: clicking anywhere in the unfurl block opens the original URL
3. Assert: URL opens in a new tab

### Scenario: Hover state is terminal-appropriate
1. User posts a URL that unfurls successfully
2. User hovers over the unfurl block
3. Assert: a visual change occurs (inverse video, brightness shift, or similar)
4. Assert: no modern UI hover effects (no shadows, no scale, no color outside terminal palette)

### Scenario: Long title is truncated
1. User posts a URL with og:title longer than 50 characters
2. Assert: title is truncated with "..." at the end
3. Assert: the box-drawing border is not broken by the truncation

### Scenario: Unfurl block has a max width
1. User posts a URL with short title (e.g. "Hi")
2. Assert: the box still renders at a reasonable minimum width
3. User posts a URL with very long title
4. Assert: the box does not exceed the max width — title truncates instead

---

## Error Handling and Timeouts

### Scenario: Unreachable URL shows plain link with no unfurl
1. User posts a URL to a domain that does not resolve
2. Assert: message is displayed with the URL as a plain clickable link
3. Assert: no unfurl block appears
4. Assert: no error message shown to the user

### Scenario: Slow URL times out after 5 seconds
1. User posts a URL to a server that takes 10 seconds to respond
2. Assert: fetching is abandoned after 5 seconds
3. Assert: message appears with URL as a plain clickable link
4. Assert: no unfurl block appears
5. Assert: message was NOT delayed — it appeared immediately when sent

### Scenario: URL returns HTTP error (404, 500, etc.)
1. User posts a URL that returns a 404 status
2. Assert: no unfurl block appears
3. Assert: URL is still a plain clickable link in the message
4. Assert: fetch_status is stored as "error"

### Scenario: Message appears immediately, unfurl appears asynchronously
1. User sends a message containing a URL
2. Assert: the message text appears in the chat immediately
3. Assert: the unfurl block appears after metadata is fetched (may be near-instant or take a few seconds)
4. Assert: sending the message was NOT blocked by metadata fetching

---

## Security

### Scenario: Fetched metadata is sanitized against XSS
1. User posts a URL to a page with og:title containing `<script>alert('xss')</script>`
2. Assert: the unfurl block displays the text with HTML escaped — no script execution
3. Assert: no JavaScript from the fetched metadata is executed in any context

### Scenario: Metadata with HTML entities is rendered as plain text
1. User posts a URL to a page with og:title containing `&amp; &lt;b&gt;bold&lt;/b&gt;`
2. Assert: the unfurl displays the literal characters, not rendered HTML

### Scenario: Internal/private IP URLs are not fetched (SSRF protection)
1. User posts a URL: "http://127.0.0.1/admin"
2. Assert: no server-side fetch is attempted
3. Assert: URL renders as a plain clickable link with no unfurl
4. User posts: "http://192.168.1.1/config"
5. Assert: no server-side fetch is attempted
6. User posts: "http://10.0.0.1/internal"
7. Assert: no server-side fetch is attempted

### Scenario: Redirect loops are limited to 2 hops
1. User posts a URL that redirects to another URL, which redirects to a third
2. Assert: the system follows at most 2 redirects
3. Assert: if still redirecting after 2 hops, fetch is abandoned
4. Assert: URL renders as a plain link with no unfurl

### Scenario: Metadata field lengths are enforced
1. User posts a URL to a page with og:title longer than 500 characters
2. Assert: stored title is truncated to 500 characters
3. User posts a URL with og:description longer than 1000 characters
4. Assert: stored description is truncated to 1000 characters

---

## Caching and Storage

### Scenario: Unfurl metadata is stored per message
1. User A posts "https://example.com/page" in one message
2. User B posts "https://example.com/page" in a different message
3. Assert: both messages have their own unfurl metadata records
4. Assert: each was fetched independently

### Scenario: Stored unfurl survives chat reload
1. User posts a URL that unfurls successfully
2. User reloads the page / re-enters the chat
3. Assert: unfurl block still appears from stored metadata
4. Assert: no new fetch request is made to the target URL

### Scenario: Fetch status is recorded for failed attempts
1. User posts a URL that times out
2. Assert: unfurl metadata record exists with fetch_status "timeout"
3. User posts a URL to a page with no title or OG tags
4. Assert: unfurl metadata record exists with fetch_status "no_metadata"

---

## Edge Cases

### Scenario: URL with query parameters and fragments is handled
1. User posts "https://example.com/page?id=123&ref=chat#section2"
2. Assert: full URL is used for fetching (including query params)
3. Assert: unfurl displays correctly
4. Assert: clicking the unfurl opens the full original URL including fragment

### Scenario: URL with unicode characters is handled
1. User posts a URL containing unicode (e.g. "https://example.com/café")
2. Assert: URL is properly encoded for fetching
3. Assert: unfurl displays correctly or falls back to plain link

### Scenario: Message that is ONLY a URL still unfurls
1. User sends a message that is just "https://example.com/article"
2. Assert: message text shows the URL
3. Assert: unfurl block appears below

### Scenario: URL with non-standard port is handled
1. User posts "https://example.com:8443/page"
2. Assert: URL is fetched on port 8443
3. Assert: unfurl displays if metadata is found

### Scenario: Already-sent messages without unfurl are not backfilled
1. Messages exist in chat from before this feature was deployed
2. Some contain URLs
3. Assert: those old messages do NOT have unfurl blocks
4. Assert: no background job attempts to fetch metadata for old messages

### Scenario: Rapid consecutive messages with URLs don't overload the server
1. User sends 5 messages in quick succession, each containing a different URL
2. Assert: all 5 messages appear immediately
3. Assert: unfurls appear as each fetch completes (not all at once, not blocking)
4. Assert: no errors from concurrent fetching
