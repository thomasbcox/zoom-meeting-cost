2026-06-11 07:20:40 PDT — Reviewed read-only. `git log main..HEAD` is one doc commit (`5ba1946`), and `git diff main...HEAD` only changes `docs/roadmap.md` plus new `docs/overlay-live-test-matrix.md`. No web used.

**Bottom Line**

The roadmap is directionally sound: de-risking the overlay first is the right call for a solo developer because it is the core product promise. But the docs are too confident in a few researched conclusions, and the test matrix has one concrete repo-state mismatch that weakens its diagnostic claims.

**Highest-Leverage Critiques**

1. The overlay test matrix is conceptually right, but one signal is wrong.
The matrix correctly catches both false readings: `drawWebView ok:true` can be blank, and local extrapolation can fake ticking. The pause/resume `overlay-message` probe is the right decisive test: [docs/overlay-live-test-matrix.md](/Users/thomasbcox/Projects/zoom-meeting-cost/docs/overlay-live-test-matrix.md:25).

But it claims `postMessage ok` logs happen “every send”: [docs/overlay-live-test-matrix.md](/Users/thomasbcox/Projects/zoom-meeting-cost/docs/overlay-live-test-matrix.md:48). Current code logs only the first successful send and every failure: [client/src/zoom/zoomAdapter.js](/Users/thomasbcox/Projects/zoom-meeting-cost/client/src/zoom/zoomAdapter.js:245), [client/src/zoom/zoomAdapter.js](/Users/thomasbcox/Projects/zoom-meeting-cost/client/src/zoom/zoomAdapter.js:480). That was intentional in `overlay-logging-quiet`: [reviews/overlay-logging-quiet.md](/Users/thomasbcox/Projects/zoom-meeting-cost/reviews/overlay-logging-quiet.md:27). Fix the matrix wording, or temporarily re-enable verbose send logs during the live matrix.

2. The docs conflict on whether live overlay updates were already proven.
The roadmap says live number-ticking was not explicitly confirmed: [docs/roadmap.md](/Users/thomasbcox/Projects/zoom-meeting-cost/docs/roadmap.md:75). But later overlay history says the channel was live-verified 1:1 and “no need for a server relay”: [reviews/overlay-payload-parse.md](/Users/thomasbcox/Projects/zoom-meeting-cost/reviews/overlay-payload-parse.md:11), and `overlay-logging-quiet` says the overlay worked end-to-end and was verified live: [reviews/overlay-logging-quiet.md](/Users/thomasbcox/Projects/zoom-meeting-cost/reviews/overlay-logging-quiet.md:11). The roadmap should distinguish “verified once on a prior build” from “not verified across current client matrix.”

3. `drawImage` fallback is plausible, not yet justified as an implementation plan.
The `drawWebView` regression evidence supports a live matrix and a fallback investigation: [docs/roadmap.md](/Users/thomasbcox/Projects/zoom-meeting-cost/docs/roadmap.md:34). But the fallback section assumes `drawImage` can redraw an animated, transparent meter at acceptable cadence and support the same sizing/z-order semantics: [docs/overlay-live-test-matrix.md](/Users/thomasbcox/Projects/zoom-meeting-cost/docs/overlay-live-test-matrix.md:141). Before committing, prove alpha, redraw cadence, clearing behavior, `drawImage` capability review requirements, and whether production can feature-detect failure. “API returns ok but pixels are blank” means runtime feature detection may be impossible without version gating.

4. The billing conclusion overreaches.
Ruling out Zoom-native monetization follows only if “global launch from day one” is a hard requirement. The roadmap treats US-only as disqualifying: [docs/roadmap.md](/Users/thomasbcox/Projects/zoom-meeting-cost/docs/roadmap.md:204). If the first paid users are US-only, Zoom-native billing might reduce checkout/linking/review friction. Similarly, “MoR is the right trade” is a good solo-dev default, but still a business assumption, not a proven conclusion: [docs/roadmap.md](/Users/thomasbcox/Projects/zoom-meeting-cost/docs/roadmap.md:210).

5. Privacy thinking is too presenter-centric.
The overlay aggregate-only invariant still looks sound, but the paid roadmap stores names, aliases, estimated rates, entitlements, and billing mappings. Harvesting attendee names into persistent rules turns meeting participant names into stored personal data, not just “presenter settings.” Delete/export for the presenter is necessary but not sufficient. Deauthorization also must delete all `uid`-scoped app data, not only `/api/rates`, once entitlements/subscriptions/history exist: [docs/roadmap.md](/Users/thomasbcox/Projects/zoom-meeting-cost/docs/roadmap.md:126), [docs/roadmap.md](/Users/thomasbcox/Projects/zoom-meeting-cost/docs/roadmap.md:326).

6. One repo doc still contradicts the new privacy model.
`server/zoom-app-config.md` calls itself authoritative for capabilities, but still says the private rate table stays in browser `localStorage` and is never sent anywhere: [server/zoom-app-config.md](/Users/thomasbcox/Projects/zoom-meeting-cost/server/zoom-app-config.md:74). That contradicts the roadmap, README, and server implementation. This matters for Marketplace/privacy review.

**Sequencing**

Overlay live matrix first is the right sequence. Phase 1 privacy/config/deauth next is also right. But Phase 6 is not really “iterate after MVP”; its deauth endpoint, privacy policy, minimal scopes, checkout allowlist, and surface config are pre-launch gates: [docs/roadmap.md](/Users/thomasbcox/Projects/zoom-meeting-cost/docs/roadmap.md:363). Split Phase 6 into “publishing gate” and “production hardening” so the roadmap cannot be read as launching before Marketplace requirements.

**Claims To Re-Verify Before Reliance**

Re-check these against primary sources before building around them:

- ZSEE-195647 current status, affected versions, and whether `drawImage` is still the recommended workaround.
- Whether Zoom-native monetization is still US-only and whether external billing is clearly allowed for Zoom Apps.
- Exact Zoom deauthorization/data-compliance payload, authentication, `uid` mapping, retention timing, and confirmation API.
- `openUrl` behavior for checkout, allowlist requirements, and whether hosted checkout/3DS policies changed.
- Paddle and Stripe Managed Payments webhook names, metadata propagation, MoR coverage, tax posture, and supported countries.
- Marketplace review requirements for camera/Layers apps, especially “Camera” surface or Meeting Component classification.