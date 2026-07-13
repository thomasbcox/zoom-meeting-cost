# Railway setup — step by step

A from-scratch guide to deploying **Meeting Cost** on [Railway](https://railway.com),
using a **two-environment (Development + Production)** layout that matches Zoom's two
credential sets.

Written for someone who has never used Railway. If you just want the variable
list, jump to [The variables](#the-variables).

---

## What you're building

Meeting Cost is one Node process (`npm start`) that serves the built client and a
small API. Railway runs that process from this GitHub repo and gives it a public
HTTPS URL. You'll set some **environment variables** (credentials + config) so the
deployed app talks to Zoom.

Because a Zoom Marketplace app has **two separate credential sets — Development and
Production** — the clean setup is **two Railway environments**, each holding one set.
You can start with just Production and add Development later.

### Two concepts you need

| Concept | What it means here |
|---|---|
| **Variable** | A key/value the app reads from the environment (e.g. `ZOOM_CLIENT_ID`). Most are read at **runtime**; one (`VITE_USE_ZOOM`) is read at **build time** (see the warning below). |
| **Environment** | An isolated copy of the deployment with its own variables and domain. We use one for Production and one for Development. |

> ⚠️ **`VITE_USE_ZOOM` is special — it's baked in at *build* time.** Vite inlines it
> into the client bundle during `npm run build`. So after you add or change it you must
> trigger a **new build/redeploy** (not just a restart) for it to take effect.

---

## The variables

Set these on the Railway **service** (per environment). Source of truth for the app's
reading of them: `server/.env.example`, `server/src/zoom/oauth.js`.

| Variable | Required? | Runtime / Build | What it is |
|---|---|---|---|
| `ZOOM_CLIENT_ID` | yes | runtime | The Zoom app's client id **for this environment's credential set** (Dev id for the dev env, Prod id for the prod env). |
| `ZOOM_CLIENT_SECRET` | yes | runtime | The **matching** client secret from the **same** Dev/Prod block. Used for the OAuth token exchange. |
| `ZOOM_REDIRECT_URI` | yes | runtime | `https://<this-env-domain>/auth/callback` — must equal the redirect URL set on the matching Zoom credential block. |
| `VITE_USE_ZOOM` | yes (`1`) | **build** | Makes the client bundle use the **real** Zoom SDK. Without it the deployed app silently runs in mock mode. **Changing it requires a rebuild.** |
| `PORT` | **do NOT set** | — | Railway injects it; the server reads it automatically. Setting it yourself can break the health check. |

---

## Part A — Create the project and first deploy

1. Sign in at <https://railway.com> (GitHub login is easiest — it grants repo access).
2. **New Project → Deploy from GitHub repo →** pick `zoom-meeting-cost`.
3. Railway reads `railway.json` automatically: it uses the **Railpack** builder, builds
   with `npm run build`, starts with `npm start`, and health-checks `GET /api/health`.
4. The first deploy will build but **stay unhealthy until you set the variables** — that's
   expected. Continue to Part B.

---

## Part B — Set the variables

1. Click the **service** → **Variables** tab.
2. Add each variable from [The variables](#the-variables). For this first environment use
   your **Production** Zoom credential set (or Development if you're testing first — see
   Part D for running both).
3. Leave `ZOOM_REDIRECT_URI` for a moment — you need the public URL first (Part C), then
   come back and set it.
4. After adding `VITE_USE_ZOOM=1`, make sure a **new build** runs (Railway usually
   redeploys on variable change; if not, trigger a redeploy).

---

## Part C — Get the public URL and wire up Zoom

1. **Service → Settings → Networking → Generate Domain.** Railway gives you a
   `https://<name>.up.railway.app` URL (or attach a custom domain).
2. Back in **Variables**, set `ZOOM_REDIRECT_URI = https://<that-domain>/auth/callback`
   and redeploy.
3. In the **Zoom Marketplace** app (the credential block matching this environment — see
   `server/zoom-app-config.md`), set:
   - **Home URL:** `https://<that-domain>/`
   - **OAuth Redirect URL:** `https://<that-domain>/auth/callback`
   - **OAuth allow list** + **Domain allow list:** `<that-domain>` (plus `appssdk.zoom.us`)
   - **Zoom App SDK capabilities:** the full list in `server/zoom-app-config.md`
   - **Activate** the app.

---

## Part D — Add the Development environment (run both at once)

A Zoom app's **Development** and **Production** credential blocks have different ids and
secrets, and **Local Test → Add only works with the Development set**. To keep both
working, run a second Railway environment so each credential set has a matching deployment.

1. In Railway, use the **Environments** selector (top of the project) → **New
   Environment** (e.g. `development`). It duplicates the service with **separate
   variables and domain**. *(Alternatively, create a second service from the
   same repo.)*
2. In the **development** environment set:
   - `ZOOM_CLIENT_ID` / `ZOOM_CLIENT_SECRET` = the **Development** credential pair
   - `ZOOM_REDIRECT_URI` = `https://<dev-domain>/auth/callback`
   - `VITE_USE_ZOOM=1`
3. Map the Zoom app's **Development** credential block's Home URL / redirect / allow lists
   to the **dev** domain (Part C, dev side).
4. Install via **Marketplace → Manage → your app → Local Test → Add** (uses the
   Development set). Then quit and reopen the Zoom **desktop** client → **Apps**.

Result: `Local Test → Add` exercises the dev deployment (dev creds); the
published/production install exercises the prod deployment. No credential mixing, no
`invalid_client`.

---

## Part E — Verify it's wired correctly

From any terminal (replace the host with your environment's domain):

```bash
# 1) App up + all three Zoom vars present?
curl -s https://<domain>/api/health
#   → {"ok":true,"zoomConfigured":true}

# 2) Which client_id is this deployment actually using?
curl -s -o /dev/null -w '%{redirect_url}\n' https://<domain>/auth/install
#   → the Location should carry the client_id you expect for THIS env (Dev vs Prod)
```

In the Zoom **desktop** client: **Apps** → your app should be listed (restart the client
if it isn't). In a meeting, the **Apps** button opens it.

---

## Troubleshooting (the failures we actually hit)

| Symptom | Cause | Fix |
|---|---|---|
| Token exchange `400 invalid_client` | The deployment's `ZOOM_CLIENT_ID`/`SECRET` don't match the app that issued the code — often **Dev id with Prod secret** (or vice versa). | Use a **matching pair from one block**; verify with probe #2. |
| App **not in the Zoom apps list** (unpublished) | Completing OAuth (`/auth/install` "success" page) does **not** install it. | Install via **Local Test → Add** (Development set); confirm app is **Activated**, you're a **test user**, and restart the desktop client. |
| Blank white screen in Zoom | Missing OWASP headers, or a build **without `VITE_USE_ZOOM=1`** (mock mode). | Headers are already set in `server/src/app.js`; ensure `VITE_USE_ZOOM=1` and **rebuild**. |
| Health check fails / port errors | `PORT` was set manually. | Remove `PORT`; Railway injects it. |

See `server/zoom-app-config.md` for the Marketplace-side configuration (scopes,
capabilities, the Dev/Prod credential blocks) this guide refers to.
