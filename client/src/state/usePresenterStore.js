import { useCallback, useEffect, useRef, useState } from 'react';

import { loadRates, saveRates } from '../lib/ratesApi.js';
import { DEFAULT_DISPLAY_INTERVAL, normalizeDisplayInterval } from '../lib/displayCadence.js';
import { appendSummary } from '../lib/meetingSummary.js';
import { upsertRule, upsertAlias, repairConfig } from '../lib/rateTable.js';
import { costModelPatch } from '../lib/cost.js';

// The presenter's PRIVATE configuration. Persisted to the SERVER (encrypted at rest,
// keyed to the presenter's Zoom identity) — NOT localStorage, which isn't durable inside
// the Zoom client. ⚠️ This means the value table (names + estimated values) leaves the
// browser and is decryptable by the app operator (see the README / the in-app notice).
// If the server is unreachable / unconfigured, the store runs session-only (no persistence).
//
// Every `rate` below is an hourly OPPORTUNITY COST (value of best alternative work), not
// pay — see dev-docs/opportunity-cost-rate.md. Identifier names are intentionally unchanged.
//
//   rateTable : [{ id, name, rate }]      best-guess hourly opportunity cost (server-persisted)
//   aliases   : [{ id, alias, canonical }] name aliases (server-persisted)
//   defaultRate, costModel, simple*  settings (server-persisted)
//   overrides : { [participantId]: rate } CURRENT MEETING ONLY (never persisted)

const DEFAULT_CONFIG = {
  rateTable: [
    { id: 'r1', name: 'Thomas Cox', rate: 150 },
    { id: 'r2', name: 'Jane Smith', rate: 95 },
    { id: 'r3', name: 'Acme CFO', rate: 220 },
  ],
  aliases: [{ id: 'a1', alias: 'Tom Cox', canonical: 'Thomas Cox' }],
  defaultRate: 75,
  // Cost model: which source drives the live meter. 'simple' uses a flat
  // N × simpleAverageRate estimate, independent of the per-participant
  // defaultRate above. simpleUserCount === null means "track the live
  // attendee count". Default is 'simple' — it works for every role (per-participant
  // needs the host/co-host-only participant list). See simple-default-role-gate.
  costModel: 'simple',
  simpleAverageRate: 75,
  simpleUserCount: null,
  // How often the ON-CAMERA cost number is allowed to change (seconds). Only
  // affects what viewers see / the preview — never the internal accrual.
  displayIntervalSeconds: DEFAULT_DISPLAY_INTERVAL,
  // Aggregate end-of-meeting summaries (newest-first, capped). Server-persisted + server-owned:
  // a PUT merge-preserves it (add-only). No names/rates. See meeting-summary-history.
  meetingHistory: [],
};

// Should the debounced persistence effect write this config? Only once hydrated, and only
// when `config` is a DIFFERENT object than the one we last marked persisted. Extracted pure
// (repo convention: testable decision, no React) so the "save at most once per change" rule
// is verified directly. The reference check is the whole point: hydration marks the loaded /
// repaired config as `lastSaved`, so it is not echoed back; a user edit produces a new object
// and does save. (Fixes the hydration double-save / clean-load echo — rate-list-dedupe review.)
export function shouldPersistConfig(hydrated, config, lastSaved) {
  return hydrated && config !== lastSaved;
}

