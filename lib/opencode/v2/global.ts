import { subscribeV2 } from './events';
import type { V2Adapter } from './shared';

export function buildGlobalApi({ api, ctx, ok }: V2Adapter): Record<string, unknown> {
  return {
    global: {
      health: async () => {
        const info = await api.server.info();
        return ok({ healthy: true, version: info.version });
      },
      event: async (parameters?: { signal?: AbortSignal }) => ({ stream: subscribeV2(api, parameters?.signal, ctx) }),
    },
  };
}
