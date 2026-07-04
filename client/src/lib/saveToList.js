import { buildRateIndex, buildAliasIndex } from './matching.js';
import { normalizeName } from './normalize.js';

// Decide whether a live attendee can be promoted into the presenter's saved rate table, and
// with what payload. Membership is checked EXPLICITLY against the saved table + aliases —
// NOT via the resolved `source`: resolveParticipant gives a per-meeting manual override
// precedence over matching, so an already-saved attendee reads as source 'manual' while
// overridden. Deriving "not saved" from source would then re-`addRule` a duplicate (or
// alias-conflicting) row. Mirrors resolveParticipant's matched branch (direct, then
// alias → canonical) and reuses matching.js so the two never drift.
//
// Returns { name, rate } to persist when the attendee is NOT already in the list, else null
// (⇒ show no Save control). `rate` is the attendee's currently-resolved rate.

export function saveToListTarget(participant, config) {
  const rateIndex = buildRateIndex(config.rateTable);
  const aliasIndex = buildAliasIndex(config.aliases);
  const norm = normalizeName(participant.displayName);
  const inList = rateIndex.has(norm) || (aliasIndex.has(norm) && rateIndex.has(aliasIndex.get(norm)));
  return inList ? null : { name: participant.displayName, rate: participant.rate };
}
