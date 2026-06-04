# Feature: Zip File Uploads

> **Status: IMPLEMENTED (owner-approved).**
> Implemented per owner go-ahead. This changes the documented "images-only"
> upload property. The automated `make validate` suite is unaffected — it only
> tests the image happy-path and does not assert zip rejection — but the
> **proposed security scenarios below (S29 revision, S53–S56) still need to be
> adopted into the read-only `specs/scenarios/` by the architect** to keep the
> scenario docs in sync with behavior. See *Open Question for the Architect*.

## Intent

Allow users to attach `.zip` archives to chat messages — for sharing mod packs,
save files, log bundles, small asset sets, etc. — alongside the existing image,
video, and audio attachment types.

The archive is treated as an **opaque blob**: stored, listed, and downloaded as
a single file. The server never inspects, extracts, or executes its contents.

## Current Behavior

Three upload endpoints each enforce a strict magic-byte MIME whitelist (sniffed
from the file bytes via `http.DetectContentType`, not the client-supplied
`Content-Type`):

| Endpoint | Handler | Allowed types | Store fn |
|---|---|---|---|
| `POST /api/v1/upload` | `server/api/upload.go` | image/jpeg, png, gif, webp | `FileStore.Store` (+ thumbnail + dimensions) |
| `POST /api/v1/media/upload` | `server/api/media.go` | video/mp4, video/webm | `FileStore.StoreVideo` |
| `POST /api/v1/radio/playlists/{id}/tracks` | `server/api/radio.go` | mp3, ogg, wav, flac, m4a, aac | `FileStore.StoreAudio` |

All store content-addressed by SHA-256 (`uploads/ab/cd/<hash>.ext`), dedup on
hash, and serve files **publicly with no auth** at the returned URL (security
scenario S34 — paths are unguessable but public if the URL leaks).

`POST /api/v1/upload` rejects anything that is not one of the four image types.
Security scenario **S29** asserts this explicitly (`.js` and `.exe` are rejected).

The client (`MessageInput.tsx`) only ever sends images to `/api/v1/upload`
(`handleFiles` filters to `f.type.startsWith("image/")`) and videos to
`/api/v1/media/upload`; the file picker uses `accept="image/*,video/*"`.

## New Behavior

### Server

Zip uploads go through the **existing attachment endpoint** `POST /api/v1/upload`
(they become message attachments, exactly like images), but down a **separate
storage path** so the image-only `Store` (thumbnailing / image decode) is never
invoked on a non-image.

1. `DetectMIME` already returns `application/zip` for real zip files
   (`http.DetectContentType` recognizes the `PK\x03\x04` magic bytes).
2. Add an allow-check `FileStore.IsArchiveMIME(mime) bool` covering exactly:
   - `application/zip` → `.zip`
   - (No other archive formats in v1 — see Out of Scope.)
3. **Reject zip-container document formats by filename extension.** Office,
   OpenDocument, and Java/Android package formats are all zip containers and
   sniff as `application/zip`, so the magic-byte check alone cannot exclude
   them. After confirming `IsArchiveMIME`, reject the upload if
   `header.Filename` (lower-cased) ends in any blocklisted extension:

   ```
   .docx .docm .dotx .dotm     (Word)
   .xlsx .xlsm .xltx .xltm      (Excel)
   .pptx .pptm .potx .ppsx      (PowerPoint)
   .odt .ods .odp .odg          (OpenDocument)
   .jar .war .ear               (Java)
   .apk .aab .ipa               (mobile packages)
   .epub                        (e-book container)
   ```

   The archive bytes are **never read** to make this determination — extension
   only — keeping the opaque-blob principle intact. Known limitation: a user can
   rename `report.docx` → `report.zip` to bypass this; accepted (see Security).
4. Add `FileStore.StoreArchive(file, mimeType) (relPath string, err error)`,
   mirroring `StoreVideo`/`StoreAudio`: SHA-256 temp-hash, dedup, write to
   `uploads/ab/cd/<hash>.zip`. **No thumbnail, no dimensions, no decode, no
   extraction.**
5. In `UploadHandler.Upload`, after the existing image branch, add an archive
   branch: if `IsArchiveMIME(mimeType)` (and the extension is not blocklisted,
   step 3), call `StoreArchive`, create the `Attachment` row with
   `MimeType = "application/zip"`, `ThumbPath = nil`, `Width/Height = nil`, and
   return the standard `uploadResponse`.
6. **Size limit:** archives are bounded by a dedicated limit `MaxArchiveSize`
   (default **100 MB**) — independent of `MaxUploadSize` (10 MB images) —
   enforced via `http.MaxBytesReader`. Rationale in Design Decisions.
   *(If the architect prefers no new config knob, archives fall under the
   existing `MaxUploadSize`; flag this in review.)*
7. **Rate limiting:** archive uploads reuse the existing upload limiter
   (3 / 30s) — no new limiter.
