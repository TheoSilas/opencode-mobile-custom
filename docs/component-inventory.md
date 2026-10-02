# Component Inventory

## Purpose

This document inventories the current UI and support components, their responsibilities, and their prop contracts where relevant to parity.

The goal is to make it possible to rebuild the UI tree without having to rediscover each component's role from source.

## Chat Components

## `components/chat/chat-view.tsx`

### Responsibility

- main chat screen controller
- bridges provider state to presentational chat subcomponents
- owns local UI state for draft, attachments, menu visibility, speaking state, snackbars, and voice draft capture

### Important local state

- `draft`
- `attachments`
- `activeTab`
- `chatLibraryVisible`
- `isUpdatingAutoApprove`
- `isCreatingSession`
- `isStoppingSession`
- `expandedDiffId`
- `copiedMessageId`
- `speakingMessageId`
- `voiceFeedback`
- `sendFeedback`

### Main responsibilities

- determine whether current session is running
- filter transcript into display entries
- coordinate copy-to-clipboard and TTS playback
- coordinate draft speech recognition
- attach files through document picker
- route prompt send / abort actions
- provide the complete filtered transcript to the virtualized chat list
- open/create sessions and toggle conversation mode
- execute exact server-provided slash commands
- route fork, revert, and unrevert actions

### Main child components

- `ChatHeader`
- `ChatLibrary`
- `ChatContent`
- `ChatComposer`
- `Snackbar`

## `components/chat/chat-content.tsx`

### Responsibility

- render transcript area and changes area
- render empty states, connection issues, running indicators, and pending interactions
- render server-owned tasks in a compact progress view that opens the shared overlay

### Prop contract

```ts
type ChatContentProps = {
  activeSession?: Session
  activeTab: 'session' | 'changes'
  awaitingUserInput: boolean
  connection: { status: 'idle' | 'connecting' | 'connected' | 'error'; message: string }
  copiedMessageId?: string
  currentActivityLabel?: string
  currentDiffs: FileDiff[]
  currentDiffScope: DiffScope
  currentPendingPermissions: PendingPermissionRequest[]
  currentPendingQuestions: PendingQuestionRequest[]
  currentTodos: Todo[]
  currentSessionId?: string
  diffCount: number
  diffDetails: DiffDetail[]
  diffTurns: DiffTurn[]
  displayTranscript: TranscriptEntry[]
  expandedDiffId?: string
  isRefreshingDiffs: boolean
  isRefreshingMessages: boolean
  onCopyMessage: (entry: TranscriptEntry) => void
  onForkMessage: (messageId: string) => void
  onRevertMessage: (messageId: string) => void
  onUnrevert: () => void
  onExpandDiff: (id?: string) => void
  onRefresh: () => void
  onRefreshDiffs: () => void
  onSelectDiffScope: (scope: DiffScope) => void
  onSelectDiffMessage: (messageId: string) => void
  selectedDiffMessageId?: string
  onRejectQuestion: (requestId: string) => void
  onReplyToPermission: (requestId: string, reply: 'once' | 'always' | 'reject') => void
  onReplyToQuestion: (requestId: string, answers: string[][]) => void
  onSendStarterPrompt: (prompt: string) => void
  onToggleSpeak: (entry: TranscriptEntry) => void
  palette: Palette
  pendingInteractions: number
  running: boolean
  speakingMessageId?: string
  status?: SessionStatus
}
```

### Behavior notes

- `session` tab shows transcript and pending cards
- transcript messages use FlashList virtualization; it starts at the bottom, follows additions only from the bottom, and preserves the visible position otherwise
- `changes` tab shows the active diff scope with a scope control, an optional turn picker, and diff accordions
- `changes` tab scopes: `Turn` (per-turn snapshot diff, with a picker when multiple turns have diffs), `Uncommitted`, and `Branch` (VCS working tree / default-branch diffs)
- displays starter prompts when there are no display transcript messages

## `components/chat/chat-composer.tsx`

### Responsibility

- render controls for agent/model/reasoning selection
- render auto-approve toggle
- render optional conversation banner
- render attachments, voice status, prompt input, and action buttons

### Prop contract

