import { describe, expect, it } from 'vitest';

import { getAddableProviders, hasConfigurableAuth } from '@/components/settings/settings-utils';
import { parseProviderOAuthRedirect } from '@/lib/opencode/oauth';

describe('parseProviderOAuthRedirect', () => {
  it('reads a code from the query string', () => {
    expect(parseProviderOAuthRedirect('opencodemobile://oauth?code=abc123')).toEqual({ code: 'abc123' });
  });

  it('reads a code from the fragment', () => {
    expect(parseProviderOAuthRedirect('opencodemobile://oauth#code=xyz')).toEqual({ code: 'xyz' });
  });

  it('prefers error_description over error', () => {
    expect(parseProviderOAuthRedirect('https://x/cb?error=access_denied&error_description=Nope')).toEqual({ error: 'Nope' });
  });

  it('returns nothing for an unrelated redirect', () => {
    expect(parseProviderOAuthRedirect('opencodemobile://oauth')).toEqual({});
  });
});

describe('provider addability', () => {
  it('treats any auth method as configurable', () => {
    expect(hasConfigurableAuth('openai', [{ type: 'oauth', label: 'Sign in' }], 'v2')).toBe(true);
  });

  it('falls back to a generic API key only on V1', () => {
    expect(hasConfigurableAuth('openrouter', undefined, 'v1')).toBe(true);
    expect(hasConfigurableAuth('openrouter', undefined, 'v2')).toBe(false);
  });

  it('excludes configured providers and providers with no usable method', () => {
    const providers = [
      { id: 'openai', label: 'OpenAI', modelCount: 3, configured: false },
      { id: 'no-auth', label: 'No auth', modelCount: 0, configured: false },
      { id: 'done', label: 'Done', modelCount: 1, configured: true },
    ];
    const methods = { openai: [{ type: 'oauth' as const, label: 'Sign in' }] };

    expect(getAddableProviders(providers, methods, 'v2').map((provider) => provider.id)).toEqual(['openai']);
    expect(getAddableProviders(providers, methods, 'v1').map((provider) => provider.id)).toEqual(['openai', 'no-auth']);
  });
});
