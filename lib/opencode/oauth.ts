export type ProviderOAuthRedirect = {
  code?: string;
  error?: string;
};

// OAuth providers return the authorization code or an error in either the query
// string or the fragment. This reads both without assuming which the server used.
export function parseProviderOAuthRedirect(url: string): ProviderOAuthRedirect {
  const result: ProviderOAuthRedirect = {};

  const read = (params: URLSearchParams) => {
    const code = params.get('code');
    const error = params.get('error_description') || params.get('error');
    if (code && !result.code) result.code = code;
    if (error && !result.error) result.error = error;
  };

  try {
    const parsed = new URL(url);
    read(parsed.searchParams);
    if (parsed.hash) read(new URLSearchParams(parsed.hash.replace(/^#/, '')));
  } catch {
    const hashIndex = url.indexOf('#');
    const queryIndex = url.indexOf('?');
    if (queryIndex >= 0) read(new URLSearchParams(url.slice(queryIndex + 1, hashIndex >= 0 ? hashIndex : undefined)));
    if (hashIndex >= 0) read(new URLSearchParams(url.slice(hashIndex + 1)));
  }

  return result;
}
