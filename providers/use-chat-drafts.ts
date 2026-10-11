import { useCallback, useMemo, useState, type SetStateAction } from 'react';

type Attachment = { uri: string; mime?: string; filename?: string };
type Draft = { text: string; attachments: Attachment[] };
const empty: Draft = { text: '', attachments: [] };

// Unsent composer content is UI-facing, but its identity spans sessions and
// workspaces, so the provider owns it for the lifetime of this app process.
export function useChatDrafts(connectionScope: string, projectPath?: string, sessionId?: string) {
  const [bySession, setBySession] = useState<Record<string, Draft>>({});
  const key = projectPath && sessionId ? `${connectionScope}\n${projectPath}\n${sessionId}` : undefined;
  const value = key ? bySession[key] ?? empty : empty;

  const setDraft = useCallback((change: SetStateAction<string>) => {
    if (!key) return;
    setBySession((current) => {
      const previous = current[key] ?? empty;
      const text = typeof change === 'function' ? change(previous.text) : change;
      return text === previous.text ? current : { ...current, [key]: { ...previous, text } };
    });
  }, [key]);
  const setAttachments = useCallback((change: SetStateAction<Attachment[]>) => {
    if (!key) return;
    setBySession((current) => {
      const previous = current[key] ?? empty;
      const attachments = typeof change === 'function' ? change(previous.attachments) : change;
      return attachments === previous.attachments ? current : { ...current, [key]: { ...previous, attachments } };
    });
  }, [key]);

  return useMemo(() => ({ draft: value.text, attachments: value.attachments, setDraft, setAttachments }),
    [value, setDraft, setAttachments]);
}
