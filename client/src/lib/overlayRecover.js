// Auto-recovery for the camera overlay, distilled to pure functions.
//
// Turning the presenter's camera OFF tears down Zoom's camera rendering context,
// which destroys our inCamera overlay webview. Turning it back ON rebuilds the camera
// feed but does NOT re-run our rendering context, so the meter stays gone until we
// re-establish it. The fix that works (proven by the manual Hide→Show) is to CLOSE
// then REOPEN the rendering context.
//
// We can't learn "camera's back" from onMyMediaChange: a live log proved that event
// never fires in the surviving panel instance (it only reaches the inCamera instance,
// which Zoom destroys on camera-off). So the panel POLLS getVideoState() instead and
// detects the off→on edge itself.

// Decide whether a polled camera-state sample should trigger recovery. Pure +
// table-testable (no jsdom). `recover` is true ONLY on a rising edge (off→on) while
// the overlay is meant to be on; `lastVideoOn` is always advanced to the new sample.
//
// @param {boolean} currentVideoOn  the just-polled camera on/off state
// @param {object}  prev            { overlayOn:boolean, lastVideoOn:boolean }
// @returns {object}                { lastVideoOn:boolean, recover:boolean }
export function reduceVideoPoll(currentVideoOn, { overlayOn, lastVideoOn }) {
  const recover = !!overlayOn && lastVideoOn === false && currentVideoOn === true;
  return { lastVideoOn: currentVideoOn, recover };
}

// Build the poll handler that drives overlay auto-recovery, decoupled from React so it
// is unit-testable without jsdom (mirrors the runCameraDraw extraction). Each call
// polls getVideoState(), runs the edge reducer, and on a rising edge re-establishes the
// overlay by CLOSING then REOPENING the rendering context (mirroring the manual
// Hide→Show), then pushes a fresh snapshot. It uses the adapter methods directly, so
// the panel's `overlayOn` is untouched (the button keeps reading "Hide from video").
//
// Robustness: a throwing/rejecting getVideoState is swallowed (no recover, no throw) so
// the poll degrades gracefully if the capability isn't authorized; the close step is
// best-effort (the context may already be torn down) and never blocks the reopen. The
// returned promise never rejects.
//
// @param {object} deps
// @param {() => boolean} deps.getOverlayOn        is the overlay currently meant to be on
// @param {() => boolean} deps.getLastVideoOn      last observed camera state
// @param {(v:boolean) => void} deps.setLastVideoOn  store the new camera state
// @param {() => (boolean|Promise<boolean>)} deps.getVideoState  poll camera on/off
// @param {() => any} deps.stopCameraOverlay       close the rendering context (Hide)
// @param {() => any} deps.startCameraOverlay      reopen the rendering context (Show)
// @param {() => void} deps.postOverlay            push a fresh snapshot after recovery
// @param {(event:string) => void} [deps.log]      lifecycle logger (begin/done)
// @returns {() => Promise<void>}
export function createVideoRecovery({
  getOverlayOn,
  getGeneration = () => 0,
  getLastVideoOn,
  setLastVideoOn,
  getVideoState,
  isRecovering = () => false,
  setRecovering = () => {},
  stopCameraOverlay,
  startCameraOverlay,
  postOverlay,
  log = () => {},
}) {
  return () =>
    Promise.resolve()
      .then(() => getVideoState?.())
      .then((currentVideoOn) => {
        const { lastVideoOn, recover } = reduceVideoPoll(!!currentVideoOn, {
          overlayOn: getOverlayOn(),
          lastVideoOn: getLastVideoOn(),
        });
        setLastVideoOn(lastVideoOn);
        if (!recover) return undefined;
        // Delegate the close→reopen to the shared rebuild (single-flight + generation guard).
        return rebuildOverlay({
          getOverlayOn,
          getGeneration,
          isRecovering,
          setRecovering,
          stop: stopCameraOverlay,
          start: startCameraOverlay,
          post: postOverlay,
          log,
        }).then(() => undefined); // the poll handler never surfaces a value
      })
      .catch(() => {
        /* a failed poll/recovery must not surface; the next tick retries */
      });
}

// Constants for dead-postMessage-link recovery. N consecutive failed sends before a
// rebuild; minimum ms between rebuild attempts (so a persistently-dead link can't hot-loop).
export const POST_FAIL_THRESHOLD = 3;
export const REBUILD_COOLDOWN_MS = 6000;

