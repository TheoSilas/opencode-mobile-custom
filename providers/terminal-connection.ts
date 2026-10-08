import type { ScopedOpencodeClient, ServerContract } from '@/lib/opencode/client';
import { createTerminalOutputQueue } from '@/lib/opencode/terminal-stream';
import { createTerminalConnectToken, getTerminalWebSocketUrl, openTerminalWebSocket, resizeTerminal } from '@/providers/services/terminal-service';
import type { TerminalInstance, TerminalRenderer } from './terminal-types';

export function createTerminalConnection({ id, client, current, serverUrl, directory, serverContract, authorization, publish }: {
  id: string;
  client: ScopedOpencodeClient;
  current: () => boolean;
  serverUrl: string;
  directory: string;
  serverContract: ServerContract;
  authorization?: string;
  publish: () => void;
}) {
  let state: TerminalInstance = { id, generation: 0, status: 'connecting' };
  let renderer: TerminalRenderer | undefined;
  let socket: WebSocket | undefined;
  let output: ReturnType<typeof createTerminalOutputQueue> | undefined;
  let cursor: number | undefined, generation = 0, attempt = 0;
  let stopped = false, foreground = true;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let resizeTimer: ReturnType<typeof setTimeout> | undefined;
  let size: { cols: number; rows: number } | undefined;
  let sentSize: string | undefined;
  let resizeRunning = false;

  function update(status: TerminalInstance['status'], error?: string) {
    state = { id, generation, status, ...(error ? { error } : {}) };
    publish();
  }
  function cancelRetry() {
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = undefined;
  }
  function disconnect() {
    generation++;
    const previous = socket;
    socket = undefined;
    previous?.close();
    cancelRetry();
  }
  function fail(error: unknown, retry: boolean) {
    if (stopped || !current()) return;
    const message = error instanceof Error ? error.message : String(error);
    update(retry ? 'reconnecting' : 'error', message);
    if (retry && foreground && renderer && !retryTimer) {
      const delay = [1000, 2000, 4000, 8000, 15000][Math.min(attempt++, 4)];
      retryTimer = setTimeout(() => { retryTimer = undefined; void connect(); }, delay);
    }
  }
  async function sendSize() {
    if (!size || resizeRunning || stopped || !current() || state.status !== 'connected') return;
    const requested = size, key = `${requested.cols}:${requested.rows}`;
    if (key === sentSize) return;
    resizeRunning = true;
    try {
      await resizeTerminal(client, id, requested);
      if (!stopped && current()) sentSize = key;
    } catch (error) {
      if (!stopped && current()) update(state.status, error instanceof Error ? error.message : 'Terminal resize failed.');
    } finally {
      resizeRunning = false;
      if (size !== requested) void sendSize();
    }
  }
  async function connect() {
    if (stopped || !foreground || !renderer || !current()) return;
    disconnect();
    const turn = generation;
    const valid = () => !stopped && current() && turn === generation;
    update(attempt ? 'reconnecting' : 'connecting');
    try {
      // A reconnect cannot overtake the last acknowledged renderer write.
      await output?.drain();
      if (!valid()) return;
      const token = await createTerminalConnectToken(client, id);
      if (!valid()) return;
      const next = openTerminalWebSocket(getTerminalWebSocketUrl({ serverUrl, directory }, id, {
        ticket: token.ticket, cursor: cursor === undefined ? undefined : String(cursor),
      }, serverContract), authorization);
      socket = next;
      const sink = renderer;
      output = createTerminalOutputQueue({
        write: (text) => sink.write(text),
        onText: (length) => { if (cursor !== undefined) cursor += length; },
        onCursor: (value) => { cursor = value; },
        onError: (error) => {
          if (!valid()) return;
          disconnect();
          fail(error, false);
        },
      });
      next.onmessage = ({ data }) => { if (valid()) output?.push(data); };
      next.onopen = () => {
        if (!valid()) { next.close(); return; }
        attempt = 0;
        sentSize = undefined;
        update('connected');
        void sendSize();
      };
      next.onerror = () => {
        if (!valid()) return;
        disconnect();
        fail(new Error('Terminal connection failed.'), true);
      };
      next.onclose = (event) => {
        if (!valid()) return;
        socket = undefined;
        const permanent = [1000, 1008, 4001, 4003, 4401, 4403, 4404].includes(event.code);
        if (event.code === 1000) { stopped = true; update('exited'); }
        else fail(new Error(event.reason || 'Terminal connection closed.'), !permanent);
      };
    } catch (error) {
      if (!valid()) return;
      const status = (error as { status?: number })?.status;
      fail(error, ![401, 403, 404].includes(status || 0) && !/401|403|404|unauthorized|forbidden|not found/i.test(String(error)));
    }
  }
  return {
    get state() { return state; },
    register(next: TerminalRenderer) {
      disconnect();
      output?.stop();
      renderer = next;
      cursor = undefined;
      if (!stopped) { attempt = 0; void connect(); }
      return () => {
        if (renderer !== next) return;
        disconnect(); output?.stop(); renderer = undefined; cursor = undefined;
      };
    },
    reconnect() { if (!stopped) { attempt = 0; void connect(); } },
    send(input: string, expectedGeneration = generation) {
      if (expectedGeneration !== generation || stopped || !current() || !foreground || !renderer || state.status !== 'connected' || socket?.readyState !== 1) throw new Error('Terminal is not connected.');
      socket.send(input);
    },
    resize(cols: number, rows: number) {
      if (!Number.isSafeInteger(cols) || !Number.isSafeInteger(rows) || cols <= 0 || rows <= 0) return;
      size = { cols, rows };
      if (resizeTimer) clearTimeout(resizeTimer);
      if (!sentSize) void sendSize();
      else resizeTimer = setTimeout(() => { resizeTimer = undefined; void sendSize(); }, 100);
    },
    foreground(active: boolean) {
      if (foreground === active) return;
      foreground = active;
      if (active) { if (!stopped) { attempt = 0; void connect(); } }
      else { disconnect(); if (!stopped) update('idle'); }
    },
    exit() { stopped = true; disconnect(); void output?.drain(); update('exited'); },
    dispose() {
      stopped = true; disconnect(); output?.stop(); renderer = undefined;
      if (resizeTimer) clearTimeout(resizeTimer);
    },
  };
}
