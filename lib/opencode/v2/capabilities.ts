import { agentToV1, configToV1, findIntegration, providerAuthToV1, providersToV1, type V2Adapter } from './shared';

const oauthAttempts = new Map<string, { integrationID: string; attemptID: string }>();

export function buildCapabilitiesApi({ api, ctx, vcsLocation, ok }: V2Adapter): Record<string, unknown> {
  const accountAnswers = (values: Record<string, string>) =>
    Object.fromEntries(
      Object.entries(values)
        .filter(([name, value]) => name !== 'key' && name !== 'token' && value.trim())
        .map(([name, value]) => [name, value.trim()]),
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
        authorize: async (parameters: { providerID: string; method: number; inputs?: Record<string, string> }) => {
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
          method: credential.value?.type === 'oauth' ? 'oauth' as const : 'key' as const,
          active: Boolean(credential.active),
        }));
      },
      add: async (providerId: string, values: Record<string, string>, label?: string) => {
        const integration = await findIntegration(api, providerId, vcsLocation, true);
        if (!integration) throw new Error('This provider is not available on OpenCode 2.');
        const key = values.key || values.token || '';
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
      remove: async (credentialId: string) => {
        await api.credential.remove({ ...vcsLocation, credentialID: credentialId });
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
