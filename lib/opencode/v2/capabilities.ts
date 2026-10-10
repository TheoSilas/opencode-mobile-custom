import type { ProviderAuthValues } from '../types';
import { agentToV1, configToV1, findIntegration, providerAuthToV1, providersToV1, type V2Adapter } from './shared';

const oauthAttempts = new Map<string, { integrationID: string; attemptID: string }>();

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function buildCapabilitiesApi({ api, ctx, vcsLocation, ok }: V2Adapter): Record<string, unknown> {
  const accountAnswers = (values: ProviderAuthValues) =>
    Object.fromEntries(
      Object.entries(values)
        .filter(([name]) => name !== 'key' && name !== 'token')
        .map(([name, value]) => [name, typeof value === 'string' ? value.trim() : value]),
    );

  return {
    config: {
      get: async () => {
        const entries = await api.config.get();
        return ok(configToV1(entries));
      },
      // V2 only exposes shell updates; return the submitted config so callers keep working.
      update: async (parameters: { config?: unknown }) => ok(parameters?.config),
    },
    provider: {
      list: async () => ok(await providersToV1(api, vcsLocation)),
      auth: async () => ok(await providerAuthToV1(api, vcsLocation)),
      oauth: {
        authorize: async (parameters: { providerID: string; method: number; inputs?: ProviderAuthValues }) => {
          const integration = await findIntegration(api, parameters.providerID, vcsLocation);
          const method = integration?.methods.filter((method) => method.type === 'key' || method.type === 'oauth')[parameters.method];
          if (!integration || !method || method.type !== 'oauth') {
            throw new Error('This provider does not offer OAuth on OpenCode 2.');
          }
          const attempt = await api.integration.oauth.connect({
            ...vcsLocation,
            integrationID: integration.id,
            methodID: method.id,
            ...(parameters.inputs ? { answer: parameters.inputs } : {}),
          });
          oauthAttempts.set(parameters.providerID, { integrationID: integration.id, attemptID: attempt.data.attemptID });
          return ok({ url: attempt.data.url, instructions: attempt.data.instructions, method: attempt.data.mode });
        },
        callback: async (parameters: { providerID: string; code?: string }) => {
          const attempt = oauthAttempts.get(parameters.providerID);
          if (!attempt) {
            throw new Error('Start provider sign-in again to complete it.');
          }
          await api.integration.oauth.complete({ integrationID: attempt.integrationID, attemptID: attempt.attemptID, ...(parameters.code ? { code: parameters.code } : {}) });
          return ok(undefined);
        },
      },
    },
    app: {
      agents: async () => {
        const response = await api.agent.list();
        return ok((response.data ?? []).map(agentToV1));
      },
    },
    auth: {
      set: async (parameters: { providerID: string; auth?: { key?: string; token?: string } }) => {
        const integration = await findIntegration(api, parameters.providerID, vcsLocation, true);
        if (!integration) throw new Error('This provider is not available on OpenCode 2.');
        const key = parameters.auth?.key || parameters.auth?.token || '';
        await api.integration.connect.key({ ...vcsLocation, integrationID: integration.id, key });
        return ok(undefined);
      },
      remove: async (parameters: { providerID: string }) => {
        let integration = await findIntegration(api, parameters.providerID, vcsLocation, true);
        if (!integration?.connections.some((connection) => connection.type === 'credential')) {
          integration = await findIntegration(api, parameters.providerID, vcsLocation);
        }
        // A provider may hold several credentials (for example a direct key and
        // a Console OAuth account). Removing credentials must clear all of the
        // resolved integration's credentials, not just the first.
        const credentials = integration?.connections.filter((connection) => connection.type === 'credential') ?? [];
        await Promise.all(credentials.map((credential) => api.credential.remove({ credentialID: credential.id })));
        return ok(undefined);
      },
    },
    accounts: {
      list: async () => {
        const credentials = await ctx.listCredentials();
        return credentials.map((credential) => ({
          id: credential.id,
          providerId: credential.integrationID,
          label: credential.label,
          method: credential.value?.type === 'oauth' ? 'oauth' as const : credential.value?.type === 'key' ? 'key' as const : 'unknown' as const,
          active: Boolean(credential.active),
        }));
      },
      add: async (providerId: string, values: ProviderAuthValues, label?: string) => {
        const integration = await findIntegration(api, providerId, vcsLocation, true);
        if (!integration) throw new Error('This provider is not available on OpenCode 2.');
        const key = typeof values.key === 'string' ? values.key : typeof values.token === 'string' ? values.token : '';
        const answer = accountAnswers(values);
        await api.integration.connect.key({
          ...vcsLocation,
          integrationID: integration.id,
          key,
          ...(label?.trim() ? { label: label.trim() } : {}),
          ...(Object.keys(answer).length > 0 ? { answer } : {}),
        });
        return ok(undefined);
      },
      activate: async (credentialId: string) => {
        await api.credential.activate({ ...vcsLocation, credentialID: credentialId });
        return ok(undefined);
      },
      rename: async (credentialId: string, label: string) => {
        await api.credential.update({ credentialID: credentialId, label });
        return ok(undefined);
      },
      remove: async (credentialId: string) => {
        await api.credential.remove({ ...vcsLocation, credentialID: credentialId });
        return ok(undefined);
      },
    },
    providerOAuth: {
      // `auto` OAuth completes on the server after the browser hits the
      // server's callback; poll the attempt until it settles.
      wait: async (providerId: string, timeoutMs = 900_000) => {
        const attempt = oauthAttempts.get(providerId);
        if (!attempt) throw new Error('Start provider sign-in again to complete it.');
        const deadline = Date.now() + timeoutMs;
        for (;;) {
          const status = (await api.integration.oauth.status({ ...vcsLocation, integrationID: attempt.integrationID, attemptID: attempt.attemptID })).data;
          if (status.status === 'complete') {
            oauthAttempts.delete(providerId);
            return ok(undefined);
          }
          if (status.status === 'failed') throw new Error(status.message || 'Provider sign-in failed.');
          if (status.status === 'expired') throw new Error('This sign-in attempt expired. Start again.');
          if (Date.now() >= deadline) throw new Error('Provider sign-in was not completed. Finish authentication in the browser and try again.');
          await delay(1_500);
        }
      },
      cancel: async (providerId: string) => {
        const attempt = oauthAttempts.get(providerId);
        if (attempt) {
          await api.integration.oauth.cancel({ ...vcsLocation, integrationID: attempt.integrationID, attemptID: attempt.attemptID }).catch(() => undefined);
          oauthAttempts.delete(providerId);
        }
        return ok(undefined);
      },
    },
    experimental: {
      session: {
        list: async () => ok([]),
      },
    },
    lsp: {
      status: async () => {
        throw new Error('Language servers are not available on OpenCode 2 servers.');
      },
    },
    formatter: {
      status: async () => {
        throw new Error('Formatters are not available on OpenCode 2 servers.');
      },
    },
  };
}
