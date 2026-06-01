// Builds the shared-state payload that the presenter broadcasts to all viewers.
//
// CRITICAL PRIVACY RULE: this payload must never contain the presenter's
// private rate table, aliases, default rate, or multiplier. It only contains
// the *resolved* values that all collaborators are allowed to see — and even
// those are stripped further when the presenter chooses aggregate-only or
// hide-rates display preferences.

export const SHARED_STATE_VERSION = 1;

/**
 * @param {Object} args
 * @param {string} args.roomId
 * @param {string} args.presenterName
 * @param {'running'|'paused'|'ended'} args.status
 * @param {number} args.elapsedSeconds
 * @param {number} args.totalCost
 * @param {Array}  args.resolved   resolved participant rows
 * @param {Object} args.totals     from computeTotals()
 * @param {Object} args.prefs      { aggregateOnly, hideRates }
 * @param {number} args.updatedAt  epoch ms (for viewer-side extrapolation)
 */
export function buildSharedState({
  roomId,
  presenterName,
  status,
  elapsedSeconds,
  totalCost,
  resolved,
  totals,
  prefs,
  updatedAt,
}) {
  const state = {
    version: SHARED_STATE_VERSION,
    roomId,
    presenterName,
    status,
    elapsedSeconds,
    totalCost,
    // Only aggregate numbers the viewers are allowed to see.
    totals: {
      attendeeCount: totals.attendeeCount,
      combinedHourly: round2(totals.combinedHourly),
      costPerMinute: round2(totals.costPerMinute),
      costPerSecond: totals.costPerSecond,
    },
    prefs: {
      aggregateOnly: !!prefs.aggregateOnly,
      hideRates: !!prefs.hideRates,
    },
    updatedAt,
  };

  if (prefs.aggregateOnly) {
    state.participants = []; // viewers see totals + count only
  } else {
    state.participants = resolved.map((p) => ({
      id: p.id,
      displayName: p.displayName,
      rate: prefs.hideRates ? null : round2(p.rate),
      source: prefs.hideRates ? null : p.source,
    }));
  }

  return state;
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}
