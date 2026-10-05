import type { OpencodeConnectionSettings, ScopedOpencodeClient } from './client';
import { buildV2Raw } from './v2/raw';
import { toError } from './v2/shared';

function wrapErrors(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(wrapErrors);
  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const target: Record<string, unknown> = {};
    Object.keys(source).forEach((key) => {
      const item = source[key];
      if (typeof item === 'function') {
        target[key] = (...args: unknown[]) => {
          try {
            const result = (item as (...inner: unknown[]) => unknown)(...args);
            if (result && typeof (result as Promise<unknown>).then === 'function') {
              return (result as Promise<unknown>).catch((error) => {
                throw toError(error);
              });
            }
            return result;
          } catch (error) {
            throw toError(error);
          }
        };
      } else {
        target[key] = wrapErrors(item);
      }
    });
    return target;
  }
  return value;
}

export function buildV2Client(settings: OpencodeConnectionSettings): ScopedOpencodeClient {
  const { client } = buildV2Raw(settings);
  return wrapErrors(client) as ScopedOpencodeClient;
}
