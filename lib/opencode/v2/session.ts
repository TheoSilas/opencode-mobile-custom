import { sessionToV1 } from '../v2-mappers';
import { fileToV1, messageToV1 } from './mappers';
import type { PendingPrompt, PromptDelivery } from '../prompt-inbox';
import { stringField, syncSessionInstructions, type V2Adapter, type V2Diff } from './shared';

export function buildSessionApi({ api, directory, listSessionPage, ok }: V2Adapter): Record<string, unknown> {
  const inboxToPrompt = (item: Extract<Awaited<ReturnType<typeof api.session.inbox.list>>[number], { type: 'user' }>): PendingPrompt => ({
    id: item.id, sessionId: item.sessionID, createdAt: item.time.created,
    text: item.payload.text, delivery: item.delivery, state: 'waiting',
    attachments: (item.payload.files ?? []).map((file) => {
      const part = fileToV1(file);
      return { uri: part.url, mime: part.mime, filename: part.filename };
    }),
  });
  const submit = async (parameters: Record<string, unknown>, delivery: PromptDelivery = 'steer') => {
    const sessionID = stringField(parameters.sessionID);
    const agent = typeof parameters.agent === 'string' ? parameters.agent : undefined;
    const model = parameters.model as { providerID?: string; modelID?: string } | undefined;
    if (agent) await api.session.switchAgent({ sessionID, agent });
    if (model?.providerID && model.modelID) {
      await api.session.switchModel({ sessionID, model: { id: model.modelID, providerID: model.providerID } });
    }
    const parts = Array.isArray(parameters.parts) ? parameters.parts : [];
    const text = parts
      .filter((part) => part && typeof part === 'object' && (part as Record<string, unknown>).type === 'text')
      .map((part) => stringField((part as Record<string, unknown>).text))
      .join('\n\n');
    const files = parts
      .filter((part) => part && typeof part === 'object' && (part as Record<string, unknown>).type === 'file')
      .map((part) => {
        const record = part as Record<string, unknown>;
        return { uri: stringField(record.url), name: stringField(record.filename, 'Attachment') };
      });
    await syncSessionInstructions(api, sessionID, parameters.system);
    const admitted = await api.session.prompt({ sessionID, text, delivery, ...(files.length > 0 ? { files } : {}) });
    return inboxToPrompt(admitted);
  };
  return {
    promptInbox: {
      submit,
      list: async (sessionId: string) => (await api.session.inbox.list({ sessionID: sessionId }))
        .filter((item): item is Extract<typeof item, { type: 'user' }> => item.type === 'user').map(inboxToPrompt),
    },
    session: {
      list: async () => {
        const response = await listSessionPage();
        return ok((response.data ?? []).map(sessionToV1));
      },
      status: async () => {
        const [active, list] = await Promise.all([
          api.session.active().catch(() => ({}) as Record<string, unknown>),
          listSessionPage(),
        ]);
        const statuses: Record<string, unknown> = {};
        (list.data ?? []).forEach((session) => {
          statuses[session.id] = { type: 'idle' };
        });
        Object.keys(active ?? {}).forEach((id) => {
          statuses[id] = { type: 'busy' };
        });
        return ok(statuses);
      },
      messages: async (parameters: { sessionID: string; before?: string; limit?: number }) => {
        const { sessionID, before, limit = 100 } = parameters;
        // Cursors carry the ordering; V2 rejects cursor + order on later pages.
        const page = await api.message.list(before ? { sessionID, limit, cursor: before } : { sessionID, limit, order: 'desc' });
        const headers = new Headers();
        if (page.cursor?.next) headers.set('x-next-cursor', page.cursor.next);
        return {
          data: [...page.data].reverse().map((message) => messageToV1(message, sessionID)).filter(Boolean),
          response: { headers },
        };
      },
      diff: async (parameters: { sessionID: string; messageID?: string }) => {
        const diffs: V2Diff[] = await api.session.diff({
          sessionID: parameters.sessionID,
          ...(parameters.messageID ? { messageID: parameters.messageID } : {}),
        });
        return ok(diffs);
      },
      // OpenCode 2.x removed the server-owned todo endpoint. The plan is derived
      // from `todowrite` tool parts in the transcript instead (see
      // deriveTodosFromMessages in lib/opencode/format.ts).
      todo: async () => ok([]),
      delete: async (parameters: { sessionID: string }) => {
        await api.session.remove({ sessionID: parameters.sessionID });
        return ok(undefined);
      },
      update: async (parameters: { sessionID: string; title?: string; permission?: unknown }) => {
        if (parameters.title !== undefined || parameters.permission !== undefined) {
          await api.session.update({
            sessionID: parameters.sessionID,
            ...(parameters.title !== undefined ? { title: parameters.title } : {}),
            ...(parameters.permission !== undefined ? { permissions: parameters.permission as never } : {}),
          });
        }
        const session = await api.session.get({ sessionID: parameters.sessionID });
        return ok(sessionToV1(session));
      },
      children: async (parameters: { sessionID: string }) => {
        const response = await api.session.list({ parentID: parameters.sessionID });
        return ok((response.data ?? []).map(sessionToV1));
      },
      fork: async (parameters: { sessionID: string; messageID?: string }) => {
        const session = await api.session.fork({ sessionID: parameters.sessionID, ...(parameters.messageID ? { before: parameters.messageID } : {}) });
        return ok(sessionToV1(session));
      },
      share: async () => {
        throw new Error('Sharing sessions is not supported by OpenCode 2 servers.');
      },
      unshare: async () => {
        throw new Error('Sharing sessions is not supported by OpenCode 2 servers.');
      },
      revert: async (parameters: { sessionID: string; messageID: string; partID?: string }) => {
        const revert = await api.session.revert.stage({ sessionID: parameters.sessionID, messageID: parameters.messageID, ...(parameters.partID ? { partID: parameters.partID } : {}) });
        return ok(revert);
      },
      unrevert: async (parameters: { sessionID: string }) => {
        await api.session.revert.clear({ sessionID: parameters.sessionID });
        return ok(undefined);
      },
      create: async (parameters?: { title?: string; directory?: string }) => {
        const target = parameters?.directory || directory;
        const session = await api.session.create({
          ...(parameters?.title ? { title: parameters.title } : {}),
          ...(target ? { location: { directory: target } } : {}),
        });
        return ok(sessionToV1(session));
      },
      summarize: async () => {
        throw new Error('Session title summarization is not supported by OpenCode 2 servers.');
      },
      promptAsync: async (parameters: Record<string, unknown>) => {
        await submit(parameters);
        return ok(undefined);
      },
      abort: async (parameters: { sessionID: string }) => {
        await api.session.interrupt({ sessionID: parameters.sessionID });
        return ok(undefined);
      },
      command: async (parameters: { sessionID: string; command: string; arguments?: string; agent?: string; model?: string }) => {
        const sessionID = parameters.sessionID;
        if (parameters.agent) await api.session.switchAgent({ sessionID, agent: parameters.agent });
        if (parameters.model) {
          const [providerID, ...rest] = parameters.model.split('/');
          const modelID = rest.join('/');
          if (providerID && modelID) await api.session.switchModel({ sessionID, model: { id: modelID, providerID } });
        }
        await api.session.command({ sessionID, name: parameters.command, text: parameters.arguments ?? '' });
        return ok(undefined);
      },
    },
    command: {
      list: async () => {
        const response = await api.command.list();
        return ok((response.data ?? []).map((command) => ({ name: command.name, description: command.description, template: '' })));
      },
    },
  };
}
