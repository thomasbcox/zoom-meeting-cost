// Cost aggregation + formatting helpers.
//
// "rate" here means each person's hourly OPPORTUNITY COST, not pay — the value of the best
// work they could be doing instead of being in the meeting. See
// dev-docs/opportunity-cost-rate.md. (Identifiers keep the historical `rate` name.)

/** Sum the hourly opportunity-cost values and derive per-minute/second. */
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
 * Simple cost model: a flat estimate of N people × average opportunity cost.
 * Returns the SAME shape as computeTotals so everything downstream is unchanged.
 * Negative / non-numeric inputs clamp to 0.
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

/**
 * Pick the active totals source from the presenter's cost model.
 * - 'simple'         -> computeSimpleTotals (N = simpleUserCount ?? liveCount)
 * - 'perParticipant' (or anything else) -> computeTotals(resolved)
 */
export function selectActiveTotals({
  costModel,
  resolved = [],
  simpleAverageRate,
  simpleUserCount,
  liveCount,
} = {}) {
  if (costModel === 'simple') {
    // Blank ('') or null N means "track the live attendee count" — normalize both
    // here so the helper is correct even if called directly (not just via the store).
    const blankN = simpleUserCount === '' || simpleUserCount == null;
    return computeSimpleTotals({
      userCount: blankN ? liveCount : simpleUserCount,
      averageRate: simpleAverageRate,
    });
  }
  return computeTotals(resolved);
}

/**
 * Decide what to persist for the simple attendee override when the N field commits.
 * Returns '' (→ store null = "track the live count") when the committed value is
 * blank, non-numeric, or equals the current live count — so a stray focus/blur, or
 * entering the same number as the live count, keeps tracking instead of pinning.
 * Otherwise returns the value to store as an explicit override.
 */
export function simpleCountCommit(rawValue, liveCount) {
  if (rawValue === '' || rawValue == null) return '';
  const n = Number(rawValue);
  if (!Number.isFinite(n)) return '';
  return n === Number(liveCount) ? '' : rawValue;
}

/**
 * The config patch to apply when the cost model changes. Switching TO 'simple' also
 * clears `simpleUserCount` to null so the attendee count defaults to the live/actual
 * count (track-live) instead of a stale saved override. Switching to 'perParticipant'
 * only sets the model — it leaves `simpleUserCount` untouched. Pure so the store can
 * spread the result and the behavior is unit-tested directly.
 */
export function costModelPatch(model) {
  return model === 'simple'
    ? { costModel: 'simple', simpleUserCount: null }
    : { costModel: 'perParticipant' };
}

/**
 * What the Simple-mode attendee-count field should display.
 * - A manual value (non-blank simpleUserCount) always shows as-is.
 * - Otherwise, when the live participant list IS available, prefill/track the live count.
 * - When the list is UNAVAILABLE (the non-host case, liveCount is a meaningless 0), show
 *   an EMPTY field so the presenter is prompted to enter their best-guess headcount —
 *   never a misleading 0 that would peg the meter at $0 silently.
 * Returns '' for the empty-prompt case; a numeric string otherwise.
 */
export function simpleCountDisplay({ simpleUserCount, liveCount, participantsAvailable }) {
  const hasManual = simpleUserCount !== '' && simpleUserCount != null;
  if (hasManual) return String(simpleUserCount);
  if (participantsAvailable) return String(liveCount ?? 0);
  return '';
}

/**
 * The live attendee count Simple mode may use — but ONLY when the participant list is
 * actually available. When it's unavailable, the adapter can still hold a STALE non-empty
 * snapshot; using it would make the meter accrue on a cached count while the field shows the
 * empty prompt. So an unavailable list yields 0: the meter reads $0 until a manual count is
 * entered, matching simpleCountDisplay's blank prompt.
 */
export function simpleLiveCount(participantsAvailable, count) {
  return participantsAvailable ? Number(count) || 0 : 0;
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
