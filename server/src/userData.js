// Single enumeration point for everything we store about a Zoom user (uid).
//
// Delete-my-data and export-my-data both iterate ONE adapter list, so a new per-user store is
// covered by both the moment it's added here — it can't silently escape the privacy paths. Each
// adapter knows how to remove and load that user's data; this module owns neither the storage nor
// the crypto. `rateStore` is the only adapter today; entitlements/subscriptions/summaries will be
// added as their own adapters as they arrive.

import * as rateStore from './store/rateStore.js';

const STORES = [
  { key: 'rates', remove: (uid) => rateStore.remove(uid), load: (uid) => rateStore.load(uid) },
];

// Delete every uid-scoped artifact. Idempotent (adapters no-op on missing data) and crypto-free
// where the adapter allows it (rateStore.remove needs no RATE_STORE_KEY). Returns the covered
// store keys so callers can log/confirm what was purged.
export async function purgeUser(uid) {
  for (const store of STORES) await store.remove(uid);
  return STORES.map((store) => store.key);
}

// Gather all uid-scoped data as { [key]: <data | null> } for a data-export request.
export async function exportUser(uid) {
  const out = {};
  for (const store of STORES) out[store.key] = await store.load(uid);
  return out;
}
