import crypto from 'node:crypto';

// At-rest encryption for a presenter's rate config. AES-256-GCM with a per-user key
// derived from a dedicated server secret (RATE_STORE_KEY) salted by the Zoom uid, so a
// leaked volume/backup is useless without the env secret. The running server (operator)
// can still decrypt — true zero-knowledge would need a user passphrase, which this app
// has no durable place to anchor.
//
// RATE_STORE_KEY is intentionally SEPARATE from the Zoom client secret: rotating Zoom
// credentials (which has happened) must not make stored data undecryptable.

export class RateCryptoUnconfigured extends Error {
  constructor() {
    super('RATE_STORE_KEY is not set');
    this.name = 'RateCryptoUnconfigured';
  }
}

// Whether a key is configured. The store fails closed (503) when this is false.
export function isConfigured() {
  return Boolean(process.env.RATE_STORE_KEY);
}

// Per-user 32-byte AES key via HKDF-SHA256: master = RATE_STORE_KEY, salt = uid.
function deriveKey(uid) {
  const master = process.env.RATE_STORE_KEY;
  if (!master) throw new RateCryptoUnconfigured();
  return Buffer.from(
    crypto.hkdfSync(
      'sha256',
      Buffer.from(master, 'utf8'),
      Buffer.from(String(uid), 'utf8'), // salt — namespaces the key per presenter
      Buffer.from('meeting-cost:rate-store:v1'), // info — domain separation
      32
    )
  );
}

// Encrypt a UTF-8 string for `uid` → a JSON-safe envelope. Random 12-byte nonce per call.
export function encrypt(uid, plaintext) {
  const key = deriveKey(uid);
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
  const ct = Buffer.concat([cipher.update(Buffer.from(plaintext, 'utf8')), cipher.final()]);
  return {
    v: 1,
    nonce: nonce.toString('base64'),
    ct: ct.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  };
}

// Decrypt an envelope for `uid`. Throws on a wrong key/uid or tampering (GCM auth fail).
export function decrypt(uid, blob) {
  const key = deriveKey(uid);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(blob.nonce, 'base64'));
  decipher.setAuthTag(Buffer.from(blob.tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(blob.ct, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}
