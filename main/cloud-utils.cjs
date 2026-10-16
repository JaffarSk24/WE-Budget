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

// The budget file in the Drive app folder. The encrypted one has a name of
// its own: versions 1.1.5 and older look only for the plain name, so they
// never read (and never write over) an encrypted budget.
const PLAIN_NAME = 'we-budget-data.json.gz';
const ENCRYPTED_NAME = 'we-budget-data.enc.gz';

// Which of the listed files (newest first) is the budget. An encrypted file
// wins over plain ones: a plain file next to it was written by an older
// version or before encryption was turned on, and is merged in as a spare
// copy. Same rule in src/web/cloud-web.js.
function pickMain(files) {
  const list = files || [];
  if (!list.length) return { exists: false };
  const main = list.find(f => f.name === ENCRYPTED_NAME) || list[0];
  return {
    exists: true,
    fileId: main.id,
    version: String(main.version),
    modifiedTime: main.modifiedTime,
    encrypted: main.name === ENCRYPTED_NAME,
    duplicates: list.filter(f => f !== main).map(f => f.id)
  };
}

module.exports = { DRIVE_SCOPE, grantsDrive, isInsufficientScope, pendingSignIn, PLAIN_NAME, ENCRYPTED_NAME, pickMain };
