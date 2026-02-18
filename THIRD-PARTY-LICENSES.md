# Third-Party Licenses

This document lists all third-party libraries used in Le Faux Pain and their respective licenses.

Le Faux Pain itself is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

---

## Go Dependencies (Backend Server)

The following Go modules are used in the backend server (`server/`):

### Core Dependencies

#### nhooyr.io/websocket
- **License**: MIT
- **Copyright**: Copyright (c) 2023 Anmol Sethi
- **Repository**: https://github.com/nhooyr/websocket

#### github.com/pion/webrtc/v4
- **License**: MIT
- **Copyright**: Copyright (c) 2018 Pion
- **Repository**: https://github.com/pion/webrtc

#### modernc.org/sqlite
- **License**: BSD-3-Clause
- **Copyright**: Copyright (c) 2017 The Sqlite Authors
- **Repository**: https://gitlab.com/cznic/sqlite

#### github.com/google/uuid
- **License**: BSD-3-Clause
- **Copyright**: Copyright (c) 2009, 2014 Google Inc.
- **Repository**: https://github.com/google/uuid

#### golang.org/x/crypto
- **License**: BSD-3-Clause
- **Copyright**: Copyright 2009 The Go Authors
- **Repository**: https://github.com/golang/crypto

#### golang.org/x/image
- **License**: BSD-3-Clause
- **Copyright**: Copyright 2009 The Go Authors
- **Repository**: https://github.com/golang/image

#### github.com/pion/interceptor
- **License**: MIT
- **Copyright**: Copyright (c) 2018 Pion
- **Repository**: https://github.com/pion/interceptor

### Additional Dependencies

To generate a complete list of all Go dependencies with their licenses, run:
```bash
cd server
go install github.com/google/go-licenses@latest
go-licenses csv ./...
```

---

## JavaScript/TypeScript Dependencies (Web Client)

The following npm packages are used in the web client (`client/`):

### Core Dependencies

#### solid-js
- **License**: MIT
- **Copyright**: Copyright (c) 2016-2024 Ryan Carniato
- **Repository**: https://github.com/solidjs/solid

#### @solidjs/router
- **License**: MIT
- **Copyright**: Copyright (c) 2021 Ryan Carniato
- **Repository**: https://github.com/solidjs/solid-router

### Dev Dependencies

#### vite
- **License**: MIT
- **Copyright**: Copyright (c) 2019-present Evan You & Vite Contributors
- **Repository**: https://github.com/vitejs/vite

#### typescript
- **License**: Apache-2.0
- **Copyright**: Copyright (c) Microsoft Corporation
- **Repository**: https://github.com/microsoft/TypeScript

#### vite-plugin-solid
- **License**: MIT
- **Copyright**: Copyright (c) 2020 Alexandre Mouton Brady
- **Repository**: https://github.com/solidjs/vite-plugin-solid

### Additional Dependencies

To generate a complete list of all npm dependencies with their licenses, run:
```bash
cd client
npx license-checker --production --summary
```

For detailed output:
```bash
npx license-checker --production --json > npm-dependencies.json
```

---

## Rust Dependencies (Desktop Client)

The following Rust crates are used in the desktop client (`desktop/src-tauri/`):

### Core Dependencies

#### tauri
- **License**: Apache-2.0 OR MIT
- **Copyright**: Copyright (c) 2017-2024 Tauri Programme within The Commons Conservancy
- **Repository**: https://github.com/tauri-apps/tauri

#### webrtc
- **License**: Apache-2.0 OR MIT
- **Copyright**: Copyright (c) 2021 WebRTC.rs
- **Repository**: https://github.com/webrtc-rs/webrtc

#### serde / serde_json
- **License**: Apache-2.0 OR MIT
- **Copyright**: Copyright (c) 2014 The Rust Project Developers
- **Repository**: https://github.com/serde-rs/serde

#### tokio
- **License**: MIT
- **Copyright**: Copyright (c) 2023 Tokio Contributors
- **Repository**: https://github.com/tokio-rs/tokio

#### cpal
- **License**: Apache-2.0
- **Copyright**: Copyright (c) 2019 The CPAL contributors
- **Repository**: https://github.com/RustAudio/cpal

#### opus
- **License**: Apache-2.0 OR MIT
- **Copyright**: Copyright (c) 2016 est31
- **Repository**: https://github.com/SpaceManiac/opus-rs

#### rubato
- **License**: MIT
- **Copyright**: Copyright (c) 2020 Henrik Enquist
- **Repository**: https://github.com/HEnquist/rubato

#### openh264
- **License**: BSD-2-Clause
- **Copyright**: Copyright (c) 2020 Ralf Biedert
- **Repository**: https://github.com/ralfbiedert/openh264-rs

#### ashpd
- **License**: MIT
- **Copyright**: Copyright (c) 2020 Bilal Elmoussaoui
- **Repository**: https://github.com/bilelmoussaoui/ashpd

#### pipewire / libspa
- **License**: MIT
- **Copyright**: Copyright (c) 2021 Tom A. Wagner
- **Repository**: https://gitlab.freedesktop.org/pipewire/pipewire-rs

### Optional Dependencies

#### nvidia-video-codec-sdk (feature: `nvenc`)
- **License**: MIT
- **Repository**: https://github.com/vivlim/nvidia-video-codec-sdk-rs

#### cudarc (feature: `nvenc`)
- **License**: Apache-2.0 OR MIT
- **Repository**: https://github.com/coreylowman/cudarc

#### cros-codecs (feature: `vaapi`)
- **License**: BSD-3-Clause
- **Repository**: https://chromium.googlesource.com/chromiumos/platform/cros-codecs

### Additional Dependencies

To generate a complete list of all Rust dependencies with their licenses, run:
```bash
cargo install cargo-license
cd desktop/src-tauri
cargo license
```

---

## License Compliance Notes

1. **MIT License**: Most dependencies use the MIT license, which is permissive and compatible with Le Faux Pain's MIT license. Attribution is required.

2. **Apache-2.0 License**: Also permissive and compatible with MIT. Requires attribution and preservation of copyright notices.

3. **BSD Licenses**: Permissive licenses that require attribution and preservation of copyright notices.

4. **Dual Licensing**: Some crates (like Tauri and serde) are dual-licensed under Apache-2.0 OR MIT, meaning you can choose either license.

## How to Update This File

When adding new dependencies, update this file:

1. Add the dependency name, license, copyright holder, and repository URL
2. Ensure the license is compatible with MIT
3. Run the automated tools listed above to verify all dependencies are accounted for

## Questions?

If you have questions about the licensing of dependencies used in this project, please open an issue on GitHub.

---

**Last Updated**: February 2026
