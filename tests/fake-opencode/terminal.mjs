import { Buffer } from 'node:buffer';

// A deterministic interactive shell fixture, shared by the two server contracts.
export function createTerminalFixture(onExit) {
  const records = new Map();
  function get(id) {
    if (!records.has(id)) records.set(id, { id, output: '$ ', input: [], history: [], historyIndex: 0, line: '', position: 0, escape: '', clients: new Set(), connections: 0, cursors: [], size: undefined, screen: false, failTerminate: false });
    return records.get(id);
  }
  function emit(record, text) {
    record.output += text;
    for (const client of record.clients) if (client.readyState === 1) client.send(text);
  }
  function redraw(record) { emit(record, `\r\x1b[2K$ ${record.line}`); }
  function remove(id) {
    const record = records.get(id);
    if (!record) return;
    for (const client of record.clients) client.close(1000);
    records.delete(id);
  }
  return {
    get,
    remove,
    reset() { for (const id of records.keys()) remove(id); },
    snapshot() { return [...records.values()].map(({ clients, ...record }) => ({ ...record, clients: clients.size })); },
    control({ id, action, text }) {
      const record = get(id);
      if (action === 'disconnect') for (const client of record.clients) client.terminate();
      if (action === 'output') emit(record, text);
      if (action === 'fail-terminate') record.failTerminate = true;
      if (action === 'exit') { onExit(id); for (const client of record.clients) client.close(1000); }
    },
    connect(socket, request) {
      const url = new URL(request.url, 'http://localhost');
      const record = get(decodeURIComponent(url.pathname.split('/').at(-2)));
      const cursor = url.searchParams.get('cursor');
      record.cursors.push(cursor); record.connections++;
      socket.send(cursor === '-1' ? '' : record.output.slice(cursor === null ? 0 : Number(cursor)));
      socket.send(Buffer.concat([Buffer.from([0]), Buffer.from(JSON.stringify({ cursor: record.output.length }))]));
      record.clients.add(socket);
      socket.on('close', () => record.clients.delete(socket));
      socket.on('message', (value) => {
        const data = value.toString(); record.input.push(data);
        for (const char of data) {
          if (record.escape || char === '\x1b') {
            record.escape += char;
            if (record.escape === '\x1b' || record.escape === '\x1b[' || record.escape === '\x1bO') continue;
            if (!/[A-Za-z~]$/.test(record.escape)) continue;
            if (/^\x1b(?:\[|O)[AB]$/.test(record.escape)) {
              record.historyIndex = Math.max(0, Math.min(record.history.length, record.historyIndex + (char === 'A' ? -1 : 1)));
              record.line = record.history[record.historyIndex] || ''; record.position = record.line.length; redraw(record);
            }
            record.escape = ''; continue;
          }
          if (record.screen) {
            if (char === 'q' || char === '\x03') { record.screen = false; emit(record, '\x1b[?1049l$ '); }
            continue;
          }
          if (char === '\r' || char === '\n') {
            const command = record.line;
            emit(record, '\r\n'); record.line = ''; record.position = 0;
            if (command) record.history.push(command);
            record.historyIndex = record.history.length;
            if (command === 'fixture-screen') { record.screen = true; emit(record, '\x1b[?1049h\x1b[2J\x1b[H\x1b[31mFULL SCREEN\x1b[0m\r\nPress q to return'); }
            else emit(record, command ? `ran: ${command}\r\n$ ` : '$ ');
          } else if (char === '\x03' || char === '\x1a') {
            record.line = ''; record.position = 0; emit(record, `${char === '\x03' ? '^C' : '^Z'}\r\n$ `);
          } else if (char === '\x04' && !record.line) {
            onExit(record.id); socket.close(1000);
          } else if (char === '\x0c') emit(record, `\x1b[2J\x1b[H$ ${record.line}`);
          else if (char === '\x01') record.position = 0;
          else if (char === '\x05') record.position = record.line.length;
          else if (char === '\x15') { record.line = record.line.slice(record.position); record.position = 0; redraw(record); }
          else if (char === '\x17') { const prefix = record.line.slice(0, record.position).replace(/\S+\s*$/, ''); record.line = prefix + record.line.slice(record.position); record.position = prefix.length; redraw(record); }
          else if (char === '\x7f' || char === '\b') { record.line = record.line.slice(0, Math.max(0, record.position - 1)) + record.line.slice(record.position); record.position = Math.max(0, record.position - 1); redraw(record); }
          else if (char === '\t') { record.line += record.line === 'ech' ? 'o ' : '-completed'; record.position = record.line.length; redraw(record); }
          else if (char >= ' ') { record.line = record.line.slice(0, record.position) + char + record.line.slice(record.position); record.position += char.length; emit(record, char); }
        }
      });
    },
  };
}
