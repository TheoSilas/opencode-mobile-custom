# F-Droid and FOSS builds

OpenCode Mobile ships a de-Googled **FOSS variant** so the app can be distributed
through F-Droid without the proprietary Android libraries F-Droid's inclusion
policy forbids.

## Why a variant exists

The Play/iOS build uses three proprietary Android components:

- `expo-iap` → Google Play Billing (optional Cloud Link subscription)
- `expo-camera` barcode scanning → Google ML Kit + `play-services-code-scanner` (Cloud Link QR pairing)
- `expo-notifications` → `com.google.firebase:firebase-messaging` (pulled in even though the app only posts local notifications)

F-Droid forbids Google Play Services and Firebase in all apps, and requires
upstream to provide a build flavour without them. The FOSS variant:

- excludes `expo-iap` and `expo-camera` from autolinking and plugins, and
  redirects their JS imports to stubs in `lib/foss/` via `metro.config.js`
- disables the Cloud Link paid-subscription and QR-pairing surfaces by returning
  `false` from `isConnectEnabled()` when `extra.foss` is set
- keeps local task-completion notifications by compiling `expo-notifications`
  against F-Droid's free `firebase-stubs` classes instead of `firebase-messaging`

The self-hosted OpenCode experience (connections, sessions, workspace, terminal,
files, voice) is unchanged. Only the optional paid Cloud Link path is absent.

## Building locally

```bash
npm run build:foss:android
```

This runs `scripts/build-android-release.mjs` with `OPENCODE_BUILD_FLAVOR=foss`,
which applies `scripts/foss-prepare.mjs` and then builds with the FOSS variant:

1. `scripts/foss-prepare.mjs` (shared with the fdroiddata recipe, so both builds
   get byte-identical dependency patches):
   - injects `expo.autolinking.exclude: ["expo-iap", "expo-camera"]` into
     `package.json` for the duration of the build (the build script restores it)
   - swaps `expo-notifications`' `firebase-messaging` dependency for F-Droid's
     pinned `firebase-stubs` sources
   - removes `expo-application`'s proprietary `com.android.installreferrer`
     dependency and stubs its `getInstallReferrerAsync`
2. `expo prebuild` and Gradle run with `EXPO_APP_VARIANT=foss`,
   `EXPO_PUBLIC_FOSS=1`, and app id `app.getopencode.fdroid`

Signing uses the same `ANDROID_KEYSTORE_*` environment variables as
`npm run build:android`. On CI the `foss-release` job builds the variant, asserts
the APK contains no `firebase`, `com.android.billingclient`,
`play-services-code-scanner`, or `mlkit` entries, and attaches
`opencode-mobile-fdroid.apk` to `v*` GitHub releases.

The FOSS package id is `app.getopencode.fdroid`, so it can be installed
alongside a Play Store build.

## Distribution stages

### Own F-Droid repository

A self-hosted F-Droid repo (`fdroid/`) can be published from the FOSS APKs. See
`fdroid/README.md`. A self-hosted repo is not bound by the inclusion policy, but
we still ship the FOSS variant for consistency with the main-repo build.

### Main F-Droid repository

Submission requires a recipe in an `fdroiddata` fork. A draft lives at
`fdroid/fdroiddata/app.getopencode.fdroid.yml`. It mirrors F-Droid's official
`build-react-native.yml` template: `npm ci`, patch `package.json` autolinking,
apply the `firebase-stub` srclib, `npx expo prebuild -p android --clean`, strip
the release `signingConfig`, and `gradle assembleRelease`. It is marked for
reproducible builds via `Binaries:` pointing at the GitHub release APK, so
F-Droid verifies its rebuild matches the upstream `opencode-mobile-fdroid.apk`
before publishing under the upstream signature.

Anti-features: voice input relies on the device's system speech recognizer,
which on many devices is supplied by Google. If F-Droid reviewers apply
`NonFreeNetwork`, declare it rather than dropping voice.

## Keeping the variant working

When changing dependencies or native config:

- `npm run test:ci:static` and `npm run typecheck` must stay green
- `npm run test:architecture` guards the layering; FOSS stubs live in `lib/foss/`
- bump the pinned `FIREBASE_STUB_SHA` in `scripts/foss-prepare.mjs` and the
  `firebase-stub@<commit>` srclib in the recipe together if `expo-notifications`
  needs a newer stub API
