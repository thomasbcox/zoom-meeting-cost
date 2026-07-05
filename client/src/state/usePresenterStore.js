import { useCallback, useEffect, useRef, useState } from 'react';

import { loadRates, saveRates } from '../lib/ratesApi.js';
import { DEFAULT_DISPLAY_INTERVAL, normalizeDisplayInterval } from '../lib/displayCadence.js';
import { appendSummary } from '../lib/meetingSummary.js';

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
  // attendee count".
  costModel: 'perParticipant',
  simpleAverageRate: 75,
  simpleUserCount: null,
  // How often the ON-CAMERA cost number is allowed to change (seconds). Only
  // affects what viewers see / the preview — never the internal accrual.
  displayIntervalSeconds: DEFAULT_DISPLAY_INTERVAL,
  // Aggregate end-of-meeting summaries (newest-first, capped). Server-persisted + server-owned:
  // a PUT merge-preserves it (add-only). No names/rates. See meeting-summary-history.
  meetingHistory: [],
};

let _seq = 100;
const newId = (prefix) => `${prefix}${_seq++}`;

export function usePresenterStore(adapter) {
  const [persisted, setPersisted] = useState(() => ({ ...DEFAULT_CONFIG }));
  // Latest persisted config, for actions that must read + flush the whole blob synchronously
  // (addMeetingSummary) without threading it through a functional updater's side effects.
  const persistedRef = useRef(persisted);
  persistedRef.current = persisted;
  // Overrides are intentionally NOT persisted — they belong to the live meeting.
  const [overrides, setOverrides] = useState({});

  // Load the presenter's saved config from the server on boot (identity = Zoom app
  // context). New user / mock / unreachable → keep the defaults. `hydrated` then gates
  // saving so we don't echo the just-loaded value back.
  const hydratedRef = useRef(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const server = await loadRates(adapter);
      if (!cancelled && server) setPersisted((c) => ({ ...c, ...server }));
      if (!cancelled) hydratedRef.current = true;
    })();
    return () => {
      cancelled = true;
    };
  }, [adapter]);

  // Persist changes to the server, debounced. Best-effort: failures are swallowed in
  // ratesApi (the app keeps working on session state).
  useEffect(() => {
    if (!hydratedRef.current) return undefined;
    const id = setTimeout(() => saveRates(adapter, persisted), 800);
    return () => clearTimeout(id);
  }, [persisted, adapter]);

  const setDefaultRate = useCallback((rate) => {
    setPersisted((c) => ({ ...c, defaultRate: clampNum(rate, 0) }));
  }, []);

  // --- Simple cost model (independent of the per-participant settings) ------
  const setCostModel = useCallback((model) => {
    setPersisted((c) => ({ ...c, costModel: model === 'simple' ? 'simple' : 'perParticipant' }));
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

  const addRule = useCallback((name, rate) => {
    if (!name?.trim()) return;
    setPersisted((c) => ({
      ...c,
      rateTable: [...c.rateTable, { id: newId('r'), name: name.trim(), rate: clampNum(rate, 0) }],
    }));
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

  const addAlias = useCallback((alias, canonical) => {
    if (!alias?.trim() || !canonical?.trim()) return;
    setPersisted((c) => ({
      ...c,
      aliases: [...c.aliases, { id: newId('a'), alias: alias.trim(), canonical: canonical.trim() }],
    }));
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