export function usePresenterStore(adapter) {
  const [persisted, setPersisted] = useState(() => ({ ...DEFAULT_CONFIG }));
  // Latest persisted config, for actions that must read + flush the whole blob synchronously
  // (addMeetingSummary) without threading it through a functional updater's side effects.
  const persistedRef = useRef(persisted);
  persistedRef.current = persisted;
  // Overrides are intentionally NOT persisted — they belong to the live meeting.
  const [overrides, setOverrides] = useState({});

  // The config we consider already on the server. Set at hydration (the loaded/healed config)
  // and after each debounced save, so the persistence effect never echoes a just-loaded or
  // just-saved config — only a genuine change (a new object) writes. Starts equal to the
  // initial `persisted`, so a null/mock load (defaults untouched) also never echoes.
  const lastSavedRef = useRef(persisted);

  // Load the presenter's saved config from the server on boot (identity = Zoom app
  // context). New user / mock / unreachable → keep the defaults. `hydrated` then gates
  // saving so we don't echo the just-loaded value back.
  const hydratedRef = useRef(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const server = await loadRates(adapter);
      if (!cancelled && server) {
        // Heal already-corrupted saved data on load: unique ids + one row per
        // normalized name/alias. repairConfig is identity-preserving on a clean config,
        // so `changed` is true only when the server data actually needed fixing — then we
        // save the healed config ONCE so the corruption is fixed server-side, not just in
        // memory. A clean load does no save (no echo). See lib/rateTable.
        const { config: fixed, changed } = repairConfig({ ...persistedRef.current, ...server });
        // Every session boots in Simple mode — it works for every role, and a persisted
        // 'perParticipant' never carries across sessions (non-hosts can't use it anyway).
        // See simple-default-role-gate.
        const booted = { ...fixed, costModel: 'simple' };
        setPersisted(booted);
        // Mark the booted config as already-persisted so the debounced effect does not echo it
        // back (a clean load writes zero times, incl. this boot-mode override). On a dirty load,
        // heal the server data with exactly ONE best-effort save — the guard suppresses the
        // debounced second write.
        lastSavedRef.current = booted;
        if (changed) saveRates(adapter, booted);
      }
      if (!cancelled) hydratedRef.current = true;
    })();
    return () => {
      cancelled = true;
    };
  }, [adapter]);

  // Persist changes to the server, debounced. Best-effort: failures are swallowed in
  // ratesApi (the app keeps working on session state).
  useEffect(() => {
    if (!shouldPersistConfig(hydratedRef.current, persisted, lastSavedRef.current)) return undefined;
    const id = setTimeout(() => {
      saveRates(adapter, persisted);
      lastSavedRef.current = persisted; // this config is now the on-server baseline
    }, 800);
    return () => clearTimeout(id);
  }, [persisted, adapter]);

  const setDefaultRate = useCallback((rate) => {
    setPersisted((c) => ({ ...c, defaultRate: clampNum(rate, 0) }));
  }, []);

  // --- Simple cost model (independent of the per-participant settings) ------
  // Switching TO simple also clears the attendee override so the count defaults to the
  // live/actual count (track-live) rather than a stale saved number. See lib/cost.
  const setCostModel = useCallback((model) => {
    setPersisted((c) => ({ ...c, ...costModelPatch(model) }));
  }, []);

  const setSimpleAverageRate = useCallback((rate) => {
    setPersisted((c) => ({ ...c, simpleAverageRate: clampNum(rate, 0) }));
  }, []);

  const setDisplayInterval = useCallback((seconds) => {
    setPersisted((c) => ({ ...c, displayIntervalSeconds: normalizeDisplayInterval(seconds) }));
  }, []);

  const setSimpleUserCount = useCallback((count) => {
    // Blank clears the override back to null (= track the live attendee count).
    setPersisted((c) => ({
      ...c,
      simpleUserCount: count === '' || count == null ? null : clampNum(count, 0),
    }));
  }, []);

  // Add-or-update by name (unique names): a name already in the table updates its rate
  // instead of adding a duplicate row; a genuinely new name past MAX_RATES is rejected.
  // upsertRule returns the SAME array reference on a no-op (empty / rejected-cap), so we
  // skip the state update — no needless save. See lib/rateTable.
  const addRule = useCallback((name, rate) => {
    setPersisted((c) => {
      const { table } = upsertRule(c.rateTable, name, clampNum(rate, 0));
      return table === c.rateTable ? c : { ...c, rateTable: table };
    });
  }, []);

  const updateRule = useCallback((id, patch) => {
    setPersisted((c) => ({
      ...c,
      rateTable: c.rateTable.map((r) =>
        r.id === id
          ? { ...r, ...patch, rate: patch.rate != null ? clampNum(patch.rate, 0) : r.rate }
          : r
      ),
    }));
  }, []);

  const deleteRule = useCallback((id) => {
    setPersisted((c) => ({ ...c, rateTable: c.rateTable.filter((r) => r.id !== id) }));
  }, []);

  // Same upsert-by-normalized-alias + cap contract as addRule (symmetry decision).
  const addAlias = useCallback((alias, canonical) => {
    setPersisted((c) => {
      const { list } = upsertAlias(c.aliases, alias, canonical);
      return list === c.aliases ? c : { ...c, aliases: list };
    });
  }, []);

  const deleteAlias = useCallback((id) => {
    setPersisted((c) => ({ ...c, aliases: c.aliases.filter((a) => a.id !== id) }));
  }, []);

  const setOverride = useCallback((participantId, rate) => {
    setOverrides((o) => {
      const next = { ...o };
      if (rate === '' || rate == null) delete next[participantId];
      else next[participantId] = clampNum(rate, 0);
      return next;
    });
  }, []);

  const clearOverride = useCallback((participantId) => {
    setOverrides((o) => {
      const next = { ...o };
      delete next[participantId];
      return next;
    });
  }, []);

  // Append an end-of-meeting summary and FLUSH immediately (don't wait for the 800 ms debounce),
  // so it survives a quick panel close. The server merge-preserves history (add-only), so the
  // immediate flush and the later debounced save are idempotent. Flush only once hydrated, so a
  // very-early End can't clobber the server with defaults before the initial load lands.
  const addMeetingSummary = useCallback(
    (summary) => {
      // `summary` already carries a stable id (String(endedAt)) from buildMeetingSummary — no
      // per-load counter, so it can't collide across reloads and get merged over server-side.
      const cur = persistedRef.current;
      const next = { ...cur, meetingHistory: appendSummary(cur.meetingHistory, summary) };
      setPersisted(next);
      if (hydratedRef.current) saveRates(adapter, next);
    },
    [adapter]
  );

  return {
    config: persisted,
    overrides,
    actions: {
      setDefaultRate,
      setCostModel,
      setSimpleAverageRate,
      setSimpleUserCount,
      setDisplayInterval,
      addRule,
      updateRule,
      deleteRule,
      addAlias,
      deleteAlias,
      setOverride,
      clearOverride,
      addMeetingSummary,
    },
  };
}

function clampNum(v, min) {
  const n = Number(v);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, n);
}
