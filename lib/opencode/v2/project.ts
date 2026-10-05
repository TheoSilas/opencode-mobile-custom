import { projectToV1 } from '../v2-mappers';
import type { V2Adapter } from './shared';

export function buildProjectApi({ api, vcsLocation, ok }: V2Adapter): Record<string, unknown> {
  return {
    path: {
      get: async () => ok(await api.location.get(vcsLocation)),
    },
    project: {
      list: async () => ok((await api.project.list()).map(projectToV1)),
      current: async () => {
        const location = await api.location.get(vcsLocation);
        return ok({ id: location.project.id, worktree: location.project.directory, time: { created: 0, initialized: 0 } });
      },
    },
  };
}
