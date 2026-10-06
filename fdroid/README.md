# F-Droid submission

This directory holds the material for submitting OpenCode Mobile's de-Googled
FOSS build to the **main F-Droid repository**. There is no self-hosted F-Droid
repo; users install either from F-Droid or from the `opencode-mobile-fdroid.apk`
asset on GitHub releases.

See [`docs/fdroid.md`](../docs/fdroid.md) for how the FOSS variant is produced.

## Submitting to fdroiddata

1. Ensure a tagged release contains the FOSS support and its `foss-release` CI
   job attached `opencode-mobile-fdroid.apk` to the GitHub release.
2. Fork and clone [fdroiddata](https://gitlab.com/fdroid/fdroiddata).
3. Copy `fdroiddata/app.getopencode.fdroid.yml` into the fork at
   `metadata/app.getopencode.fdroid.yml`, and set `commit:` to that release's
   tag SHA.
4. Extract upstream signatures for reproducible verification:
   ```bash
   curl -L -o opencode-mobile-fdroid.apk \
     https://github.com/alvarolorentedev/opencode-mobile/releases/download/v1.0.49/opencode-mobile-fdroid.apk
   fdroid signatures opencode-mobile-fdroid.apk
   ```
   Place the extracted files under
   `metadata/app.getopencode.fdroid/signatures/<versionCode>/`.
5. Validate:
   ```bash
   fdroid checkupdates --allow-dirty app.getopencode.fdroid
   fdroid lint app.getopencode.fdroid
   fdroid build app.getopencode.fdroid
   ```
6. Branch, commit (`New App: app.getopencode.fdroid`), push to your fork, and
   open a merge request. F-Droid maintainers build and publish it.

## Reviewer notes

- The FOSS build excludes Google Play Billing and ML Kit barcode scanning and
  compiles `expo-notifications` against F-Droid's `firebase-stubs` rather than
  Firebase Cloud Messaging. Local notifications still work.
- Voice input uses the device's system speech recognizer; if reviewers apply
  `NonFreeNet`, declare it in the recipe rather than dropping the feature.