```ts
type ChatComposerProps = {
  attachments: { uri: string; mime?: string; filename?: string }[]
  availableAgents: AgentOption[]
  chatPreferences: ChatPreferences
  connectionStatus: 'idle' | 'connecting' | 'connected' | 'error'
  conversation: { active: boolean; isListening: boolean; phase: string; statusLabel?: string }
  draft: string
  insetsBottom: number
  isCreatingSession: boolean
  isSpeechInputAvailable: boolean
  isSpeechInputListening: boolean
  isStoppingSession: boolean
  isUpdatingAutoApprove: boolean
  onAttach: () => void
  onDraftChange: (value: string) => void
  onRemoveAttachment: (index: number) => void
  onSend: () => void
  onToggleAutoApprove: () => void
  onToggleRecording: () => void
  palette: Palette
  selectedAgentLabel: string
  showSendAction: boolean
  currentSessionId?: string
  visibleModels: ModelOption[]
  updateChatPreferences: (patch: Partial<ChatPreferences>) => void
  commands: Command[]
  onCommandSelect: (command: string) => void
}
```

### Important parity notes

- todos are server-owned and displayed in the chat overlay with disabled status icons; the UI has no todo mutation action
- typing `/` shows up to six matching server commands; selecting one fills the draft
- model selection uses a searchable sheet grouped by provider; the trigger displays `Provider · Model`

## `components/chat/model-picker.tsx`

### Responsibility

- render the searchable, provider-grouped configured-model picker
- virtualize model rows with a bounded-height native `SectionList`, so opening a large catalog does not mount every model's text views at once
- pin a `Selected` and `Recent` section above the provider groups (hidden while searching)
- own only local modal visibility and search-query state
- return the selected `ModelOption` to the composer, which persists it through the provider

## `components/chat/chat-header.tsx`

### Responsibility

- top app bar
- active session and workspace title that opens the Chats overlay
- compact current-session usage summary and usage breakdown sheet
- mounting point for conversation overlay

### Prop contract

```ts
type ChatHeaderProps = {
  connectionStatus: 'idle' | 'connecting' | 'connected' | 'error'
  conversation: { active: boolean; latestHeardText?: string; phase: ConversationPhase }
  insetsTop: number
  isCreatingSession: boolean
  onConfirmStopConversation: () => void
  onCreateSession: () => void
  onOpenLibrary: () => void
  onToggleConversationMode: () => void
  palette: Palette
  selectedSession?: Session
  activeProjectLabel?: string
}
```

## `components/chat/chat-library.tsx`

- Chats overlay with search, favorites, archived sessions, and swipe-left session actions
- "Active across workspaces" group above Favorites listing up to four running/recent sessions from the whole connection; listed IDs are removed from the Chat list below, and tapping one switches project and opens it through `openSessionInProject`. Project-scoped actions (rename/share/archive/delete) appear only on the current-workspace rows
- re-seeds the cross-workspace snapshot when the overlay opens
- keeps the Hide subagents switch alongside the Active and Archived filters
- header action opening the shared workspace picker overlay
- uses provider actions for switching workspaces, opening chats, and persistence
- owns only local search, section, swipe row, rename, and feedback state

## `components/ui/overlay-sheet.tsx`

- shared overlay presentation for Chats, workspace selection, progress, diff source selection, session usage, terminal selection, and Settings categories; short overlays fit their content

## `components/ui/workspace-picker.tsx`

- shared Chat workspace button and project picker overlay also used by Workspace's existing dropdown
- lets the user enter a directory on the OpenCode server; the provider resolves and selects it
- owns no domain state or persistence

## `components/chat/chat-cards.tsx`

### Exported components

- `PendingInteractionsCard`
- `QuestionFlow`
- `SessionDiffCard`
- `DiffCard`
- `TranscriptMessage`

### `PendingInteractionsCard`

Responsibility:

- render session-scoped permission actions in the floating continuation area

### `QuestionFlow`

- full-screen step-by-step questions; preserve local drafts across dismissal
- collect single, multiple, or custom answers and submit on the last step
- render V2 form field types, conditions, defaults, and retry errors

### `SessionDiffCard`

Responsibility:

- render a structured diff (`FileDiff`/`VcsFileDiff`) using a generated line-level preview; used for every Files Changed scope

### `DiffCard`

Responsibility:

- render filename-only patch transcript details when structured diff data is absent

### `TranscriptMessage`

Responsibility:

- render one display transcript bubble
- in flat mode (chat preference), drop the bubble chrome and side margins, render full-width rows with condensed spacing and a shared text color; the role label still distinguishes user and assistant
- with the slim-interface preference, reduce bubble padding and action-button sizes
- show copy state, optional TTS button, fork/revert actions for user messages, timestamp, markdown text, error, and summary chips
- an explicit copy button keeps copying available without capturing table-scroll gestures; taps still dismiss the keyboard

## `components/chat/chat-markdown.tsx`

### Responsibility

- render assistant/user messages with `react-native-enriched-markdown` in GitHub flavor
- Message bubbles stretch within their side margins; the renderer stretches within the bubble padding and keeps its measured content height. Avoid percentage widths inside content-sized bubbles, which can mismeasure native wrapping and height.

