import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';
import { Button, Card, IconButton, Text } from 'react-native-paper';

import { PendingInteractionsCard, QuestionFlow } from '@/components/chat/chat-cards';
import { styles } from '@/components/chat/chat-view-styles';
import { OverlaySheet } from '@/components/ui/overlay-sheet';
import { Colors } from '@/constants/theme';
import type { PendingPermission, PendingQuestion, PendingQuestionAnswer } from '@/lib/opencode/client';
import type { Todo } from '@/lib/opencode/types';

type Palette = typeof Colors.light;

type PendingInteractionsProps = {
  changesVisible: boolean;
  currentPendingPermissions: PendingPermission[];
  currentPendingQuestions: PendingQuestion[];
  currentTodos: Todo[];
  diffCount: number;
  onCloseProgress: () => void;
  onRejectQuestion: (requestId: string) => Promise<void>;
  onReplyToPermission: (requestId: string, reply: 'once' | 'always' | 'reject') => Promise<void>;
  onReplyToQuestion: (requestId: string, answers: PendingQuestionAnswer[]) => Promise<void>;
  palette: Palette;
  progressAction?: ReactNode;
  progressVisible: boolean;
};

export function PendingInteractions({
  changesVisible,
  currentPendingPermissions,
  currentPendingQuestions,
  currentTodos,
  diffCount,
  onCloseProgress,
  onRejectQuestion,
  onReplyToPermission,
  onReplyToQuestion,
  palette,
  progressAction,
  progressVisible,
}: PendingInteractionsProps) {
  const { t } = useTranslation();
  const [dismissedQuestionId, setDismissedQuestionId] = useState<string>();
  const currentQuestion = currentPendingQuestions[0];

  return (
    <>
      {currentQuestion ? (
        <QuestionFlow
          key={currentQuestion.id}
          request={currentQuestion}
          sourceTitle={currentQuestion.sourceTitle}
          visible={dismissedQuestionId !== currentQuestion.id}
          onDismiss={() => setDismissedQuestionId(currentQuestion.id)}
          onReject={() => onRejectQuestion(currentQuestion.id)}
          onReply={(answers) => onReplyToQuestion(currentQuestion.id, answers)}
        />
      ) : null}

      {currentPendingPermissions.length > 0 && !currentQuestion ? (
        <ScrollView keyboardShouldPersistTaps="handled" style={[styles.todoOverlay, { maxHeight: '75%' }]}>
          <PendingInteractionsCard permissions={currentPendingPermissions} onPermissionReply={onReplyToPermission} />
        </ScrollView>
      ) : null}
      {currentQuestion && dismissedQuestionId === currentQuestion.id ? (
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
      {diffCount === 0 ? progressAction : null}
      <OverlaySheet visible={!changesVisible && !currentQuestion && currentPendingPermissions.length === 0 && progressVisible} testID="progress-overlay" title={t('chat:content.progress')} fitContent onClose={onCloseProgress}>
        {currentTodos.map((todo, index) => <View key={`${todo.content}-${index}`} style={styles.todoItemRow}>
          <IconButton icon={todo.status === 'completed' ? 'check-circle' : todo.status === 'in_progress' ? 'progress-clock' : 'circle-outline'} size={20} disabled style={styles.todoStatusIcon} />
          <View style={styles.todoTextWrap}><Text variant="bodyMedium" style={{ color: palette.text }}>{todo.content || t('chat:content.untitledTask')}</Text>{todo.priority ? <Text variant="bodySmall" style={{ color: palette.muted }}>{todo.priority}</Text> : null}</View>
        </View>)}
      </OverlaySheet>
    </>
  );
}
