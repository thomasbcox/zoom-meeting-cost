// POST a JSON payload to the server's /api/log sink. Never throws — logging must
// never break the thing it is observing. Shared by the Zoom diagnostics probe
// and the client error reporter.

export async function postLog(payload) {
  try {
    await fetch('/api/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    /* server may be unreachable; non-fatal */
  }
}
