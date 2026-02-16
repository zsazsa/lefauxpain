# Dependabot PR Review — 2026-02-15

## Safe to merge now

| PR | Package | Change | Risk |
|----|---------|--------|------|
| #1 | actions/setup-node | 4 → 6 | LOW |
| #2 | actions/checkout | 4 → 6 | LOW |
| #3 + #5 | @tauri-apps/plugin-updater | 2.9.0 → 2.10.0 | LOW (merge both together) |
| #6 | @solidjs/router | 0.14.10 → 0.15.4 | LOW (barely used) |

## Needs local testing first

| PR | Package | Change | Risk |
|----|---------|--------|------|
| #4 | vite | 5.4.21 → 7.3.1 | **MEDIUM-HIGH** — two major versions, may need vite-plugin-solid upgrade |
| #7 | ashpd | 0.9.2 → 0.12.2 | **MEDIUM** — zbus dependency chain could cause conflicts |

## Will NOT compile — requires code changes

| PR | Package | Change | Risk |
|----|---------|--------|------|
| #9 | cpal | 0.15.3 → 0.17.1 | **HIGH** — `SampleRate` changed from struct to `u32`, breaks audio_capture.rs and audio_playback.rs |
| #10 | rubato | 0.14.1 → 1.0.1 | **HIGH** — complete API rewrite, resampler.rs needs to be rewritten |
| #8 | webrtc | 0.11.0 → 0.17.1 | **HIGH** — 6 minor versions of a pre-1.0 crate, likely API breakage across the voice engine |

## Details

### PR #1: actions/setup-node 4 → 6
Two major versions but minimal impact. v5 added automatic caching, v6 limits it to npm only. Our workflow just sets up Node 22 — no caching configured. Requires runner v2.327.1+ (GitHub-hosted runners already meet this).

### PR #2: actions/checkout 4 → 6
Credential persistence moved to `$RUNNER_TEMP`. Only matters if downstream steps rely on git credentials in `.gitconfig`. Our workflow just checks out code for a Tauri build — no multi-repo or credential-dependent git operations.

### PR #3 + #5: @tauri-apps/plugin-updater 2.9.0 → 2.10.0
Minor bump. Adds `no_proxy` config, `dangerousAcceptInvalidCerts` option, broader bundle type support, and updates `reqwest` to 0.13. All additive changes. **Merge #3 (client) and #5 (desktop) together** to keep versions in sync.

### PR #6: @solidjs/router 0.14.10 → 0.15.4
Pre-1.0 minor bump. `cache` renamed to `query` in v0.15.0. However, the router is listed as a dependency but barely used in our source. Low risk.

### PR #4: vite 5.4.21 → 7.3.1
Jumps two major versions. Vite 7 requires Node.js 20.19+ or 22.12+, changes default browser target (we override to `esnext` so no impact), and uses Rolldown bundler experimentally. Main risk: `vite-plugin-solid` ^2.0.0 may need upgrading for Vite 7 compatibility. Must run `npm run build` and `npm run dev` locally to verify.

### PR #7: ashpd 0.9.2 → 0.12.2
Pre-1.0 minor bump spanning three versions. Internal zbus dependency jumps from v3 to v5, which could cause cascading dependency conflicts. Screen capture API usage in `capture.rs` (Screencast, PersistMode, WindowIdentifier) looks standard and likely still compatible, but the dependency chain is the risk. Must run `cargo build` on Linux to verify.

### PR #8: webrtc 0.11.0 → 0.17.1
Pre-1.0 jump spanning 6 minor versions. The webrtc-rs project underwent major workspace reorganization. Plan-B removed, `RTCRtpSender::new` signature changed, multi-codec negotiation added. Our voice engine (`peer.rs`, `audio_capture.rs`, `audio_playback.rs`) heavily depends on these APIs. Riskiest PR — needs full voice chat end-to-end testing after code changes. Must verify RTP packet construction and Opus codec registration (PT111, 48kHz/2ch) still match the Go SFU.

### PR #9: cpal 0.15.3 → 0.17.1
**Will not compile as-is.** `SampleRate` changed from a struct to a `u32` type alias. Code changes needed:
- `SampleRate(device_rate)` → `device_rate` in audio_capture.rs and audio_playback.rs
- `supported.sample_rate().0` → `supported.sample_rate()`
- `device.name()` deprecated in favor of `id()` and `description()`
- ALSA device enumeration now returns many more devices
- `BufferSize::Default` behavior changed — may affect latency

### PR #10: rubato 0.14.1 → 1.0.1
**Will not compile as-is.** Rubato 1.0 is a complete API rewrite:
- `FftFixedIn::new()` constructor signature changed
- `process()` now expects `AudioAdapter` objects instead of `&Vec<Vec<f32>>`
- FFT resamplers may need explicit `fft_resampler` feature flag
- Migration path: wrap `Vec<Vec<f32>>` in `SequentialSliceOfVecs` adapter

## Recommended approach

1. **Merge safe PRs now**: #1, #2, #3+#5, #6
2. **Test locally then merge**: #4 (vite), #7 (ashpd)
3. **Voice engine upgrade (coordinated)**: #8, #9, #10 should be done together in a single branch since all three affect the voice engine and must compile together. Requires code changes in `resampler.rs`, `audio_capture.rs`, `audio_playback.rs`, and possibly `peer.rs`.
