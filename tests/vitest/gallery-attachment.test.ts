import { describe, expect, it, vi } from 'vitest';

import { useChatViewActions } from '@/components/chat/use-chat-view-actions';

const h = vi.hoisted(() => ({ gallery: vi.fn(), files: vi.fn() }));
vi.mock('react-native', () => ({ Alert: { alert: vi.fn() }, Platform: { OS: 'android' } }));
vi.mock('expo-image-picker', () => ({ launchImageLibraryAsync: h.gallery }));
vi.mock('expo-document-picker', () => ({ getDocumentAsync: h.files }));
vi.mock('@/lib/voice/speech-output', () => ({ speakText: vi.fn(), stopSpeaking: vi.fn() }));

describe('chat attachment choices', () => {
  it('adds gallery images to the same removable draft as file picks, retaining existing text input', async () => {
    let attachments: { uri: string; mime?: string; filename?: string }[] = [];
    let feedback: string | undefined;
    const actions = useChatViewActions({
      t: (key: string) => key, chatPreferences: {} as never, conversationActive: false,
      abortSession: vi.fn(), createSession: vi.fn(), openSession: vi.fn(), toggleConversationMode: vi.fn(),
      setAttachments: (value) => { attachments = typeof value === 'function' ? value(attachments) : value; },
      setSendFeedback: (value) => { feedback = typeof value === 'function' ? value(feedback) : value; },
      setChangesVisible: vi.fn(), setIsCreatingSession: vi.fn(), setIsStoppingSession: vi.fn(), setSpeakingMessageId: vi.fn(), setVoiceFeedback: vi.fn(),
    });
    h.gallery.mockResolvedValueOnce({ canceled: false, assets: [{ uri: 'file:///cache/photo.jpg', mimeType: 'image/jpeg', fileName: 'photo.jpg', fileSize: 100 }] });
    await actions.handleAttach('photos');
    expect(attachments).toEqual([{ uri: 'file:///cache/photo.jpg', mime: 'image/jpeg', filename: 'photo.jpg' }]);
    h.files.mockResolvedValueOnce({ canceled: false, assets: [{ uri: 'file:///cache/note.txt', mimeType: 'text/plain', name: 'note.txt' }] });
    await actions.handleAttach('files');
    expect(attachments).toHaveLength(2);
    h.gallery.mockResolvedValueOnce({ canceled: false, assets: [{ uri: 'file:///cache/big.jpg', mimeType: 'image/jpeg', fileSize: 11 * 1024 * 1024 }] });
    await actions.handleAttach('photos');
    expect(attachments).toHaveLength(2);
    expect(feedback).toBe('chat:view.fileTooLarge');
  });
});
