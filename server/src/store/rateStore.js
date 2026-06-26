import { promises as fs } from 'node:fs';
import path from 'node:path';

import * as rateCrypto from './rateCrypto.js';

// Per-presenter rate config persisted to a Railway volume, ENCRYPTED at rest. One JSON
// file per uid under DATA_DIR (default /data); the file holds ONLY the rateCrypto
// envelope (ciphertext) — plaintext never touches disk.
//
// NOTE: every `rate` here is an hourly OPPORTUNITY COST (value of best alternative work),
// never pay. See dev-docs/opportunity-cost-rate.md. Field/identifier names are unchanged.
//
// The server is a dumb, size-bounded blob store: it persists the presenter's config
// object verbatim (the CLIENT owns the schema + defaults and merges on load), so adding
// client config fields never needs a server change. Reads are defensive: missing /
// corrupt / undecryptable → null (the caller falls back to client defaults), never throws.

function dataDir() {
  return process.env.DATA_DIR || '/data';
}

// Map a uid → a safe filename. base64url-encode the uid so it can never contain path
// separators / traversal sequences and can't escape DATA_DIR.
function fileFor(uid) {
  const safe = Buffer.from(String(uid), 'utf8').toString('base64url');
  return path.join(dataDir(), `rates-${safe}.json`);
}

// A plain JSON object (not array/null) or null. Guards stored + incoming data.
export function asConfigObject(cfg) {
  return cfg && typeof cfg === 'object' && !Array.isArray(cfg) ? cfg : null;
}

const numNonNeg = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const strOrNull = (v) => v == null || typeof v === 'string';

// Validate an incoming rate config before it is persisted. Returns the config on success,
// or null if anything is malformed (the endpoint then 400s). Strict: rateTable/aliases
// must be arrays of well-formed rows; every present numeric field must be a finite,
// non-negative NUMBER (rejects strings / NaN / negatives); costModel, if present, must be
// a known value. (Don't trust the client — this is the only writer of the stored data.)
export function validateConfig(cfg) {
  const c = asConfigObject(cfg);
  if (!c) return null;

  if (!Array.isArray(c.rateTable) || !Array.isArray(c.aliases)) return null;
  for (const r of c.rateTable) {
    if (!r || typeof r !== 'object' || Array.isArray(r)) return null;
    if (typeof r.name !== 'string' || !strOrNull(r.id) || !numNonNeg(r.rate)) return null;
  }
  for (const a of c.aliases) {
    if (!a || typeof a !== 'object' || Array.isArray(a)) return null;
    if (typeof a.alias !== 'string' || typeof a.canonical !== 'string' || !strOrNull(a.id)) return null;
  }

  // Settings: required numbers must be valid; the simple-model fields are optional.
  if (!numNonNeg(c.defaultRate)) return null;
  if (c.costModel != null && c.costModel !== 'simple' && c.costModel !== 'perParticipant') return null;
  if (c.simpleAverageRate != null && !numNonNeg(c.simpleAverageRate)) return null;
  if (c.simpleUserCount != null && !numNonNeg(c.simpleUserCount)) return null;
  // multiplier / simpleMultiplier are REMOVED fields (the loaded-cost multiplier was
  // dropped — see reviews/remove-cost-multiplier.md). New clients omit them; tolerate a
  // legacy blob that still carries them (the client ignores them in cost math), but if
  // present they must still be well-formed so a malformed legacy value is rejected.
  if (c.multiplier != null && !numNonNeg(c.multiplier)) return null;
  if (c.simpleMultiplier != null && !numNonNeg(c.simpleMultiplier)) return null;

  return c;
}

// Returns the stored config object, or null if there's nothing usable for this uid.
export async function load(uid) {
  try {
    const raw = await fs.readFile(fileFor(uid), 'utf8');
    const plaintext = rateCrypto.decrypt(uid, JSON.parse(raw));
    return asConfigObject(JSON.parse(plaintext));
  } catch {
    return null;
  }
}

// Persist the config object for uid (encrypted). Returns the stored object, or null if
// the input wasn't a plain object (the caller should 400).
export async function save(uid, config) {
  const cfg = asConfigObject(config);
  if (!cfg) return null;
  const envelope = rateCrypto.encrypt(uid, JSON.stringify(cfg));
  await fs.mkdir(dataDir(), { recursive: true });
  await fs.writeFile(fileFor(uid), JSON.stringify(envelope), 'utf8');
  return cfg;
}

// Delete this uid's stored config. Idempotent: a missing file is NOT an error (force), and no
// decryption is needed — so deletion works even when RATE_STORE_KEY is absent. This is the
// rateStore adapter's contribution to the uid-scoped "purge everything" registry (userData.js).
export async function remove(uid) {
  await fs.rm(fileFor(uid), { force: true });
}
