# F-Droid distribution

This directory holds the F-Droid scaffolding for OpenCode Mobile's de-Googled
FOSS build. See [`docs/fdroid.md`](../docs/fdroid.md) for how the variant is
produced.

- `fdroiddata/app.getopencode.fdroid.yml` — **draft** recipe for the main F-Droid
  repository (`fdroiddata`). Copy it into an `fdroiddata` fork and open a merge
  request.
- `config.yml` — [fdroidserver](https://f-droid.org/docs/) config for the
  self-hosted repository.

## Own F-Droid repository

The self-hosted repo serves the `app.getopencode.fdroid` FOSS APKs. It can be
installed alongside a Play Store build.

### One-time setup

1. Generate a repo signing key and keep it backed up (losing it breaks updates):
   ```bash
   keytool -genkeypair -v -keystore fdroid/repo.keystore \
     -alias opencode-mobile-repo -keyalg RSA -keysize 4096 -validity 10000
   ```
2. Add these repository secrets:
   - `FDROID_KEYSTORE_BASE64` — `base64 < fdroid/repo.keystore`
   - `FDROID_KEYSTORE_PASS` — keystore password
   - `FDROID_KEY_PASS` — key password (often the same)
3. Enable GitHub Pages for the repository (the publish workflow pushes to the
   `gh-pages` branch, served at
   `https://alvarolorentedev.github.io/opencode-mobile/fdroid/repo`).

### Publishing

`.github/workflows/fdroid.yml` runs when a GitHub release is published (or
manually). It downloads the release's `opencode-mobile-fdroid.apk`, updates the
repository index with fdroidserver, and publishes to GitHub Pages.

### Install

Add `https://alvarolorentedev.github.io/opencode-mobile/fdroid/repo` as a
repository in the F-Droid client.

## Main F-Droid repository

Submission requires the recipe and, for reproducible builds, upstream signing
key material:

1. Ensure a tagged release contains the FOSS support and the `foss-release` CI
   job attached `opencode-mobile-fdroid.apk` to the GitHub release.
2. Copy `fdroiddata/app.getopencode.fdroid.yml` into an `fdroiddata` fork and set
   `commit:` to the full SHA of that tag.
3. Extract upstream signatures for reproducible verification:
   ```bash
   fdroid signatures opencode-mobile-fdroid.apk
   ```
   Place them under
   `metadata/app.getopencode.fdroid/signatures/<versionCode>/` in the fork.
4. Run `fdroid checkupdates --allow-dirty app.getopencode.fdroid`,
   `fdroid lint app.getopencode.fdroid`, and
   `fdroid build app.getopencode.fdroid`.
5. Open a merge request. Expect reviewer questions about voice input's use of
   the system speech recognizer (possible `NonFreeNet` anti-feature).
