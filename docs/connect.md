# OpenCode Connect development pilot

Connect is an optional alternative to manual server setup, enabled only with
`EXPO_APP_VARIANT=development` on iOS/Android. Production builds expose no pairing
route, scanner, or account request execution. Both native
development variants have separate app IDs and credential stores.

## Setup and flow

The only trusted control plane is `https://api.getopencode.app`. Other origins,
paths, and HTTP URLs are rejected, even if supplied in configuration. Connector
URLs must use HTTPS. Rebuild after camera/plugin or app identity changes.

Settings → Connection and onboarding expose Pair with Connect (development).
Configure an existing contract-issued pilot bearer token with
`EXPO_CONNECT_TEST_USER_TOKEN` before starting/building the development app.
Keep it in a local, ignored `.env.local` or the shell environment, never in
source control. `.env*` files are already excluded by `.gitignore`.
It is imported into SecureStore automatically; users enter no token or device
identifier. This value is embedded in the development bundle, so use only
disposable pilot accounts. Production configuration excludes it completely.
The app never invokes admin endpoints or fabricates a bearer token. Scan the
connector QR or open/paste its exact version-1 link:

```text
opencodemobile://pair?v=1&cp=<control-plane-url>&id=<pairing_id>&t=<pairing_token>&n=<machine_name>
```

Pairing is available before onboarding completion. The route ingests parameters
into provider state, then strips them from navigation. Scanner permission is
requested only in the scan flow; losing focus or backgrounding unmounts the preview.
Missing iOS camera lenses and startup timeouts show unavailable/retry recovery. Claim
taps and scanner callbacks are guarded. Claims are never automatically replayed.

The app uses the default `device_name` iPhone or Android phone, without user input.
It creates no device identifier or account. The control plane assigns
`device_id`/`device_secret` on each claim; its current handler ignores `device_name`.
Automatic user account creation requires a backend provisioning/token-issuance contract.

Saving precedes `switchConnection()`, which reuses normal workspace/session
bootstrap. Re-pairing replaces profiles for the same control-plane/machine and
deletes superseded secrets. Metadata-write failure rolls back the new secret;
the response stays in memory so Retry secure saving does not redeem again.
Restart during that failure requires a fresh pairing. An offline/not-yet-ready
tunnel preserves the saved profile and offers Reconnect.

## Ownership, credentials, and transport

- `use-connect-state.ts` is composed by `OpencodeProvider` and exposed through
  `useConnection().connectSetup`. It owns token readiness, pairing progress,
  machine listing, and local/remote removal.
- `lib/connect.ts` owns parsing, response validation, account wrappers, token
  storage, and build/expiry gating. Only the fixed API origin is trusted.
- Existing profile and active-settings DTOs retain non-secret `connect` metadata:
  `{controlPlaneUrl, machineId, machineName, deviceId, expiresAt}`. AsyncStorage
  never receives pairing tokens, user tokens, or device secrets.
- `device_id` becomes the existing username; `device_secret` uses the existing
  per-profile and active-password SecureStore keys. Connect credentials use
device-only iOS accessibility after first unlock, without biometric prompts,
  for background notification reads. Origin-scoped user tokens require an
  unlocked device. Existing Android backup exclusions remain in place.

Expiry/missing credentials are checked on activation, every OpenCode SDK fetch,
background resolution, and while active, including foreground resume. Expiry
closes SSE and terminal sockets and stops ordinary polling. OpenCode traffic
uses only `server_url` with Basic auth; account bearer tokens never reach it.
Connect uses Expo's bundled native fetch for streaming and redirect rejection;
React Native's default XHR fetch ignores redirect mode. The SDK, SSE/polling
orchestration, and manual connection transport are reused.
Native terminal upgrades send Basic headers alongside upstream ticket, cursor,
and directory parameters. Device credentials never enter WebSocket URLs. Existing
SSE reconnect and polling fallback remain in place.

Forget locally removes this device's profile/credentials, disconnecting first.
Revoke machine deletes all matching local profiles after server acknowledgement.
The UI distinguishes acknowledgement from guaranteed remote tunnel cleanup.
Machine lists lack credentials, so another device must pair independently.
Only profiles with present, unexpired local credentials offer machine connection.

## Pinned contract and gaps

Reference: the sibling `opencode-mobile-connect` working tree inspected on
2026-10-02, based on `715da5f1bcbd437bb854e6cbc61a2538339818af`. It has uncommitted
changes; the actual reviewed files are pinned by these SHA-256 hashes:

| File | SHA-256 |
| --- | --- |
| `protocol/README.md` | `4ce7219a13607d492e52677470c279af2099cd779e0e58169b5bf6304bbfef7c` |
| `control-plane/src/index.ts` | `a7bf82e556fb00cb755e5516565abe752749552fcf750b4d292436460415ff36` |
| `connector/core/src/proxy.rs` | `adaeb6d44fcf3281c633e93daeb86c638a80869193d670e38985bdb4c5b878eb` |
| `connector/core/tests/compatibility.rs` | `e94e11162fc97cfbb02badc2417908fc5e0074ec3f65229a463db79c30b75c04` |

Claim sends `{device_name}` with the user bearer. The handler currently ignores
QR `t` and does not persist the device name. No expiry countdown is invented:
links contain no timestamp. Expected claim errors are 401/403/404/409; 429 and
network/server failures permit explicit retry. A lost response cannot recover
its credential; retry may return 409 and require a new pairing. Renewal and
per-device revocation do not exist. Machine deletion suppresses remote cleanup
failures. Production needs a specified token issuer/login flow, entitlement
integration, and reliable revocation. No production authentication was added.

## Verification and human validation

`test:connect` covers parsing, endpoint trust, exact account requests/errors,
production gating, token scope, app identity, and native WebSocket headers.
`test:connection-profiles` covers replacement, storage rollback, secret exclusion,
and expiry without active-password fallback. Both run in `test:ci:static`.

`tests/e2e/connect.spec.mjs` intercepts the fixed API origin and an HTTPS connector
fixture, forwarding REST to the existing fake OpenCode server with deterministic
SSE failure/polling fallback. It never calls the real API or adds a trusted origin.
Only the explicit development E2E web build
substitutes in-memory credentials; reload loses secrets and requires re-pairing.
Product web has no Connect support. The E2E changes require explicit human
validation under AGENTS.md, even when automation passes.

Run `test:ci:static`, `test:fake-server:self`, `test:e2e:web`, and
`build:development:android`, plus the iOS development simulator build.
Physical iOS and Android checks remain required: cold/warm links and fresh
onboarding, camera allow/deny/unavailable, secure relaunch/locked-device access,
expiry while streaming, re-pair, manual/Connect switching, named-tunnel SSE and
polling fallback, authenticated terminal input/output, and global revocation.
Use a reachable tunnel: loopback refers to the phone itself.
Verify link routing when both variants are installed: they share the existing
`opencodemobile` scheme.

Local verification on 2026-10-02: static checks, fake-server self-checks, and all
54 web E2E flows passed. The iOS development app built successfully; a bundled
development variant verified cold/warm pairing links before onboarding and
camera-unavailable recovery on iPhone 17 Pro Simulator. The synthetic camera
feed renders QR frames but does not supply AVFoundation QR metadata events,
so physical QR recognition remains unverified. No live API token was supplied
for native claiming. Android Gradle reached SDK discovery but could not build
because this machine has no configured Android SDK. Human validation of the
new E2E tests and the physical-device checklist remain pending.

Pilot labels use English in all shipped locales. Existing translations stay in
their existing languages; production localization follows production sign-in.
