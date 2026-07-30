// Overlay recovery + the serialized rendering-context controller.
//
// The camera overlay renders in Zoom's inCamera rendering context. That context is GLOBAL —
// runRenderingContext() / closeRenderingContext() take no target — and Zoom can tear it down out
// from under us (camera off, breakout-room round-trip), destroying the overlay webview.
//
// Two independent signals detect a dead overlay:
//   1. A camera off→on edge (getVideoState polled — onMyMediaChange never fires in the panel).
//   2. A run of failed postMessage sends (the inCamera instance is gone; the link is dead).
// Both recover by CLOSING then REOPENING the context (a single reopen does not re-composite —
// proven live). Because Show, Hide, and BOTH recoveries mutate the one global context, they are
// funnelled through a single serialized controller (createOverlayController): every SDK start/close
// runs one at a time, so concurrent intents can't interleave and the LAST intent wins — no races,
// no compensating closes, no generation bookkeeping.

// --- Pure reducers (table-testable, no jsdom) --------------------------------

// Decide whether a polled camera-state sample should trigger recovery. `recover` is true ONLY on a
// rising edge (off→on) while the overlay is meant to be on; `lastVideoOn` always advances.
export function reduceVideoPoll(currentVideoOn, { overlayOn, lastVideoOn }) {
  const recover = !!overlayOn && lastVideoOn === false && currentVideoOn === true;
  return { lastVideoOn: currentVideoOn, recover };
}

// N consecutive failed sends before a rebuild; minimum ms between rebuild attempts.
export const POST_FAIL_THRESHOLD = 3;
export const REBUILD_COOLDOWN_MS = 6000;

// Decide whether a dead-link rebuild is due. Given the latest send outcome (`ok`) and the prior
// { consecutiveFailures, lastRebuildAt }, return the COMPLETE next state + a `rebuild` signal. A
// success resets the count; a failure increments it; a rebuild is due once the count reaches the
// threshold AND the cooldown has elapsed — advancing lastRebuildAt but KEEPING the count, so a
// persistently dead link retries at the cooldown cadence, not every tick. `now` is injected.
export function reducePostResult(
  ok,
  { consecutiveFailures = 0, lastRebuildAt = 0 } = {},
  now = 0,
  { threshold = POST_FAIL_THRESHOLD, cooldownMs = REBUILD_COOLDOWN_MS } = {}
) {
  if (ok) return { consecutiveFailures: 0, lastRebuildAt, rebuild: false };
  const nextFailures = consecutiveFailures + 1;
  const due = nextFailures >= threshold && now - lastRebuildAt >= cooldownMs;
  return {
    consecutiveFailures: nextFailures,
    lastRebuildAt: due ? now : lastRebuildAt,
    rebuild: due,
  };
}

// --- Serialized rendering-context controller ---------------------------------

// Single owner of the global camera rendering context. Show, Hide, and both recovery paths call
// its methods; every SDK start/close runs in a serialized queue, so concurrent intents can't
// interleave and the last one wins. Tracks `desired` (the intent, read at run time) and a
// best-effort `open` belief (to skip a redundant reopen); `rebuild()` force-cycles regardless of
// `open`, so a stale belief never blocks recovery. Deps are injected for testing.
//
// @param {() => Promise|any} startCtx  open the rendering context (runRenderingContext + draw)
// @param {() => Promise|any} stopCtx   close the rendering context (closeRenderingContext)
// @param {() => void} [post]           push a fresh snapshot after a rebuild reopen
// @param {(event:string) => void} [log]
export function createOverlayController({ startCtx, stopCtx, post = () => {}, log = () => {} }) {
  let desired = false; // the intent: is the overlay meant to be up?
  let open = false; // best-effort belief about whether the context is currently up
  let tail = Promise.resolve(); // serialization queue tail

  // Run `task` after all prior tasks (serialized). The returned promise mirrors the task (so Show
  // can observe a start failure); the chain's own tail swallows so one failure never wedges it.
  function enqueue(task) {
    const run = tail.then(task, task);
    tail = run.then(
      () => {},
      () => {}
    );
    return run;
  }

  // Reconcile the actual context toward `desired` (idempotent): open it if wanted-and-closed, close
  // it if unwanted-and-open. `desired` is read at RUN time, so a superseding Show/Hide queued
  // behind this op wins.
  function reconcile() {
    return enqueue(async () => {
      if (desired && !open) {
        await startCtx(); // may throw → the returned promise rejects (Show surfaces its notice)
        open = true;
      } else if (!desired && open) {
        try {
          await stopCtx();
        } catch {
          /* best-effort: the context may already be gone */
        }
        open = false;
      }
    });
  }

  return {
    isOn: () => desired,
    // Bring the overlay up (or reconcile to it). Sets intent, then serializes the SDK start.
    show() {
      desired = true;
      return reconcile();
    },
    // Take the overlay down. Sets intent, then serializes the SDK close. Always reaches "hidden".
    hide() {
      desired = false;
      return reconcile();
    },
    // Recovery: the context died while still wanted — force a close→reopen. No-op if hidden since
    // the rebuild was requested; if a Hide lands during the close, leave it down (a queued Hide's
    // reconcile, or this early return, keeps it closed). Serialization means no stale reopen can
    // clobber a newer Show — that op simply runs last.
    rebuild() {
      return enqueue(async () => {
        if (!desired) return;
        log('overlay-rearm:begin');
        try {
          await stopCtx();
        } catch {
          /* best-effort close */
        }
        open = false;
        if (!desired) return; // a Hide landed during the close — leave it down
        await startCtx();
        open = true;
        post();
        log('overlay-rearm:done');
      });
    },
  };
}

// --- Recovery drivers (decide WHEN to rebuild; the controller owns HOW) -------

// Camera off→on auto-recovery. Each call polls getVideoState(), runs the edge reducer, and on a
// rising edge asks the controller to rebuild. A throwing/rejecting poll is swallowed; never rejects.
export function createVideoRecovery({ getLastVideoOn, setLastVideoOn, getVideoState, isOn, rebuild }) {
  return () =>
    Promise.resolve()
      .then(() => getVideoState?.())
      .then((currentVideoOn) => {
        const { lastVideoOn, recover } = reduceVideoPoll(!!currentVideoOn, {
          overlayOn: isOn(),
          lastVideoOn: getLastVideoOn(),
        });
        setLastVideoOn(lastVideoOn);
        if (recover) return rebuild();
        return undefined;
      })
      .catch(() => {
        /* a failed poll/recovery must not surface; the next tick retries */
      });
}

// Dead-postMessage-link recovery. Feed each send outcome through reducePostResult, persist the next
// state, and — when a rebuild is due — ask the controller to rebuild. Never rejects.
export function createPostRecovery({
  getState,
  setState,
  now = () => 0,
  rebuild,
  threshold = POST_FAIL_THRESHOLD,
  cooldownMs = REBUILD_COOLDOWN_MS,
}) {
  return (ok) => {
    const next = reducePostResult(ok, getState(), now(), { threshold, cooldownMs });
    setState({ consecutiveFailures: next.consecutiveFailures, lastRebuildAt: next.lastRebuildAt });
    if (!next.rebuild) return Promise.resolve(false);
    return Promise.resolve(rebuild()).catch(() => false); // failed reopen never surfaces
  };
}
