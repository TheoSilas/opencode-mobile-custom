import { agentToV1, configToV1, findIntegration, providerAuthToV1, providersToV1, type V2Adapter } from './shared';

const oauthAttempts = new Map<string, { integrationID: string; attemptID: string }>();

export function buildCapabilitiesApi({ api, vcsLocation, ok }: V2Adapter): Record<string, unknown> {
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
        const credential = integration?.connections.find((connection) => connection.type === 'credential');
        if (credential && credential.type === 'credential') {
          await api.credential.remove({ credentialID: credential.id });
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
