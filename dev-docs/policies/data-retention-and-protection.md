# Data Retention & Protection Policy

**Owner:** Transformative Leadership Lab LLC · **Applies to:** Meeting Cost Meter (Zoom App)
**Contact:** thomas+mcsupport@txl-lab.com · **Effective:** 25 June 2026 · **Review:** annually or on material change

This policy complements the public Privacy Policy
(https://thomasbcox.github.io/zoom-meeting-cost/privacy.html) with operational detail.

## Data we hold
| Data | Sensitivity | Where | Notes |
|---|---|---|---|
| Presenter configuration — attendee count + one hourly **opportunity-cost** estimate + display cadence | Confidential | **Browser session only — never sent to or stored by our server** | Not persisted server-side |
| Zoom OAuth tokens (install flow) | Secret | Server memory / environment | In transit (TLS); not persisted in plaintext |
| Operational logs + client diagnostics (via `/api/log`) | Low — minimized to exclude participant PII (data-shape + technical fields only) | Hosting platform logs | In transit (TLS) |

We do **not** collect wages or salaries, audio/video/chat, or any HR/payroll/directory data, and
we **do not persist presenter configuration** server-side — it is session-only. The live on-camera
cost total is aggregate-only and is computed in the Zoom client — it is never sent to or stored by
our server.

## Protection
- **At rest:** the app persists **no** presenter configuration server-side — there is nothing at
  rest to protect. Settings live only in the browser session.
- **In transit:** HTTPS/TLS enforced (HSTS).
- **Access:** presenter figures never leave the Zoom client and are never shown to other
  participants or users; the overlay pushes only aggregate display state.
- **No sharing/sale:** data is not sold, shared with third parties, or used for advertising.

## Retention
- **Presenter configuration:** not retained — it exists only in the browser session and is
  discarded when the meeting ends.
- **Aggregate meeting totals:** not retained — they exist only during the active meeting,
  in-client.
- **Operational logs:** the app logs runtime errors and client-reported diagnostics (via
  `/api/log`) to the hosting platform's logs. **Client diagnostics are minimized at the source
  so they exclude participant personal data:** the in-Zoom diagnostics probe transmits only the
  *shape* of Zoom SDK responses (field names, lengths, counts) — never participant names or
  other values — and error reports carry only error text plus a fixed set of technical fields
  (no arbitrary payloads; the request URL is reduced to its path). Logs do **not** include the
  presenter's opportunity-cost figures or any secrets. They follow the hosting platform's standard
  retention and are accessible only to the operator.

## Deletion / data-subject requests
The app stores no presenter configuration server-side, so there is nothing to delete for an
account. A user can remove the app from the Zoom Marketplace at any time; questions about data
can be sent to the contact above.

## Breach handling
Suspected exposure of stored data is handled per `incident-response.md`.
