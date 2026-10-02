import { useCallback, useEffect, useRef, useState } from 'react';

import type { ScopedOpencodeClient, ServerContract } from '@/lib/opencode/client';
import type { Pty, PtyShellsResponse } from '@/lib/opencode/types';
import {
  createTerminal as svcCreateTerminal,
  createTerminalConnectToken,
  getTerminalWebSocketUrl,
  listShells,
  listTerminals,
  removeTerminal as svcRemoveTerminal,
  openTerminalWebSocket,
} from '@/providers/services/terminal-service';

// Terminal is self-contained: one project-scoped PTY list, the active socket,
// and the replayed output buffer. Keeping it in its own hook keeps the provider
// focused on session/chat orchestration.
const ANSI_CSI_PATTERN = new RegExp('\\u001b\\[[0-?]*[ -/]*[@-~]', 'gi');
const MAX_TERMINAL_OUTPUT_CHARS = 100_000;

type TerminalConnectionState = 'idle' | 'connecting' | 'connected' | 'error';

export function useTerminalState({
  client,
  isCurrentClient,
  serverUrl,
  directory,
  serverContract,
  authorization,
}: {
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
  const [terminalOutput, setTerminalOutput] = useState('');
  const [terminalConnection, setTerminalConnection] = useState<TerminalConnectionState>('idle');

  const terminalSocketRef = useRef<WebSocket | undefined>(undefined);
  const terminalCursorByIdRef = useRef<Record<string, string>>({});
  const terminalOpenGenerationRef = useRef(0);

  useEffect(() => () => {
    terminalSocketRef.current?.close();
  }, []);

  // Clears terminal state and tears down the socket. Called when the project or
  // connection scope changes.
  const resetTerminal = useCallback(() => {
    setTerminals([]);
    setTerminalShells([]);
    setActiveTerminalId(undefined);
    setTerminalOutput('');
    setTerminalConnection('idle');
    terminalSocketRef.current?.close();
    terminalSocketRef.current = undefined;
    terminalCursorByIdRef.current = {};
    terminalOpenGenerationRef.current += 1;
  }, []);

  const refreshTerminals = useCallback(async () => {
    const [nextTerminals, nextShells] = await Promise.all([listTerminals(client), listShells(client)]);
    if (!isCurrentClient(client)) return;
    setTerminals(nextTerminals);
    setTerminalShells(nextShells);
  }, [client, isCurrentClient]);

  const openTerminal = useCallback(async (ptyId: string) => {
    const generation = ++terminalOpenGenerationRef.current;
    const previousSocket = terminalSocketRef.current;
    terminalSocketRef.current = undefined;
    previousSocket?.close();
    const switchingTerminal = activeTerminalId !== ptyId;
    setActiveTerminalId(ptyId);
    if (switchingTerminal) setTerminalOutput('');
    setTerminalConnection('connecting');
    const token = await createTerminalConnectToken(client, ptyId);
    if (!isCurrentClient(client) || generation !== terminalOpenGenerationRef.current) {
      throw new Error('Terminal connection was superseded.');
    }
    const socket = openTerminalWebSocket(getTerminalWebSocketUrl(
      { serverUrl, directory },
      ptyId,
      { ticket: token.ticket, cursor: terminalCursorByIdRef.current[ptyId] },
      serverContract,
    ), authorization);
    terminalSocketRef.current = socket;
    let opened = false;
    const connected = new Promise<void>((resolve, reject) => {
      socket.onopen = () => {
        if (generation !== terminalOpenGenerationRef.current) {
          socket.close();
          reject(new Error('Terminal connection was superseded.'));
          return;
        }
        opened = true;
        setTerminalConnection('connected');
        resolve();
      };
      socket.onerror = () => {
        if (generation !== terminalOpenGenerationRef.current) return;
        setTerminalConnection('error');
        if (!opened) reject(new Error('Could not connect to the terminal.'));
      };
      socket.onclose = () => {
        if (generation !== terminalOpenGenerationRef.current) return;
        if (terminalSocketRef.current === socket && opened) setTerminalConnection('idle');
        if (!opened) reject(new Error('The terminal connection closed before it was ready.'));
      };
    });
    socket.onmessage = ({ data }) => {
      // ponytail: strip common CSI styling; use a terminal emulator if full VT control becomes required.
      if (generation !== terminalOpenGenerationRef.current) return;
      const append = (value: string) => setTerminalOutput((current) => `${current}${value.replace(ANSI_CSI_PATTERN, '')}`.slice(-MAX_TERMINAL_OUTPUT_CHARS));
      if (typeof data === 'string') append(data);
      else {
        const read = async () => {
          const buffer = data instanceof Blob ? await data.arrayBuffer() : data as ArrayBuffer;
          if (generation !== terminalOpenGenerationRef.current) return;
          const bytes = new Uint8Array(buffer);
          const text = new TextDecoder().decode(bytes[0] === 0 ? bytes.subarray(1) : bytes);
          if (bytes[0] !== 0) {
            append(text);
            return;
          }
          try {
            const cursor = JSON.parse(text).cursor;
            if (cursor !== undefined) terminalCursorByIdRef.current[ptyId] = String(cursor);
          } catch {
            // Ignore malformed control frames instead of rendering protocol data.
          }
        };
        void read();
      }
    };
    await connected;
  }, [activeTerminalId, authorization, client, directory, isCurrentClient, serverContract, serverUrl]);

  const createTerminal = useCallback(async (command?: string, title?: string) => {
    const terminal = await svcCreateTerminal(client, { command: command?.trim() || undefined, title: title?.trim() || undefined });
    await refreshTerminals();
    await openTerminal(terminal.id);
    return terminal;
  }, [client, openTerminal, refreshTerminals]);

  const sendTerminalInput = useCallback((input: string) => {
    if (terminalSocketRef.current?.readyState !== WebSocket.OPEN) throw new Error('Terminal is not connected.');
    terminalSocketRef.current.send(input);
  }, []);

  const closeTerminal = useCallback(async (ptyId: string) => {
    if (activeTerminalId === ptyId) {
      terminalOpenGenerationRef.current += 1;
      terminalSocketRef.current?.close();
      terminalSocketRef.current = undefined;
      setActiveTerminalId(undefined);
      setTerminalOutput('');
    }
    delete terminalCursorByIdRef.current[ptyId];
    await svcRemoveTerminal(client, ptyId);
    await refreshTerminals();
  }, [activeTerminalId, client, refreshTerminals]);

  return {
    terminals,
    terminalShells,
    activeTerminalId,
    terminalOutput,
    terminalConnection,
    refreshTerminals,
    openTerminal,
    createTerminal,
    sendTerminalInput,
    closeTerminal,
    resetTerminal,
  };
}
