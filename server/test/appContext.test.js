import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveUid, encryptAppContextForTest, AppContextError } from '../src/zoom/appContext.js';

const SECRET = 'zoom-client-secret-not-real';
const CLIENT_ID = 'client-abc';

// A valid, unexpired context payload (Zoom shape).
function ctx(overrides = {}) {
  return {
    iss: 'marketplace.zoom.us',
    aud: CLIENT_ID,
    uid: 'zoom-user-42',
    exp: Math.floor(Date.now() / 1000) + 600,
    typ: 'meeting',
    ...overrides,
  };
}

test('decrypts a valid context and returns the uid', () => {
  const blob = encryptAppContextForTest(ctx(), SECRET);
  assert.equal(resolveUid(blob, { clientId: CLIENT_ID, clientSecret: SECRET }), 'zoom-user-42');
});

test('rejects a context encrypted with a different client secret', () => {
  const blob = encryptAppContextForTest(ctx(), 'other-secret');
  assert.throws(
    () => resolveUid(blob, { clientId: CLIENT_ID, clientSecret: SECRET }),
    AppContextError
  );
});

test('rejects a wrong audience (different app)', () => {
  const blob = encryptAppContextForTest(ctx({ aud: 'some-other-app' }), SECRET);
  assert.throws(
    () => resolveUid(blob, { clientId: CLIENT_ID, clientSecret: SECRET }),
    /aud mismatch/
  );
});

test('rejects an expired context', () => {
  const blob = encryptAppContextForTest(ctx({ exp: Math.floor(Date.now() / 1000) - 1 }), SECRET);
  assert.throws(
    () => resolveUid(blob, { clientId: CLIENT_ID, clientSecret: SECRET }),
    /expired/
  );
});

test('rejects a bad issuer', () => {
  const blob = encryptAppContextForTest(ctx({ iss: 'evil.example.com' }), SECRET);
  assert.throws(() => resolveUid(blob, { clientId: CLIENT_ID, clientSecret: SECRET }), /iss/);
});

test('rejects garbage / missing context', () => {
  assert.throws(() => resolveUid('not-base64-context', { clientId: CLIENT_ID, clientSecret: SECRET }));
  assert.throws(() => resolveUid('', { clientId: CLIENT_ID, clientSecret: SECRET }), /missing/);
});

test('rejects a context with no uid', () => {
  const blob = encryptAppContextForTest(ctx({ uid: undefined }), SECRET);
  assert.throws(() => resolveUid(blob, { clientId: CLIENT_ID, clientSecret: SECRET }), /no uid/);
});
