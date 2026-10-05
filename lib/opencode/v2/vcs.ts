import type { V2Adapter } from './shared';

export function buildVcsApi({ api, vcsLocation, ok }: V2Adapter): Record<string, unknown> {
  return {
    vcs: {
      get: async () => {
        const response = await api.vcs.get(vcsLocation);
        return ok({ branch: response.data?.branch?.current, default_branch: response.data?.branch?.default });
      },
      status: async () => {
        const response = await api.vcs.status(vcsLocation);
        return ok(response.data);
      },
      diff: async (parameters: { mode?: string; context?: number }) => {
        // V1 speaks `git`; V2 speaks `working`. The adapter is the translation point.
        const mode = parameters?.mode === 'branch' ? 'branch' : 'working';
        const response = await api.vcs.diff({ ...vcsLocation, mode, ...(parameters?.context !== undefined ? { context: parameters.context } : {}) });
        return ok(response.data);
      },
      diff2: {
        raw: async () => {
          const response = await api.vcs.diff({ ...vcsLocation, mode: 'working' });
          return ok((response.data ?? []).map((diff) => diff.patch).join('\n'));
        },
      },
      apply: async () => {
        throw new Error('Applying patches is not supported by OpenCode 2 servers.');
      },
    },
  };
}