### Supported formatting

- Transcript Markdown text and line spacing follow the persisted chat text-size preference.
- GitHub-flavored Markdown, including tables, ordered and unordered lists, links, emphasis, blockquotes, and fenced code blocks
- native text selection and link handling on iOS/Android, plus semantic HTML rendering on web

## `components/chat/chat-overlay.tsx`

### Responsibility

- full-screen conversation-mode overlay
- shows session title, phase, last heard text, and stop button

### Inputs

- connection status
- top inset
- latest user text
- stop handler
- conversation phase
- session title

## `components/chat/chat-controls.tsx`

### Exported components

- `SelectControl`
- `ControlButton`
- `TopTab`

### Responsibility

- small reusable controls for chat toolbar and tab strip
- accept a `slim` prop that shrinks control height, icon size, and label size for the slim-interface preference

## `components/chat/chat-diff.ts`

### Responsibility

- parse current unified `patch` hunks into line diff previews
- collapse large unchanged context sections
- derive diff palette by line kind

### Important behavior

- treats the common prefix and suffix as context and the middle as one changed block
- preserves context/add/remove rows with line numbers

## `components/chat/chat-view-utils.ts`

### Responsibility

- constants and tiny label helpers

Current values used by the UI:

- starter prompts list
- reasoning options list
- transcript page size = `20`
- auto-approve icon mapping

## `components/chat/chat-view-styles.ts`

### Responsibility

- centralized style sheet for most chat surfaces
- export `slimStyles`, parallel overrides applied on top of the base sheet when the slim-interface preference is on

This is important to parity because the chat layout is intentionally dense and highly composed, especially around:

- chat library
- message bubble geometry
- composer dock
- conversation banner
- task overlay

## Screen Controllers

## `app/(tabs)/workspace.tsx`

### Responsibility

- wire project selection to the provider
- render file search plus conflict-checked text editing and full-file patch save
- render experimental worktree create/list/reset/remove controls
- keep confirmations, rename/edit inputs, file query, and worktree forms local to the screen

### Presentation

- keeps its active-project title, path, and dropdown trigger in the header; the dropdown opens the shared workspace picker overlay
- the shared picker can add a server directory as a workspace
- keeps separate project sync and workspace refresh actions
- separates files and worktrees with the same top tabs as Chat, without an enclosing panel border; chat lifecycle actions live in the Chat library
- opens file viewing and editing in a focused full-screen surface

## `app/(tabs)/settings.tsx`

### Responsibility

- wire connection, diagnostics, provider, notification, and voice sections to the provider
- open provider OAuth URLs
- collect and submit authorization codes for code-based OAuth callbacks
- wire MCP add/connect/disconnect/enable/disable and OAuth actions to `McpSection`
- declare every category once in a `SettingsSection` registry (`icon`, `title`,
  `summary`, `onPress`, `render`); the row list and the overlay both derive from
  it, so adding a category is a single entry plus its presentational component

### Presentation

- shows compact settings rows in one group and opens one category at a time
- uses the same safe-area app header and title treatment as Chat and Terminal
- groups MCP servers and diagnostics under the `Advanced` category
- shows a `Language` category for the app interface language
- shows compact category summaries and renders one category at a time in the shared overlay
- opens connection and provider forms in keyboard-safe full-screen surfaces

## `app/(tabs)/terminal.tsx`

### Responsibility

- fourth tab and thin controller over provider-owned PTY state
- render a content-sized PTY selector overlay; each terminal opens on tap and reveals Close on swipe
- create default-shell PTYs, select/reconnect existing PTYs, and send newline-terminated input
- auto-scroll provider-capped output; it is not a VT terminal emulator

## Settings Components

`connect-panel.tsx` renders development-only pairing, scanner, profile,
and machine-management UI. `app/pair.tsx` ingests links and navigates only.
Domain state/actions come from `useConnection().connectSetup`; see [Connect](connect.md).

## `components/settings/settings-sections.tsx`

### Exported sections

- `AppearanceSection`
- `ConnectionSection`
- `AiDefaultsSection`
- `NotificationsSection`
- `VoiceSection`
- `LanguageSection`
- `DiagnosticsSection`

### `ConnectionSection`

Responsibility:

- show connection state card
- show the current connection message or error hint from provider state
- render the saved-connection list (`ConnectionProfiles`)

The server URL/username/password fields are no longer a standalone form; they
live inside the connection rows (current connection row) or the add/edit
dialog, so there is a single place to configure a connection.

## `components/settings/connection-profiles.tsx`