8. **Filename safety is unchanged:** the on-disk name is the SHA-256 hash;
   `header.Filename` is only stored as a display label (scenario S45 still holds).

### Client

1. `MessageInput.tsx` `handleFiles` / `handleDrop`: accept files whose type is
   `application/zip` (and, for drag-drop where the browser may report an empty
   type, fall back to a `.zip` extension check) and upload them to
   `/api/v1/upload`.
2. File picker `accept` becomes `image/*,video/*,.zip,application/zip`.
3. **Rendering:** a zip attachment has no image preview. Render a generic file
   chip — a 📦/archive glyph, the original `filename`, and the human-readable
   size (`size_bytes`) — that links to the download URL. This is a new
   non-image attachment renderer in the message list and in the pending-upload
   tray (the current tray assumes an image `previewUrl`).
4. Downloading is a plain link to the public `url`; the browser handles the save.

### What does NOT change

- Existing image / video / audio endpoints and their whitelists.
- Content-addressed storage, dedup, public serving, orphan cleanup.
- The server never extracts or reads archive contents.

## Files

| File | Change |
|------|--------|
| `server/storage/files.go` | Added `archiveMIME` map, `IsArchiveMIME`, `StoreArchive` (mirrors `StoreAudio`) |
| `server/api/upload.go` | Added archive branch + extension blocklist; per-type size limits; honors `MaxArchiveSize` |
| `server/config/config.go` | Added `MaxArchiveSize` flag/env (`--max-archive-size` / `MAX_ARCHIVE_SIZE`, default 104857600 = 100 MB) |
| `server/api/router.go` | Pass `MaxArchiveSize` to `UploadHandler` |
| `server/api/messages.go`, `server/ws/handlers.go` | Added `size_bytes` to message attachment payloads (REST history + WS), so the client chip can show file size |
| `client/src/stores/messages.ts` | `Attachment` type gains `size_bytes` |
| `client/src/components/TextChannel/MessageInput.tsx` | Accept zips (picker + drag-drop); `accept` attr; pending-tray non-image chip; nullable `previewUrl` |
| `client/src/components/TextChannel/Message.tsx` | Generic 📦 download chip (filename + size) for non-image attachments; `formatBytes` helper |
| `specs/architecture/current-state.md` | Documented zip as an allowed attachment type + the new config flag |

## Database

None. The existing `attachments` table already carries `filename`, `path`,
`size_bytes`, `mime_type`, and nullable `width`/`height`/`thumb_path`. A zip row
simply has null image fields. No migration.

## Lifecycle (inherited, no new code)

Zips are ordinary attachment rows, so the existing attachment lifecycle applies
unchanged:

- **Orphan cleanup** — a zip uploaded but never linked to a message is removed by
  the background goroutine after 1 hour (`CleanupOrphanedAttachments` →
  `RemoveFile`). `RemoveFile` deletes only the `.zip` blob; there is no thumbnail
  to clean up (`thumb_path` is null).
- **Dedup** — two identical zips (same SHA-256) share one file on disk; the
  second upload returns the same path. Same content-addressed behavior as images
  (security scenario S49).
- **Message delete** — the blob stays on disk after a message is deleted, since
  another message may reference the same hash (matches image behavior, S48).

## Design Decisions

1. **Opaque blob, never extracted.** Server-side extraction would expose two
   classic archive attacks: **zip-slip** (entry names like `../../etc/cron.d/x`
   escaping the target dir) and **zip-bomb** (tiny archive that decompresses to
   gigabytes — decompression-ratio DoS). Storing the raw bytes and never reading
   them sidesteps both entirely. If preview/extraction is ever wanted, it is a
   separate spec with explicit per-entry path validation and a decompressed-size
   cap.

2. **Dedicated 100 MB size cap.** Archives invite larger uploads than images, so
   they get their own limit (100 MB) rather than sharing the 10 MB image cap.
   Kept separate so the image limit is not raised. Note there is no per-user
   storage quota (scenario S47), so at 100 MB the disk-exhaustion ceiling per
   upload is meaningfully higher — the 3/30s rate limit is the only throttle;
   call this out for the architect.

3. **Reuse `/api/v1/upload`, not a new endpoint.** Zips are message attachments,
   same lifecycle as images (link to message, orphan cleanup, dedup). A separate
   storage *function* keeps the image-only thumbnail/decode path untouched while
   avoiding a parallel attachment subsystem.

4. **`application/zip` only in v1.** `http.DetectContentType` reliably detects
   zip via `PK` magic bytes. `.rar`, `.7z`, `.tar.gz` have weaker/Go-stdlib-
   absent sniffing and would need explicit detectors — deferred.

