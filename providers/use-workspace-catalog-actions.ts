import { useCallback, useEffect, useRef } from 'react';

import { buildClient, type ScopedOpencodeClient } from '@/lib/opencode/client';
import type { Project, SessionStatus } from '@/lib/opencode/types';
import type { WorkspaceCatalog } from '@/providers/opencode-provider-types';
import { hydrateSessionCache } from '@/providers/session-cache';
import {
  loadWorkspaceCatalog as svcLoadWorkspaceCatalog,
  resolveWorkspace as svcResolveWorkspace,
} from '@/providers/services/session-service';
import type { WorkspaceActionsInput } from '@/providers/opencode-provider-action-inputs';

export function useWorkspaceCatalogActions({
  catalogClient,
  isCurrentCatalogClient,
  activeProjectPath,
  setActiveProjectPath,
  activeProjectPathRef,
  clearProjectState,
  serverProjectsRef,
  setServerProjects,
  setCurrentProjectPath,
  setServerRootPath,
  connectionScope,
  connectionScopeRef,
  isHydrated,
  setSessions,
  setSessionStatuses,
  setIsRefreshingWorkspaceCatalog,
  scopeGenerationRef,
  serverContract,
  settingsRef,
}: WorkspaceActionsInput) {
  const loadWorkspaceCatalog = useCallback(
    async (silent = false, targetClient: ScopedOpencodeClient = catalogClient): Promise<WorkspaceCatalog> => {
      if (!silent) {
        setIsRefreshingWorkspaceCatalog(true);
      }

      try {
        const result = await svcLoadWorkspaceCatalog(targetClient);
        if (!isCurrentCatalogClient(targetClient)) {
          return result;
        }
        const nextServerProjects = result.serverProjects as Project[];
        serverProjectsRef.current = nextServerProjects;
        setServerProjects(nextServerProjects);
        setCurrentProjectPath(result.currentProjectPath);
        setServerRootPath(result.serverRootPath);
        const currentProject = activeProjectPathRef.current;
        const nextProject = currentProject && result.serverProjects.some((project) => project.worktree === currentProject)
          ? currentProject
          : result.currentProjectPath || result.serverProjects[0]?.worktree;
        if (nextProject !== currentProject) {
          scopeGenerationRef.current += 1;
          clearProjectState();
          setActiveProjectPath(nextProject);
        }
        return result;
      } finally {
        if (!silent) {
          setIsRefreshingWorkspaceCatalog(false);
        }
      }
    },
    [catalogClient, clearProjectState, isCurrentCatalogClient],
  );

  const refreshWorkspaceCatalog = useCallback(
    async (silent = false) => {
      await loadWorkspaceCatalog(silent);
    },
    [loadWorkspaceCatalog],
  );

  const sessionCacheKeyRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!isHydrated) {
      return;
    }
    const projectPath = activeProjectPath;
    const scope = connectionScope;
    const cacheKey = projectPath ? `${scope}\u0000${projectPath}` : undefined;
    if (sessionCacheKeyRef.current === cacheKey) {
      return;
    }
    sessionCacheKeyRef.current = cacheKey;
    if (!projectPath) {
      return;
    }
    void hydrateSessionCache(
      scope,
      projectPath,
      (cached) => setSessions(cached),
      (cached) => setSessionStatuses(cached as Record<string, SessionStatus>),
      () => activeProjectPathRef.current === projectPath && connectionScopeRef.current === scope,
    );
  }, [activeProjectPath, connectionScope, isHydrated]);

  const selectProject = useCallback((path: string) => {
    const normalizedPath = path.trim();
    if (!normalizedPath) {
      return;
    }
    if (normalizedPath === activeProjectPathRef.current) {
      return;
    }

    scopeGenerationRef.current += 1;
    setActiveProjectPath(normalizedPath);
    clearProjectState();
  }, [clearProjectState]);

  const addWorkspace = useCallback(async (directory: string) => {
    const path = directory.trim();
    if (!path) throw new Error('Enter a directory on the OpenCode server.');
    const connectionAtStart = connectionScopeRef.current;
    const scopedClient = buildClient({ ...settingsRef.current, directory: path }, serverContract);
    const project = await svcResolveWorkspace(scopedClient).catch((reason: unknown) => {
      if (reason instanceof Error && /\b(400|404)\b/.test(reason.message)) {
        throw new Error('OpenCode could not open that directory. Check the server path.');
      }
      throw reason;
    });
    if (connectionScopeRef.current !== connectionAtStart) throw new Error('The connection changed while adding the workspace.');
    if (!project.worktree) throw new Error('OpenCode did not return a workspace path.');
    await loadWorkspaceCatalog(true);
    selectProject(project.worktree);
    return project.worktree;
  }, [loadWorkspaceCatalog, selectProject, serverContract]);

  return { loadWorkspaceCatalog, refreshWorkspaceCatalog, selectProject, addWorkspace };
}
