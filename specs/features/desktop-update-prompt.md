# Feature: Desktop Update Prompt

## Intent

When a new desktop release is published, every installed desktop client
should tell the user plainly, at the top of the app, that a newer version
exists and offer to download and install it there and then. Today the only
hint is a one-line button at the bottom of the sidebar that opens Settings;
most users never notice it, and nobody is asked to update.

## Current Behavior

- `client/src/stores/updateChecker.ts` (desktop shell only) checks the
  GitHub release manifest 5 s after launch and every 2 h, and exposes
  status, version, progress and error signals.
- The sidebar shows "↑ Update X available" above the user bar; clicking it
  opens Settings → App, where `[download & install]` and `[relaunch]` live.
  Linux package installs get a link to the release page instead.
- The desktop app's own launcher page has no update logic. Everything runs
  in the web client, which the desktop loads from the server, so a server
  deploy reaches every installed client on its next reload.
- The Tauri updater, signing key and `latest.json` publishing are in place;
  the last published release is v1.5.6 (Feb 2026) and the tree says 1.5.7.

## New Behavior

- A banner across the top of the main column, in the same slot as the
  stale-version banner, desktop shell only, driven by the same store:
  - available: "Desktop app X is available." `[DOWNLOAD & UPDATE]` starts the
    download and install. On Linux the button is `[DOWNLOAD]` and opens the
    release page, matching the Settings tab. `[LATER]` hides the banner for
    this session.
  - downloading: "Downloading desktop app X… N%".
  - ready: "Desktop app X installed." `[RESTART NOW]` relaunches the app.
    `[LATER]`.
  - error, only after an update was found: "Update to X failed: message"
    with `[RETRY]`, `[DOWNLOAD PAGE]` and `[LATER]`.
- Dismissing only hides the banner. The sidebar button and the Settings tab
  keep showing the update, and the next launch asks again.
- The sidebar button and the Settings tab are unchanged.
- Release: the desktop version becomes 1.6.0 in `tauri.conf.json` and
  `Cargo.toml`. Tag `v1.6.0` on that commit triggers the publish workflow,
  whose `latest.json` is what installed clients compare against.

## Constraints

- Browser users never see any of this (`isTauri` gate).
- No new dependencies: the client already has the updater, process and
  opener packages.

## Validation

- `make validate` stays green; no scenario is modified.
- Manual: run a 1.5.x desktop build against a server serving this client
  after v1.6.0 is published. Within about 5 s of launch the banner appears
  with `[DOWNLOAD & UPDATE]`. On macOS and Windows the download completes and
  `[RESTART NOW]` relaunches into 1.6.0. On Linux `[DOWNLOAD]` opens the
  v1.6.0 release page.
