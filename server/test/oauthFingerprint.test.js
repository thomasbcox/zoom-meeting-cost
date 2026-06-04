import { test } from 'node:test';
import assert from 'node:assert/strict';

// oauth.js captures the ZOOM_* env vars at module load, so set fixtures BEFORE
// importing it. The client_id and redirect URI are NOT secrets (both appear in
// the public authorize URL), so their real values double as the live-diagnostic
// reference. The client SECRET must never appear raw in source control, so we
// use a synthetic fixture value here. `node --test` runs each test file in its
// own process, so these assignments are isolated.
const REF_CLIENT_ID = '3zRuUUQfQdWlezkiWzdQCA';
const REF_REDIRECT = 'https://zoom-meeting-cost-production.up.railway.app/auth/callback';
const SYNTHETIC_SECRET = 'test-secret-not-a-real-credential';

process.env.ZOOM_CLIENT_ID = REF_CLIENT_ID;
process.env.ZOOM_CLIENT_SECRET = SYNTHETIC_SECRET;
process.env.ZOOM_REDIRECT_URI = REF_REDIRECT;

const { fingerprint, zoomCredentialFingerprint } = await import('../src/zoom/oauth.js');

// The fingerprint must never leak the raw credential — it only ever reveals
// length, a hash prefix, and a whitespace flag.

test('fingerprint reports length and a 12-char sha prefix, never the raw value', () => {
  const fp = fingerprint(SYNTHETIC_SECRET);
  assert.match(fp, /^len=\d+ sha=[0-9a-f]{12}$/);
  assert.ok(!fp.includes(SYNTHETIC_SECRET), 'fingerprint must not contain the raw value');
});

test('fingerprint matches independently-computed reference values', () => {
  // Computed via `printf %s "<value>" | shasum -a 256`. The id/redirect are the
  // real (non-secret) live values; the secret reference uses the synthetic
  // fixture. A live log differing from id/redirect means the running process
  // holds a different value than the Marketplace UI shows.
  assert.equal(fingerprint(REF_CLIENT_ID), 'len=22 sha=1c7b30d7e5c4');
  assert.equal(fingerprint(REF_REDIRECT), 'len=65 sha=b08787d46f0c');
  assert.equal(fingerprint(SYNTHETIC_SECRET), 'len=33 sha=015ea6d692ce');
});

test('fingerprint flags leading/trailing whitespace and leaves clean values unflagged', () => {
  assert.ok(fingerprint('abc\n').includes('WHITESPACE!'), 'trailing newline not flagged');
  assert.ok(fingerprint('  abc').includes('WHITESPACE!'), 'leading space not flagged');
  assert.ok(!fingerprint('abc').includes('WHITESPACE!'), 'clean value wrongly flagged');
});

test('fingerprint renders a missing credential as MISSING without throwing', () => {
  assert.equal(fingerprint(undefined), 'MISSING');
  assert.equal(fingerprint(null), 'MISSING');
});

test('zoomCredentialFingerprint composes all three labelled segments', () => {
  const line = zoomCredentialFingerprint();
  assert.match(
    line,
    /^id\[len=22 sha=1c7b30d7e5c4\] secret\[len=33 sha=015ea6d692ce\] redirect\[len=65 sha=b08787d46f0c\]$/
  );
  assert.ok(!line.includes(SYNTHETIC_SECRET), 'must not leak the secret value');
});
