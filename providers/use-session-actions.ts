import type { SessionActionsInput } from '@/providers/opencode-provider-action-inputs';
import { useSessionCrudActions } from '@/providers/use-session-crud-actions';
import { useSessionFavoriteActions } from '@/providers/use-session-favorite-actions';
import { useSessionInteractionActions } from '@/providers/use-session-interaction-actions';
import { useSessionBootstrapActions } from '@/providers/use-session-bootstrap-actions';

export function useSessionActions(input: SessionActionsInput) {
  const crud = useSessionCrudActions(input);
  const favorites = useSessionFavoriteActions(input);
  const interactions = useSessionInteractionActions(input);
  const bootstrap = useSessionBootstrapActions({ ...input, createSession: crud.createSession });
  return { ...crud, ...favorites, ...interactions, ...bootstrap };
}
