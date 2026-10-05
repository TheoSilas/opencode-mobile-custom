import type { SessionMessageRecord } from './types';

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
