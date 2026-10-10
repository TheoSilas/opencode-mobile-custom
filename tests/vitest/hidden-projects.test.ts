import { describe, expect, it, vi } from 'vitest';

import { hiddenProjectsKey } from '@/lib/storage-keys';
import { parseHiddenProjectPaths } from '@/providers/use-hidden-projects';

vi.mock('@react-native-async-storage/async-storage', () => ({ default: {} }));

describe('app-only hidden workspaces', () => {
  it('isolates different server scopes, without embedding credentials in a key', () => {
    expect(hiddenProjectsKey('server-a')).not.toBe(hiddenProjectsKey('server-b'));
    expect(hiddenProjectsKey('server/a')).toContain('server%2Fa');
  });

  it('fails safe for malformed metadata and filters invalid directory paths', () => {
    expect(parseHiddenProjectPaths('{broken')).toEqual([]);
    expect(parseHiddenProjectPaths(JSON.stringify(['', 'relative', '/repo', '/repo', 7, '/work']))).toEqual(['/repo', '/work']);
    expect(parseHiddenProjectPaths(JSON.stringify({ path: '/repo' }))).toEqual([]);
  });
});
