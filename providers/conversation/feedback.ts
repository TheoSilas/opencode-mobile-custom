import type { VoiceRecoveryAction } from '@/lib/voice/speech-errors';

export function applyConversationFeedback(
  setFeedback: (value: string | undefined) => void,
  setAction: (value: VoiceRecoveryAction) => void,
  message: string | undefined,
  action: VoiceRecoveryAction = 'none',
) {
  setFeedback(message);
  setAction(action);
}
