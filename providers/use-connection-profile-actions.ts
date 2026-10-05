import { useConnectionProfiles } from '@/providers/use-connection-profiles';
import type { ConnectionActionsInput } from '@/providers/opencode-provider-action-inputs';
import type { useConnectionConnectActions } from '@/providers/use-connection-connect-actions';

type ConnectionProfileActionsInput = ConnectionActionsInput
  & Pick<ReturnType<typeof useConnectionConnectActions>, 'switchConnection' | 'updateSettings'>;

export function useConnectionProfileActions({ settings, switchConnection, updateSettings }: ConnectionProfileActionsInput) {
  const connectionProfiles = useConnectionProfiles({ settings, switchConnection, updateSettings });
  return { connectionProfiles };
}
