# OpenCode Connect

Connect is an optional native alternative to manual server setup. Settings,
onboarding and the independent `pair` route reuse the same provider flow.
Account creation is invisible: a verified App Store or Google Play subscription
issues the Connect session. There is no signup, login or token-entry step.

## Environment and native prerequisites

The default trusted control plane is `https://api.getopencode.app`.
`EXPO_CONNECT_CONTROL_PLANE_URL` sets a different default HTTPS environment at build
or Metro start time. The Connect panel lets the user edit and save the trusted
control plane URL. This non-secret preference survives relaunch and takes precedence
over the build default. Only that exact normalized URL is accepted in pairing links;
QR links cannot change the selected environment. URLs must use HTTPS and contain
no credentials, query parameters, or fragments. Switching reloads the catalog and
environment/store-scoped session and pending QR, and clears displayed offers,
machines and pairing state. Switching is blocked during operations, unfinished
purchases and pending credential saves. Existing profiles and secure sessions
remain available in their original environment. Never put product IDs or private verification credentials in Expo
configuration. The environment's `GET /v1/subscriptions/catalog` supplies plans,
Apple products and Google product/base-plan/offer IDs. Missing configuration or
native product metadata shows an unavailable error.

`expo-iap` 5.8.2 requires a native development/store build. Rebuild after adding
its plugin. Expo Go and ordinary web cannot purchase or restore. Keep Expo SDK
57's generated native deployment targets and toolchain; don't replace them with the
standalone IAP library's compiler. Android requires Java and an Android SDK.
The separate development app IDs must match the backend/store configuration
for that environment; a production store product cannot be tested under an
unregistered development bundle/package ID.

Apple prerequisites: auto-renewable subscription group, In-App Purchase
capability, sandbox/TestFlight testers, backend verification credentials and V2
notifications. **Keep Family Sharing disabled.** Shared Connect ownership is not
supported. Family-shareable native products are not offered by the app.
Google prerequisites: active auto-renewing base plan, eligible offers when
advertised, license testers/test-track build, backend verification credentials
and authenticated RTDN. Local StoreKit simulation is not server-verifiable.
Store-console setup and backend deployment are external to this mobile change.

**Backend release blocker:** the sibling backend inspected for this change still
acknowledges Google purchases. Mobile is the sole finalization owner under the
corrected contract. Remove backend acknowledgement from claim, notifications,
reconciliation and recovery before full Android contract validation. Mobile
calls only `finishTransaction`, not a second acknowledgement operation. Backend
claim must safely recover the same store ownership when repeated.

## Purchase, Restore and pairing

The app renders native localized pricing, periods and eligible advertised offers.
Only an explicit Purchase tap invokes `requestPurchase`. Pending approval and
cancellation grant nothing. Google replacement purchases include the previous
subscription token and explicit `deferred` replacement parameters.

Only an explicit Restore tap calls `restorePurchases`, followed by
`getAvailablePurchases`. Startup, foreground, session recovery and reconnect
may query available purchases, but never synchronize StoreKit interactively or
open a purchase dialog. iOS queries explicitly use
`onlyIncludeActiveItemsIOS: true` and `alsoPublishToEventListenerIOS: false`.
Unfinished iOS transactions are inspected through the native pending-transaction
API. Client metadata never authorizes Connect access.

Both stores follow this order:

1. Obtain a purchased/recovered native transaction. Apple uses the exact native
   StoreKit signed JWS (`purchaseToken`, or native `getTransactionJwsIOS` when
   needed); Google uses its purchase token.
2. Submit the proof to unauthenticated `/v1/subscriptions/claim`.
3. Validate the returned session and durably write it to SecureStore.
4. Call `finishTransaction({ purchase, isConsumable: false })`, finishing StoreKit
   on iOS and acknowledging Google on Android.
5. Automatically continue a pending QR, or recover owned machines.

A failed backend claim or secure write never finalizes the transaction.
Finalization retries reuse the saved session without buying again. After app
termination, the unfinished native transaction can be rediscovered, exchanged
again through the idempotent claim and finalized. Store proofs are not stored
permanently. Session validity and paid-through entitlement are separate.

Scan the connector QR or open its version-1 link:

```text
opencodemobile://pair?v=1&cp=<trusted-control-plane>&id=<pairing_id>&t=<pairing_token>&n=<machine_name>
```

The route ingests parameters into provider state and strips them from navigation.
Pending QR data lives only in secure storage for continuation, never AsyncStorage.
Purchase/Restore resumes that exact pending pairing after finalization. Claim
sends the bearer session and JSON `{pairing_token,device_name}`. Default device
names are iPhone or Android phone; the backend assigns credential identifiers.

Completed pairing/access responses are saved before normal connection switching.
Secure-save retries retain the completed response in memory and do not redeem or
purchase again. Restart during an ambiguous pairing can repeat the same claim;
owner-visible `machine_id` in `409`/`503` recovers through authenticated machine
access. Provisioning locks remain retryable. Explicit expiry/invalid-token errors
clear pending QR data and request a fresh scan, preserving the subscription and
session. The older backend's combined conflict/expiry/lock message is ambiguous;
retain that QR for explicit retry or replacement rather than guessing its age.
A new scan replaces pending QR data; closing the pairing flow clears it.

