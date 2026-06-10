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
  getLastVideoOn,
  setLastVideoOn,
  getVideoState,
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
        log('overlay-rearm:begin');
        // Close THEN reopen — a single reopen does not re-composite (proven live).
        return Promise.resolve()
          .then(() => stopCameraOverlay?.())
          .catch(() => {
            /* close is best-effort: the context may already be torn down */
          })
          .then(() => startCameraOverlay?.())
          .then(() => {
            postOverlay();
            log('overlay-rearm:done');
          });
      })
      .catch(() => {
        /* a failed poll/recovery must not surface; the next tick retries */
      });
}
