import { formatDuration } from './cost.js';

// Display cadence: how often the *visible* meeting-cost number is allowed to
// change. The internal accrual (App.jsx's totalRef/elapsedRef) keeps advancing
// every second; these helpers only quantize what gets RENDERED, so the on-camera
// overlay holds steady between N-second steps instead of perpetually ticking.

// Allowed cadences, in seconds: every second, every 10 seconds, every minute.
export const DISPLAY_INTERVALS = [1, 10, 60];
export const DEFAULT_DISPLAY_INTERVAL = 10;

// Human labels for the picker.
export const DISPLAY_INTERVAL_LABELS = {
  1: 'Every second',
  10: 'Every 10s',
  60: 'Every minute',
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
// the next boundary. stepSeconds ≤ 1 ⇒ no quantization (pass-through).
export function quantizeForDisplay({ totalCost, elapsedSeconds, costPerSecond, stepSeconds }) {
  const tc = num(totalCost);
  const es = Math.max(0, num(elapsedSeconds));
  const step = num(stepSeconds);
  if (!(step > 1)) return { totalCost: tc, elapsedSeconds: es };
  const steppedElapsed = Math.floor(es / step) * step;
  const cps = num(costPerSecond);
  return {
    totalCost: tc - cps * (es - steppedElapsed),
    elapsedSeconds: steppedElapsed,
  };
}

// Cadence-aware duration text. At the 1-minute cadence we drop seconds entirely
// ("1h 26m" / "26m") so a frozen ":00" never reads as a stuck clock, and "1:10"
// can't be misread as 1h10m vs 1m10s. Faster cadences keep the usual h:mm:ss.
export function formatCadenceDuration(totalSeconds, intervalSeconds) {
  if (num(intervalSeconds) >= 60) {
    const s = Math.max(0, Math.floor(num(totalSeconds)));
    const totalMinutes = Math.floor(s / 60);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
  }
  return formatDuration(totalSeconds);
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
