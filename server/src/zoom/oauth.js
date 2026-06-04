// Zoom OAuth scaffolding.
//
// This is intentionally a thin, self-contained module that is NOT required for
// the local prototype to run. It exists so that flipping to a real Zoom App is
// a matter of filling in credentials (server/.env) and registering the redirect
// URL in the Zoom Marketplace — no architectural rework.
//
// Zoom Apps use the standard authorization-code OAuth flow. The in-client app
// is launched with a short-lived code that you exchange for an access token;
// you also verify requests using the `x-zoom-app-context` header (decrypted
// with your client secret) to learn the meeting/user context securely.
//
// Docs: https://developers.zoom.us/docs/zoom-apps/authentication/

import { createHash } from 'node:crypto';
import express from 'express';

const {
  ZOOM_CLIENT_ID,
  ZOOM_CLIENT_SECRET,
  ZOOM_REDIRECT_URI,
} = process.env;

export const zoomConfigured = Boolean(
  ZOOM_CLIENT_ID && ZOOM_CLIENT_SECRET && ZOOM_REDIRECT_URI
);

// Safe diagnostic for the `invalid_client` class of failures: it reveals whether
// the LIVE process holds the credential value we expect — catching hidden
// whitespace (len/trimmed mismatch) and stale/wrong values (sha mismatch)
// WITHOUT ever printing the secret. Compare the sha/len against the known-good
// values from the Zoom Marketplace.
export function fingerprint(value) {
  if (value == null) return 'MISSING';
  const sha = createHash('sha256').update(value).digest('hex').slice(0, 12);
  const ws = value !== value.trim() ? ' WHITESPACE!' : '';
  return `len=${value.length} sha=${sha}${ws}`;
}

export function zoomCredentialFingerprint() {
  return (
    `id[${fingerprint(ZOOM_CLIENT_ID)}] ` +
    `secret[${fingerprint(ZOOM_CLIENT_SECRET)}] ` +
    `redirect[${fingerprint(ZOOM_REDIRECT_URI)}]`
  );
}

export function createOAuthRouter() {
  const router = express.Router();

  // Step 1: send the user to Zoom's authorize screen.
  router.get('/install', (req, res) => {
    if (!zoomConfigured) {
      return res
        .status(501)
        .send('Zoom OAuth not configured. See server/.env.example.');
    }
    const url = new URL('https://zoom.us/oauth/authorize');
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', ZOOM_CLIENT_ID);
    url.searchParams.set('redirect_uri', ZOOM_REDIRECT_URI);
    res.redirect(url.toString());
  });

  // Step 2: Zoom redirects back here with ?code=...
  router.get('/callback', async (req, res) => {
    if (!zoomConfigured) {
      return res.status(501).send('Zoom OAuth not configured.');
    }
    const { code } = req.query;
    if (!code) return res.status(400).send('Missing authorization code.');

    try {
      const token = await exchangeCodeForToken(code);
      // In a real app: persist token keyed by Zoom user id, then deep-link the
      // user back into the in-client app. For the scaffold we just confirm.
      res.send(
        'Zoom authorization successful. You can close this window and open the app inside Zoom.'
      );
      // Avoid logging the token itself.
      void token;
    } catch (err) {
      res.status(500).send(`Token exchange failed: ${err.message}`);
    }
  });

  return router;
}

async function exchangeCodeForToken(code) {
  const basic = Buffer.from(
    `${ZOOM_CLIENT_ID}:${ZOOM_CLIENT_SECRET}`
  ).toString('base64');
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: ZOOM_REDIRECT_URI,
  });
  const resp = await fetch('https://zoom.us/oauth/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  if (!resp.ok) {
    throw new Error(`${resp.status} ${await resp.text()}`);
  }
  return resp.json();
}
