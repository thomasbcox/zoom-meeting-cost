# Data Retention & Protection Policy

**Owner:** Transformative Leadership Lab LLC · **Applies to:** Meeting Cost Meter (Zoom App)
**Contact:** thomas+mcsupport@txl-lab.com · **Effective:** 1 June 2026 · **Review:** annually or on material change

This policy complements the public Privacy Policy
(https://thomasbcox.github.io/zoom-meeting-cost/privacy.html) with operational detail.

## Data we hold
| Data | Sensitivity | Where | Encryption |
|---|---|---|---|
| Presenter configuration — names entered + per-person hourly **opportunity-cost** values, defaults | Confidential | Railway persistent volume, one file per user | AES-256-GCM at rest |
| Zoom OAuth tokens / app-context material | Secret | Server memory / environment | In transit (TLS); not persisted in plaintext |
| Operational logs (requests, errors) | Low | Hosting platform logs | In transit (TLS) |

We do **not** collect wages or salaries, audio/video/chat, or any HR/payroll/directory data.
The live on-camera cost total is aggregate-only and is computed in the Zoom client — it is
never sent to or stored by our server.

## Protection
- **At rest:** presenter configuration is AES-256-GCM encrypted with a per-user key derived
  from a server secret and the Zoom user id; plaintext is never written to disk. A leaked
  volume or backup is useless without the server key.
- **In transit:** HTTPS/TLS enforced (HSTS).
- **Access:** stored configuration is readable only by the owning Zoom account, gated by the
  verified Zoom App Context. It is never shown to other participants or users.
- **No sharing/sale:** data is not sold, shared with third parties, or used for advertising.

## Retention
- **Presenter configuration:** retained (encrypted) until the user deletes it or requests
  deletion. There is no automatic expiry, because it exists to restore the user's own setup.
- **Aggregate meeting totals:** not retained — they exist only during the active meeting,
  in-client.
- **Operational logs:** retained only as long as the hosting platform's standard log
  retention; scrubbed of secrets and per-person values.

## Deletion / data-subject requests
A user can remove the app from the Zoom Marketplace and email the contact above to have the
configuration stored for their account deleted. Deletion requests are honored promptly.

## Breach handling
Suspected exposure of stored data is handled per `incident-response.md`.