Scanner permission is requested only in the scan flow. Losing focus or
backgrounding unmounts the preview. Missing iOS lenses and startup timeout retain
deep-link recovery. Pairing remains available before onboarding completion.

## Machines, secure profiles and transport

`machine_id` is durable ownership identity. `/v1/machines/:id/access` must return
that exact ID; a mismatch is rejected before credentials are saved or state is
migrated. Existing machine hostnames and profile IDs/names/model preferences are
preserved. Device credentials may rotate. The provider copies validated
connection-scoped caches and migrates remembered sessions, favorites and pending
notification references to the new credential scope before switching. Old
non-secret cache/remembered-session copies remain for interruption-safe recovery.

`GET /v1/machines` exposes owned machines and `access_enabled`, including after
subscription expiry. Second-device Restore recovers store ownership and obtains
machine access without a new QR. Expiry preserves machine/profile records;
Purchase/Restore reactivates the same machine/tunnel/hostname. Reconnect paths
prepare Connect credentials centrally. Foreground access refresh starts five
minutes before expiry, avoids repeatedly refreshing unchanged paid-through
credentials, and retries transient failures. Expiry still closes SSE/terminal
sockets and blocks all SDK/polling/background traffic.

Sessions are SecureStore records scoped by trusted environment and store; Apple
and Google identities never merge. Session/pending-QR storage requires an
unlocked device and uses device-only iOS accessibility. Profile credentials use
the existing device-only, after-first-unlock storage for background notifications.
Native backup exclusions remain. AsyncStorage contains only profile metadata:
`{controlPlaneUrl,machineId,machineName,deviceId,expiresAt}` plus ordinary
connection metadata/preferences, never bearer/proof/pairing/device secrets.

HTTP, SSE and native WebSockets talk directly to `server_url` using device
Basic auth. User sessions never reach the data plane and credentials never enter
WebSocket URLs. Existing SSE reconnect/polling fallback and manual connections
remain. Forget removes local credentials only; explicit machine deletion removes
local records only after the backend acknowledges successful cleanup.

## Validation

`test:connect` covers trusted catalog/API/proof/session contracts and the actual
claim → secure-write → finalization aggregation on both stores, including
failures, retries and rediscovered transactions. It also tests catalog/base-plan/
offer selection, native JWS forwarding, Family Sharing exclusion, DEFERRED
replacement, URL safety, app identity/camera/build variants and WebSocket headers.
`test:connection-profiles` checks stable profile identity, credential rotation,
hostname preservation, rollback, secret exclusion and expiry.
Control-plane checks cover URL normalization/rejection, explicit pairing trust,
environment-isolated sessions and pending QR records. The Connect E2E flow also
checks editing, catalog reload, state reset, purchase blocking and relaunch.

`tests/e2e/connect.spec.mjs` intercepts the trusted API, supplies deterministic
native-store metadata/events and forwards HTTPS connector REST to the existing
fake OpenCode server. SSE deliberately falls back to polling. The development
E2E build substitutes memory for secure storage; reload loses credentials.
Production web has neither this store driver nor credential persistence.

Run `test:ci:static`, `test:fake-server:self`, `test:e2e:web`, the Android
development build and an iOS development build. E2E changes require explicit
human validation under AGENTS.md, even when automated checks pass.

Validation recorded on 2026-10-02:

- Static checks and both fake-server self-tests passed.
- Chromium: all 61 E2E flows passed, including subscription recovery, save-only
  retries and credential rotation. Mobile/desktop screenshots showed no overflow;
  the purchase flow reported no browser runtime errors.
- Android development `assembleDebug` passed for ARM64, using the existing JDK 17
  and a temporary command-line Android SDK. Other Android ABIs were not built.
- iOS development prebuild/CocoaPods and unsigned Debug simulator compilation
  passed, including the native IAP integration. Device signing was not tested.
- Explicit human E2E validation and live store/tunnel acceptance remain pending.

For the simulator compilation after a development prebuild:

```bash
EXPO_APP_VARIANT=development CI=1 npx expo prebuild --platform ios
EXPO_APP_VARIANT=development xcodebuild -workspace ios/OpenCodeMobileDev.xcworkspace \
  -scheme OpenCodeMobileDev -configuration Debug -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
```

Native acceptance remains separate: real sandbox/license-test purchase and
second-device Restore in each store, secure cold/locked-device relaunch,
finalization after interruption, Google plan replacement/lineage, renewal of the
same machine/tunnel/hostname, expiry/refund termination of active SSE/WebSockets,
camera allow/deny/unavailable, cold/warm deep links, manual/Connect switching and
background notifications. Both variants share `opencodemobile`; verify routing
when both are installed. Mocked checks and simulator compilation do not establish
live purchase, Restore, acknowledgement or tunnel behavior.
