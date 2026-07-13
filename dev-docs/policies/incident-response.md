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
   endpoint, or take the service offline if warranted.
4. **Eradicate.** Remove the root cause (patch, configuration fix, credential rotation).
5. **Recover.** Restore normal service and verify the fix; monitor for recurrence.
6. **Notify.** Where users are affected, notify them and, where applicable, Zoom, in line
   with Zoom Marketplace requirements and any legal obligations, without undue delay.
7. **Review.** Conduct a brief post-incident review: timeline, root cause, and concrete
   follow-up actions to prevent recurrence; feed actions back into the SSDLC.

## Secrets rotation
- **Zoom OAuth credentials** can be rotated safely at any time via the hosting platform's
  environment configuration — a standard containment step. The app persists no user data, so
  there is no stored-data encryption key to rotate.

## Records
Incident records and post-incident reviews are retained for future reference and policy
improvement.
