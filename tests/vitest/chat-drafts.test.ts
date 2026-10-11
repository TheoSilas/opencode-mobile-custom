import { describe, expect, it } from 'vitest';

import { hookRuntime, loadTs } from '../helpers/runtime.mjs';

describe('chat composer drafts', () => {
  it('keeps unsent text and attachments scoped to server, project and session', async () => {
    const runtime = hookRuntime();
    const { useChatDrafts } = await loadTs('providers/use-chat-drafts.ts', { react: runtime.react });
    runtime.mount(({ scope, project, session }: { scope: string; project: string; session: string }) =>
      useChatDrafts(scope, project, session), { scope: 'one', project: '/repo', session: 'a' });
    runtime.value.setDraft('draft for A');
    runtime.value.setAttachments([{ uri: 'file:///image.jpg' }]);
    runtime.flush();
    runtime.update({ session: 'b' });
    expect(runtime.value.draft).toBe('');
    expect(runtime.value.attachments).toEqual([]);
    runtime.value.setDraft('draft for B');
    runtime.flush();
    runtime.update({ session: 'a' });
    expect(runtime.value.draft).toBe('draft for A');
    expect(runtime.value.attachments).toEqual([{ uri: 'file:///image.jpg' }]);
    runtime.update({ scope: 'two' });
    expect(runtime.value.draft).toBe('');
    runtime.update({ scope: 'one', project: '/other' });
    expect(runtime.value.draft).toBe('');
    runtime.update({ project: '/repo', session: 'b' });
    expect(runtime.value.draft).toBe('draft for B');
  });
});
