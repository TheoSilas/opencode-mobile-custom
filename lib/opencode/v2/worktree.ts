import type { V2Adapter } from './shared';

export function buildWorktreeApi({ api, getProjectID, ok }: V2Adapter): Record<string, unknown> {
  return {
    worktree: {
      list: async () => {
        const projectID = await getProjectID();
        return ok(await api.worktree.list({ projectID }));
      },
      create: async (parameters: { worktreeCreateInput?: { name?: string } }) => {
        const projectID = await getProjectID();
        const input = parameters?.worktreeCreateInput ?? {};
        return ok(await api.worktree.create({ projectID, ...(input.name ? { name: input.name } : {}) }));
      },
      reset: async () => {
        const projectID = await getProjectID();
        await api.worktree.refresh({ projectID });
        return ok({});
      },
      remove: async (parameters: { worktreeRemoveInput?: { directory?: string } }) => {
        const projectID = await getProjectID();
        const target = parameters?.worktreeRemoveInput?.directory;
        if (!target) throw new Error('A worktree directory is required.');
        await api.worktree.remove({ projectID, directory: target, force: true });
        return ok({});
      },
    },
  };
}
