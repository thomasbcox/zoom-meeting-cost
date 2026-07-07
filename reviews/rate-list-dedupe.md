# rate-list-dedupe — unique-name saved list + id-collision fix

Date: 2026-07-07 · Branch: claude/rate-list-dedupe · Status: approved

## Problem

The saved "Private per-person values" list (and the aliases list) corrupts on normal use:
deleting one row removes others, editing one edits its twin, and deleting can leave a duplicated
row. Root cause in [usePresenterStore.js:44](../client/src/state/usePresenterStore.js#L44):

```js
let _seq = 100;
const newId = (prefix) => `${prefix}${_seq++}`;
```

`_seq` is a **module-level counter that resets to 100 on every panel reload** and is **blind to
ids hydrated from the server** (the server round-trips the config verbatim, ids included). So on the
2nd+ session, a new add mints an id (`r100`) that already exists → two rows share an id. Then:

- `deleteRule(id)` → `rateTable.filter(r => r.id !== id)` removes **every** row with that id.
- `updateRule(id, …)` → `map` patches **every** matching row.
- React renders two `<tr key="r100">` → duplicate-key reconciliation → the "duplicated the entry
  below" artifact.

Duplicate **names** make this easy to hit (e.g. three identical "Fathom Notetaker" bot rows).

## In scope

- **Stable, collision-free row id** — replace the resettable module counter with an id derived from
  the current rows (`max numeric id + 1`). A persistent unique handle, **not** a positional index.
  This id stays the React key so inline name-editing keeps focus; it is opaque (matching keys on
  names, never ids).
- **Upsert-by-name** — adding a name that already exists (by `normalizeName`) updates that row's
  rate instead of appending a duplicate. Applies to both the Add box and the overrides "＋ Save".
- **Cap the saved list at 10** — a new name past the cap is blocked with a friendly message; an
  upsert of an existing name is always allowed (it doesn't grow the list).
- **Hydration repair** — on load, heal already-corrupted saved data: guarantee unique ids and
  collapse duplicate-named rows (keep the first occurrence). This fixes data already on the server
  (e.g. Thomas's current duplicate rows), not just new adds.
- **Aliases: the id fix + hydration id-repair apply** (same `newId('a')` bug). Whether aliases also
  get upsert-by-alias + a 10-cap is an **open question** (below).
- **Extract pure helpers** into `client/src/lib/rateTable.js` (upsert, dedupe/repair, next-id, cap
  constant) with unit tests — matching the repo's pure-lib + test convention.

## Non-goals

- `defaultRate` behavior — already correct and persisted; not touched (an optional label
  clarification is the only thing that could ride along, and only if trivial).
- Enforcing name-uniqueness on **inline rename** (renaming row A's name to equal row B's). The
  stable id keeps this structurally safe; matching already collapses duplicate normalized names
  (last-in-index wins), and the next hydration repair tidies it. Live per-keystroke rename blocking
  would be hostile UX.
- Changing the matching precedence, the overlay, or the simple cost model.
- Random UUIDs (explicitly rejected).

## Acceptance criteria

1. **No duplicate ids, ever.** Adding rows across simulated reloads never produces two rows with the
   same id. `deleteRule`/`updateRule` on a table containing duplicate **names** affect exactly the
   targeted row.
2. **Upsert-by-name.** Adding a name already present (case/punctuation-insensitive via
   `normalizeName`) updates that row's rate and does **not** add a second row; the row count is
   unchanged. Same for the overrides "＋ Save" path.
3. **Cap at 10.** With 10 saved rows, adding a genuinely new name is blocked and the UI shows a
   clear "up to 10" message; the Add control (and overrides "＋ Save") is disabled in that state.
   Upserting an existing name at the cap still works.
4. **Hydration repair.** Loading a server config that contains duplicate ids and/or duplicate
   normalized names yields a healed table: unique ids, one row per normalized name (first kept),
   order otherwise preserved. The repair does **not** trigger a redundant save on a clean load.
5. **Aliases: full symmetry.** New aliases get collision-free ids; hydration repairs duplicate
   alias ids; **and** aliases get upsert-by-alias (re-mapping an existing normalized alias updates
   its canonical target) plus the same 10-cap. (Resolved: symmetry with the rate list.)
6. **Scope containment.** The diff touches only the files enumerated in Test notes; no product
   behavior outside the saved list / aliases changes.

## Test notes

- **AC1/AC2/AC4/AC5:** unit tests in `client/src/lib/rateTable.test.js` against the pure helpers —
  `upsertRule` (new vs existing name; rate overwrite; count invariance), `nextId` (max+1; never
  reuses; handles mixed/legacy id formats), `repairConfig` (dedupe by id and by normalized name;
  order/keep-first; idempotent — repairing a clean config returns an equivalent config so no save
  echo). Reuse `normalizeName` so uniqueness matches the matching layer exactly.
- **AC3:** unit-test the cap guard in the helper (add past 10 → unchanged; upsert at cap → applied).
  Component-level: `RateTableEditor` disables Add + shows the message when `rateTable.length >= 10`
  and the typed name isn't an existing row; verified by reading the component logic (no e2e).
- **AC1 (React key):** the row `key` is the stable id; inline editing a name does not remount the
  input (focus retained) — reasoned from the stable-id invariant, not an automated focus test.
- **AC6:** `git diff --name-only main...HEAD` shows no files beyond: `client/src/lib/rateTable.js`,
  `client/src/lib/rateTable.test.js`, `client/src/state/usePresenterStore.js`,
  `client/src/components/PresenterControls.jsx`, `reviews/rate-list-dedupe.md`
  (+ `reviews/rate-list-dedupe.design.json`).
- Full gate: `npm test && npm run build` green.

## Open questions

_Both resolved at the frame consult — see Design decisions._
1. **Aliases: upsert + 10-cap?** → **Resolved: yes, full symmetry** (upsert-by-alias + 10-cap).
2. **Keep-first vs keep-last on hydration collapse?** → **Resolved: keep first** (topmost, stable).

## Design sketch — HOW

- **New pure module `client/src/lib/rateTable.js`** (mirrors `saveToList.js`/`matching.js` — pure,
  unit-tested, no React):
  - `MAX_RATES = 10`.
  - `nextId(rows)` → `String(1 + max(rows.map(numericId)))`, where `numericId` parses the trailing
    digits of an id (`'r100'→100`, `'7'→7`, non-numeric→0); min result `'1'`.
  - `upsertRule(rateTable, name, rate)` → if a row matches `normalizeName(name)`, return the table
    with that row's rate replaced; else if `length >= MAX_RATES` return the table **unchanged**
    (cap); else append `{ id: nextId(table), name: name.trim(), rate }`. Returns `{ table, result }`
    where `result ∈ {updated, added, rejectedCap}` so the UI can message.
  - `dedupeRateTable(rows)` → collapse by `normalizeName` (**keep first**), then **minimal id
    repair** (per design decision): keep each surviving row's existing id when it is a non-empty,
    unique string; assign `nextId(...)` **only** to rows whose id is missing or collides. Do **not**
    renumber otherwise-valid ids.
  - `dedupeAliases(rows)` → same shape for `{alias, canonical}`: collapse by `normalizeName(alias)`
    (keep first) + minimal id repair. Repair does **not** truncate to the cap — the 10-cap governs
    new adds only; silently dropping already-saved rows on load would be surprising data loss.
  - `repairConfig(config)` → apply both dedupers; return **`{ config, changed }`** where `changed`
    is true iff anything was actually altered (so a clean load is a no-op).
- **`usePresenterStore.js`:** delete `_seq`/`newId`. `addRule` → `upsertRule` (+ clamp); `addAlias`
  → `upsertAlias` (both enforce the cap). `deleteRule`/`updateRule`/`deleteAlias` unchanged (now
  safe on unique ids). Hydration: `const { config: fixed, changed } = repairConfig({ ...c, ...server })`;
  `setPersisted(fixed)`, and **if `changed`, one best-effort `saveRates(adapter, fixed)`** so
  already-corrupted server data is healed once (per BLOCKER fix). A clean load (`changed === false`)
  does no save. `DEFAULT_CONFIG` ids left as-is (already unique — minimal repair treats them clean).
- **`PresenterControls.jsx`:** `RateTableEditor` computes `atCap = rateTable.length >= MAX_RATES` and
  `isUpsert = table.some(r => normalizeName(r.name) === normalizeName(name))`; disables Add when
  `atCap && !isUpsert`, shows an "N/10 — up to 10 people" note. `OverridesEditor`'s "＋ Save"
  disabled at cap with a tooltip. Row `key` stays `r.id`.
- **Error model:** none new — helpers are pure and total (never throw); the store keeps its
  best-effort save. Cap/upsert outcomes are data, surfaced as UI affordance, not exceptions.

## Codex design review (2026-07-07)

**Verdict:** *"The main shape is sound — a pure `client/src/lib/rateTable.js` helper, `normalizeName`
reuse, Vitest coverage, no new dependency, opaque React-key ids all fit the repo. I would not build
the hydration/id-repair exactly as sketched, and the alias policy needs a decision."*

### BLOCKER — Dirty hydration repair is never persisted _(one-way · kludgy)_
> The sketch runs `repairConfig` before `hydratedRef` flips *so it won't save* — which heals the
> in-memory table for the session but leaves Thomas's **corrupted server data corrupted** until some
> later unrelated edit happens to flush the whole config.
> - **alternative:** `repairConfig` returns `{ config, changed }` (identity-preserving on clean
>   input); do one best-effort `saveRates(adapter, repaired)` **only when the load was actually
>   repaired**. Clean loads still skip the echo.
> - **win:** existing corrupted data is cleaned once, while keeping the no-redundant-save invariant.

### IMPORTANT — Global renumbering makes stable ids positional _(one-way · kludgy)_
> `dedupeRateTable` was sketched to renumber all ids to sequential strings after collapse — which
> churns valid legacy ids and makes repaired ids a function of current order (the very "positional"
> thing the invariant rejects).
> - **alternative:** repair *minimally* — after name-dedupe, keep the first occurrence's existing id
>   when present and unique; assign `nextId(rows)` only to missing/colliding ids. Any unique string
>   id counts as clean, prefix or gaps notwithstanding.
> - **win:** fixes the uniqueness bug without avoidable id migration, row-key churn, or extra dirty
>   repairs of already-valid data.

### QUESTION — Alias cap/upsert policy unresolved _(two-way · standard)_
> AC5 says alias behavior is "per the resolved open question," but it isn't resolved — so the helper
> API, UI disabled state, and tests could land half-scoped.
> - **alternative:** decide before building — either `upsertAlias` + same `MAX_RATES` cap for
>   symmetry, or explicitly scope aliases to id-generation + id-repair only.
> - **win:** one clear alias contract; no test/UI rework after the first pass.

## Design decisions (2026-07-07)

Thomas approved scope (fix the saved-list corruption via unique-name identity + collision-free ids +
hydration heal, new pure `lib/rateTable.js` with tests; `defaultRate` untouched; no UUIDs) and
ratified the following, resolving both design findings and both open questions:

- **BLOCKER (persist the repair) → fix.** `repairConfig` returns `{ config, changed }`; on a load
  that was actually repaired (`changed`), do one best-effort `saveRates` so corrupted server data is
  healed once. Clean loads skip the save (no echo). This is the binding hydration contract.
- **IMPORTANT (minimal id repair) → fix.** Do **not** renumber valid ids. Keep each surviving row's
  existing unique id; mint a new id only for missing/colliding rows. Ids stay opaque handles, not
  positional.
- **Aliases → full symmetry.** `upsertAlias` by normalized alias + the same `MAX_RATES` cap, plus
  the id fix/repair. One contract across both lists.
- **Collapse → keep first.** Duplicate-name collapse keeps the topmost occurrence's row/rate.
