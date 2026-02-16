# APT Repository for Linux Auto-Updates

## Status: TODO

## Goal

Allow Linux users to add our repo once, then receive updates automatically via `apt upgrade`.

## User Experience (after setup)

```bash
# One-time setup:
curl -s https://zsazsa.github.io/lefauxpain/key.gpg | sudo gpg --dearmor -o /usr/share/keyrings/lefauxpain.gpg
echo "deb [signed-by=/usr/share/keyrings/lefauxpain.gpg] https://zsazsa.github.io/lefauxpain stable main" | sudo tee /etc/apt/sources.list.d/lefauxpain.list

# Then forever after:
sudo apt update && sudo apt upgrade  # picks up new versions automatically
```

## How APT Auto-Update Works

When a user runs `sudo apt upgrade`, APT checks all configured repositories for newer package versions. A valid APT repository requires:
- `Packages` — index of available `.deb` files with versions, checksums, dependencies
- `Release` / `InRelease` — signed metadata about the repository
- GPG key — users import the public key to verify signatures
- The `.deb` files themselves

## Implementation Plan

### Step 1: Generate a GPG key for repo signing

```bash
gpg --full-generate-key  # RSA 4096, no expiry, "Le Faux Pain APT Signing Key"
gpg --export --armor KEY_ID > key.gpg
```

Store the private key as a GitHub Actions secret (`APT_GPG_PRIVATE_KEY`).

### Step 2: Create the gh-pages branch structure

```
gh-pages branch:
├── key.gpg                    # Public GPG key
├── dists/
│   └── stable/
│       └── main/
│           └── binary-amd64/
│               ├── Packages
│               ├── Packages.gz
│               └── Release
├── pool/
│   └── main/
│       └── LeFauxPain_X.X.X_amd64.deb
├── Release
├── Release.gpg
└── InRelease
```

### Step 3: Add CI step to publish.yml

After the `tauri-action` step completes, add a job that:

1. Downloads the `.deb` artifact from the release
2. Checks out `gh-pages` branch
3. Copies `.deb` into `pool/main/`
4. Runs `dpkg-scanpackages` to regenerate `Packages`
5. Runs `apt-ftparchive release` to regenerate `Release`
6. Signs with `gpg --detach-sign` (Release.gpg) and `gpg --clearsign` (InRelease)
7. Pushes to `gh-pages`

```yaml
# Rough outline for the CI job
publish-apt:
  needs: publish-tauri
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v6
      with:
        ref: gh-pages

    - name: Download .deb from release
      run: gh release download ${{ github.ref_name }} --pattern '*.deb' --dir pool/main/

    - name: Import GPG key
      run: echo "${{ secrets.APT_GPG_PRIVATE_KEY }}" | gpg --import

    - name: Generate repo metadata
      run: |
        cd dists/stable/main/binary-amd64
        dpkg-scanpackages --multiversion ../../../../pool/main/ > Packages
        gzip -k -f Packages
        cd ../../..
        apt-ftparchive release dists/stable > dists/stable/Release
        gpg --default-key KEY_ID -abs -o dists/stable/Release.gpg dists/stable/Release
        gpg --default-key KEY_ID --clearsign -o dists/stable/InRelease dists/stable/Release

    - name: Push to gh-pages
      run: |
        git add -A
        git commit -m "Update APT repo for ${{ github.ref_name }}"
        git push
```

### Step 4: Enable GitHub Pages

Settings → Pages → Source: `gh-pages` branch, root directory.

Repo will be served at `https://zsazsa.github.io/lefauxpain/`.

### Step 5: Update README

Add "Linux (APT)" install instructions with the one-time setup commands.

## Alternatives Considered

| Option | Pros | Cons |
|--------|------|------|
| **GitHub Pages APT repo** | Free, no third-party, all Debian/Ubuntu | Must manage GPG key and CI step |
| **Packagecloud.io** | Managed, free for open-source | Third-party dependency |
| **Launchpad PPA** | Native Ubuntu experience | Ubuntu-only, requires source packages |
| **OBS (Open Build Service)** | Multi-distro (deb + rpm) | Complex setup, openSUSE-centric |

GitHub Pages was chosen for simplicity and zero cost.

## References

- [Debian Repository Format](https://wiki.debian.org/DebianRepository/Format)
- [dpkg-scanpackages man page](https://man7.org/linux/man-pages/man1/dpkg-scanpackages.1.html)
- [apt-ftparchive man page](https://manpages.debian.org/apt-ftparchive)
