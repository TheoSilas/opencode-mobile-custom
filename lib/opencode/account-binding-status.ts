export type AccountBindingReadStatus = 'confirmed' | 'unbound' | 'authentication-failed' | 'read-failed' | 'unsupported';

export function getAccountBindingCapability(connectionStatus: string, contract: 'v1' | 'v2'): boolean | undefined {
  if (connectionStatus !== 'connected') return undefined;
  return contract === 'v2';
}

/** Classify only explicit protocol evidence as unsupported; transport/auth failures stay unknown. */
export function classifyAccountBindingRead(status: number, hasCredentialField?: boolean): AccountBindingReadStatus {
  if (status === 401 || status === 403) return 'authentication-failed';
  // A missing session (404) is not proof that the server lacks the binding
  // capability. Only method-not-allowed is explicit protocol evidence here.
  if (status === 405 && hasCredentialField === undefined) return 'unsupported';
  if (status < 200 || status >= 300) return 'read-failed';
  // A successful session response without the optional field represents no
  // session-specific credential. It is not evidence that the protocol lacks it.
  if (hasCredentialField === undefined) return 'confirmed';
  return hasCredentialField ? 'confirmed' : 'unbound';
}

export function getAccountBindingRequestDiagnostic(message: string): string | undefined {
  const match = message.match(/\b(GET|PATCH) (\/api\/session\/[^:]+): HTTP (\d{3})\b/);
  return match ? `${match[1]} ${match[2]} · HTTP ${match[3]}` : undefined;
}
