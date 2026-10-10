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

  it('reads older V2 ordered integration credentials when the list endpoint is absent', async () => {
    h.request = vi.fn(async () => new Response('', { status: 404 }));
    const list = vi.fn(async () => ({ data: [{ id: 'openai', connections: [
      { type: 'env', name: 'OPENAI_API_KEY' },
      { type: 'credential', id: 'c2', label: 'Personal' },
      { type: 'credential', id: 'c1', label: 'Work' },
    ] }] }));
    h.api = { integration: { list } };
    await expect(buildV2Client(settings).accounts!.list()).resolves.toEqual([
      { id: 'c2', providerId: 'openai', label: 'Personal', method: 'unknown', active: true },
      { id: 'c1', providerId: 'openai', label: 'Work', method: 'unknown', active: false },
    ]);
    expect(list).toHaveBeenCalledWith({ location: { directory: '/repo' } });
  });

  it('does not disguise malformed or denied credential reads as an empty list', async () => {
    h.request = vi.fn(async () => new Response('{}', { status: 200 }));
    await expect(buildV2Client(settings).accounts!.list()).rejects.toThrow('unexpected response format');
    h.request = vi.fn(async () => new Response('', { status: 401 }));
    await expect(buildV2Client(settings).accounts!.list()).rejects.toThrow('401');
  });

  it('confirms older V2 activation through the server connection order', async () => {
    h.request = vi.fn(async () => new Response('', { status: 405 }));
    const activate = vi.fn(async () => undefined);
    const list = vi.fn()
      .mockResolvedValueOnce({ data: [{ id: 'openai', connections: [
        { type: 'credential', id: 'c1', label: 'Work' },
        { type: 'credential', id: 'c2', label: 'Personal' },
      ] }] })
      .mockResolvedValueOnce({ data: [{ id: 'openai', connections: [
        { type: 'credential', id: 'c2', label: 'Personal' },
        { type: 'credential', id: 'c1', label: 'Work' },
      ] }] });
    h.api = { integration: { list }, credential: { activate } };
    await expect(activateVerifiedAccount(buildV2Client(settings), 'c2')).resolves.toBeUndefined();
    expect(activate).toHaveBeenCalledOnce();
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
