import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { DRIVE_SCOPE, grantsDrive, isInsufficientScope, pendingSignIn } = require('../main/cloud-utils.cjs');

describe('Google sign-in helpers', () => {
  it('accepts a token only with the Drive permission', () => {
    expect(grantsDrive(`${DRIVE_SCOPE} https://www.googleapis.com/auth/userinfo.email`)).toBe(true);
    expect(grantsDrive('https://www.googleapis.com/auth/userinfo.email openid')).toBe(false);
    expect(grantsDrive(undefined)).toBe(true);
  });

  it('recognises a Drive answer about missing permissions', () => {
    expect(isInsufficientScope(403, '{"error":{"message":"Request had insufficient authentication scopes."}}')).toBe(true);
    expect(isInsufficientScope(403, 'The user has exceeded their Drive storage quota')).toBe(false);
    expect(isInsufficientScope(401, 'insufficient')).toBe(false);
  });

  it('keeps asking for a sign-in until the owner signs in or turns sync off', () => {
    // signed in: nothing pending
    expect(pendingSignIn({ signInNeeded: { reason: 'expired' }, lastSyncAt: '2026-10-05T15:00:00Z' }, true)).toBeNull();
    // a recorded drop, with its reason
    expect(pendingSignIn({ signInNeeded: { reason: 'drive_scope', email: 'a@example.com' } }, false))
      .toEqual({ reason: 'drive_scope', email: 'a@example.com' });
    // dropped by an older version that did not record it: the device still remembers a sync
    expect(pendingSignIn({ fileId: 'f', lastSyncAt: '2026-10-05T15:00:00Z' }, false)).toEqual({ reason: 'expired', email: '' });
    // never synced, or signed out by choice (signing out clears lastSyncAt)
    expect(pendingSignIn({}, false)).toBeNull();
    expect(pendingSignIn({ fileId: null, lastSyncAt: null }, false)).toBeNull();
    expect(pendingSignIn(null, false)).toBeNull();
  });
});
