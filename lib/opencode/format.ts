import { getFormatLocale } from '@/lib/i18n';
import type { Message, Part, Session, Todo, ToolPart } from '@/lib/opencode/types';

export type SessionMessageRecord = {
  info: Message;
  parts: Part[];
};

export type TranscriptDetail =
  | { id: string; kind: 'reasoning'; label: string; body: string }
  | { id: string; kind: 'tool'; label: string; body: string; status: string }
  | { id: string; kind: 'patch'; label: string; body: string }
  | { id: string; kind: 'file'; label: string; body: string }
  | { id: string; kind: 'subtask'; label: string; body: string }
  | { id: string; kind: 'step'; label: string; body: string }
  | { id: string; kind: 'agent'; label: string; body: string }
  | { id: string; kind: 'retry'; label: string; body: string }
  | { id: string; kind: 'compaction'; label: string; body: string };

export type TranscriptEntry = {
  id: string;
  role: Message['role'];
  createdAt: number;
  text: string;
  details: TranscriptDetail[];
  error?: string;
};

function isCompletedToolPart(
  part: Part,
): part is ToolPart & { state: Extract<ToolPart['state'], { status: 'completed' }> } {
  return part.type === 'tool' && part.state.status === 'completed';
}

function getToolTitle(part: ToolPart) {
  return 'title' in part.state && part.state.title ? part.state.title : part.tool;
}

function getToolBody(part: ToolPart) {
  if ('error' in part.state && part.state.error) {
    return part.state.error;
  }

  if ('output' in part.state && part.state.output) {
    return part.state.output;
  }

  if ('metadata' in part && part.metadata) {
    return JSON.stringify(part.metadata, null, 2);
  }

  return 'No output';
}

function getMessageError(record: SessionMessageRecord) {
  if (record.info.role !== 'assistant' || !('error' in record.info) || !record.info.error) {
    return undefined;
  }

  const data = record.info.error.data;
  const message = data && 'message' in data ? String(data.message) : 'Request failed';
  return `${record.info.error.name}: ${message}`;
}

