# Composer reference QA

final result: passed

Scope: the supplied Codex composer, adapted to OpenCode Mobile's existing tokens and provider actions. The transcript, four tabs, navigation, and device chrome are outside this visual change.

- Source: `/tmp/codex-remote-attachments/01a10316-82fe-7bd0-952d-62951573186a/4d7d4c0a-c331-4b64-8dc8-906ac374d3e6/1-19440.jpg` (570 × 1280 pixels).
- Implementation: `output/ux-validation-2026-10-03/ios-direct-controls.jpg` (368 × 800 pixels, Simulator-tool downscaled capture of the iPhone 17 Pro app).
- Full-view comparison: `output/ux-validation-2026-10-03/composer-full-comparison.jpg`; both images normalized to 393 pixels wide. Different device aspect ratios and surrounding app content are expected; only the composer is the target.
- Focused comparison: `output/ux-validation-2026-10-03/composer-comparison.jpg`; both composer crops normalized to 393 pixels wide, retaining their respective heights.
- State: dark theme, normal text, empty composer, completed transcript. Larger-text/light evidence: `output/ux-validation-2026-10-03/ios-codex-composer-larger-text.jpg`.

## Findings and comparison history

The earlier composer separated settings from a narrow pill input and put attachment on the right. That was a P1 mismatch with the selected reference. It now uses a single rounded text area with an integrated lower toolbar. Left to right: attachment plus, options/approval icon, model and reasoning summary, microphone, circular voice/send/stop action.

An intermediate native capture showed extra filled circles around attachment and dictation, and a filled shield. Those P2 mismatches were corrected with transparent icon containers and an outlined caution icon. The post-fix focused comparison shows plain plus/microphone icons and the intended caution outline. No actionable P0/P1/P2 visual differences remain within the agreed composer scope.

## Required fidelity surfaces

- Typography: existing app font retained; compact, semibold model/reasoning summary reads as one line at normal size. Full model/provider/reasoning names remain accessible. Larger system text moves the summary to its own line.
- Layout: one rounded container, text above actions, shared bottom baseline, trailing circular primary action. The normalized composer height is close to the source. Large text preserves every action.
- Colors: existing light/dark app palette retained intentionally; surface-alt separates the text area from the transcript, caution uses the warning token, and primary action uses a high-contrast foreground/background pair.
- Assets: no raster assets in the composer. Existing Material Community icon library supplies plus, alert outline, microphone outline, waveform, arrow-up, and stop.
- Copy: actual selected model/reasoning and existing localized prompt/action labels replace reference-specific product text. Provider is retained in the model picker's accessible name and full selection sheet.

## Interaction checks

Native snapshots confirm attachment, Chat options with expanded state, model/provider/reasoning, dictation and voice/send/stop names. Web flow coverage checks expansion, dismissal, reasoning changes, selected model, errors and retained drafts. VoiceOver announcement/focus order, native software keyboard and slim-mode manual signoff remain pending; this visual pass does not assert those are complete.

## Latest requested control refinement

The supplied screenshot is amended by the user's subsequent requirements: auto-approval is a direct toggle with a shield when off and a warning when on; unsupported V2 servers hide it. A mode icon sits beside it. The model summary opens the selected-model picker with a thinking slider at the top. These requirements supersede the earlier expanding options icon.

Native post-refinement evidence: `output/ux-validation-2026-10-03/ios-direct-controls.jpg` and `output/ux-validation-2026-10-03/ios-thinking-picker.jpg`, both 368 × 800 tool-scaled iPhone captures in dark theme. The slider is above search; Selected identifies the actual chosen model. The compact summary uses two lines to preserve room for the added mode icon. Existing palette/font/icons remain. The native accessibility snapshot reports Reasoning as an adjustable slider with its current level. Manual VoiceOver/device checks remain pending.

The final native direct-toggle check confirms unchecked shield → checked warning → unchecked shield, with the server setting restored to off. Evidence: `output/ux-validation-2026-10-03/ios-auto-approve-enabled.jpg`. Static, fake-server and 71 web flows passed after the control refinement.

## Space and task-progress refinement

The latest user requirements remove the duplicate header headphones, reduce composer margins, and replace the wide completion row with a right-side floating progress icon that reserves no vertical space. Native evidence: `output/ux-validation-2026-10-03/ios-floating-task-progress.jpg` (368 × 800, dark/normal text), showing the wide completion row removed, a small completed FAB on the right, one composer voice action, and a 6px gap above the tab bar. The FAB occupies no layout row or added transcript padding. Its existing progress details open on tap. These intentional refinements supersede the previous completion-row presentation. No P0/P1/P2 visual mismatch remains within this amended scope; native keyboard, real dictation, slim mode and VoiceOver checks remain manual.
