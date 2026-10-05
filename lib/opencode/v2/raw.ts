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
import { resolveV2Base, type AdapterContext, type LocationOptions, type RawCredential, type RawResult, type V2Adapter } from './shared';
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
  const prefixedFetch = createPrefixFetch(base.origin, pathPrefix, settings);
  const api = OpenCode.make({
    baseUrl: base.origin,
    headers,
    fetch: prefixedFetch,
  });

  // Credential management is a newer V2 surface that the pinned client does not
  // type. Read it through the same prefixed/authenticated transport and degrade
  // to "no accounts" on servers that do not expose it.
  const listCredentials = async (): Promise<RawCredential[]> => {
    const response = await prefixedFetch(new URL('/api/credential', base.origin).toString(), { method: 'GET', headers });
    if (response.status === 404 || response.status === 405) return [];
    if (!response.ok) throw new Error(`Could not load provider accounts (${response.status}).`);
    const body = (await response.json()) as { data?: RawCredential[] };
    return Array.isArray(body?.data) ? body.data : [];
  };

  const ctx: AdapterContext = {
    api,
    directory,
    listCredentials,
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