### Responsibility

- list saved connections as collapsible rows with name, host, and an Active/Connecting badge
- expand a row to see its server URL and username and to reach Connect, Edit, and Delete
- always render a `Current connection` row when the active connection has not been saved as a profile, so the live connection stays editable
- switch to a saved connection through `switchConnection()` (which persists the outgoing profile's model selection, restores the target's, and reconnects)
- add a connection through `Add connection` (saves metadata to AsyncStorage, password to SecureStore, and connects)
- edit a connection through the same dialog; editing the active connection applies to the live settings but waits for Reconnect, so an in-flight session is never dropped
- delete a saved connection and its SecureStore password, except the active one
- mark the active row by comparing `getConnectionScope()` of the profile and the current settings

The component owns only local state (expanded row, dialog, switching row); profile persistence and credential handling live in `lib/connection-profiles.ts`, and switching/reconnecting live in the provider.

## `components/settings/connection-profile-dialog.tsx`

### Responsibility

- collect name, server URL, username, and password for one connection
- validate the name and URL before submit, surface the error inline, and disable submit while saving
- own its form state for the lifetime of one dialog instance (mounted only while open)

Submit is a callback: the list component decides whether the values are added
as a profile plus connected, or applied to the existing profile/current
connection.

### `AiDefaultsSection`

Responsibility:

- show configured providers
- allow adding unconfigured providers
- allow removing configured provider credentials
- show models grouped by provider
- allow toggling enabled model IDs

### `NotificationsSection`

Responsibility:

- show notification readiness
- request notification permission
- deep-link into app, notification, and battery settings

### `VoiceSection`

Responsibility:

- edit speech input/output preferences
- edit response style settings that become system prompt hints
- select working sound and speech voice
- adjust speech rate and working-sound volume with touch sliders

### `LanguageSection`

Responsibility:

- choose the app interface language or follow the system default
- persist the choice through `updateChatPreferences({ language })`; `undefined` follows the OS locale
- list the supported languages built from `SUPPORTED_LANGUAGES`

### `DiagnosticsSection`

Responsibility:

- show OpenCode health/version when available
- show global event stream state and whether polling fallback is active
- show MCP, LSP, and formatter counts
- refresh diagnostics on demand

## `components/settings/provider-config-dialog.tsx`

### Responsibility

- render provider configuration modal
- support multi-method auth selection
- render prompt fields from auth metadata
- support OAuth and API/manual flows
- hand code-based OAuth completion back to Settings for callback submission

### Prop contract

Main relevant props:

- `authValues`
- `effectiveAuthMethods`
- `onAuthValueChange`
- `onMethodChange`
- `onSubmit`
- `selectedMethod`
- `selectedMethodIndex`
- `selectedProviderLabel`
- `visiblePrompts`

## `components/settings/mcp-section.tsx`

### Responsibility

- add local command or remote URL MCP configurations
- show status and failure details
- connect/disconnect, enable/disable, remove, refresh, and complete remote OAuth
- retain only form, busy, error, and OAuth-code UI state locally

## `components/settings/settings-utils.ts`

### Responsibility

- response scope option definitions
- working sound option definitions
- provider marketing copy
- provider marketing copy and settings option lists

## Onboarding Components

## `app/onboarding/*.tsx`

Responsibility:

- the six first-run setup steps: welcome, connect, workspace, preferences, permissions, ready
- connect, workspace, preferences, and permissions are skippable; skipping advances one step without persisting anything
- thin controllers only; connection/workspace/preference persistence and permission requests are delegated to the provider and existing helpers
- seeded from current provider state so re-running from Settings reviews rather than resets

## `components/onboarding/onboarding-step.tsx`

- shared step chrome: back action, step progress, title/subtitle, scrollable body, pinned footer
- keeps every step visually consistent without duplicating layout

## `components/onboarding/project-options.tsx`

- presentational project-row list shared by `WorkspacePicker` and the onboarding workspace step
- callers own empty/loading states

## `providers/onboarding-state.ts`

- `CURRENT_ONBOARDING_VERSION`, parse/serialize for the completion marker
- pure `resolveOnboardingStatus()` migration decision and the storage-backed `loadOnboardingStatus()`
- completion only; never stores connection, workspace, preference, or permission values

## `components/settings/use-notification-setup.ts`

- notification permission/status/platform-settings controller shared by Settings and onboarding
- requests permission only from `enable()`; `refreshStatus()` is read-only

## `components/settings/use-provider-configuration.tsx`

- provider credential dialog state machine (manual API key and OAuth, including the code callback) shared by Settings and onboarding
- returns the dialogs as `dialog` plus `feedback`/`setFeedback`