function compactText(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

export function formatTimestamp(value: number) {
  try {
    if (typeof Intl !== 'undefined' && typeof Intl.DateTimeFormat === 'function') {
      return new Intl.DateTimeFormat(getFormatLocale(), {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(value);
    }
  } catch {
    // Fall back below.
  }

  return new Date(value).toLocaleString();
}

export function formatRelativeTime(value: number) {
  const diffMs = value - Date.now();
  const diffMinutes = Math.round(diffMs / 60000);

  if (Math.abs(diffMinutes) < 1) {
    return 'just now';
  }

  if (Math.abs(diffMinutes) < 60) {
    return formatRelative(diffMinutes, 'minute');
  }

  const diffHours = Math.round(diffMinutes / 60);
  if (Math.abs(diffHours) < 24) {
    return formatRelative(diffHours, 'hour');
  }

  const diffDays = Math.round(diffHours / 24);
  return formatRelative(diffDays, 'day');
}

function formatRelative(value: number, unit: 'minute' | 'hour' | 'day') {
  try {
    if (typeof Intl !== 'undefined' && typeof Intl.RelativeTimeFormat === 'function') {
      return new Intl.RelativeTimeFormat(getFormatLocale(), { numeric: 'auto' }).format(value, unit);
    }
  } catch {
    // Fall back below.
  }

  if (value === 0) {
    return 'just now';
  }

  const absolute = Math.abs(value);
  const suffix = absolute === 1 ? unit : `${unit}s`;
  return value < 0 ? `${absolute} ${suffix} ago` : `in ${absolute} ${suffix}`;
}

export function getSessionSubtitle(session: Session) {
  const summary = session.summary;
  if (!summary) {
    return 'No file changes recorded yet';
  }

  return `${summary.files} files changed, +${summary.additions} / -${summary.deletions}`;
}

function getPrimaryText(parts: Part[]) {
  return parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join('\n\n');
}

export function getMessagePreview(record: SessionMessageRecord) {
  const primary = compactText(getPrimaryText(record.parts));
  if (primary) {
    return primary;
  }

  const completedTools = record.parts.filter(isCompletedToolPart);
  if (completedTools.length > 0) {
    return compactText(getToolTitle(completedTools[0]));
  }

  const error = getMessageError(record);
  if (error) {
    return error;
  }

  return record.info.role === 'user' ? 'Prompt sent' : 'Response ready';
}

export function getHistoryPreview(messages: SessionMessageRecord[]) {
  const latest = [...messages].reverse().find((record) => getMessagePreview(record));
  if (!latest) {
    return 'Start a new conversation';
  }

  return getMessagePreview(latest);
}

// OpenCode 2.x dropped the server-owned session todo endpoint. Its plan/task
// list is carried by the `todowrite` tool input instead, so derive it from the
// transcript. Messages arrive chronologically, so the last write wins.
const TODO_TOOL_NAMES = new Set(['todowrite', 'todo', 'todo_write']);

// A transcript window is paginated, so the provider accumulates only the
// records that can carry a plan instead of retaining every loaded message.
export function hasTodoWritePart(record: SessionMessageRecord) {
  return record.parts.some((part) => part.type === 'tool' && TODO_TOOL_NAMES.has(part.tool));
}

export function deriveTodosFromMessages(messages: SessionMessageRecord[]): Todo[] {
  let todos: Todo[] = [];

  for (const record of messages) {
    for (const part of record.parts) {
      if (part.type !== 'tool' || !TODO_TOOL_NAMES.has(part.tool)) {
        continue;
      }

      const input = part.state.input as Record<string, unknown> | undefined;
      const raw = input && typeof input === 'object' ? input.todos : undefined;
      if (!Array.isArray(raw)) {
        continue;
      }

      todos = raw.flatMap((item) => {
        if (!item || typeof item !== 'object') {
          return [];
        }
        const value = item as Record<string, unknown>;
        const content = typeof value.content === 'string' ? value.content : '';
        if (!content) {
          return [];
        }
        return [{
          content,
          status: typeof value.status === 'string' ? value.status : 'pending',
          priority: typeof value.priority === 'string' ? value.priority : 'medium',
        }];
      });
    }
  }

  return todos;
}

// Record equality covers BOTH parts and info. toTranscriptEntry reads
// record.info.error (via getMessageError) — if the server adds an error
// post-hoc without changing parts, ignoring info would silently drop the
// error banner AND poison the WeakMap cache. JSON.stringify is cheap here:
// info is small metadata (id/role/time/error) and the network/parse cost of
// the fetch has already been paid.
function sessionMessageRecordsEqual(prior: SessionMessageRecord, record: SessionMessageRecord) {
  return (
    prior === record ||
    (prior.parts.length === record.parts.length &&
      JSON.stringify(prior.parts) === JSON.stringify(record.parts) &&
      JSON.stringify(prior.info) === JSON.stringify(record.info))
  );
}

// Merge a freshly fetched *newest* page into the window already held in memory.
// New records are appended, records already present are replaced in place when
// their content changed, and record object references are preserved for
// unchanged messages. toTranscriptEntry below caches transcript entries in a
// WeakMap keyed by record reference, so unchanged records skip the heavy
// tokenization pass during streaming refreshes. The array reference is
// preserved when nothing changed, letting downstream useMemos skip.
export function mergeSessionMessageWindow(previous: SessionMessageRecord[], fetched: SessionMessageRecord[]): SessionMessageRecord[] {
  if (previous.length === 0) {
    return fetched;
  }
  if (fetched.length === 0) {
    return previous;
  }

  const previousIndexById = new Map<string, number>();
  for (let index = 0; index < previous.length; index += 1) {
    previousIndexById.set(previous[index].info.id, index);
  }

  let merged: SessionMessageRecord[] | undefined;
  let appended = false;
  for (const record of fetched) {
    const index = previousIndexById.get(record.info.id);
    if (index === undefined) {
      // A new record is newer than everything already held (the fetch is the
      // newest page), so append it in fetched order.
      if (!merged) merged = previous.slice();
      merged.push(record);
      previousIndexById.set(record.info.id, merged.length - 1);
      appended = true;
      continue;
    }
    const prior = (merged ?? previous)[index];
    if (!sessionMessageRecordsEqual(prior, record)) {
      if (!merged) merged = previous.slice();
      merged[index] = record;
    }
  }

  return appended || merged ? merged! : previous;
}

// Prepend an *older* page fetched while scrolling up. Records already present
// are dropped (pages can overlap at the cursor), so the result stays a single
// deduped contiguous window with `previous` order preserved.
export function prependSessionMessageHistory(previous: SessionMessageRecord[], older: SessionMessageRecord[]): SessionMessageRecord[] {
  if (older.length === 0) {
    return previous;
  }

  const known = new Set(previous.map((record) => record.info.id));
  const additions = older.filter((record) => !known.has(record.info.id));
  if (additions.length === 0) {
    return previous;
  }

  return [...additions, ...previous];
}

const transcriptEntryCache = new WeakMap<SessionMessageRecord, TranscriptEntry>();

export function toTranscriptEntry(record: SessionMessageRecord): TranscriptEntry {
  const cached = transcriptEntryCache.get(record);
  if (cached) {
    return cached;
  }

  const textBlocks: string[] = [];
  const details: TranscriptDetail[] = [];

  record.parts.forEach((part, index) => {
    const id = `${record.info.id}-${index}`;

    if (part.type === 'text') {
      const text = part.text.trim();
      if (text) {
        textBlocks.push(text);
      }
      return;
    }

    if (part.type === 'reasoning') {
      const text = part.text.trim();
      if (text) {
        details.push({
          id,
          kind: 'reasoning',
          label: 'Reasoning',
          body: text,
        });
      }
      return;
    }

    if (part.type === 'tool') {
      details.push({
        id,
        kind: 'tool',
        label: getToolTitle(part),
        body: getToolBody(part),
        status: part.state.status,
      });
      if (part.state.status === 'completed') {
        part.state.attachments?.forEach((attachment, attachmentIndex) => {
          details.push({
            id: `${id}-attachment-${attachmentIndex}`,
            kind: 'file',
            label: attachment.filename || 'Tool attachment',
            body: attachment.mime || 'Attachment',
          });
        });
      }
      return;
    }

    if (part.type === 'patch') {
      details.push({
        id,
        kind: 'patch',
        label: `Patch ${part.files.length} files`,
        body: part.files.join('\n'),
      });
      return;
    }

    if (part.type === 'file') {
      details.push({
        id,
        kind: 'file',
        label: part.filename || 'File attachment',
        body: part.mime || 'Attachment',
      });
      return;
    }

    if (part.type === 'subtask') {
      details.push({
        id,
        kind: 'subtask',
        label: 'Subtask',
        body: part.description,
      });
      return;
    }

    if (part.type === 'step-start') {
      details.push({
        id,
        kind: 'step',
        label: 'Step started',
        body: part.snapshot || 'OpenCode started a new step.',
      });
      return;
    }

    if (part.type === 'step-finish') {
      details.push({
        id,
        kind: 'step',
        label: 'Step finished',
        body: `${part.reason}${part.snapshot ? `\n\n${part.snapshot}` : ''}`,
      });
      return;
    }

    if (part.type === 'agent') {
      details.push({
        id,
        kind: 'agent',
        label: 'Agent',
        body: part.name,
      });
      return;
    }

    if (part.type === 'retry') {
      details.push({
        id,
        kind: 'retry',
        label: `Retry ${part.attempt}`,
        body: 'data' in part.error && part.error.data && 'message' in part.error.data ? String(part.error.data.message) : 'Request failed',
      });
      return;
    }

    if (part.type === 'compaction') {
      details.push({
        id,
        kind: 'compaction',
        label: 'Context compaction',
        body: part.auto ? 'OpenCode compacted the session automatically.' : 'OpenCode compacted the session.',
      });
    }
  });

  const entry: TranscriptEntry = {
    id: record.info.id,
    role: record.info.role,
    createdAt: record.info.time.created,
    text: textBlocks.join('\n\n').trim(),
    details,
    error: getMessageError(record),
  };
  transcriptEntryCache.set(record, entry);
  return entry;
}
