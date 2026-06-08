// Cost aggregation + formatting helpers.

/** Sum the (multiplier-applied) hourly rates and derive per-minute/second. */
export function computeTotals(resolvedParticipants = []) {
  const combinedHourly = resolvedParticipants.reduce(
    (sum, p) => sum + (Number(p.rate) || 0),
    0
  );
  return {
    attendeeCount: resolvedParticipants.length,
    combinedHourly,
    costPerMinute: combinedHourly / 60,
    costPerSecond: combinedHourly / 3600,
  };
}

/**
 * Simple cost model: a flat estimate of N people × average $/hr × multiplier.
 * Returns the SAME shape as computeTotals so everything downstream is unchanged.
 * Negative / non-numeric inputs clamp to 0.
 */
export function computeSimpleTotals({ userCount, averageRate, multiplier } = {}) {
  const n = clampNonNeg(userCount);
  const rate = clampNonNeg(averageRate);
  const mult = clampNonNeg(multiplier);
  const combinedHourly = n * rate * mult;
  return {
    attendeeCount: n,
    combinedHourly,
    costPerMinute: combinedHourly / 60,
    costPerSecond: combinedHourly / 3600,
  };
}

/**
 * Pick the active totals source from the presenter's cost model.
 * - 'simple'         -> computeSimpleTotals (N = simpleUserCount ?? liveCount)
 * - 'perParticipant' (or anything else) -> computeTotals(resolved)
 */
export function selectActiveTotals({
  costModel,
  resolved = [],
  simpleAverageRate,
  simpleMultiplier,
  simpleUserCount,
  liveCount,
} = {}) {
  if (costModel === 'simple') {
    return computeSimpleTotals({
      userCount: simpleUserCount ?? liveCount,
      averageRate: simpleAverageRate,
      multiplier: simpleMultiplier,
    });
  }
  return computeTotals(resolved);
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
