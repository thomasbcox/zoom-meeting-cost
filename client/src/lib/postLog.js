// POST a JSON payload to the server's /api/log sink. Never throws — logging must
// never break the thing it is observing. Shared by the Zoom diagnostics probe
// and the client error reporter.
//
// `keepalive` lets a caller opt into a delivery that survives the page being
// destroyed: an ordinary fetch is canceled when the webview unloads, so a
// teardown breadcrumb (pagehide) must set keepalive:true or it may never reach
// the server. Default false keeps the steady-state per-tick logs unchanged.

export async function postLog(payload, { keepalive = false } = {}) {
  try {
    await fetch('/api/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive,
    });
  } catch {
    /* server may be unreachable; non-fatal */
  }
}
