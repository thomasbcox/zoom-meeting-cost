// Zoom deauthorization / data-compliance webhook.
//
// A PUBLISHED Zoom OAuth app MUST expose this endpoint (Marketplace publishing gate,
// BACKLOG.md → OPS-3). On uninstall Zoom POSTs an `app_deauthorized` event; we verify its
// HMAC signature, purge the user's data, and POST a confirmation to Zoom's
// /oauth/data/compliance within 10 days.
//
// THE PURGE IS A NO-OP, BY DESIGN. This app persists NO per-user data: the attendee count,
// hourly rate, and display cadence are browser-session-only (the encrypted rate store was
// deleted in `remove-rate-store`). There is no record keyed by Zoom user id to delete — so
// the compliance callback is the only action. If persistence is ever re-introduced, the
// delete hook belongs right here, before the callback.
//
// Docs: https://developers.zoom.us/docs/api/webhooks/ (signature)
//       https://developers.zoom.us/docs/api/rest/data-compliance/ (callback)

import { createHmac, timingSafeEqual } from 'node:crypto';
import express from 'express';

const COMPLIANCE_URL = 'https://api.zoom.us/oauth/data/compliance';

// Reject signed requests whose timestamp is more than this far from now, in EITHER
// direction — a stale replay and a future-dated one are both refused.
const REPLAY_WINDOW_SECONDS = 300;

// Zoom expects a webhook response within ~3 s and retries on failure, so the outbound
// callback must finish well inside that or we'd answer late AND get re-delivered.
const CALLBACK_TIMEOUT_MS = 2000;

// The only signature shape Zoom sends: `v0=` + hex sha256. Checked BEFORE any compare so a
// hostile header can never reach timingSafeEqual with a mismatched length (which throws).
const SIGNATURE_SHAPE = /^v0=[0-9a-f]{64}$/;

/** The signature Zoom should have sent for these bytes. `rawBody` stays a Buffer. */
export function zoomSignature({ rawBody, timestamp, secretToken }) {
  return (
    'v0=' +
    createHmac('sha256', secretToken)
      .update('v0:')
      .update(String(timestamp))
      .update(':')
      .update(rawBody)
      .digest('hex')
  );
}

/**
 * Is this a genuine, in-window Zoom webhook? A TOTAL, NON-THROWING predicate: every
 * malformed header, bad timestamp, or crypto error returns false (→ one 401 path), so a
 * hostile request can never surface as a 500.
 */
export function verifyZoomSignature({ rawBody, signature, timestamp, secretToken, nowSeconds }) {
  if (!secretToken) return false;
  if (typeof signature !== 'string' || !SIGNATURE_SHAPE.test(signature)) return false;
  // A decimal integer, nothing else ('12.5', '1e3', 'abc', '' all fail).
  if (typeof timestamp !== 'string' || !/^\d+$/.test(timestamp)) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || !Number.isFinite(nowSeconds)) return false;
  if (Math.abs(nowSeconds - ts) > REPLAY_WINDOW_SECONDS) return false;

  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.alloc(0);
  let expected;
  try {
    expected = zoomSignature({ rawBody: body, timestamp, secretToken });
  } catch {
    return false;
  }
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false; // belt-and-braces; the shape check already pins it
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/** Zoom's endpoint-URL handshake: echo the token plus its HMAC. */
export function urlValidationResponse({ plainToken, secretToken }) {
  return {
    plainToken,
    encryptedToken: createHmac('sha256', secretToken).update(String(plainToken)).digest('hex'),
  };
}

/** The confirmation Zoom requires once the (no-op) purge is done. */
export function complianceBody({ clientId, payload }) {
  return {
    client_id: clientId,
    user_id: payload?.user_id,
    account_id: payload?.account_id,
    deauthorization_event_received: payload,
    compliance_completed: true,
  };
}

/**
 * Dependencies are injectable so tests get a deterministic clock and a stub fetch without
 * mutating globals or busting the module cache; production passes nothing and gets env +
 * globalThis.fetch + Date.now.
 */
export function createDeauthRouter({
  secretToken = process.env.ZOOM_WEBHOOK_SECRET_TOKEN,
  clientId = process.env.ZOOM_CLIENT_ID,
  clientSecret = process.env.ZOOM_CLIENT_SECRET,
  fetchImpl,
  now = Date.now,
} = {}) {
  const router = express.Router();

  router.post('/deauthorize', async (req, res) => {
    // No secret token → we cannot verify anything. Inert, like the OAuth scaffold.
    if (!secretToken) return res.status(503).json({ error: 'not_configured' });

    const ok = verifyZoomSignature({
      // express.json's `verify` hook stashes the exact bytes Zoom signed (see app.js).
      rawBody: req.rawBody,
      signature: req.get('x-zm-signature'),
      timestamp: req.get('x-zm-request-timestamp'),
      secretToken,
      nowSeconds: Math.floor(now() / 1000),
    });
    if (!ok) return res.sendStatus(401);

    const event = req.body?.event;

    if (event === 'endpoint.url_validation') {
      // Needs only the secret token — answerable before OAuth creds are configured.
      return res.json(
        urlValidationResponse({ plainToken: req.body?.payload?.plainToken, secretToken })
      );
    }

    if (event === 'app_deauthorized') {
      // --- Purge: intentionally nothing. See the module header. -------------
      if (!clientId || !clientSecret) {
        // Refuse BEFORE the callback rather than sending `Basic undefined:undefined`.
        return res.status(503).json({ error: 'not_configured' });
      }
      const doFetch = fetchImpl ?? globalThis.fetch;
      const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
      try {
        const resp = await doFetch(COMPLIANCE_URL, {
          method: 'POST',
          headers: {
            Authorization: `Basic ${basic}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(complianceBody({ clientId, payload: req.body?.payload })),
          signal: AbortSignal.timeout(CALLBACK_TIMEOUT_MS),
        });
        if (!resp?.ok) {
          // Status only — never the body, which echoes our credentials back.
          console.error(`[deauth] compliance callback rejected: ${resp?.status}`);
          return res.sendStatus(500); // let Zoom retry the event
        }
        return res.sendStatus(200);
      } catch (err) {
        // Name only (AbortError on timeout) — an error body could carry secrets.
        console.error(`[deauth] compliance callback failed: ${err?.name || 'Error'}`);
        return res.sendStatus(500); // let Zoom retry the event
      }
    }

    // Signature-valid but not an event we act on: acknowledge so Zoom stops retrying.
    return res.sendStatus(200);
  });

  return router;
}
