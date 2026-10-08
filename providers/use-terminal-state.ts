import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';

import type { ScopedOpencodeClient, ServerContract } from '@/lib/opencode/client';
import type { Pty, PtyShellsResponse } from '@/lib/opencode/types';
import { createTerminal as svcCreateTerminal, listShells, listTerminals, removeTerminal } from '@/providers/services/terminal-service';
import { createTerminalConnection } from './terminal-connection';
import type { TerminalInstance, TerminalRenderer, TerminalRuntime } from './terminal-types';

export function useTerminalState({ client, isCurrentClient, serverUrl, directory, serverContract, authorization }: {
  client: ScopedOpencodeClient;
  isCurrentClient: (candidate: object) => boolean;
  serverUrl: string;
  directory: string;
  serverContract: ServerContract;
  authorization?: string;
}) {
  const [terminals, setTerminals] = useState<Pty[]>([]);
  const [terminalShells, setTerminalShells] = useState<PtyShellsResponse>([]);
  const [activeTerminalId, setActiveTerminalId] = useState<string>();
  const [instances, setInstances] = useState<TerminalInstance[]>([]);
  const [scope, setScope] = useState(0);
  const scopeRef = useRef(0);
  const refreshRequest = useRef(0);
  const connections = useRef(new Map<string, ReturnType<typeof createTerminalConnection>>());
  const foreground = useRef(AppState.currentState !== 'background' && AppState.currentState !== 'inactive');
  const publish = useCallback(() => setInstances([...connections.current.values()].map((entry) => entry.state)), []);

  useEffect(() => {
    const owned = connections.current;
    return () => { for (const connection of owned.values()) connection.dispose(); owned.clear(); };
  }, []);

  const resetTerminal = useCallback(() => {
    for (const connection of connections.current.values()) connection.dispose();
    connections.current.clear();
    setTerminals([]); setTerminalShells([]); setActiveTerminalId(undefined); setInstances([]);
    refreshRequest.current++;
    scopeRef.current++;
    setScope(scopeRef.current);
  }, []);

  const refreshTerminals = useCallback(async () => {
    const request = ++refreshRequest.current;
    const opened = new Set(connections.current.keys());
    const [nextTerminals, nextShells] = await Promise.all([listTerminals(client), listShells(client)]);
    if (!isCurrentClient(client) || request !== refreshRequest.current) return;
    setTerminals(nextTerminals); setTerminalShells(nextShells);
    for (const [id, connection] of connections.current) {
      const pty = nextTerminals.find((item) => item.id === id);
      if (opened.has(id) && (!pty || pty.status === 'exited') && connection.state.status !== 'exited') connection.exit();
    }
  }, [client, isCurrentClient]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      foreground.current = state === 'active';
      for (const connection of connections.current.values()) connection.foreground(foreground.current);
      if (foreground.current && connections.current.size) void refreshTerminals().catch(() => undefined);
    });
    return () => subscription.remove();
  }, [refreshTerminals]);

  const openTerminal = useCallback(async (ptyId: string) => {
    if (!isCurrentClient(client)) return;
    const existing = connections.current.get(ptyId);
    if (!existing) {
      const connection = createTerminalConnection({
        id: ptyId, client, current: () => isCurrentClient(client), serverUrl, directory, serverContract, authorization, publish,
      });
      connections.current.set(ptyId, connection);
      connection.foreground(foreground.current);
      publish();
    } else if (existing.state.status === 'error' || existing.state.status === 'idle') existing.reconnect();
    setActiveTerminalId(ptyId);
  }, [authorization, client, directory, isCurrentClient, publish, serverContract, serverUrl]);

  const createTerminal = useCallback(async (command?: string, title?: string) => {
    const terminal = await svcCreateTerminal(client, { command: command?.trim() || undefined, title: title?.trim() || undefined });
    if (!isCurrentClient(client)) return terminal;
    await refreshTerminals();
    if (isCurrentClient(client)) await openTerminal(terminal.id);
    return terminal;
  }, [client, isCurrentClient, openTerminal, refreshTerminals]);

  const sendTerminalInput = useCallback((ptyId: string, input: string, generation: number, expectedScope: number) => {
    if (expectedScope !== scopeRef.current) throw new Error('Terminal scope changed.');
    const connection = connections.current.get(ptyId);
    if (!connection) throw new Error('Terminal is not open.');
    connection.send(input, generation);
  }, []);

  const closeTerminal = useCallback(async (ptyId: string) => {
    await removeTerminal(client, ptyId);
    if (!isCurrentClient(client)) return;
    connections.current.get(ptyId)?.dispose(); connections.current.delete(ptyId);
    setActiveTerminalId((current) => current === ptyId ? connections.current.keys().next().value : current);
    publish();
    await refreshTerminals();
  }, [client, isCurrentClient, publish, refreshTerminals]);

  const registerRenderer = useCallback((ptyId: string, renderer: TerminalRenderer) => {
    return connections.current.get(ptyId)?.register(renderer) ?? (() => {});
  }, []);
  const resize = useCallback((ptyId: string, cols: number, rows: number) => {
    connections.current.get(ptyId)?.resize(cols, rows);
  }, []);
  const terminalRuntime = useMemo<TerminalRuntime>(() => ({ scope, instances, registerRenderer, resize }), [scope, instances, registerRenderer, resize]);
  const terminalConnection = instances.find((entry) => entry.id === activeTerminalId)?.status ?? 'idle';

  return { terminals, terminalShells, activeTerminalId, terminalRuntime, terminalConnection, refreshTerminals, openTerminal, createTerminal, sendTerminalInput, closeTerminal, resetTerminal };
}
