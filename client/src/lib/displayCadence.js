import { formatDuration } from './cost.js';

// Display cadence: how often the *visible* meeting-cost number is allowed to
// change. The internal accrual (App.jsx's totalRef/elapsedRef) keeps advancing
// every second; these helpers only quantize what gets RENDERED, so the on-camera
// overlay holds steady between N-second steps instead of perpetually ticking.

// Allowed cadences, in seconds: every second or every 10 seconds.
export const DISPLAY_INTERVALS = [1, 10];
export const DEFAULT_DISPLAY_INTERVAL = 10;

// Human labels for the picker.
export const DISPLAY_INTERVAL_LABELS = {
  1: 'Every second',
  10: 'Every 10s',
};

// Snap an arbitrary value to the nearest allowed cadence; fall back to the
// default for blank / non-finite input. Keeps the stored setting in-set.
export function normalizeDisplayInterval(value) {
  if (value === null || value === undefined || value === '') return DEFAULT_DISPLAY_INTERVAL;
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_DISPLAY_INTERVAL;
  let best = DISPLAY_INTERVALS[0];
  let bestDist = Math.abs(n - best);
  for (const opt of DISPLAY_INTERVALS) {
    const d = Math.abs(n - opt);
    if (d < bestDist) {
      best = opt;
      bestDist = d;
    }
  }
  return best;
}

// Floor the displayed total + elapsed onto a `stepSeconds` grid. The total is
// walked BACK from the live value by the within-bucket fraction
// (costPerSecond × secondsSinceStep), so the displayed figure equals what the
// total was at the start of the current N-second bucket and holds there until
// the next boundary. Quantize at EVERY allowed cadence (stepSeconds ≥ 1) — so even
// the 1 s cadence changes at most once per second: the overlay re-renders faster
// than that (OverlayApp's 250 ms tick) but shows the same floored value between
// second boundaries (BUG-2). Only a sub-second step (< 1, never offered) passes through.
export function quantizeForDisplay({ totalCost, elapsedSeconds, costPerSecond, stepSeconds }) {
  const tc = num(totalCost);
  const es = Math.max(0, num(elapsedSeconds));
  const step = num(stepSeconds);
  // The displayed total is never negative (BUG-3). In the first bucket the walk-back below is
  // `tc - cps*es`, which dips a hair under $0 when the round2'd total lags costPerSecond×elapsed
  // early in a session — rendering as "-$0.00" / a small negative. Clamp at zero on BOTH return
  // paths so the invariant holds for any input, without touching the internal accrual.
  if (!(step >= 1)) return { totalCost: Math.max(0, tc), elapsedSeconds: es };
  const steppedElapsed = Math.floor(es / step) * step;
  const cps = num(costPerSecond);
  return {
    totalCost: Math.max(0, tc - cps * (es - steppedElapsed)),
    elapsedSeconds: steppedElapsed,
  };
}

// Duration text for the overlay clock. With the {1, 10}s cadences the clock always
// shows the usual h:mm:ss; the 1-minute cadence (which dropped seconds) was retired.
export function formatCadenceDuration(totalSeconds) {
  return formatDuration(totalSeconds);
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