## `lib/voice/permissions.ts`

- `getVoiceInputPermissionAsync()` (read-only) and `requestVoiceInputPermissionAsync()` (explicit-action only) wrappers over `expo-speech-recognition`

## Shared UI Components

## `components/ui/native-select.tsx`

### Responsibility

- platform-aware select control

Behavior:

- iOS uses `ActionSheetIOS`
- Android/web use a custom modal sheet

### Prop contract

```ts
type NativeSelectProps<T extends string> = {
  disabled?: boolean
  onValueChange: (value: T) => void
  options: NativeSelectOption<T>[]
  renderTrigger: (props: {
    disabled: boolean
    open: () => void
    openState: boolean
    selectedOption?: NativeSelectOption<T>
  }) => ReactNode
  selectedValue?: T
  title?: string
}
```

## `components/ui/provider-icon.tsx`

### Responsibility

- render provider-specific icon assets or icon fallbacks

Known image-backed providers include:

- `openai`
- `anthropic`
- `google`
- `groq`
- `openrouter`
- `mistral`
- `xai`
- `azure`
- `github-copilot`
- `github_copilot`
- `github`

Fallback:

- `gitlab` icon
- generic `cube-outline`

## `components/ui/icon-symbol.tsx`

### Responsibility

- map SF-symbol-style names to Material Icons fallback names

Used primarily by tab icons.

## `components/haptic-tab.tsx`

### Responsibility

- custom bottom-tab button with iOS haptic feedback on press-in

## Provider And Utility Modules With UI Contracts

## `providers/opencode-provider.tsx`

### Responsibility

- central domain controller for almost all app behavior

The public UI contract is exposed through domain hooks from `providers/opencode-contexts.ts` (`useOnboarding`, `useConnection`, `useCapabilities`, `usePreferences`, `useWorkspace`, `useSessions`, `useChat`, `useConversation`, `useTerminal`, `useMcp`), each typed by its matching `*ContextValue`. `OpencodeContextValue` is their documented union.

## `providers/opencode-provider-types.ts`

### Responsibility

- define public provider-facing types used across UI

Most important exported contracts:

- `ConversationState`
- `ConnectionState`
- `ProviderOption`
- `ProviderAuthMethod`
- `OpencodeProject`
- the `*ContextValue` domain types and their union `OpencodeContextValue`

The domain values cover active/archived session lifecycle, commands, workspace editing/worktrees, MCP management, PTY terminal state/actions, diagnostics, global stream status, and OAuth callback completion in addition to chat state.

## `providers/opencode-provider-selectors.ts`

### Responsibility

- derive current session-scoped interactions, configured providers, transcript activity label, conversation status label, and session previews

## `providers/opencode-preferences.ts`

### Responsibility

- define the chat preference shape and defaults
- build the reasoning/response-style system prompt

## `providers/opencode-capabilities.ts`

### Responsibility

- map the resolved contract to server capability flags
- read and merge the auto-approve permission config

## `providers/opencode-model-selection.ts`

### Responsibility

- define model/agent catalog shapes
- map agents and validate stored/configured provider and model choices

## `providers/opencode-provider-utils.ts`

### Responsibility

- derive project labels
- group pending interactions by session

## `providers/services/session-service.ts`

### Responsibility

- aggregate workspace/session API fetches in small helpers
- expose delete, rename, fork, share/unshare, revert/unrevert, command-list, and command-execution calls

## `providers/services/capabilities-service.ts`

### Responsibility

- aggregate capability discovery and normalize provider/model/agent lists
- normalize current nested model attachment/input/tool-call/reasoning/status/limit capabilities

## `providers/services/workspace-service.ts`

### Responsibility

- expose file find/read/status, VCS read/apply, and experimental worktree operations

## `providers/services/mcp-service.ts`

### Responsibility

- expose MCP status/add/connect/disconnect/OAuth operations
- use config updates for enable/disable and removal

## `providers/services/terminal-service.ts`

### Responsibility

- expose PTY shell/list/create/get/update/remove/connect-token operations
- build the ticket-authenticated, project-scoped PTY WebSocket URL

## `providers/services/diagnostics-service.ts`

### Responsibility

- load health, MCP, LSP, and formatter status independently so one unavailable endpoint does not hide the others

## Regeneration Notes

To regenerate the app, the components above do not all need to be split exactly the same way.

But parity is easiest if these responsibilities remain separated:

- one chat controller component
- one transcript/content component
- one composer component
- one session header/sheet component
- one provider configuration dialog
- one platform-aware select abstraction
- one central provider/orchestrator
