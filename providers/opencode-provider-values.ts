import { useMemo } from 'react';

import { deriveTodosFromMessages } from '@/lib/opencode/format';
import { aggregateUsageSteps, getLatestAssistantTurnUsage } from '@/lib/opencode/usage';
import { getServerCapabilities } from '@/providers/opencode-capabilities';
import {
  getConfiguredProviders,
  getCurrentPendingRequests,
  getSessionPreviewById,
  getTranscript,
} from '@/providers/opencode-provider-selectors';
import { collectDescendantSessionIds } from '@/providers/opencode-provider-utils';
import type {
  CapabilitiesContextValue,
  ChatContextValue,
  ConnectionContextValue,
  ConversationContextValue,
  DiffScope,
  DiffTurn,
  McpContextValue,
  OnboardingContextValue,
  PreferencesContextValue,
  SessionContextValue,
  TerminalContextValue,
  WorkspaceContextValue,
} from '@/providers/opencode-provider-types';
import type { ProviderValuesInput } from '@/providers/opencode-provider-values-input';

export function useOpencodeProviderValues(input: ProviderValuesInput) {
  const {
    isHydrated,
    onboardingCompleted,
    onboardingActive,
    completeOnboarding,
    startOnboardingReview,
    stopOnboardingReview,
    settings,
    connection,
    connectionProfiles,
    connectSetup,
    updateSettings,
    switchConnection,
    connect,
    eventStreamStatus,
    diagnostics,
    currentConfig,
    availableProviders,
    providerAuthMethodsById,
    availableModels,
    availableAgents,
    configureProvider,
    completeAutomaticProviderOAuth,
    setProviderAuth,
    removeProvider,
    startProviderOAuth,
    completeProviderOAuth,
    cancelProviderOAuth,
    addProviderAccount,
    activateProviderAccount,
    removeProviderAccount,
    setAutoApprove,
    chatPreferences,
    updateChatPreferences,
    projects,
    activeProjectPath,
    activeProject,
    serverProjects,
    currentProjectPath,
    serverRootPath,
    isRefreshingWorkspaceCatalog,
    refreshWorkspaceCatalog,
    refreshServerFeatures,
    refreshDiagnostics,
    workspaceFiles,
    workspaceFileStatuses,
    selectedWorkspaceFile,
    vcsInfo,
    selectProject,
    addWorkspace,
    searchWorkspaceFiles,
    openWorkspaceFile,
    saveWorkspaceFile,
    worktrees,
    refreshWorktrees,
    createWorktree,
    resetWorktree,
    removeWorktree,
    sessions,
    archivedSessions,
    sessionStatuses,
    favoriteSessions,
    toggleFavoriteSession,
    isFavoriteSession,
    clearFavoriteSession,
    currentSessionId,
    refreshSessions,
    openSession,
    ensureActiveSession,
    openDeepLinkSession,
    createSession,
    deleteSession,
    archiveSession,
    restoreSession,
    refreshArchivedSessions,
    renameSession,
    forkSession,
    shareSession,
    unshareSession,
    revertSession,
    unrevertSession,
    openSessionInProject,
    activeSessions,
    refreshActiveSessions,
    setActiveSessionsVisible,
    messagesBySession,
    pendingPromptsBySession,
    diffScopeBySession,
    diffsBySession,
    vcsDiffsByScope,
    selectedDiffMessageBySession,
    todosBySession,
    todoRecordsBySession,
    usageStepsBySession,
    messageWindows,
    loadingOlderBySession,
    pendingPermissionsBySession,
    pendingQuestionsBySession,
    sendingState,
    isRefreshingSessions,
    isRefreshingMessages,
    isRefreshingDiffs,
    isBootstrappingChat,
    commands,
    promptError,
    clearPromptError,
    executeCommand,
    sendPrompt,
    abortSession,
    setDiffScope,
    selectDiffMessage,
    refreshDiffs,
    refreshCurrentSession,
    refreshCurrentTodos,
    replyToPermission,
    replyToQuestion,
    rejectQuestion,
    loadOlderMessages,
    conversation,
    clearConversationFeedback,
    toggleConversationMode,
    terminals,
    terminalShells,
    activeTerminalId,
    terminalRuntime,
    terminalConnection,
    refreshTerminals,
    createTerminal,
    openTerminal,
    sendTerminalInput,
    closeTerminal,
    mcpStatuses,
    refreshMcpServers,
    addMcpServer,
    connectMcpServer,
    disconnectMcpServer,
    setMcpServerEnabled,
    startMcpOAuth,
    completeMcpOAuth,
    serverContract,
  } = input;

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === currentSessionId),
    [currentSessionId, sessions],
  );

  const currentMessages = useMemo(
    () => (currentSessionId ? messagesBySession[currentSessionId] || [] : []),
    [currentSessionId, messagesBySession],
  );
  const pendingPrompts = useMemo(() => {
    const delivered = new Set(currentMessages.map((record) => record.info.id));
    return (pendingPromptsBySession?.[currentSessionId ?? ''] ?? []).filter((prompt) => !delivered.has(prompt.id));
  }, [currentMessages, currentSessionId, pendingPromptsBySession]);
  const currentDiffScope = useMemo<DiffScope>(
    () => (currentSessionId ? diffScopeBySession[currentSessionId] ?? 'turn' : 'turn'),
    [currentSessionId, diffScopeBySession],
  );
  const currentDiffs = useMemo(
    () => {
      if (!currentSessionId) {
        return [];
      }
      if (currentDiffScope === 'turn') {
        return diffsBySession[currentSessionId] || [];
      }
      return vcsDiffsByScope[currentDiffScope] || [];
    },
    [currentDiffScope, currentSessionId, diffsBySession, vcsDiffsByScope],
  );
  const diffTurns = useMemo<DiffTurn[]>(() => {
    const turns = currentMessages.filter(
      (record) => record.info.role === 'user' && (record.info.summary?.diffs?.length ?? 0) > 0,
    );
    return turns.map((record, index) => {
      const textPart = record.parts.find((part) => part.type === 'text');
      const preview = textPart && textPart.type === 'text' ? textPart.text.replace(/\s+/g, ' ').trim() : '';
      return { id: record.info.id, label: `Turn ${index + 1}`, preview: preview ? preview.slice(0, 80) : undefined };
    });
  }, [currentMessages]);
  const selectedDiffMessageId = useMemo(() => {
    if (!currentSessionId) {
      return undefined;
    }
    const selected = selectedDiffMessageBySession[currentSessionId];
    if (selected && diffTurns.some((turn) => turn.id === selected)) {
      return selected;
    }
    return diffTurns[diffTurns.length - 1]?.id;
  }, [currentSessionId, diffTurns, selectedDiffMessageBySession]);
  const currentTodos = useMemo(() => {
    if (!currentSessionId) {
      return [];
    }

    const serverTodos = todosBySession[currentSessionId];
    if (serverContract !== 'v2' && serverTodos !== undefined) {
      return serverTodos;
    }

    const todoRecords = todoRecordsBySession[currentSessionId];
    return todoRecords ? deriveTodosFromMessages(todoRecords) : [];
  }, [currentSessionId, serverContract, todoRecordsBySession, todosBySession]);
  const relatedInteractionSessionIds = useMemo(
    () => collectDescendantSessionIds(sessions, [currentSessionId, sendingState.sessionId]),
    [sessions, currentSessionId, sendingState.sessionId],
  );
  const currentPendingPermissions = useMemo(
    () => getCurrentPendingRequests(currentSessionId, sendingState.sessionId, pendingPermissionsBySession, relatedInteractionSessionIds),
    [currentSessionId, pendingPermissionsBySession, relatedInteractionSessionIds, sendingState.sessionId],
  );
  const currentPendingQuestions = useMemo(
    () => getCurrentPendingRequests(currentSessionId, sendingState.sessionId, pendingQuestionsBySession, relatedInteractionSessionIds),
    [currentSessionId, pendingQuestionsBySession, relatedInteractionSessionIds, sendingState.sessionId],
  );
  const configuredProviders = useMemo(() => getConfiguredProviders(availableProviders), [availableProviders]);
  const usagePricingByModel = useMemo(
    () => Object.fromEntries(availableModels.flatMap((model) => model.pricing ? [[`${model.providerID}/${model.modelID}`, model.pricing] as const] : [])),
    [availableModels],
  );
  const currentUsage = useMemo(
    () => aggregateUsageSteps(usageStepsBySession[currentSessionId ?? ''] ?? [], usagePricingByModel),
    [currentSessionId, usageStepsBySession, usagePricingByModel],
  );
  const latestAssistantTurnUsage = useMemo(
    () => getLatestAssistantTurnUsage(currentMessages, usagePricingByModel),
    [currentMessages, usagePricingByModel],
  );
  const currentTranscript = useMemo(() => getTranscript(currentMessages), [currentMessages]);
  const sessionPreviewById = useMemo(() => getSessionPreviewById(messagesBySession), [messagesBySession]);
  const serverCapabilities = useMemo(() => getServerCapabilities(serverContract), [serverContract]);

  const onboardingValue = useMemo<OnboardingContextValue>(
    () => ({ isHydrated, onboardingCompleted, onboardingActive, completeOnboarding, startOnboardingReview, stopOnboardingReview }),
    [isHydrated, onboardingCompleted, onboardingActive, completeOnboarding, startOnboardingReview, stopOnboardingReview],
  );

  const connectionValue = useMemo<ConnectionContextValue>(
    () => ({ connectionProfiles, settings, updateSettings, switchConnection, connection, serverCapabilities, connect, diagnostics, refreshDiagnostics, eventStreamStatus, connectSetup }),
    [connectionProfiles, settings, updateSettings, switchConnection, connection, serverCapabilities, connect, diagnostics, refreshDiagnostics, eventStreamStatus, connectSetup],
  );

  const capabilitiesValue = useMemo<CapabilitiesContextValue>(
    () => ({ currentConfig, availableProviders, providerAuthMethodsById, configuredProviders, availableModels, availableAgents, configureProvider, setProviderAuth, removeProvider, providerOAuth: { start: startProviderOAuth, complete: completeProviderOAuth, completeAutomatic: completeAutomaticProviderOAuth, cancel: cancelProviderOAuth }, providerAccounts: { add: addProviderAccount, activate: activateProviderAccount, remove: removeProviderAccount } }),
    [currentConfig, availableProviders, providerAuthMethodsById, configuredProviders, availableModels, availableAgents, configureProvider, setProviderAuth, removeProvider, startProviderOAuth, completeProviderOAuth, completeAutomaticProviderOAuth, cancelProviderOAuth, addProviderAccount, activateProviderAccount, removeProviderAccount],
  );

  const preferencesValue = useMemo<PreferencesContextValue>(
    () => ({ chatPreferences, updateChatPreferences }),
    [chatPreferences, updateChatPreferences],
  );

  const workspaceValue = useMemo<WorkspaceContextValue>(
    () => ({ projects, activeProjectPath, activeProject, selectProject, addWorkspace, serverProjects, currentProjectPath, serverRootPath, isRefreshingWorkspaceCatalog, refreshWorkspaceCatalog, refreshWorkspaceStatus: refreshServerFeatures, workspaceFiles, workspaceFileStatuses, selectedWorkspaceFile, vcsInfo, searchWorkspaceFiles, openWorkspaceFile, saveWorkspaceFile, worktrees, refreshWorktrees, createWorktree, resetWorktree, removeWorktree }),
    [projects, activeProjectPath, activeProject, selectProject, addWorkspace, serverProjects, currentProjectPath, serverRootPath, isRefreshingWorkspaceCatalog, refreshWorkspaceCatalog, refreshServerFeatures, workspaceFiles, workspaceFileStatuses, selectedWorkspaceFile, vcsInfo, searchWorkspaceFiles, openWorkspaceFile, saveWorkspaceFile, worktrees, refreshWorktrees, createWorktree, resetWorktree, removeWorktree],
  );

  const activeSessionsValue = useMemo(
    () => ({ list: activeSessions, refresh: refreshActiveSessions, setVisible: setActiveSessionsVisible }),
    [activeSessions, refreshActiveSessions, setActiveSessionsVisible],
  );
  const sessionValue = useMemo<SessionContextValue>(
    () => ({ sessions, archivedSessions, sessionStatuses, favoriteSessions, toggleFavoriteSession, isFavoriteSession, clearFavoriteSession, currentSessionId, activeSession, sessionPreviewById, isRefreshingSessions, refreshSessions, openSession, activeSessions: activeSessionsValue, ensureActiveSession, openDeepLinkSession, createSession, deleteSession, archiveSession, restoreSession, refreshArchivedSessions, renameSession, forkSession, shareSession, unshareSession, revertSession, unrevertSession, openSessionInProject }),
    [sessions, archivedSessions, sessionStatuses, favoriteSessions, toggleFavoriteSession, isFavoriteSession, clearFavoriteSession, currentSessionId, activeSession, sessionPreviewById, isRefreshingSessions, refreshSessions, openSession, activeSessionsValue, ensureActiveSession, openDeepLinkSession, createSession, deleteSession, archiveSession, restoreSession, refreshArchivedSessions, renameSession, forkSession, shareSession, unshareSession, revertSession, unrevertSession, openSessionInProject],
  );

  const hasOlderMessages = currentSessionId ? messageWindows[currentSessionId]?.hasMore === true : false;
  const isLoadingOlderMessages = currentSessionId ? loadingOlderBySession[currentSessionId] === true : false;
  const transcriptPaging = useMemo(
    () => ({ loadOlder: loadOlderMessages, hasOlder: hasOlderMessages, isLoadingOlder: isLoadingOlderMessages }),
    [hasOlderMessages, isLoadingOlderMessages, loadOlderMessages],
  );
  const chatValue = useMemo<ChatContextValue>(
    () => ({ pendingPrompts, currentMessages, currentTranscript, currentUsage, latestAssistantTurnUsage, currentDiffs, currentDiffScope, setDiffScope, diffTurns, selectedDiffMessageId, selectDiffMessage, refreshDiffs, currentTodos, currentPendingPermissions, currentPendingQuestions, isRefreshingMessages, isRefreshingDiffs, isBootstrappingChat, refreshCurrentSession, refreshCurrentTodos, replyToPermission, replyToQuestion, rejectQuestion, commands, executeCommand, sendPrompt, abortSession, setAutoApprove, sendingState, promptError, clearPromptError, transcriptPaging }),
    [pendingPrompts, currentMessages, currentTranscript, currentUsage, latestAssistantTurnUsage, currentDiffs, currentDiffScope, setDiffScope, diffTurns, selectedDiffMessageId, selectDiffMessage, refreshDiffs, currentTodos, currentPendingPermissions, currentPendingQuestions, isRefreshingMessages, isRefreshingDiffs, isBootstrappingChat, refreshCurrentSession, refreshCurrentTodos, replyToPermission, replyToQuestion, rejectQuestion, commands, executeCommand, sendPrompt, abortSession, setAutoApprove, sendingState, promptError, clearPromptError, transcriptPaging],
  );

  const conversationValue = useMemo<ConversationContextValue>(
    () => ({ conversation, clearConversationFeedback, toggleConversationMode }),
    [conversation, clearConversationFeedback, toggleConversationMode],
  );

  const terminalValue = useMemo<TerminalContextValue>(
    () => ({ terminals, terminalShells, activeTerminalId, terminalRuntime, terminalConnection, refreshTerminals, createTerminal, openTerminal, sendTerminalInput, closeTerminal }),
    [terminals, terminalShells, activeTerminalId, terminalRuntime, terminalConnection, refreshTerminals, createTerminal, openTerminal, sendTerminalInput, closeTerminal],
  );

  const mcpValue = useMemo<McpContextValue>(
    () => ({ mcpStatuses, refreshMcpServers, addMcpServer, connectMcpServer, disconnectMcpServer, setMcpServerEnabled, startMcpOAuth, completeMcpOAuth }),
    [mcpStatuses, refreshMcpServers, addMcpServer, connectMcpServer, disconnectMcpServer, setMcpServerEnabled, startMcpOAuth, completeMcpOAuth],
  );

  return {
    onboardingValue,
    connectionValue,
    capabilitiesValue,
    preferencesValue,
    workspaceValue,
    sessionValue,
    chatValue,
    conversationValue,
    terminalValue,
    mcpValue,
  };
}
