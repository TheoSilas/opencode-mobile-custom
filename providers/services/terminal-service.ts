import type { OpencodeClient } from '@opencode-ai/sdk/v2/client';
import { Platform } from 'react-native';

import { buildPtyWebSocketUrl, type OpencodeConnectionSettings, type ServerContract } from '@/lib/opencode/client';
import { requireData } from '@/providers/services/require-data';

export async function listShells(client: OpencodeClient) {
  return requireData((await client.pty.shells()).data, 'shell list request');
}

export async function listTerminals(client: OpencodeClient) {
  return requireData((await client.pty.list()).data, 'terminal list request');
}

export async function createTerminal(
  client: OpencodeClient,
  input?: { command?: string; args?: string[]; cwd?: string; title?: string; env?: Record<string, string> },
) {
  return requireData((await client.pty.create(input)).data, 'terminal create request');
}

export async function removeTerminal(client: OpencodeClient, ptyId: string) {
  await client.pty.remove({ ptyID: ptyId });
}

export async function resizeTerminal(client: OpencodeClient, ptyId: string, size: { cols: number; rows: number }) {
  return requireData((await client.pty.update({ ptyID: ptyId, size })).data, 'terminal resize request');
}

export async function createTerminalConnectToken(client: OpencodeClient, ptyId: string) {
  return requireData((await client.pty.connectToken(
    { ptyID: ptyId },
    { headers: { 'x-opencode-ticket': '1' } },
  )).data, 'terminal connect token request');
}

export function getTerminalWebSocketUrl(
  settings: Pick<OpencodeConnectionSettings, 'serverUrl' | 'directory'>,
  ptyId: string,
  options?: { ticket?: string; cursor?: string },
  contract?: ServerContract,
) {
  return buildPtyWebSocketUrl(settings, ptyId, options, contract);
}

export function openTerminalWebSocket(url: string, authorization?: string) {
  if (Platform.OS === 'web') return new WebSocket(url);
  // React Native's constructor accepts handshake headers; the DOM type does not.
  const NativeSocket = WebSocket as unknown as { new(url: string, protocols: undefined, options: { headers: Record<string, string> }): WebSocket };
  return new NativeSocket(url, undefined, { headers: authorization ? { Authorization: authorization } : {} });
}
