import { useCallback, useEffect, useState } from 'react';

// The presenter's PRIVATE configuration. Persisted to localStorage so it
// survives reloads. This data NEVER leaves the browser except as resolved,
// sanitized aggregate numbers in the overlay payload (see lib/overlayState.js).
//
//   rateTable : [{ id, name, rate }]      persistent best-guess rates
//   aliases   : [{ id, alias, canonical }] persistent name aliases
//   defaultRate, multiplier               persistent settings
//   overrides : { [participantId]: rate } CURRENT MEETING ONLY (not persisted)

const STORAGE_KEY = 'meeting-cost:presenter:v1';

const DEFAULT_CONFIG = {
  rateTable: [
    { id: 'r1', name: 'Thomas Cox', rate: 150 },
    { id: 'r2', name: 'Jane Smith', rate: 95 },
    { id: 'r3', name: 'Acme CFO', rate: 220 },
  ],
  aliases: [{ id: 'a1', alias: 'Tom Cox', canonical: 'Thomas Cox' }],
  defaultRate: 75,
  multiplier: 1.0,
};

function loadPersisted() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_CONFIG };
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

let _seq = 100;
const newId = (prefix) => `${prefix}${_seq++}`;

export function usePresenterStore() {
  const [persisted, setPersisted] = useState(loadPersisted);
  // Overrides are intentionally NOT persisted — they belong to the live meeting.
  const [overrides, setOverrides] = useState({});

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
    } catch {
      /* storage may be unavailable; non-fatal */
    }
  }, [persisted]);

  const setDefaultRate = useCallback((rate) => {
    setPersisted((c) => ({ ...c, defaultRate: clampNum(rate, 0) }));
  }, []);

  const setMultiplier = useCallback((mult) => {
    setPersisted((c) => ({ ...c, multiplier: clampNum(mult, 0) }));
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

  return {
    config: persisted,
    overrides,
    actions: {
      setDefaultRate,
      setMultiplier,
      addRule,
      updateRule,
      deleteRule,
      addAlias,
      deleteAlias,
      setOverride,
      clearOverride,
    },
  };
}

function clampNum(v, min) {
  const n = Number(v);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, n);
}
