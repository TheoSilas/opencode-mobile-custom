import { describe, expect, it } from 'vitest';

import { classifyAccountBindingRead, getAccountBindingCapability, getAccountBindingMismatchDiagnostic, getAccountBindingRequestDiagnostic } from '@/lib/opencode/account-binding-status';

describe('chat account binding read status', () => {
  it('keeps authentication failures distinct from unsupported protocol', () => {
    expect(classifyAccountBindingRead(401)).toBe('authentication-failed');
    expect(classifyAccountBindingRead(403)).toBe('authentication-failed');
  });

  it('classifies other failed reads separately from a successful HTTP response', () => {
    expect(classifyAccountBindingRead(500)).toBe('read-failed');
    expect(classifyAccountBindingRead(200)).toBe('confirmed');
  });

  it('requires explicit unsupported evidence', () => {
    expect(classifyAccountBindingRead(404)).toBe('read-failed');
    expect(classifyAccountBindingRead(405)).toBe('unsupported');
    expect(classifyAccountBindingRead(200, false)).toBe('unbound');
    expect(classifyAccountBindingRead(200, true)).toBe('confirmed');
  });
});

describe('chat account binding request diagnostics', () => {
  it('retains only the request method, path and status, never request headers', () => {
    expect(getAccountBindingRequestDiagnostic('Could not read (GET /api/session/ses_abc: HTTP 401).'))
      .toBe('GET /api/session/ses_abc · HTTP 401');
    expect(getAccountBindingRequestDiagnostic('No account was confirmed')).toBeUndefined();
  });
  it('shows only masked IDs and PATCH/GET status for a rejected confirmation', () => {
    expect(getAccountBindingMismatchDiagnostic('OpenCode did not confirm the selected session account. PATCH /api/session/:id HTTP 204 requested …onal; GET /api/session/:id HTTP 200 returned omitted.'))
      .toBe('PATCH /api/session/:id HTTP 204 requested …onal; GET /api/session/:id HTTP 200 returned omitted');
    expect(getAccountBindingMismatchDiagnostic('OpenCode did not confirm; credentialID=cred_personal')).toBeUndefined();
  });
});

describe('chat account binding capability presentation', () => {
  it('keeps the initial or disconnected contract unknown instead of treating the V1 default as evidence', () => {
    expect(getAccountBindingCapability('idle', 'v1')).toBeUndefined();
    expect(getAccountBindingCapability('connecting', 'v1')).toBeUndefined();
    expect(getAccountBindingCapability('error', 'v1')).toBeUndefined();
  });

  it('reports unsupported only after a successful connection resolves V1', () => {
    expect(getAccountBindingCapability('connected', 'v1')).toBe(false);
    expect(getAccountBindingCapability('connected', 'v2')).toBe(true);
  });
});
