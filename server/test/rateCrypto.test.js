import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as rateCrypto from '../src/store/rateCrypto.js';

// Helper: run fn with RATE_STORE_KEY set to `key`, then restore.
function withKey(key, fn) {
  const prev = process.env.RATE_STORE_KEY;
  if (key === undefined) delete process.env.RATE_STORE_KEY;
  else process.env.RATE_STORE_KEY = key;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.RATE_STORE_KEY;
    else process.env.RATE_STORE_KEY = prev;
  }
}

test('encrypt → decrypt round-trips for the same uid + key', () => {
  withKey('test-master-key-not-real', () => {
    const blob = rateCrypto.encrypt('user-123', 'hello rates');
    assert.equal(rateCrypto.decrypt('user-123', blob), 'hello rates');
    // The envelope carries no plaintext.
    assert.ok(!JSON.stringify(blob).includes('hello rates'));
  });
});

test('a different uid cannot decrypt (per-user keys)', () => {
  withKey('test-master-key-not-real', () => {
    const blob = rateCrypto.encrypt('user-123', 'secret');
    assert.throws(() => rateCrypto.decrypt('user-999', blob));
  });
});

test('a different RATE_STORE_KEY cannot decrypt', () => {
  const blob = withKey('key-A', () => rateCrypto.encrypt('u', 'secret'));
  withKey('key-B', () => {
    assert.throws(() => rateCrypto.decrypt('u', blob));
  });
});

test('a tampered tag/ciphertext is rejected (GCM auth)', () => {
  withKey('test-master-key-not-real', () => {
    const blob = rateCrypto.encrypt('u', 'secret');
    const tampered = { ...blob, ct: Buffer.from('garbage').toString('base64') };
    assert.throws(() => rateCrypto.decrypt('u', tampered));
  });
});

test('fails closed when RATE_STORE_KEY is unset', () => {
  withKey(undefined, () => {
    assert.equal(rateCrypto.isConfigured(), false);
    assert.throws(() => rateCrypto.encrypt('u', 'x'), rateCrypto.RateCryptoUnconfigured);
  });
});

test('isConfigured reflects the env', () => {
  withKey('something', () => assert.equal(rateCrypto.isConfigured(), true));
});
