import { formToQuestion, mapStatus } from './mappers';
import { extractErrorMessage, numberField, stringField, type AdapterContext, type V1Envelope, type V2Api, type V2EventEnvelope, type V2Form } from './shared';

export function mapV2Event(event: V2EventEnvelope, ctx: AdapterContext): V1Envelope | undefined {
  const data = event.data ?? {};
  const sessionID = typeof data.sessionID === 'string' ? data.sessionID : undefined;
  const directory = event.location?.directory ?? '';
  const envelope = (type: string, properties: Record<string, unknown>): V1Envelope => ({
    directory,
    payload: { id: event.id, type, properties },
  });

  switch (event.type) {
    case 'server.connected':
      return envelope('catalog.updated', {});
    case 'session.created':
      return envelope('session.created', { sessionID });
    case 'session.renamed':
    case 'session.moved':
    case 'session.forked':
    case 'session.permissions':
    case 'session.viewed':
    case 'session.agent.selected':
    case 'session.model.selected':
      return envelope('session.updated', { sessionID });
    case 'session.deleted':
      return envelope('session.deleted', { sessionID });
    case 'session.status':
      return envelope('session.status', { sessionID, status: mapStatus(data.status) });
    case 'session.idle':
      return envelope('session.idle', { sessionID });
    case 'session.execution.started':
      return envelope('session.status', { sessionID, status: { type: 'busy' } });
    case 'session.execution.succeeded':
    case 'session.execution.interrupted':
      return envelope('session.idle', { sessionID });
    case 'session.execution.failed':
      return envelope('session.idle', { sessionID });
    case 'session.retry.scheduled':
      return envelope('session.status', {
        sessionID,
        status: { type: 'retry', attempt: numberField(data.attempt), message: extractErrorMessage(data.error), next: numberField(data.at) },
      });
    case 'session.compaction.started':
    case 'session.compaction.ended':
    case 'session.compaction.failed':
      return envelope('session.compacted', { sessionID });
    case 'session.step.started':
    case 'session.step.streamed':
    case 'session.step.ended':
    case 'session.step.failed':
    case 'session.text.started':
    case 'session.text.delta':
    case 'session.text.ended':
    case 'session.reasoning.started':
    case 'session.reasoning.delta':
    case 'session.reasoning.ended':
    case 'session.tool.input.started':
    case 'session.tool.input.delta':
    case 'session.tool.input.ended':
    case 'session.tool.called':
    case 'session.tool.progress':
    case 'session.tool.success':
    case 'session.tool.failed':
    case 'session.message.content.updated':
    case 'session.synthetic':
    case 'session.skill.activated':
      return envelope('message.part.updated', { sessionID });
    case 'permission.asked':
      if (typeof data.id === 'string') ctx.permissionSession.set(data.id, stringField(sessionID));
      return envelope('permission.asked', {
        id: data.id,
        sessionID,
        permission: data.action,
        patterns: data.resources,
        metadata: data.metadata ?? {},
        always: data.save ?? [],
      });
    case 'permission.replied':
      return envelope('permission.replied', { sessionID, requestID: data.requestID, reply: data.reply });
    case 'form.created': {
      const form = data.form as V2Form | undefined;
      if (!form || typeof form.id !== 'string') return undefined;
      return envelope('question.asked', formToQuestion(form, ctx));
    }
    case 'form.replied': {
      const id = typeof data.id === 'string' ? data.id : '';
      return envelope('question.replied', { sessionID, requestID: id });
    }
    case 'form.cancelled': {
      const id = typeof data.id === 'string' ? data.id : '';
      return envelope('question.rejected', { sessionID, requestID: id });
    }
    case 'filesystem.changed':
      return envelope('file.edited', {});
    case 'vcs.branch.updated':
      return envelope('vcs.branch.updated', {});
    case 'pty.created':
    case 'pty.updated':
    case 'pty.exited':
    case 'pty.deleted':
      return envelope(event.type, {});
    case 'worktree.updated':
    case 'worktree.resolved':
      return envelope('worktree.ready', {});
    case 'mcp.status.changed':
    case 'mcp.resources.changed':
      return envelope('mcp.tools.changed', {});
    case 'config.updated':
    case 'provider.updated':
    case 'model.updated':
    case 'agent.updated':
    case 'skill.updated':
    case 'command.updated':
    case 'integration.updated':
    case 'credential.updated':
    case 'models-dev.refreshed':
    case 'reference.updated':
    case 'plugin.updated':
      return envelope('catalog.updated', {});
    case 'project.updated':
      return envelope('project.updated', {});
    default:
      return undefined;
  }
}

export async function* subscribeV2(api: V2Api, signal?: AbortSignal, ctx?: AdapterContext): AsyncGenerator<V1Envelope> {
  const context = ctx as AdapterContext;
  const subscription = await api.event.subscribe(signal ? { signal } : undefined);
  for await (const raw of subscription) {
    const mapped = mapV2Event(raw as V2EventEnvelope, context);
    if (mapped) {
      yield mapped;
    }
  }
}
