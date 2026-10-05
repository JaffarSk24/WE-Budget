// Pure helpers of the Google sign-in, kept apart from Electron so tests can
// run them.

// The permission the whole sync depends on.
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';

// Google lets people untick single permissions on its consent page, and a
// token without Drive access is useless for sync. A token response without
// a scope list is taken at its word.
function grantsDrive(scope) {
  if (!scope) return true;
  return String(scope).split(/\s+/).includes(DRIVE_SCOPE);
}

// A Drive answer saying the token lacks the permission it needs.
function isInsufficientScope(status, body) {
  return status === 403 && /insufficient/i.test(String(body || ''));
}

// Whether the app should keep asking for a new sign-in. Sync counts as
// switched on while the device remembers a sync (signing out clears that)
// or when a dropped sign-in was recorded. Signed in, nothing is pending.
function pendingSignIn(state, loggedIn) {
  if (loggedIn) return null;
  const s = state || {};
  if (s.signInNeeded) return { reason: s.signInNeeded.reason || 'expired', email: s.signInNeeded.email || '' };
  if (s.lastSyncAt) return { reason: 'expired', email: '' };
  return null;
}

module.exports = { DRIVE_SCOPE, grantsDrive, isInsufficientScope, pendingSignIn };
