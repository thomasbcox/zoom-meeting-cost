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
