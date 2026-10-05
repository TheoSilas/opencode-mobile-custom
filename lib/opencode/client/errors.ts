import { normalizeServerUrl } from './url';

export function getConnectionErrorMessage(error: unknown, serverUrl: string) {
  const normalized = normalizeServerUrl(serverUrl);
  if (!normalized.valid) {
    return 'Enter a complete server URL, such as http://192.168.1.10:4096.';
  }

  if (!(error instanceof Error)) {
    return 'Something went wrong while talking to OpenCode.';
  }

  const normalizedUrl = normalized.displayUrl;
  const message = error.message || 'Something went wrong while talking to OpenCode.';
  const alreadyApiBase = /\/api$/i.test(normalizedUrl);
  const apiHint = alreadyApiBase
    ? ''
    : ` If this address serves a web UI, use its API base URL instead, usually ${normalizedUrl}/api.`;
  const versionHint = alreadyApiBase
    ? ' This app supports OpenCode 1.x and 2.x servers; verify the API base URL is correct.'
    : '';

  if (/unsupported.?content.?type|malformed.?response/i.test(message)) {
    return `The server at ${normalizedUrl} did not return an OpenCode API response.${apiHint}${versionHint}`;
  }

  if (/^UnexpectedStatus$/i.test(message)) {
    return `OpenCode endpoint not found at ${normalizedUrl}.${apiHint}${versionHint}`;
  }

  if (/text\/html/i.test(message) || /not supported by this version/i.test(message)) {
    return `The server at ${normalizedUrl} returned a web page instead of the OpenCode API.${apiHint}${versionHint}`;
  }

  if (/404|not found/i.test(message)) {
    return `OpenCode endpoint not found at ${normalizedUrl}.${apiHint}${versionHint}`;
  }

  if (/json/i.test(message) && /unexpected|parse|token/i.test(message)) {
    return `The server at ${normalizedUrl} did not return an OpenCode API response.${apiHint}${versionHint}`;
  }

  return message;
}

export function getConnectionError(serverUrl: string, error: unknown) {
  return getConnectionErrorMessage(error, serverUrl);
}

export function isContractMismatchError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }
  return /unsupported.?content.?type|unexpectedstatus|malformed.?response|text\/html|not supported by this version/i.test(error.message);
}
