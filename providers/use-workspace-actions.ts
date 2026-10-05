import type { WorkspaceActionsInput } from '@/providers/opencode-provider-action-inputs';
import { useWorkspaceCatalogActions } from '@/providers/use-workspace-catalog-actions';
import { useWorkspaceRefreshActions } from '@/providers/use-workspace-refresh-actions';
import { useWorkspaceFileActions } from '@/providers/use-workspace-file-actions';

export function useWorkspaceActions(input: WorkspaceActionsInput) {
  const catalog = useWorkspaceCatalogActions(input);
  const refresh = useWorkspaceRefreshActions(input);
  const files = useWorkspaceFileActions({ ...input, refreshVcsDiff: refresh.refreshVcsDiff });
  return { ...catalog, ...refresh, ...files };
}
