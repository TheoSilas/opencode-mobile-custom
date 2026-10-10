import { describe, expect, it, vi } from 'vitest';

import { buildV2Client } from '@/lib/opencode/v2-client';
import { activateVerifiedAccount, renameVerifiedAccount } from '@/providers/services/capabilities-service';

const h = vi.hoisted(() => ({ api: undefined as unknown, request: undefined as unknown }));
vi.mock('@opencode/client', () => ({ OpenCode: { make: () => h.api } }));
vi.mock('@/lib/opencode/client', () => ({
  getServerBase: () => ({ origin: 'http://test', pathPrefix: '' }),
  getRequestHeaders: () => ({}),
  createPrefixFetch: () => h.request,
}));

const settings = { serverUrl: 'http://test', directory: '/repo', username: '', password: '' } as never;

describe('v2 provider accounts', () => {
  it('maps stored credentials to accounts with method and active state', async () => {
    h.request = vi.fn(async () => new Response(JSON.stringify({ data: [
      { id: 'c1', integrationID: 'openai', label: 'Work', active: true, value: { type: 'oauth' } },
      { id: 'c2', integrationID: 'openai', label: 'Personal', active: false, value: { type: 'key' } },
    ] }), { status: 200 }));

    await expect(buildV2Client(settings).accounts!.list()).resolves.toEqual([
      { id: 'c1', providerId: 'openai', label: 'Work', method: 'oauth', active: true },
      { id: 'c2', providerId: 'openai', label: 'Personal', method: 'key', active: false },
    ]);
  });

  it('treats a missing credential endpoint as no accounts', async () => {
    h.request = vi.fn(async () => new Response('', { status: 404 }));
    await expect(buildV2Client(settings).accounts!.list()).resolves.toEqual([]);
  });

  it('sends account label updates and activation to the server rather than session state', async () => {
    const update = vi.fn(async () => undefined);
    const activate = vi.fn(async () => undefined);
    h.api = { credential: { update, activate } };
    const accounts = buildV2Client(settings).accounts!;
    await accounts.rename('c2', 'Personal');
    await accounts.activate('c2');
    expect(update).toHaveBeenCalledWith({ credentialID: 'c2', label: 'Personal' });
    expect(activate).toHaveBeenCalledWith({ location: { directory: '/repo' }, credentialID: 'c2' });
  });

  it('reports success only after the server confirms the active account and label', async () => {
    const initial = [
      { id: 'c1', providerId: 'openai', label: 'Work', active: true },
      { id: 'c2', providerId: 'openai', label: 'Personal', active: false },
    ];
    const list = vi.fn().mockResolvedValueOnce(initial).mockResolvedValueOnce(initial);
    const activate = vi.fn(async () => undefined);
    const rename = vi.fn(async () => undefined);
    const client = { accounts: { list, activate, rename } } as never;
    await expect(activateVerifiedAccount(client, 'c2')).rejects.toThrow('did not confirm');
    expect(activate).toHaveBeenCalledWith('c2');
    list.mockResolvedValueOnce(initial).mockResolvedValueOnce([{ ...initial[0], active: false }, { ...initial[1], active: true }]);
    await expect(activateVerifiedAccount(client, 'c2')).resolves.toBeUndefined();
    list.mockResolvedValueOnce(initial);
    await expect(renameVerifiedAccount(client, 'c2', 'Home')).rejects.toThrow('did not confirm');
    list.mockResolvedValueOnce([{ ...initial[1], label: 'Home' }]);
    await expect(renameVerifiedAccount(client, 'c2', ' Home ')).resolves.toBeUndefined();
    expect(rename).toHaveBeenLastCalledWith('c2', 'Home');
  });
});
