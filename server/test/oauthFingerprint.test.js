import { test } from 'node:test';
import assert from 'node:assert/strict';

// oauth.js captures the ZOOM_* env vars at module load, so set the known-good
// Development credentials BEFORE importing it — that lets the composed
// `zoomCredentialFingerprint()` be asserted against the reference values.
// `node --test` runs each test file in its own process, so this is isolated.
process.env.ZOOM_CLIENT_ID = '3zRuUUQfQdWlezkiWzdQCA';
process.env.ZOOM_CLIENT_SECRET = 'I4ZYMLzbiTtci5m2BLSM1XVeVDk7Sg8v';
process.env.ZOOM_REDIRECT_URI =
  'https://zoom-meeting-cost-production.up.railway.app/auth/callback';

const { fingerprint, zoomCredentialFingerprint } = await import('../src/zoom/oauth.js');

// The fingerprint must never leak the raw credential — it only ever reveals
// length, a hash prefix, and a whitespace flag. These guard that contract plus
// the known-good reference values used to diagnose `invalid_client`.

test('fingerprint reports length and a 12-char sha prefix, never the raw value', () => {
  const secret = 'I4ZYMLzbiTtci5m2BLSM1XVeVDk7Sg8v';
  const fp = fingerprint(secret);
  assert.match(fp, /^len=\d+ sha=[0-9a-f]{12}$/);
  assert.ok(!fp.includes(secret), 'fingerprint must not contain the raw value');
});

test('fingerprint matches the independently-computed reference values', () => {
  // Reference computed via `printf %s "<value>" | shasum -a 256` over the exact
  // Zoom Marketplace (Development) credentials. A live log differing from these
  // means the running process holds a different value than the UI shows.
  assert.equal(fingerprint('3zRuUUQfQdWlezkiWzdQCA'), 'len=22 sha=1c7b30d7e5c4');
  assert.equal(
    fingerprint('I4ZYMLzbiTtci5m2BLSM1XVeVDk7Sg8v'),
    'len=32 sha=eaf5da8397e7'
  );
  assert.equal(
    fingerprint('https://zoom-meeting-cost-production.up.railway.app/auth/callback'),
    'len=65 sha=b08787d46f0c'
  );
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
    /^id\[len=22 sha=1c7b30d7e5c4\] secret\[len=32 sha=eaf5da8397e7\] redirect\[len=65 sha=b08787d46f0c\]$/
  );
  assert.ok(!line.includes('I4ZYMLzbiTtci5m2BLSM1XVeVDk7Sg8v'), 'must not leak secret');
});
