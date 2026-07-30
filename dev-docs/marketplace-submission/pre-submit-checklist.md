# Meeting Cost Meter — pre-submit checklist

State of the Zoom Marketplace **Production** submission after a full dashboard walkthrough on
**2026-07-30**. The app is a **Draft**, marked *"Ready for submission"* by Zoom, with the **Publish**
step showing **Ready**.

App id: `NHKKtSnhTVaxWAQI3ZCbTg` · Production client id: `ajxPMkSFQE2kzj9qBrdo6Q`

---

## ⛔ Thomas must do these before hitting Submit

Uploads are listed first because Claude **cannot** perform them — the browser tool only accepts files
explicitly shared with a session, so it rejects both repo paths and scratch paths.

1. **Upload the app icon.** Click the Dark-mode icon on *App Listing → App Information*, choose
   **Change**, pick `docs/image-app-icon.png` (512×512), and tick **"Apply this app icon to light
   mode"** so one upload serves both slots. This replaces the current icon, which shows **"€ 789.40"**
   — a euro figure, while the app is hardcoded USD (`client/src/lib/cost.js`,
   `client/src/lib/overlayState.js`) and every other asset shows dollars.
2. **Re-upload the architecture diagram.** *Technical Design → Overview → Architecture Diagram*
   currently holds a **stale render**. Replace it with the regenerated
   `dev-docs/meeting-cost-architecture.png`. (See the Technical Design note below — this matters.)
3. **Swap the screenshots.** Upload `docs/MeetingCost_hero_1200x780.png`, then delete the two weak
   ones: the old unblurred-background hero (`Screenshot_2026-07-19_1200x780.png`) and the
   shrunk-panel shot (`MeetingCost_1200x780.png`). Target order: hero → cost overlay → estimate inputs.
3b. **Re-upload the cover image.** `docs/image-market-cover.png` was **regenerated 2026-07-30** to fix
   a collision: Zoom composites the app icon over the cover's left side (measured at roughly
   x=451..579 of 1824), which was covering the word "meeting" in the tagline. The text now starts at
   x=620 and the banner's own green `$` logomark was dropped, because the app icon Zoom overlays is
   that same mark. The old file is still live on the listing.
4. **Confirm the webhook token matches.** The Production **Secret Token** on *Features → Access* must
   equal `ZOOM_WEBHOOK_SECRET_TOKEN` in the Railway **production** environment. A 401 on an unsigned
   POST proves the endpoint is *armed*, not that the values *agree* — if they differ, every real
   deauthorization callback fails signature verification after publish. *(Thomas elected to verify
   this manually right before submitting.)*
5. **Check the six policy PDFs.** *Technical Design → Overview → Additional Documents* holds
   `data-retention-and-protection`, `dependency-management`, `incident-response`, `security-policy`,
   `vulnerability-management`, and `SECURITY`. The **markdown sources in `dev-docs/policies/` are all
   current**, but they were rewritten on **2026-07-13** during `remove-rate-store`, and no PDFs exist
   in the repo — so their vintage is unknown. **Any PDF generated before 2026-07-13 is stale** and will
   describe the deleted encrypted rate store.

## 🤔 Open decisions

- **The "regenerate the Authorization URL" banner** — Zoom has been showing this since a config change.
  Low stakes for an unpublished app (that URL is a testing convenience, not the install path once
  listed), but it leaves a warning banner sitting on the config page during review.

### Decided 2026-07-30

- **EU availability — stays OFF.** Thomas's call. EU users cannot add the app; turning it on would
  require publishing EU trader information (real business name, address, contact) under the Digital
  Services Act. Revisit only if EU demand justifies putting the business address on a public page.
- **The 7.1.0 client floor is now declared in the long description.** ✅ Added to the dashboard and
  recorded in [`listing-copy.md`](listing-copy.md). Necessary because the listing shows
  **"Desktop — 7.0.5 or later"** — computed automatically by Zoom from the selected SDK APIs, with
  **no editable field** — while the project's supported floor is **7.1.0** (`README.md`,
  `docs/support.html`, `reviews/min-client-version-warning.md`), chosen because `drawWebView` no-ops
  on 7.0.2 (ZSEE-195647). Without that sentence, 7.0.x users are told they're supported while the
  camera overlay silently never renders.

## ⚠️ The near-miss worth remembering

*Technical Design* described the **pre-pivot architecture** — the app as it existed before
`remove-rate-store` and `simple-only-panel`. The Technology Stack field claimed the SDK was used for
"participant counts", listed an `/api/rates` endpoint, described requests authenticated via a
"signed Zoom App Context header, decrypted server-side (AES-256-GCM)", and stated that
**"each presenter's config [is] saved as a per-user AES-256-GCM-encrypted JSON file on a persistent
volume."** The uploaded architecture diagram was worse — its legend read *"Individual config (**names**
+ opportunity-cost values) — encrypted, **stored on our server**."*