5. **Office / container formats are rejected by extension.** Office,
   OpenDocument, `.jar`, `.apk`, `.epub` etc. are zip containers that sniff as
   `application/zip`, so the magic-byte check cannot tell them apart from a plain
   zip. Per product decision they are not allowed, enforced via a filename
   extension blocklist (New Behavior step 3). This keeps the archive opaque (no
   bytes read) at the cost of being bypassable by renaming — an accepted
   limitation for a self-hosted, approval-gated instance. (A content-inspection
   alternative — reading the zip central directory for `[Content_Types].xml` /
   `mimetype` / `META-INF/` — was considered and deferred; it would break the
   "never read the archive" principle.)

6. **No content scanning / AV.** Out of scope for a self-hosted, approval-gated
   app. Documented as residual risk below.

## Security Considerations (must be reviewed)

Allowing archives **removes the "images-only" property the security audit
explicitly called out as a strength** (`docs/security-hardening.md` §"What Was
Already Good"). The following must hold:

- **No execution surface.** Uploaded files are served as static content from
  `/uploads/`. Confirm the static handler / nginx sets a benign or download
  disposition and does **not** serve user uploads from a path that could be
  interpreted/executed. `X-Content-Type-Options: nosniff` (already in the nginx
  hardening) must remain in force on `/uploads/`.
- **Malware distribution.** A zip can contain anything, served at a stable public
  URL with no auth. For a self-hosted instance with approval-gated registration
  this is an accepted risk, but it MUST be documented (new scenario S55 below).
- **MIME spoofing still blocked.** Detection stays magic-byte based; a renamed
  `.exe` does not sniff as `application/zip` and is still rejected (the S29
  intent — "no arbitrary executables" — is preserved; only `application/zip` is
  added).
- **Office-doc block is best-effort.** The extension blocklist stops the common
  case (uploading `report.docx` directly) but is bypassable by renaming to
  `.zip`. This is accepted: a renamed office file is still just an inert zip blob
  on disk, served non-executably; the block is a product/usability rule, not a
  security boundary.
- **Path traversal unchanged.** On-disk name is the hash; S45/S46/S50 unaffected.

## Open Question for the Architect (blocking)

`specs/scenarios/security-scenarios.md` is read-only and checksum-verified by CI.
**S29** currently asserts `/api/v1/upload` rejects everything non-image. This
feature requires S29 to be revised to "rejects everything except the four image
types **and `application/zip`**", and new scenarios (S53–S55 below) to be
adopted. I cannot modify scenario files. **Please confirm whether the S29
whitelist may be extended, and adopt the proposed scenarios, before any code is
written.**

## Proposed Security Scenarios (for architect adoption into `specs/scenarios/security-scenarios.md`)

> These are drafts for the architect to place, number, and re-baseline checksums.
> Numbering continues from the current max (S50 in the body; S51/S52 are free).

### Proposed S29 revision
1. Upload a `.js` file to `POST /api/v1/upload` → rejected.
2. Upload a `.exe` file → rejected.
3. Upload a real `.zip` file → **accepted** (only image/jpeg, png, gif, webp,
   and application/zip allowed).
4. Upload an `.exe` renamed to `.zip` (PE magic bytes, not `PK`) → rejected
   (magic-byte detection, not extension/header).

### Proposed S53: Archive upload size limit
1. Upload a zip larger than `MaxArchiveSize` (default 100 MB) to `/api/v1/upload`.
2. Assert: rejected with a size error.
3. Upload a zip just under the limit → accepted.

### Proposed S56: Office / container documents are rejected
1. Upload a real `.docx` (a valid zip whose filename ends in `.docx`) to
   `/api/v1/upload`.
2. Assert: rejected (extension blocklist), even though it sniffs as
   `application/zip`.
3. Repeat for `.xlsx`, `.pptx`, `.odt`, `.jar`, `.apk`, `.epub` → all rejected.
4. Upload the same bytes renamed to `.zip` → accepted (documents the known
   rename-bypass limitation; archive stored as an opaque blob).

### Proposed S54: Archive is stored opaquely, never extracted
1. Upload a zip whose entries include a path-traversal name
   (`../../evil.txt`) and a high-compression-ratio member (zip-bomb-style).
2. Assert: the upload is stored as a single `.zip` blob under the SHA-256 path.
3. Assert: no entry is written anywhere on disk; no file appears outside
   `data-dir/uploads/`; server memory/disk is not affected by the compression
   ratio (no extraction occurs).

### Proposed S55: Uploaded archives are public, static, and non-executable
1. Upload a zip, note the returned `/uploads/<hash>.zip` URL.
2. Assert: the file is downloadable without auth (consistent with S34).
3. Assert: the response carries `X-Content-Type-Options: nosniff` and the file
   is served as a static download, not interpreted/executed by the server.

## Out of Scope (v2 candidates)

- Other archive formats (`.rar`, `.7z`, `.tar`, `.tar.gz`).
- Server-side extraction, in-browser archive preview, or listing zip contents.
- Antivirus / content scanning of uploads.
- Per-user storage quotas (tracked separately under S47).
- Per-file download auth / access control (uploads remain content-addressed
  public, unchanged from today).
