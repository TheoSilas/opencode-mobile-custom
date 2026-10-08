import { describe, expect, it } from 'vitest';

import { loadTs } from '../helpers/runtime.mjs';

async function hasPlayStoreRating(platform: string, foss: boolean) {
  const { hasPlayStoreRating } = await loadTs('lib/support.ts', {
    'expo-constants': { __esModule: true, default: { expoConfig: { extra: { foss } } } },
    'react-native': { Platform: { OS: platform } },
  });
  return hasPlayStoreRating();
}

describe('support store rating availability', () => {
  it.each([
    ['android', false, true],
    ['android', true, false],
    ['ios', false, false],
    ['web', false, false],
  ] as const)('%s (foss=%s) -> %s', async (platform, foss, expected) => {
    expect(await hasPlayStoreRating(platform, foss)).toBe(expected);
  });
});
