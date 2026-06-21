// Builds the payload streamed from the side panel to the camera overlay.
//
// PRIVACY: this must never carry the presenter's private value table, aliases,
// per-participant names, or individual opportunity-cost values. The overlay shows
// aggregate numbers only, so only aggregate numbers are sent to the camera context.

/**
 * @param {Object} args
 * @param {'idle'|'running'|'paused'|'ended'} args.status
 * @param {number} args.totalCost          accumulated cost so far
 * @param {Object} args.totals             from computeTotals() (aggregate only)
 * @param {number} args.elapsedSeconds
 * @param {string} [args.currency]
 * @param {number} args.updatedAt          epoch ms, for overlay-side extrapolation
 * @param {number} [args.displayIntervalSeconds] cadence the overlay quantizes to
 */
export function buildOverlayState({
  status,
  totalCost,
  totals,
  elapsedSeconds,
  currency = 'USD',
  updatedAt,
  displayIntervalSeconds = 1,
}) {
  return {
    status,
    totalCost: round2(totalCost),
    costPerSecond: Number(totals?.costPerSecond) || 0,
    elapsedSeconds: Number(elapsedSeconds) || 0,
    attendees: Number(totals?.attendeeCount) || 0,
    currency,
    updatedAt,
    // Non-private scalar: how often the overlay steps its displayed number.
    displayIntervalSeconds: Number(displayIntervalSeconds) || 1,
    prefs: {}, // reserved; never carries private data
  };
}

/**
 * Extrapolate total + elapsed forward from the last received snapshot so the
 * meter ticks smoothly between updates. Frozen unless status is 'running'.
 */
export function extrapolateOverlay(state, now = Date.now()) {
  if (!state) return null;
  const base = {
    totalCost: Number(state.totalCost) || 0,
    elapsedSeconds: Number(state.elapsedSeconds) || 0,
  };
  if (state.status !== 'running' || !state.updatedAt) return base;
  const dt = Math.max(0, (now - state.updatedAt) / 1000);
  return {
    totalCost: base.totalCost + (Number(state.costPerSecond) || 0) * dt,
    elapsedSeconds: base.elapsedSeconds + dt,
  };
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}
