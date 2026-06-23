# Security Policy

**Owner:** Transformative Leadership Lab LLC · **Applies to:** Meeting Cost Meter (Zoom App)
**Contact:** thomas+mcsupport@txl-lab.com · **Effective:** 1 June 2026 · **Review:** annually or on material change

> This policy describes controls actually in place for a small-team operation. It claims no
> SOC 2 / ISO 27001 certification and no third-party penetration testing.

## Purpose & scope
Defines how we protect the Meeting Cost Meter application, its hosted service, and the data
entrusted to it.

## Data classification
- **Presenter configuration** (names entered + per-person hourly opportunity-cost values,
  defaults): treated as confidential; encrypted at rest; retrievable only by the owning
  Zoom account. Never wages/salaries — we do not request or store pay data.
- **Zoom OAuth tokens / app context:** secret; used only to authenticate and operate;
  not exposed to other users.
- **Operational logs / client diagnostics:** low-to-moderate sensitivity; logged to the
  hosting platform via `/api/log`. Not separately redacted today, so they may include
  Zoom meeting context sent for troubleshooting; they exclude the encrypted rate-store
  contents and secrets. See `data-retention-and-protection.md`.

## Controls
- **Encryption in transit:** HTTPS/TLS enforced (HSTS).
- **Encryption at rest:** AES-256-GCM for stored presenter configuration; per-user key
  derived from a server secret + Zoom user id; plaintext never written to disk.
- **Secrets management:** all credentials are environment variables, injected per
  environment; never committed. A pre-commit secret-scanning hook blocks credential commits.
- **Access control:** the source repository (GitHub) and hosting (Railway) are accessed
  through individual accounts; account owners are expected to enable multi-factor
  authentication. `main` is a protected branch: changes merge only via reviewed pull request
  with all required status checks passing (see [SSDLC](ssdlc.md) § Merge control).
- **Secure headers:** CSP, `nosniff`, `Referrer-Policy`, and `no-store` on all responses.
- **Input validation:** stored configuration is strictly validated server-side before
  persistence (rejects malformed/oversized/negative input).
- **Automated testing & SAST:** see `ssdlc.md` (tests, CodeQL, Dependabot).

## Third parties / sub-processors
- **GitHub** — source control and CI (CodeQL, Dependabot).
- **Railway** — application hosting and the encrypted-storage volume.
- **Zoom** — the platform the app runs within (SDK, OAuth).

No other third-party data processors. No analytics, advertising, or tracking SDKs.

## Responsibilities
The application owner (Transformative Leadership Lab LLC) is responsible for maintaining
these controls, triaging reports sent to the contact above, and reviewing this policy on the
cadence stated in the header.

## Related documents
`ssdlc.md` · `vulnerability-management.md` · `data-retention-and-protection.md` ·
`incident-response.md` · `dependency-management.md` · public Privacy Policy
(https://thomasbcox.github.io/zoom-meeting-cost/privacy.html).
