import crypto from 'node:crypto';

// Decrypt + verify the Zoom App Context to resolve the presenter's stable Zoom user id
// (uid). The client sends the context blob (from getAppContext()) in the
// `x-zoom-app-context` request header; we decrypt it server-side with the Zoom client
// secret. `uid` is "the Zoom user id who opens the app" — stable per user, the key the
// rate store needs. No OAuth round-trip.
//
// Zoom's documented scheme: base64 → AES-256-GCM (no padding), key = SHA256(clientSecret);
// binary layout (little-endian lengths):
//   [ivLength:1][iv][aadLength:2][aad][cipherLength:4][cipherText][tag:16]
// Ref: https://developers.zoom.us/docs/zoom-apps/zoom-app-context/

export class AppContextError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AppContextError';
  }
}

function unpack(context) {
  let buf = Buffer.from(context, 'base64');
  const ivLength = buf.readUInt8(0);
  buf = buf.subarray(1);
  const iv = buf.subarray(0, ivLength);
  buf = buf.subarray(ivLength);
  const aadLength = buf.readUInt16LE(0);
  buf = buf.subarray(2);
  const aad = buf.subarray(0, aadLength);
  buf = buf.subarray(aadLength);
  const cipherLength = buf.readInt32LE(0);
  buf = buf.subarray(4);
  const cipherText = buf.subarray(0, cipherLength);
  const tag = buf.subarray(cipherLength);
  return { iv, aad, cipherText, tag };
}

// Decrypt the raw context string → the parsed payload object. Throws AppContextError.
export function decryptAppContext(context, clientSecret) {
  if (!context || typeof context !== 'string') throw new AppContextError('missing context');
  if (!clientSecret) throw new AppContextError('server not configured');
  try {
    const { iv, aad, cipherText, tag } = unpack(context);
    const key = crypto.createHash('sha256').update(clientSecret).digest();
    // authTagLength: 16 pins the GCM tag length so a truncated tag can't be accepted — Zoom's
    // app-context layout always carries a 16-byte trailing tag. (AUDIT-1 / semgrep gcm-no-tag-length.)
    const decipher = crypto
      .createDecipheriv('aes-256-gcm', key, iv, { authTagLength: 16 })
      .setAAD(aad)
      .setAuthTag(tag)
      .setAutoPadding(false);
    const json = Buffer.concat([decipher.update(cipherText), decipher.final()]).toString('utf8');
    return JSON.parse(json);
  } catch (err) {
    throw new AppContextError(`decrypt failed: ${err.message}`);
  }
}

// Decrypt, validate (iss, aud == our client id, exp not passed), and return the uid.
// `now` (ms) is injectable for tests. Throws AppContextError on any failure.
export function resolveUid(context, { clientId, clientSecret, now = Date.now() } = {}) {
  // Fail CLOSED: this gates private per-user data, so every check is mandatory.
  if (!clientId) throw new AppContextError('server not configured (no client id)');
  const p = decryptAppContext(context, clientSecret);
  if (p.iss !== 'marketplace.zoom.us') throw new AppContextError('unexpected iss');
  if (p.aud !== clientId) throw new AppContextError('aud mismatch'); // this app, not another
  // exp is epoch seconds; require it present + numeric + unexpired (no missing-exp bypass).
  if (!Number.isFinite(p.exp) || now / 1000 > p.exp) {
    throw new AppContextError('context expired or missing exp');
  }
  if (!p.uid || typeof p.uid !== 'string') throw new AppContextError('no uid in context');
  return p.uid;
}

// Inverse of unpack/decrypt — mints a valid encrypted context for TESTS (and never used
// in the request path), so identity can be unit-tested without the live Zoom client.
export function encryptAppContextForTest(
  payload,
  clientSecret,
  { iv = crypto.randomBytes(12), aad = Buffer.alloc(0) } = {}
) {
  const key = crypto.createHash('sha256').update(clientSecret).digest();
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv).setAAD(aad).setAutoPadding(false);
  const cipherText = Buffer.concat([
    cipher.update(Buffer.from(JSON.stringify(payload), 'utf8')),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  const ivLen = Buffer.from([iv.length]);
  const aadLen = Buffer.alloc(2);
  aadLen.writeUInt16LE(aad.length);
  const cipherLen = Buffer.alloc(4);
  cipherLen.writeInt32LE(cipherText.length);
  return Buffer.concat([ivLen, iv, aadLen, aad, cipherLen, cipherText, tag]).toString('base64');
}
