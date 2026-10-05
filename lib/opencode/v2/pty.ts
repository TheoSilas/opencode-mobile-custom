import { shellToV1, type V2Adapter } from './shared';

export function buildPtyApi({ api, ctx, ok }: V2Adapter): Record<string, unknown> {
  return {
    pty: {
      shells: async () => {
        const shells = await api.config.shells();
        return ok(shells.map(shellToV1));
      },
      list: async () => {
        const response = await api.pty.list(ctx.directory ? { location: { directory: ctx.directory } } : {});
        return ok(response.data);
      },
      create: async (parameters?: { command?: string; args?: string[]; cwd?: string; title?: string; env?: Record<string, string> }) => {
        const response = await api.pty.create({
          ...parameters,
          ...(ctx.directory ? { location: { directory: ctx.directory } } : {}),
        });
        return ok(response.data);
      },
      get: async (parameters: { ptyID: string }) => {
        const response = await api.pty.get({ ptyID: parameters.ptyID, ...(ctx.directory ? { location: { directory: ctx.directory } } : {}) });
        return ok(response.data);
      },
      update: async (parameters: { ptyID: string; title?: string; size?: { rows: number; cols: number } }) => {
        const response = await api.pty.update({
          ptyID: parameters.ptyID,
          ...(ctx.directory ? { location: { directory: ctx.directory } } : {}),
          ...(parameters.title !== undefined ? { title: parameters.title } : {}),
          ...(parameters.size ? { size: parameters.size } : {}),
        });
        return ok(response.data);
      },
      remove: async (parameters: { ptyID: string }) => {
        await api.pty.remove({ ptyID: parameters.ptyID, ...(ctx.directory ? { location: { directory: ctx.directory } } : {}) });
        return ok(undefined);
      },
      connectToken: async (parameters: { ptyID: string }) => {
        const response = await api.pty.connect.token(
          { ptyID: parameters.ptyID, ...(ctx.directory ? { location: { directory: ctx.directory } } : {}) },
          { headers: { 'x-opencode-ticket': '1' } },
        );
        return ok({ ticket: response.data?.ticket });
      },
    },
  };
}
