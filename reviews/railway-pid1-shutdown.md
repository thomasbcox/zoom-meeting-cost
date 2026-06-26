Date: 2026-06-26 · Branch: claude/railway-pid1-shutdown · Status: approved

Approved 2026-06-26 by Thomas ("approved"): scope as written — `exec node` startCommand to
make node PID 1, keep the graceful handler, update the existing `health.test.js` contract with
exact equality, de-mislead the `shutdown.test.js` comment, and append (not rewrite) a
follow-up note to `reviews/graceful-shutdown.md`.

## Design decisions (2026-06-26)
- BLOCKER (existing Railway config test) → **fix**: update `health.test.js`'s `startCommand`
  assertion; no new test file.
- IMPORTANT (guard strength) → **fix**: assert exact equality to `exec node server/src/index.js`.

## Problem
Railway still fires false "Deploy Crashed!" emails on every container stop/redeploy,
**even though the [graceful-shutdown](graceful-shutdown.md) fix (merged 2026-06-25, commit
`0821512`) is live.** The crash log of the container that booted 2026-06-25T21:47Z and was
stopped 2026-06-26T05:46Z (by the next deploy) shows `npm error signal SIGTERM` and — the
tell — **no `[meeting-cost] received SIGTERM, shutting down` line.** The graceful handler
never ran.

**Root cause: PID-1 signal handling, not a code bug in the handler.** Production starts the
server with the *shell form* `startCommand: "npm start"`. Railway runs that as
`sh -c "npm start"`, so **PID 1 in the container is the shell/npm wrapper, not node**
(`npm start` → `npm --workspace server run start` → `node src/index.js`). When Railway sends
`SIGTERM` to PID 1 to stop the container, the wrapper does **not** forward it to node, so
node's `SIGTERM` handler is never reached; the platform then force-kills, and the process
exits non-zero → Railway reports a "crash."

The graceful-shutdown handler is **correct but inert**: it only fires if node itself receives
the signal. The prior story explicitly listed "No `railway.json` change" as a non-goal — that
non-goal was the actual gap. Its test also hid the problem: it does `spawn('node', [ENTRY])`,
so node receives the signal directly — a process tree that never exists on Railway. The test
went green while prod kept crashing.

