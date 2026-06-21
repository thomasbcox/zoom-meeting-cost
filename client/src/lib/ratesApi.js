// Load/save the presenter's rate config to the server, authenticated by the Zoom app
// context. ("rate" = hourly opportunity cost, not pay; see dev-docs/opportunity-cost-rate.md.)
// The signed context blob (from the adapter) is sent in the `x-zoom-app-context`
// header; the server decrypts it → uid and reads/writes the encrypted store.
//
// Every call is BEST-EFFORT: a missing context (mock / not in Zoom), a 401/503, or a
// network error resolves to null / false so the app silently degrades to session-only
// state (no persistence that session) — never throwing into React.

async function authHeader(adapter) {
  try {
    const context = await adapter?.getAppContext?.();
    return context ? { 'x-zoom-app-context': context } : null;
  } catch {
    return null;
  }
}

// Returns the stored config object, or null if there's none / we can't authenticate.
export async function loadRates(adapter, { fetchImpl = fetch } = {}) {
  try {
    const headers = await authHeader(adapter);
    if (!headers) return null;
    const res = await fetchImpl('/api/rates', { headers });
    if (!res.ok) return null;
    return await res.json(); // config object, or null when the server has nothing stored
  } catch {
    return null;
  }
}

// Persists the config; resolves true on success, false otherwise (caller ignores failures).
export async function saveRates(adapter, config, { fetchImpl = fetch } = {}) {
  try {
    const headers = await authHeader(adapter);
    if (!headers) return false;
    const res = await fetchImpl('/api/rates', {
      method: 'PUT',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify(config),
    });
    return res.ok;
  } catch {
    return false;
  }
}
