import { mcpConfigToV2, type V2Adapter } from './shared';

export function buildMcpApi({ api, ok }: V2Adapter): Record<string, unknown> {
  return {
    mcp: {
      status: async () => {
        const response = await api.mcp.list();
        const statuses: Record<string, unknown> = {};
        (response.data ?? []).forEach((server) => {
          const raw = (server.status ?? {}) as Record<string, unknown>;
          const value = typeof raw.status === 'string' ? raw.status : typeof raw.type === 'string' ? raw.type : 'disabled';
          statuses[server.name] = { status: value };
        });
        return ok(statuses);
      },
      add: async (parameters: { name: string; config?: Record<string, unknown> }) => {
        await api.mcp.add({ server: parameters.name, config: mcpConfigToV2(parameters.config) });
        return ok(parameters.config);
      },
      connect: async (parameters: { name: string }) => {
        await api.mcp.connect({ server: parameters.name });
        return ok(undefined);
      },
      disconnect: async (parameters: { name: string }) => {
        await api.mcp.disconnect({ server: parameters.name });
        return ok(undefined);
      },
      auth: {
        start: async () => {
          throw new Error('MCP OAuth is not supported by OpenCode 2 servers.');
        },
        callback: async () => {
          throw new Error('MCP OAuth is not supported by OpenCode 2 servers.');
        },
        remove: async () => {
          throw new Error('MCP OAuth is not supported by OpenCode 2 servers.');
        },
      },
    },
  };
}
