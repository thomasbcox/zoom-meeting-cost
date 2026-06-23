# Incident Management & Response Policy

**Owner:** Transformative Leadership Lab LLC · **Applies to:** Meeting Cost Meter (Zoom App)
**Contact:** thomas+mcsupport@txl-lab.com · **Effective:** 1 June 2026 · **Review:** annually or on material change

> Sized for a small-team operation. It describes the process we follow; it does not claim a
> 24/7 staffed security operations center.

## What counts as an incident
Any event that may compromise the confidentiality, integrity, or availability of the
Meeting Cost Meter service or its data — e.g., suspected exposure of stored configuration,
credential leakage, unauthorized access, a serious vulnerability under active exploitation,
or a significant outage.

## Roles
The application owner (Transformative Leadership Lab LLC) acts as incident lead and
coordinates any needed help. The reporting/coordination contact is the address above.

## Response steps
1. **Identify & record.** Capture what was observed, when, and the suspected scope; open a
   private tracking record.
2. **Triage.** Assign severity (see `vulnerability-management.md`) and decide on immediate
   action.
3. **Contain.** Limit impact — e.g., rotate compromised Zoom OAuth credentials, disable an
   endpoint, or take the service offline if warranted. (The rate-store key is a special
   case — see Secrets rotation below.)
4. **Eradicate.** Remove the root cause (patch, configuration fix, credential rotation).
5. **Recover.** Restore normal service and verify the fix; monitor for recurrence.
6. **Notify.** Where users are affected, notify them and, where applicable, Zoom, in line
   with Zoom Marketplace requirements and any legal obligations, without undue delay.
7. **Review.** Conduct a brief post-incident review: timeline, root cause, and concrete
   follow-up actions to prevent recurrence; feed actions back into the SSDLC.

## Secrets rotation
- **Zoom OAuth credentials** can be rotated safely at any time via the hosting platform's
  environment configuration — a standard containment step that does not affect stored data.
- **The rate-store encryption key (`RATE_STORE_KEY`) is different.** Every stored
  configuration is encrypted with a key derived from it, with no key versioning, so rotating
  it makes **all existing stored configurations unreadable** — users would have to re-enter
  their settings. Treat `RATE_STORE_KEY` rotation as a last resort (e.g. confirmed key
  compromise) and notify affected users. A safer path is a planned re-encryption migration
  that reads with the old key and writes with the new one.

## Records
Incident records and post-incident reviews are retained for future reference and policy
improvement.
