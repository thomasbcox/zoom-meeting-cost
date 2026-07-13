// Cost aggregation + formatting helpers.
//
// "rate" here means the hourly OPPORTUNITY COST per participant — the value of the best
// work they could be doing instead of being in the meeting, not pay. See
// dev-docs/opportunity-cost-rate.md.

/**
 * The meeting's cost totals from a flat estimate: N attendees × one hourly rate.
 * Negative / non-numeric inputs clamp to 0. Shape matches what the overlay + readout
 * consume (attendeeCount, combinedHourly, costPerMinute, costPerSecond).
 */
export function computeSimpleTotals({ userCount, averageRate } = {}) {
  const n = clampNonNeg(userCount);
  const rate = clampNonNeg(averageRate);
  const combinedHourly = n * rate;
  return {
    attendeeCount: n,
    combinedHourly,
    costPerMinute: combinedHourly / 60,
    costPerSecond: combinedHourly / 3600,
  };
}

function clampNonNeg(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function formatMoney(value, { decimals = 2 } = {}) {
  const n = Number(value) || 0;
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function formatDuration(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds || 0));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}