// Close THEN reopen the camera rendering context — a single reopen does not re-composite
// (proven live). Shared by BOTH recovery paths: the camera-off edge and a dead postMessage
// link. `isRecovering` is a single-flight guard so the two automatic paths — and a concurrent
// manual Hide — can't overlap. Intent (`getOverlayOn`) is re-checked after the close and again
// after the reopen: a Hide that lands mid-rebuild is honored, so an invalidated recovery exits
// WITHOUT reopening (or without posting to an overlay the presenter just hid). The close is
// best-effort (the context may already be gone) and never rejects; a reopen (`start`) rejection
// propagates to the caller, which swallows it (the cooldown then rate-limits the next attempt).
// @returns {Promise<boolean>} true when it reopened + posted; false when guarded/aborted.
export async function rebuildOverlay({
  getOverlayOn = () => true,
  getGeneration = () => 0,
  isRecovering = () => false,
  setRecovering = () => {},
  stop,
  start,
  post,
  log = () => {},
}) {
  if (isRecovering()) return false; // another rebuild already in flight
  if (!getOverlayOn()) return false; // overlay is meant to be off — nothing to rebuild
  const gen = getGeneration();
  // Superseded = the overlay was hidden, or a new overlay run started (generation advanced),
  // since this rebuild began — either way this rebuild is stale and must not win (last-intent-wins).
  const superseded = () => !getOverlayOn() || getGeneration() !== gen;
  setRecovering(true);
  log('overlay-rearm:begin');
  try {
    try {
      await stop?.();
    } catch {
      /* close is best-effort: the context may already be torn down */
    }
    if (superseded()) return false; // a Hide / new run landed during the close — do NOT reopen
    await start?.();
    if (superseded()) {
      // A Hide / new run landed while we were reopening. We just recreated the context, so close
      // it (best-effort) — never leave a live overlay the current intent rejects. This is the
      // compensating close that makes "Hide always wins" enforced, not a timing assumption.
      try {
        await stop?.();
      } catch {
        /* compensating close is best-effort */
      }
      return false;
    }
    post?.();
    log('overlay-rearm:done');
    return true;
  } finally {
    setRecovering(false);
  }
}

// Pure decision for dead-postMessage-link recovery. Given the latest send outcome (`ok`) and
// the prior `{ consecutiveFailures, lastRebuildAt }`, return the COMPLETE next state plus a
// `rebuild` effect signal. A success resets the failure count. A failure increments it; a
// rebuild is due once the count reaches `threshold` AND `cooldownMs` has elapsed since the last
// rebuild — on which we advance `lastRebuildAt` but KEEP the count, so persistent failures retry
// at the cooldown cadence (not every tick). `now` is injected (Date.now in the app) for
// table-testability. Owns the whole transition — the caller just persists the returned state.
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

// Wire the dead-link reducer to the shared rebuild, decoupled from React so it is unit-testable
// with stubbed deps (mirrors createVideoRecovery). Each call feeds one postMessage outcome
// through reducePostResult, persists the next state, and — when a rebuild is due — runs
// rebuildOverlay (close→reopen). Never rejects.
export function createPostRecovery({
  getState,
  setState,
  now = () => 0,
  getOverlayOn,
  getGeneration = () => 0,
  isRecovering = () => false,
  setRecovering = () => {},
  stop,
  start,
  post,
  log = () => {},
  threshold = POST_FAIL_THRESHOLD,
  cooldownMs = REBUILD_COOLDOWN_MS,
}) {
  return (ok) => {
    const next = reducePostResult(ok, getState(), now(), { threshold, cooldownMs });
    setState({ consecutiveFailures: next.consecutiveFailures, lastRebuildAt: next.lastRebuildAt });
    if (!next.rebuild) return Promise.resolve(false);
    return rebuildOverlay({
      getOverlayOn,
      getGeneration,
      isRecovering,
      setRecovering,
      stop,
      start,
      post,
      log,
    }).catch(() => false); // a failed reopen must not surface; the cooldown paces the retry
  };
}

// Manual "Hide from video". Record the hidden INTENT first (so a rebuild racing in the
// background re-checks getOverlayOn and bails before reopening), THEN best-effort close the
// rendering context. The close is swallowed — the context may already be gone — so the click
// never yields an unhandled rejection and the panel always reaches the hidden state.
export async function runStopOverlay({ setOff, stop }) {
  setOff();
  try {
    await stop?.();
  } catch {
    /* best-effort: the camera context may already be torn down */
  }
}
