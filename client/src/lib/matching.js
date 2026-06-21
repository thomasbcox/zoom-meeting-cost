import { normalizeName } from './normalize.js';

// Matching resolves each meeting participant to an hourly opportunity-cost value and
// records how that value was determined (the "source"), so the UI can be honest about it.
// ("rate" throughout = hourly opportunity cost, not pay — see dev-docs/opportunity-cost-rate.md.)
//
// Precedence (highest first):
//   1. manual override for this participant in the current meeting -> "manual"
//   2. exact match on normalized display name                      -> "matched"
//   3. alias -> canonical name, then exact match                   -> "matched"
//   4. fall back to the configurable default value                 -> "default"
//
// The multiplier is applied on top of whatever base value is chosen.

export const SOURCE = {
  MANUAL: 'manual',
  MATCHED: 'matched',
  DEFAULT: 'default',
};

/** Build a normalized-name -> rule lookup from the private rate table. */
export function buildRateIndex(rateTable = []) {
  const index = new Map();
  for (const rule of rateTable) {
    const key = normalizeName(rule.name);
    if (key) index.set(key, rule);
  }
  return index;
}

/** Build a normalized-alias -> normalized-canonical lookup. */
export function buildAliasIndex(aliases = []) {
  const index = new Map();
  for (const a of aliases) {
    const key = normalizeName(a.alias);
    const canonical = normalizeName(a.canonical);
    if (key && canonical) index.set(key, canonical);
  }
  return index;
}

/**
 * Resolve a single participant to { baseRate, source, matchedName }.
 * `overrides` maps participant id -> base rate (number) for the current meeting.
 */
export function resolveParticipant(participant, ctx) {
  const { rateIndex, aliasIndex, overrides = {}, defaultRate } = ctx;

  const override = overrides[participant.id];
  if (override != null && override !== '' && Number.isFinite(Number(override))) {
    return { baseRate: Number(override), source: SOURCE.MANUAL, matchedName: null };
  }

  const norm = normalizeName(participant.displayName);

  if (rateIndex.has(norm)) {
    const rule = rateIndex.get(norm);
    return { baseRate: Number(rule.rate), source: SOURCE.MATCHED, matchedName: rule.name };
  }

  if (aliasIndex.has(norm)) {
    const canonical = aliasIndex.get(norm);
    if (rateIndex.has(canonical)) {
      const rule = rateIndex.get(canonical);
      return { baseRate: Number(rule.rate), source: SOURCE.MATCHED, matchedName: rule.name };
    }
  }

  return { baseRate: Number(defaultRate) || 0, source: SOURCE.DEFAULT, matchedName: null };
}

/**
 * Resolve every participant, applying the multiplier.
 * Returns rows: { id, displayName, baseRate, rate, source, matchedName }.
 */
export function resolveAll(participants = [], config) {
  const rateIndex = buildRateIndex(config.rateTable);
  const aliasIndex = buildAliasIndex(config.aliases);
  const multiplier = Number(config.multiplier) || 1;

  return participants.map((p) => {
    const r = resolveParticipant(p, {
      rateIndex,
      aliasIndex,
      overrides: config.overrides,
      defaultRate: config.defaultRate,
    });
    return {
      id: p.id,
      displayName: p.displayName,
      baseRate: r.baseRate,
      rate: r.baseRate * multiplier,
      source: r.source,
      matchedName: r.matchedName,
    };
  });
}
