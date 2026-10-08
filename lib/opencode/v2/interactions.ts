import { formToQuestion, mapPermission, mapSavedPermission, toAnswer } from './mappers';
import type { AdapterContext, V2Adapter, V2Api, V2Form } from './shared';

async function resolvePermissionSession(api: V2Api, ctx: AdapterContext, requestID: string): Promise<string> {
  const known = ctx.permissionSession.get(requestID);
  if (known) return known;
  const response = await api.permission.request.list(ctx.directory ? { location: { directory: ctx.directory } } : {});
  (response.data ?? []).forEach((permission) => ctx.permissionSession.set(permission.id, permission.sessionID));
  const resolved = ctx.permissionSession.get(requestID);
  if (!resolved) throw new Error('This permission request is no longer available.');
  return resolved;
}

async function resolveForm(api: V2Api, ctx: AdapterContext, requestID: string): Promise<V2Form> {
  const known = ctx.formSession.get(requestID);
  if (known) return known;
  const response = await api.form.list(ctx.directory ? { location: { directory: ctx.directory } } : {});
  (response.data ?? []).forEach((form) => ctx.formSession.set(form.id, form));
  const resolved = ctx.formSession.get(requestID);
  if (!resolved) throw new Error('This question is no longer available.');
  return resolved;
}

export function buildInteractionsApi({ api, ctx, ok }: V2Adapter): Record<string, unknown> {
  return {
    permission: {
      list: async () => {
        const response = await api.permission.request.list(ctx.directory ? { location: { directory: ctx.directory } } : {});
        return ok((response.data ?? []).map((permission) => mapPermission(permission, ctx)));
      },
      reply: async (parameters: { requestID: string; reply: 'once' | 'always' | 'reject' }) => {
        const sessionID = await resolvePermissionSession(api, ctx, parameters.requestID);
        await api.permission.reply({ sessionID, requestID: parameters.requestID, decision: parameters.reply });
        return ok(undefined);
      },
    },
    // Server-persisted "always allow" rules. Exposed as its own client surface
    // because the V1-shaped SDK `permission` object does not type it.
    savedPermissions: {
      list: async () => (await api.permission.saved.list()).map(mapSavedPermission),
      remove: async (id: string) => {
        await api.permission.saved.remove({ id });
        return ok(undefined);
      },
    },
    question: {
      list: async () => {
        const response = await api.form.list(ctx.directory ? { location: { directory: ctx.directory } } : {});
        return ok((response.data ?? []).map((form) => formToQuestion(form, ctx)));
      },
      reply: async (parameters: { requestID: string; answers?: unknown }) => {
        const form = await resolveForm(api, ctx, parameters.requestID);
        await api.session.form.reply({ sessionID: form.sessionID, formID: form.id, answer: toAnswer(form, parameters.answers) });
        return ok(undefined);
      },
      reject: async (parameters: { requestID: string }) => {
        const form = await resolveForm(api, ctx, parameters.requestID);
        await api.session.form.cancel({ sessionID: form.sessionID, formID: form.id });
        return ok(undefined);
      },
    },
  };
}
