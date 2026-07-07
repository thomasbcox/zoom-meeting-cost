import { normalizeName } from './normalize.js';

// Pure helpers for the presenter's saved rate table and alias list. Kept out of the
// React store so the identity/dedupe rules are unit-testable in isolation (mirrors
// matching.js / saveToList.js). ("rate" = hourly opportunity cost; see matching.js.)
//
// Identity model: a person's NAME is the product identity (unique by normalizeName —
// the SAME normalization matching.js uses, so the two layers agree). Each row also
// carries an opaque, collision-free `id` used only as the React key and for
// delete/update lookup — NEVER a positional index. New ids are `max(existing)+1`,
// derived from the current rows, so they can't collide the way a module-level counter
// (which resets on reload and is blind to hydrated ids) did.

export const MAX_RATES = 10;

// Trailing digits of an id → number, else 0. Tolerates legacy ('r100'→100), plain
// ('7'→7), and junk (''/null→0). Lets minimal repair keep valid legacy ids while
// still advancing a monotonic max for freshly minted ones.
function idNum(id) {
  const m = /(\d+)\s*$/.exec(id == null ? '' : String(id));
  return m ? Number(m[1]) : 0;
}

// Next collision-free id for a list: max numeric id + 1, as a string (min '1').
export function nextId(rows = []) {
  const max = rows.reduce((m, r) => Math.max(m, idNum(r.id)), 0);
  return String(max + 1);
}

// Add-or-update a rule by normalized name. Returns { table, result } with
// result ∈ 'updated' | 'added' | 'rejected-cap' | 'empty'. `rate` is expected
// pre-clamped by the caller (the store owns clamping). Never mutates the input.
export function upsertRule(rateTable = [], name, rate) {
  const trimmed = String(name ?? '').trim();
  if (!trimmed) return { table: rateTable, result: 'empty' };
  const norm = normalizeName(trimmed);
  const idx = rateTable.findIndex((r) => normalizeName(r.name) === norm);
  if (idx >= 0) {
    const table = rateTable.map((r, i) => (i === idx ? { ...r, rate } : r));
    return { table, result: 'updated' };
  }
  if (rateTable.length >= MAX_RATES) return { table: rateTable, result: 'rejected-cap' };
  return {
    table: [...rateTable, { id: nextId(rateTable), name: trimmed, rate }],
    result: 'added',
  };
}

// Add-or-update an alias by normalized alias. Same contract as upsertRule; on update
// the canonical target is replaced. Returns { list, result }.
export function upsertAlias(aliases = [], alias, canonical) {
  const a = String(alias ?? '').trim();
  const canon = String(canonical ?? '').trim();
  if (!a || !canon) return { list: aliases, result: 'empty' };
  const norm = normalizeName(a);
  const idx = aliases.findIndex((x) => normalizeName(x.alias) === norm);
  if (idx >= 0) {
    const list = aliases.map((x, i) => (i === idx ? { ...x, canonical: canon } : x));
    return { list, result: 'updated' };
  }
  if (aliases.length >= MAX_RATES) return { list: aliases, result: 'rejected-cap' };
  return {
    list: [...aliases, { id: nextId(aliases), alias: a, canonical: canon }],
    result: 'added',
  };
}

// Collapse rows by a normalized key (keep FIRST occurrence), then apply MINIMAL id
// repair: keep every surviving row's existing id when it is a non-empty, unique string;
// mint a fresh id (monotonic above the max existing numeric id) ONLY for rows whose id
// is missing or collides. Does NOT renumber otherwise-valid ids, and does NOT truncate
// to the cap. Returns { rows, changed }; `changed` is false iff nothing was altered.
function dedupeRows(rows = [], keyOf) {
  // 1) Collapse duplicate keys (keep first).
  const seenKey = new Set();
  const kept = [];
  let changed = false;
  for (const r of rows) {
    const k = keyOf(r);
    if (k && seenKey.has(k)) {
      changed = true; // dropping a duplicate-named row
      continue;
    }
    if (k) seenKey.add(k);
    kept.push(r);
  }
  // 2) Minimal id repair. Seed the monotonic counter from all valid unique ids.
  let maxNum = 0;
  const validIds = new Set();
  for (const r of kept) {
    const id = r.id == null ? '' : String(r.id);
    if (id && !validIds.has(id)) {
      validIds.add(id);
      maxNum = Math.max(maxNum, idNum(id));
    }
  }
  const usedId = new Set();
  const repaired = kept.map((r) => {
    const id = r.id == null ? '' : String(r.id);
    if (id && !usedId.has(id)) {
      usedId.add(id);
      return r; // valid, first use → keep as-is
    }
    // missing or colliding → mint a fresh id above every existing numeric id
    changed = true;
    maxNum += 1;
    const fresh = String(maxNum);
    usedId.add(fresh);
    return { ...r, id: fresh };
  });
  return { rows: repaired, changed };
}

// Heal a hydrated config: unique ids + one row per normalized name/alias (keep first).
// Returns { config, changed }. Identity-preserving on a clean config (returns the SAME
// object with changed=false) so the caller can skip a redundant save.
export function repairConfig(config) {
  const rt = dedupeRows(config.rateTable ?? [], (r) => normalizeName(r.name));
  const al = dedupeRows(config.aliases ?? [], (a) => normalizeName(a.alias));
  if (!rt.changed && !al.changed) return { config, changed: false };
  return { config: { ...config, rateTable: rt.rows, aliases: al.rows }, changed: true };
}
