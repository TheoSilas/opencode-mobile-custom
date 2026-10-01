import { MaterialCommunityIcons } from '@expo/vector-icons';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Animated, Easing, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { ActivityIndicator, Button, Card, IconButton, ProgressBar, Text, TouchableRipple } from 'react-native-paper';

import { Colors } from '@/constants/theme';
import { OverlaySheet } from '@/components/ui/overlay-sheet';
import { DiffCard, PendingInteractionsCard, QuestionFlow, SessionDiffCard, TranscriptMessage } from '@/components/chat/chat-cards';
import type { TranscriptEntry } from '@/lib/opencode/format';
import type { FileDiff, Session, SessionStatus, Todo } from '@/lib/opencode/types';
import type { DiffScope, DiffTurn } from '@/providers/opencode-provider-types';
import type { PendingPermissionRequest, PendingQuestionAnswer, PendingQuestionRequest } from '@/lib/opencode/client';

import { styles, slimStyles } from '@/components/chat/chat-view-styles';
import { STARTER_PROMPT_KEYS } from '@/components/chat/chat-view-utils';

type Palette = typeof Colors.light;

// Skeleton placeholder shown during the initial transcript fetch. Avoids the
// "blank → populated list" snap users can read as a lock-up. Subtle opacity
// pulse (1.2s loop, native driver) signals active loading without thrashing
// the JS thread.
function TranscriptSkeletonImpl({ palette }: { palette: Palette }) {
  const [opacity] = useState(() => new Animated.Value(0.35));
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 600, easing: Easing.out(Easing.ease), useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.35, duration: 600, easing: Easing.in(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  // Three placeholder bubbles mimic a typical user/assistant turn shape.
  const rows: { role: 'user' | 'assistant'; width: `${number}%` }[] = [
    { role: 'user', width: '60%' },
    { role: 'assistant', width: '90%' },
    { role: 'assistant', width: '75%' },
  ];
  return (
    <View style={styles.transcriptItem}>
      {rows.map((row, index) => (
        <Animated.View
          key={`skeleton-${index}`}
          style={[
            styles.skeletonRow,
            row.role === 'user' ? styles.skeletonUser : styles.skeletonAssistant,
            { width: row.width, backgroundColor: palette.surface, opacity },
          ]}
        />
      ))}
    </View>
  );
}

const TranscriptSkeleton = memo(TranscriptSkeletonImpl);

// Stable reference so FlashList does not treat every parent render as a prop
// change. Combined with the memoized TranscriptMessage rows this keeps
// streaming refreshes from re-rendering untouched rows.
const MAINTAIN_VISIBLE_CONTENT_POSITION = {
  autoscrollToBottomThreshold: 0,
  animateAutoScrollToBottom: false,
  startRenderingFromBottom: true,
} as const;
type DiffDetail = Extract<TranscriptEntry['details'][number], { kind: 'patch' }>;

const DIFF_SCOPE_OPTIONS: { value: DiffScope; labelKey: string }[] = [
  { value: 'turn', labelKey: 'chat:diff.turn' },
  { value: 'uncommitted', labelKey: 'chat:diff.uncommitted' },
  { value: 'branch', labelKey: 'chat:diff.branch' },
];

type ChatContentProps = {
  activeSession?: Session;
  activeTab: 'session' | 'changes';
  awaitingUserInput: boolean;
  connection: { status: 'idle' | 'connecting' | 'connected' | 'error'; message: string };
  copiedMessageId?: string;
  currentActivityLabel?: string;
  currentDiffs: FileDiff[];
  currentDiffScope: DiffScope;
  currentPendingPermissions: PendingPermissionRequest[];
  currentPendingQuestions: PendingQuestionRequest[];
  currentTodos: Todo[];
  currentSessionId?: string;
  diffCount: number;
  diffDetails: DiffDetail[];
  diffTurns: DiffTurn[];
  displayTranscript: TranscriptEntry[];
  flatTranscript: boolean;
  slim: boolean;
  transcriptFontSize: number;
  expandedDiffId?: string;
  isRefreshingDiffs: boolean;
  isRefreshingMessages: boolean;
  onCopyMessage: (entry: TranscriptEntry) => void;
  onForkMessage: (messageId: string) => void;
  onRevertMessage: (messageId: string) => void;
  onUnrevert: () => void;
  onExpandDiff: (id?: string) => void;
  onRefresh: () => void;
  onRefreshDiffs: () => void;
  onSelectDiffScope: (scope: DiffScope) => void;
  onSelectDiffMessage: (messageId: string) => void;
  selectedDiffMessageId?: string;
  onReplyToPermission: (requestId: string, reply: 'once' | 'always' | 'reject') => Promise<void>;
  onRejectQuestion: (requestId: string) => Promise<void>;
  onReplyToQuestion: (requestId: string, answers: PendingQuestionAnswer[]) => Promise<void>;
  onSendStarterPrompt: (prompt: string) => void;
  onToggleSpeak: (entry: TranscriptEntry) => void;
  palette: Palette;
  pendingInteractions: number;
  running: boolean;
  speakingMessageId?: string;
  status?: SessionStatus;
};

export function ChatContent({
  activeSession,
  activeTab,
  awaitingUserInput,
  connection,
  copiedMessageId,
  currentActivityLabel,
  currentDiffs,
  currentDiffScope,
  currentPendingPermissions,
  currentPendingQuestions,
  currentTodos,
  currentSessionId,
  diffCount,
  diffDetails,
  diffTurns,
  displayTranscript,
  flatTranscript,
  slim,
  transcriptFontSize,
  expandedDiffId,
  isRefreshingDiffs,
  isRefreshingMessages,
  onCopyMessage,
  onForkMessage,
  onRevertMessage,
  onUnrevert,
  onExpandDiff,
  onRefresh,
  onRefreshDiffs,
  onSelectDiffScope,
  onSelectDiffMessage,
  selectedDiffMessageId,
  onRejectQuestion,
  onReplyToPermission,
  onReplyToQuestion,
  onSendStarterPrompt,
  onToggleSpeak,
  palette,
  pendingInteractions,
  running,
  speakingMessageId,
  status,
}: ChatContentProps) {
  const { t } = useTranslation();
  const [progressVisible, setProgressVisible] = useState(false);
  const [diffSourcesVisible, setDiffSourcesVisible] = useState(false);
  const [dismissedQuestionId, setDismissedQuestionId] = useState<string>();
  const transcriptRef = useRef<FlashListRef<TranscriptEntry>>(null);
  const shouldPositionInitialTranscriptRef = useRef(false);
  const previousTranscriptRef = useRef({ sessionId: currentSessionId, length: displayTranscript.length });
  const completedTodoCount = currentTodos.filter((todo) => todo.status === 'completed').length;
  const currentQuestion = currentPendingQuestions[0];
  const isTurnScope = currentDiffScope === 'turn';
  const isLatestTurn = diffTurns.length === 0 || selectedDiffMessageId === diffTurns[diffTurns.length - 1]?.id;
  const scopeTitle = currentDiffScope === 'uncommitted'
    ? t('chat:diff.uncommittedTitle')
    : currentDiffScope === 'branch'
      ? t('chat:diff.branchTitle')
      : isLatestTurn
        ? t('chat:diff.latestTurnTitle')
        : t('chat:diff.selectedTurnTitle');
  const scopeEmptyMessage = currentDiffScope === 'uncommitted'
    ? t('chat:diff.noUncommitted')
    : currentDiffScope === 'branch'
      ? t('chat:diff.noBranchChanges')
      : t('chat:diff.noChanges');
  const scopeLabel = t(DIFF_SCOPE_OPTIONS.find((option) => option.value === currentDiffScope)?.labelKey ?? 'chat:diff.turn');
  const selectedTurnLabel = diffTurns.find((turn) => turn.id === selectedDiffMessageId)?.label || t('chat:diff.latestTurn');
  const showingLabel = isTurnScope && diffTurns.length > 1
    ? `${t('chat:diff.showing', { scope: scopeLabel })}${t('chat:diff.showingTurnSuffix', { turn: selectedTurnLabel })}`
    : t('chat:diff.showing', { scope: scopeLabel });
  const showDiffDetails = isTurnScope && currentDiffs.length === 0;

  useLayoutEffect(() => {
    const previous = previousTranscriptRef.current;
    if (previous.sessionId !== currentSessionId || (previous.length === 0 && displayTranscript.length > 0)) {
      shouldPositionInitialTranscriptRef.current = true;
    }
    previousTranscriptRef.current = { sessionId: currentSessionId, length: displayTranscript.length };
  }, [currentSessionId, displayTranscript.length]);

  const extraData = useMemo(() => ({ copiedMessageId, speakingMessageId }), [copiedMessageId, speakingMessageId]);

  return (
    <View style={styles.chatArea}>
      {activeTab === 'session' ? (
        <FlashList
          key={currentSessionId || 'no-session'}
          ref={transcriptRef}
          data={displayTranscript}
          style={styles.scroll}
          contentContainerStyle={[
            styles.content,
            slim && slimStyles.content,
            currentTodos.length > 0 || pendingInteractions > 0 ? { paddingBottom: 110 } : null,
          ]}
          extraData={extraData}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          keyExtractor={(entry) => `${entry.id}-${entry.createdAt}`}
          maintainVisibleContentPosition={MAINTAIN_VISIBLE_CONTENT_POSITION}
          onContentSizeChange={() => {
            if (!shouldPositionInitialTranscriptRef.current || displayTranscript.length === 0) {
              return;
            }
            shouldPositionInitialTranscriptRef.current = false;
            transcriptRef.current?.scrollToEnd({ animated: false });
          }}
          refreshControl={<RefreshControl refreshing={isRefreshingMessages} onRefresh={onRefresh} tintColor={palette.tint} />}
          renderItem={({ item: entry }) => (
            <View style={[
              styles.transcriptItem,
              slim && slimStyles.transcriptItem,
              flatTranscript && (slim ? slimStyles.transcriptItemFlat : styles.transcriptItemFlat),
            ]}>
              <TranscriptMessage
                canSpeak={entry.role === 'assistant' && Boolean(entry.text.trim())}
                copied={copiedMessageId === entry.id}
                entry={entry}
                flat={flatTranscript}
                fontSize={transcriptFontSize}
                slim={slim}
                onCopy={() => onCopyMessage(entry)}
                onFork={entry.role === 'user' ? () => onForkMessage(entry.id) : undefined}
                onRevert={entry.role === 'user' ? () => onRevertMessage(entry.id) : undefined}
                onToggleSpeak={() => onToggleSpeak(entry)}
                speaking={speakingMessageId === entry.id}
              />
            </View>
          )}
          ListHeaderComponent={connection.status === 'error' ? (
            <Card mode="contained" style={[styles.noticeCard, styles.transcriptItem, { backgroundColor: palette.surface }]}>
              <Card.Content>
                <Text variant="titleMedium" style={{ color: palette.text }}>{t('chat:content.connectionIssue')}</Text>
                <Text variant="bodyMedium" style={{ color: palette.muted }}>{connection.message}</Text>
              </Card.Content>
            </Card>
          ) : null}
          ListEmptyComponent={isRefreshingMessages && currentSessionId ? (
            <TranscriptSkeleton palette={palette} />
          ) : (
            <Card mode="contained" style={[styles.emptyCard, { backgroundColor: palette.surface }]}>
              <Card.Content style={styles.emptyContent}>
                <Text variant="headlineSmall" style={[styles.emptyTitle, { color: palette.text }]}>{t('chat:starter.title')}</Text>
                <Text variant="bodyMedium" style={{ color: palette.muted }}>
                  {t('chat:starter.description')}
                </Text>
                <View style={styles.promptStack}>
                  {STARTER_PROMPT_KEYS.map((key) => (
                    <TouchableRipple
                      key={key}
                      style={[styles.promptCard, { borderColor: palette.border, backgroundColor: palette.background }]}
                      onPress={() => onSendStarterPrompt(t(key))}>
                      <View style={styles.promptCardInner}>
                        <MaterialCommunityIcons name="lightning-bolt" size={18} color={palette.tint} />
                        <Text variant="bodyMedium" style={{ color: palette.text }}>{t(key)}</Text>
                      </View>
                    </TouchableRipple>
                  ))}
                </View>
              </Card.Content>
            </Card>
          )}
          ListFooterComponent={(
            <View style={styles.transcriptFooter}>
              {activeSession?.revert ? (
                <Card mode="contained" style={[styles.noticeCard, { backgroundColor: palette.surface }]}>
                  <Card.Content>
                    <Text variant="titleMedium" style={{ color: palette.text }}>{t('chat:content.sessionReverted')}</Text>
                    <Button mode="outlined" onPress={onUnrevert}>{t('chat:content.restoreReverted')}</Button>
                  </Card.Content>
                </Card>
              ) : null}

              {running && !awaitingUserInput ? (
                <View style={styles.loadingRow}>
                  <ActivityIndicator color={palette.tint} />
                  <Text style={{ color: palette.muted }}>
                    {currentActivityLabel ? t('chat:content.runningActivity', { activity: currentActivityLabel.toLowerCase() }) : t('chat:content.runningGeneric')}
                  </Text>
                </View>
              ) : null}
            </View>
          )}
        />
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          keyboardDismissMode="on-drag"
          refreshControl={<RefreshControl refreshing={isRefreshingDiffs} onRefresh={onRefreshDiffs} tintColor={palette.tint} />}>
          {connection.status === 'error' ? (
            <Card mode="contained" style={[styles.noticeCard, { backgroundColor: palette.surface }]}>
              <Card.Content>
                <Text variant="titleMedium" style={{ color: palette.text }}>{t('chat:content.connectionIssue')}</Text>
                <Text variant="bodyMedium" style={{ color: palette.muted }}>{connection.message}</Text>
              </Card.Content>
            </Card>
          ) : null}

          <View style={styles.sectionStack}>
          <Card mode="contained" style={[styles.sectionCard, { backgroundColor: palette.surface }]}>
            <Card.Content style={styles.sectionHeaderCard}>
              <View>
                <Text variant="titleMedium" style={{ color: palette.text }}>{scopeTitle}</Text>
                <Text variant="bodyMedium" style={{ color: palette.muted }}>
                  {currentDiffs.length > 0
                    ? t('chat:diff.filesChangedCompact', {
                        files: diffCount,
                        additions: currentDiffs.reduce((total, diff) => total + diff.additions, 0),
                        deletions: currentDiffs.reduce((total, diff) => total + diff.deletions, 0),
                      })
                    : t('chat:diff.filesChangedSimple', { files: diffCount })}
                </Text>
              </View>
              <Text variant="labelMedium" style={{ color: palette.tint }}>{isRefreshingDiffs ? t('chat:diff.syncing') : status?.type || 'idle'}</Text>
            </Card.Content>
          </Card>

          <Button mode="outlined" icon="swap-horizontal" onPress={() => setDiffSourcesVisible(true)} accessibilityLabel={t('chat:diff.changeSourceLabel', { source: scopeLabel })}>
            {showingLabel}
          </Button>

          {currentDiffs.length === 0 && !(showDiffDetails && diffDetails.length > 0) ? (
            <Card mode="contained" style={[styles.sectionCard, { backgroundColor: palette.surface }]}>
              <Card.Content>
                <Text variant="bodyMedium" style={{ color: palette.muted }}>{scopeEmptyMessage}</Text>
              </Card.Content>
            </Card>
          ) : null}

          {currentDiffs.length > 0 || (showDiffDetails && diffDetails.length > 0) ? (
            <Card mode="contained" style={[styles.sectionCard, { backgroundColor: palette.surface }]}>
              <Card.Content style={styles.diffListCardContent}>
                {currentDiffs.map((diff) => {
                  const accordionId = `diff:${currentDiffScope}:${diff.file}`;
                  return <SessionDiffCard key={accordionId} diff={diff} expanded={expandedDiffId === accordionId} onPress={() => onExpandDiff(expandedDiffId === accordionId ? undefined : accordionId)} />;
                })}
                {showDiffDetails
                  ? diffDetails.map((detail) => {
                      const accordionId = `detail:${detail.id}`;
                      return <DiffCard key={detail.id} detail={detail} expanded={expandedDiffId === accordionId} onPress={() => onExpandDiff(expandedDiffId === accordionId ? undefined : accordionId)} />;
                    })
                  : null}
              </Card.Content>
            </Card>
          ) : null}
          </View>
        </ScrollView>
      )}

      <OverlaySheet visible={activeTab !== 'session' && diffSourcesVisible} testID="diff-source-overlay" title={t('chat:diff.sourceTitle')} fitContent onClose={() => setDiffSourcesVisible(false)}>
        {DIFF_SCOPE_OPTIONS.map((option) => <Pressable key={option.value} accessibilityRole="button" onPress={() => { onSelectDiffScope(option.value); if (option.value !== 'turn' || diffTurns.length <= 1) setDiffSourcesVisible(false); }} style={[styles.sessionPickerItemRow, { borderWidth: 1, borderRadius: 16, borderColor: currentDiffScope === option.value ? palette.tint : palette.border }]}>
          <MaterialCommunityIcons name={currentDiffScope === option.value ? 'check-circle' : 'circle-outline'} size={20} color={currentDiffScope === option.value ? palette.tint : palette.muted} />
          <Text style={{ color: palette.text }}>{t(option.labelKey)}</Text>
        </Pressable>)}
        {currentDiffScope === 'turn' && diffTurns.length > 1 ? <>
          <Text variant="labelLarge" style={{ color: palette.muted }}>{t('chat:diff.turn')}</Text>
          {diffTurns.map((turn) => <Pressable key={turn.id} accessibilityRole="button" onPress={() => { onSelectDiffMessage(turn.id); setDiffSourcesVisible(false); }} style={[styles.sessionPickerItemRow, { borderWidth: 1, borderRadius: 16, borderColor: selectedDiffMessageId === turn.id ? palette.tint : palette.border }]}>
            <MaterialCommunityIcons name={selectedDiffMessageId === turn.id ? 'check-circle' : 'circle-outline'} size={20} color={selectedDiffMessageId === turn.id ? palette.tint : palette.muted} />
            <Text style={{ color: palette.text }}>{turn.label}</Text>
          </Pressable>)}
        </> : null}
      </OverlaySheet>

      {currentQuestion ? (
        <QuestionFlow
          key={currentQuestion.id}
          request={currentQuestion}
          visible={dismissedQuestionId !== currentQuestion.id}
          onDismiss={() => setDismissedQuestionId(currentQuestion.id)}
          onReject={() => onRejectQuestion(currentQuestion.id)}
          onReply={(answers) => onReplyToQuestion(currentQuestion.id, answers)}
        />
      ) : null}

      {activeTab === 'session' && currentPendingPermissions.length > 0 && !currentQuestion ? (
        <View style={styles.todoOverlay}>
          <PendingInteractionsCard permissions={currentPendingPermissions} onPermissionReply={onReplyToPermission} />
        </View>
      ) : null}
      {activeTab === 'session' && currentQuestion && dismissedQuestionId === currentQuestion.id ? (
        <Card mode="elevated" style={[styles.todoOverlay, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          <Card.Content style={styles.todoHeader}>
            <View style={styles.todoSummary}>
              <Text variant="labelLarge" style={{ color: palette.text }}>{t('chat:content.answerNeeded')}</Text>
              <Text variant="bodySmall" style={{ color: palette.muted }}>{currentQuestion.title || t('chat:content.waitingForAnswer')}</Text>
            </View>
            <Button onPress={() => setDismissedQuestionId(undefined)}>{t('common:actions.open')}</Button>
          </Card.Content>
        </Card>
      ) : null}
      {activeTab === 'session' && !currentQuestion && currentPendingPermissions.length === 0 && currentTodos.length > 0 ? <Pressable accessibilityRole="button" accessibilityLabel={t('chat:content.openProgressLabel', { completed: completedTodoCount, total: currentTodos.length })} onPress={() => setProgressVisible(true)} style={[styles.todoOverlay, { backgroundColor: palette.surface, borderColor: palette.border, padding: 12, gap: 8 }]}>
        <View style={styles.todoHeader}>
          <View style={styles.todoSummary}><Text variant="labelLarge" style={{ color: palette.text }}>{t('chat:content.progressTitle', { completed: completedTodoCount, total: currentTodos.length })}</Text><Text numberOfLines={1} variant="bodySmall" style={{ color: palette.muted }}>{currentTodos.find((todo) => todo.status === 'in_progress')?.content || (completedTodoCount === currentTodos.length ? t('chat:content.allTasksCompleted') : t('chat:content.openToSeeSteps'))}</Text></View>
          <MaterialCommunityIcons name="arrow-expand" size={18} color={palette.muted} />
        </View>
        <ProgressBar progress={completedTodoCount / currentTodos.length} color={palette.tint} style={styles.todoProgress} />
      </Pressable> : null}
      <OverlaySheet visible={activeTab === 'session' && !currentQuestion && currentPendingPermissions.length === 0 && progressVisible} testID="progress-overlay" title={t('chat:content.progress')} fitContent onClose={() => setProgressVisible(false)}>
        {currentTodos.map((todo, index) => <View key={`${todo.content}-${index}`} style={styles.todoItemRow}>
          <IconButton icon={todo.status === 'completed' ? 'check-circle' : todo.status === 'in_progress' ? 'progress-clock' : 'circle-outline'} size={20} disabled style={styles.todoStatusIcon} />
          <View style={styles.todoTextWrap}><Text variant="bodyMedium" style={{ color: palette.text }}>{todo.content || t('chat:content.untitledTask')}</Text>{todo.priority ? <Text variant="bodySmall" style={{ color: palette.muted }}>{todo.priority}</Text> : null}</View>
        </View>)}
      </OverlaySheet>
    </View>
  );
}