**Reproduced in the real runtime** (this is why this fix is trusted where the last wasn't):
a Linux container (`node:22-slim`, npm 10.9.8 — Railway's runtime) stopped with `docker stop`
(SIGTERM to PID 1, exactly like Railway):

| Start command | PID 1 | Handler ran? | Exit code |
|---|---|---|---|
| `npm start` (shell form — current) | sh→npm→node | **NO** | **137** (force-killed → crash) |
| `exec node server/src/index.js` | **node** | **YES** | **0** (clean) |

The `handler ran? NO` row matches the production log's missing handler line exactly.

## In scope
1. **Make node PID 1.** Change `railway.json` `deploy.startCommand` from `npm start` to
   `exec node server/src/index.js`. The `exec` makes the shell replace itself with node, so
   node is PID 1 and receives `SIGTERM` directly. No npm in the runtime/signal path.
2. **Portable regression guard (update the existing contract test).** `server/test/health.test.js`
   already asserts `railway.json`'s `startCommand` (currently `=== 'npm start'`). Update that
   one canonical assertion to the new exact value `exec node server/src/index.js`, keeping its
   build/healthcheck assertions. Exact equality (not a starts-with-`exec`/excludes-`npm`
   heuristic) is the real invariant — it's the one command proven safe in the container repro,
   and it rejects any wrapper form that could reintroduce the PID-1 signal risk. This is a
   static contract check (deterministic, no Docker); a signal-timing test isn't suitable for
   the gate because only Linux PID-1 reproduces the bug (it passes on macOS even when broken).
   No new test file — that would duplicate the existing contract.
3. **De-mislead the existing handler test.** Update the comment in
   `server/test/shutdown.test.js` to state what it actually proves — the handler exits 0
   *when node receives the signal* — and that the new contract test guards the *delivery*
   half (node being PID 1 in prod). No behavior change to that test.
4. **Correct the record.** Append a brief "Follow-up" note to `reviews/graceful-shutdown.md`
   pointing here and noting that its "no `railway.json` change" non-goal was the gap.

## Non-goals
- No change to the graceful-shutdown handler in `server/src/index.js` — it is correct and
  becomes effective once node is PID 1. (Keeping it is required: without it, node-as-PID-1
  exits 143 on SIGTERM — still a crash.)
- No change to `railway.json` build/healthcheck/restart-policy — only `startCommand` changes.
- No Docker-based test in the gate (heavy, needs a daemon in CI). The container run is the
  one-time evidence above + an optional manual reproduction, not part of `npm test`.
- No change to routes, `createApp`, or any app logic.
- Authenticating the Railway CLI / pulling live logs is Thomas's post-deploy verification
  step, not a code change here.

## Acceptance criteria
1. **startCommand makes node PID 1.** `railway.json` `deploy.startCommand` is
   `exec node server/src/index.js` (begins with `exec`, runs `node` directly, contains no
   `npm`).
2. **Regression test updated and passes.** `server/test/health.test.js`'s railway-config test
   asserts `cfg.deploy.startCommand === 'exec node server/src/index.js'` (exact), with its
   build/healthcheck assertions intact. It fails if `startCommand` is reverted to `npm start`
   or any other form.
3. **Prod boot still works.** Built client present (`npm run build`) + `node server/src/index.js`
   from the repo root boots and `GET /api/health` returns `200 { ok: true }` (the path
   resolution `server/src` → `client/dist` and `.env`-absent boot are unchanged from today).
4. **Existing handler test still green** and its comment no longer claims to cover the prod
   signal path (it covers the handler given direct delivery).
5. **Record corrected.** `reviews/graceful-shutdown.md` has a dated follow-up note linking
   here.
6. **Scope containment.** `git diff --name-only main...HEAD` shows no files beyond:
   `railway.json`, `server/test/health.test.js` (startCommand assertion),
   `server/test/shutdown.test.js` (comment only), `reviews/graceful-shutdown.md` (note),
   and this story file.
7. **Gate green:** `npm test && npm run build`.

## Test notes
- AC1: read `railway.json`.
- AC2: `server/test/health.test.js` — update the existing `startCommand` assertion to exact
  equality with `exec node server/src/index.js`; build/healthcheck assertions unchanged.
- AC3: manual/local — `npm run build` then `node server/src/index.js` with a test `PORT`,
  curl `/api/health` → `200 {"ok":true,...}`. (Already verified once during diagnosis.)
- AC4: read the updated comment in `shutdown.test.js`; the two existing tests still pass.
- AC5/AC6: read the note; `git diff --name-only main...HEAD`.
- AC7: run the gate.
- **Production verification (post-merge, Thomas):** after the deploy, on the *next* redeploy
  watch the deploy log for `[meeting-cost] received SIGTERM, shutting down` and a clean stop
  (no `npm error signal SIGTERM`, no crash email). `railway login` then
  `railway logs` (CLI now installed, 5.23.1, currently unauthenticated). This is the real
  confirmation — the gate can only prove the contract, not Railway's signal delivery.

## Open questions
1. **Prior-story note vs rewrite.** I plan to *append* a follow-up note to
   `reviews/graceful-shutdown.md` (preserve history), not rewrite its non-goal. OK?

(Resolved after Codex design review: the regression guard updates the *existing*
`health.test.js` contract with an exact-equality assertion — no new test file, no Docker in
the gate. The one-time container reproduction stays as documented evidence only.)

## Codex design review (2026-06-26)
Verdict: the deployment fix itself is sound — `exec node server/src/index.js` matches the
reproduced PID-1 failure mode, fits the existing direct-Node entrypoint, and adds no
init/process-manager dependency. Two test-design findings (both **two-way**, both **accepted
→ fix**, folded into the spec above):

- **BLOCKER · nonstandard** — *Scope misses the existing Railway config test.*
  `server/test/health.test.js:35` already asserts `startCommand === 'npm start'`, so the change
  breaks the gate, and a new test file would duplicate it.
  *Alternative (taken):* update that existing assertion; don't add a new file.
  *Win:* gate passes, one canonical contract, no duplicate JSON-read code.
- **IMPORTANT · kludgy** — *Regression guard weaker than the PID-1 contract.* starts-with-`exec`/
  excludes-`npm` heuristics can pass for wrapper forms that reintroduce the risk.
  *Alternative (taken):* assert exact equality to `exec node server/src/index.js`.
  *Win:* one declarative invariant; rejects any non-proven shape.

## Design sketch — HOW
- **The fix is one line:** `railway.json` → `deploy.startCommand: "exec node server/src/index.js"`.
  Railpack/Railway invokes `startCommand` via `sh -c`; the `exec` makes `sh` replace itself
  with `node`, so node is PID 1 and receives `SIGTERM` directly. cwd is `/app`; `index.js`
  uses path-relative imports and `__dirname`-based `clientDist`, so running it directly is
  identical to today (verified during diagnosis).
- **Keep** the existing `SIGTERM`/`SIGINT` handler in `index.js` — it is now the load-bearing
  half (it produces the exit-0). No edit.
- **Regression guard** reuses the existing config-contract test in `server/test/health.test.js`
  (already `JSON.parse`s `railway.json`): change its `startCommand` assertion to exact equality
  with `exec node server/src/index.js`. One canonical contract, no duplicate test file. Chosen
  over a runtime signal test because the bug only manifests under Linux PID 1 — an exact
  config-contract assertion is the portable thing that catches a revert.
- **Comment-only** edit to `shutdown.test.js`; **append-only** note to the prior story.

## Build note (2026-06-26)
AC → file map:
- AC1 startCommand makes node PID 1 → `railway.json` (`deploy.startCommand: "exec node server/src/index.js"`)
- AC2 exact-equality contract test → `server/test/health.test.js` (railway.json assertion)
- AC3 prod boot still works → verification only (no file): `node server/src/index.js` + `/api/health` 200
- AC4 de-mislead handler test → `server/test/shutdown.test.js` (comment only)
- AC5 record corrected → `reviews/graceful-shutdown.md` (Follow-up note)
- AC6 scope containment → git (no product files beyond the above)
- AC7 gate → all
