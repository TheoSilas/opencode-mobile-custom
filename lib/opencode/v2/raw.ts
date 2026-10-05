import { OpenCode } from '@opencode/client';

import { createPrefixFetch, getRequestHeaders, type OpencodeConnectionSettings } from '../client';
import { coalesceRead } from '../in-flight';
import { buildCapabilitiesApi } from './capabilities';
import { buildFilesystemApi } from './filesystem';
import { buildGlobalApi } from './global';
import { buildInteractionsApi } from './interactions';
import { buildMcpApi } from './mcp';
import { buildProjectApi } from './project';
import { buildPtyApi } from './pty';
import { buildSessionApi } from './session';
import { resolveV2Base, type AdapterContext, type LocationOptions, type RawResult, type V2Adapter } from './shared';
import { buildVcsApi } from './vcs';
import { buildWorktreeApi } from './worktree';

export function buildV2Raw(settings: OpencodeConnectionSettings): { client: Record<string, unknown>; ctx: AdapterContext } {
  const { base, pathPrefix } = resolveV2Base(settings);
  const headers = getRequestHeaders(settings);
  const directory = settings.directory.trim() || undefined;
  // Every V2 endpoint that reads repository state is location-scoped. Without
  // `location[directory]` the server falls back to its own working directory
  // and reports another repository's VCS state (usually an empty diff).
  const vcsLocation: LocationOptions = directory ? { location: { directory } } : {};
  const api = OpenCode.make({
    baseUrl: base.origin,
    headers,
    fetch: createPrefixFetch(base.origin, pathPrefix, settings),
  });

  const ctx: AdapterContext = {
    api,
    directory,
    permissionSession: new Map(),
    formSession: new Map(),
  };

  let cachedProjectID: string | undefined;
  const getProjectID = async () => {
    if (!cachedProjectID) {
      const location = await api.location.get(vcsLocation);
      cachedProjectID = location.project.id;
    }
    return cachedProjectID;
  };

  const ok = (data: unknown): RawResult => ({ data });
  const listSessionPage = () => coalesceRead(api, 'sessions', () => api.session.list(directory ? { directory } : {}));

  // The V2 surface is assembled from per-domain builders. Each builder is a
  // self-contained translation slice; the composer below only wires them
  // together, so adding or changing an endpoint touches one builder.
  const adapter: V2Adapter = { api, ctx, directory, vcsLocation, ok, listSessionPage, getProjectID };

  const client: Record<string, unknown> = {
    __opencode: { directory },
    ...buildProjectApi(adapter),
    ...buildSessionApi(adapter),
    ...buildCapabilitiesApi(adapter),
    ...buildFilesystemApi(adapter),
    ...buildVcsApi(adapter),
    ...buildWorktreeApi(adapter),
    ...buildMcpApi(adapter),
    ...buildPtyApi(adapter),
    ...buildGlobalApi(adapter),
    ...buildInteractionsApi(adapter),
  };

  return { client, ctx };
}