None of that is true. The app reads no participant list, has no `/api/rates`, and stores nothing.

This mattered because it **contradicted, inside the same submission**, the Scope description, the
Privacy Policy at the URL given to Zoom, and the listing's own "100% session-only: nothing is stored"
claim — a direct conflict about whether the app stores personal data.

**Fixed 2026-07-30:** the Technology Stack text was rewritten in the dashboard (verified persistent),
and the diagram PNG was re-rendered from the repo's already-correct SVG via headless Chrome at
3000×2100. **The diagram still needs uploading** (item 2 above).

**Lesson:** `dev-docs/meeting-cost-architecture.svg` was updated during the pivot but the exported
`.png` was not. Re-render the PNG whenever the SVG changes:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless --disable-gpu \
  --default-background-color=FFFFFF --window-size=3000,2100 \
  --screenshot=dev-docs/meeting-cost-architecture.png \
  "file://$PWD/dev-docs/meeting-cost-architecture.svg"
```

---

## ✅ Verified correct on 2026-07-30

**Live infrastructure**
- Production deploy healthy, running current `main`, `zoomConfigured: true`
- Deauthorization endpoint armed in production (401 on unsigned POST ⇒ secret token is set)
- All six GitHub Pages legal/support URLs return 200

**Basic Information (Production)** — OAuth redirect → production domain; Strict Mode on;
deauthorization endpoint URL set; developer contact correct; User-managed.
*Note:* the two greyed OAuth allow-list rows (including a **development** callback) are
**locked entries Zoom derives automatically** from each credential block's redirect URL. Not editable,
not a misconfiguration.

**Scopes** — `zoomapp:inmeeting` only, not marked Optional. Scope description **rewritten 2026-07-30**;
the exact submitted text lives in [`server/zoom-app-config.md`](../../server/zoom-app-config.md).

**Surface** — Home URL correct; domain allow list = production Railway host (with review
justification) + `appssdk.zoom.us`; Meetings only; RTMS auto-start off; Guest Mode off;
In-Client OAuth on; Mobile and Zoom Rooms off.

**Zoom App SDK capabilities — 11/11 exact match** with `ZOOM_CAPABILITIES` in
`client/src/zoom/zoomAdapter.js`, no gaps and no extras:
`getRunningContext`, `getUserContext`, `runRenderingContext`, `drawWebView`, `clearWebView`,
`closeRenderingContext`, `drawParticipant`, `getVideoState`, `postMessage` (9 APIs) +
`onMessage`, `onMyMediaChange` (2 events).

**Access** — Event Subscription off, Plugin SDK off (deauthorization uses its own dedicated endpoint
field, not the general event mechanism).

**App Listing** — name, company, short + long description all set (copy reconciled into
[`listing-copy.md`](listing-copy.md)); categories **Productivity + Analytics + Collaboration**
(added 2026-07-30, was 1 of 3 slots); all four legal/support URLs correct; data-subject-rights
checkbox ticked; discoverability = public.

**Technical Design → Security (3/3)** — TLS 1.2+ *Yes*; `x-zm-signature` webhook verification *Yes*;
collects/stores/logs/retains Zoom user data *No*. All three correct post-pivot.
*Context for #3 if a reviewer probes:* the app does write minimized, ephemeral diagnostics to
`/api/log` (error text, request path, user agent). That is not Zoom user data, and the Privacy Policy
and TDD both document the minimization.

**Monetization** — Plan 1 Free, no trial, support contact `thomas+mcsupport@txl-lab.com`.

**Unused and correctly empty** — Embed (all three SDKs off), Connect (no API spec — matches the
config doc's note that `connect`/`onConnect` is *not* the camera-mode mechanism), Custom Form
(0 fields), Actions and Triggers (none).

## Notes

- **The public Preview page is stale** and must not be used to verify edits. On 2026-07-30 it showed
  an older Overview, omitted the feature bullets, listed only one category, and displayed the company
  as **"Eudae LLC"** — while the Company Name field correctly holds *Transformative Leadership Lab
  LLC*. Re-check the published company name after going live.
- **The cover/logo collision is fixed in the repo** but the old file is still live — see item 3b.
  [`marketplace-cover.sh`](../marketing/marketplace-cover.sh) now documents the reserved left zone so
  the layout can't regress; it also carries the right-hand bound (the live-cost chip starts at
  x=1440, so text must end before ~1420).
- **Editing Slate rich-text fields: `Cmd+A` then `Right` does NOT collapse the selection.** Pressing
  Return next replaces the whole document. This wiped the long description on 2026-07-30; it was
  restored from the verbatim copy in [`listing-copy.md`](listing-copy.md), which is exactly why that
  file records the live text in full. To append, retype the whole field, and always re-read the value
  back after editing.
- The red **"apps joining meetings… OBF or ZAK tokens, or RTMS"** banner does not apply — that targets
  apps that *join* meetings as participants. This app runs embedded and never joins.
