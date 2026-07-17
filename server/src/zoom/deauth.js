// Zoom deauthorization webhook.
//
// A PUBLISHED Zoom app MUST expose this endpoint (Marketplace publishing gate, BACKLOG.md →
// OPS-3). Zoom: "All apps made available to end users must provide the proper ability for users
// to remove or deauthorize the app and receive deauthorization notifications from Zoom."
// (https://developers.zoom.us/docs/integrations/end-user-auth/)
//
// NO COMPLIANCE CALLBACK — deliberately. Zoom's Data Compliance API (POST /oauth/data/compliance)
// is DEPRECATED: "our Data Compliance endpoint is now deprecated. This means that it is no longer
// required to call this endpoint" (Zoom staff, devforum.zoom.us/t/data-compliance-api-deprecated/51768).
// It is slated to become inoperative, and the Marketplace submission/review process no longer
// includes it. The whole contract is therefore: verify the signed event, delete the user's data,
// acknowledge 200. (An earlier draft of this file built the callback — see the approach review in
// reviews/deauth-endpoint.md. Don't re-add it.)
//
// THE PURGE IS A NO-OP, BY DESIGN. This app persists NO per-user data: the attendee count, hourly
// rate, and display cadence are browser-session-only (the encrypted rate store was deleted in
// `remove-rate-store`). There is no record keyed by Zoom user id to delete — so verification is
// the only real work here. If persistence is ever re-introduced, the delete hook belongs right
// where the no-op comment sits below.
//
// Signature docs: https://developers.zoom.us/docs/api/webhooks/

import { createHmac, timingSafeEqual } from 'node:crypto';
import express from 'express';
import { rateLimit } from 'express-rate-limit';

// Reject signed requests whose timestamp is more than this far from now, in EITHER
// direction — a stale replay and a future-dated one are both refused.
const REPLAY_WINDOW_SECONDS = 300;

// The only signature shape Zoom sends: `v0=` + hex sha256. Checked BEFORE any compare so a
// hostile header can never reach timingSafeEqual with a mismatched length (which throws).
const SIGNATURE_SHAPE = /^v0=[0-9a-f]{64}$/;

// DoS guard on this public, pre-auth endpoint: bound how often the (cheap but non-zero) verify
// path can run. Zoom sends deauthorization events infrequently and `url_validation` just once on
// save, so this ceiling sits far above any legitimate cadence. Applied to the whole route, so
// even signature-rejected floods are capped. Overridable via the `rateLimitOptions` dep (tests).
const DEFAULT_RATE_LIMIT = { windowMs: 60_000, limit: 60 };

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

/**
 * Dependencies are injectable so tests get a deterministic clock without mutating globals or
 * busting the module cache; production passes nothing and gets env + Date.now.
 */
export function createDeauthRouter({
  secretToken = process.env.ZOOM_WEBHOOK_SECRET_TOKEN,
  now = Date.now,
  rateLimitOptions,
} = {}) {
  const router = express.Router();

  const limiter = rateLimit({
    ...DEFAULT_RATE_LIMIT,
    ...rateLimitOptions,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    // A single constant key → ONE process-global bucket, independent of source IP. Zoom's webhook
    // source IPs are explicitly unstable (Zoom: "verify events instead of an IP allow list …
    // because Zoom may update the IP ranges at any time"), so per-IP keying is the wrong model;
    // this bounds total work on the endpoint. Signature verification stays the real authenticity
    // control. The constant key replaces the default IP key generator, so the IP/proxy validations
    // never run — no need to disable validation wholesale; the store/option-integrity checks stay on.
    keyGenerator: () => 'zoom-deauthorize',
  });

  // Route-local chain, mounted (in app.js) BEFORE the global JSON parser so the limiter is the
  // OUTERMOST gate: limiter → bounded raw-body capture → verify → dispatch. This way malformed or
  // oversized floods are counted/capped too (they don't get rejected by a parser that runs first),
  // and the exact signed bytes are `req.body` here — no global body-parser side-effect needed.
  router.post('/deauthorize', limiter, express.raw({ type: () => true, limit: '100kb' }), (req, res) => {
    // No secret token → we cannot verify anything. Inert, like the OAuth scaffold.
    if (!secretToken) return res.status(503).json({ error: 'not_configured' });

    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const ok = verifyZoomSignature({
      rawBody,
      signature: req.get('x-zm-signature'),
      timestamp: req.get('x-zm-request-timestamp'),
      secretToken,
      nowSeconds: Math.floor(now() / 1000),
    });
    if (!ok) return res.sendStatus(401);

    // Verified as genuinely from Zoom → parse the now-trusted JSON to dispatch. Zoom always sends
    // JSON, so a parse failure means a validly-signed but malformed body — a 400, not a crash.
    let event;
    try {
      event = JSON.parse(rawBody.toString('utf8'));
    } catch {
      return res.sendStatus(400);
    }

    if (event?.event === 'endpoint.url_validation') {
      return res.json(
        urlValidationResponse({ plainToken: event?.payload?.plainToken, secretToken })
      );
    }

    // Otherwise it's an event notification (`app_deauthorized`). --- PURGE GOES HERE ---
    // and is intentionally nothing: no per-user data is stored (see the module header). So
    // acknowledge and stop. No outbound call — the compliance API is deprecated.
    return res.sendStatus(200);
  });

  // Answer KNOWN body-parser request errors (e.g. an oversized body → 413 from express.raw) with
  // the bare status, quietly — so an oversized-body flood can't spew stack traces to stderr (the
  // limiter already bounded it, but the endpoint should stay quiet). These carry an exposed 4xx
  // status (the http-errors contract). Anything else — a genuine limiter/store or app fault — is
  // passed on to Express's default handler so it's still recorded, not silently masked as a 400.
  // eslint-disable-next-line no-unused-vars
  router.use((err, _req, res, next) => {
    const status = err?.status ?? err?.statusCode;
    if (err?.expose && status >= 400 && status < 500) return res.sendStatus(status);
    return next(err);
  });

  return router;
}
