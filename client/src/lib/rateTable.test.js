import { describe, it, expect } from 'vitest';
import { MAX_RATES, nextId, upsertRule, upsertAlias, repairConfig } from './rateTable.js';

describe('nextId', () => {
  it('is max numeric id + 1 as a string', () => {
    expect(nextId([{ id: '1' }, { id: '2' }])).toBe('3');
  });
  it('tolerates legacy prefixed and mixed ids', () => {
    expect(nextId([{ id: 'r100' }, { id: '7' }, { id: 'junk' }])).toBe('101');
  });
  it('starts at 1 for an empty list', () => {
    expect(nextId([])).toBe('1');
    expect(nextId()).toBe('1');
  });
  it('never reuses: max+1 even with gaps', () => {
    expect(nextId([{ id: '5' }])).toBe('6');
  });
});

describe('upsertRule', () => {
  const table = [
    { id: '1', name: 'Thomas Cox', rate: 250 },
    { id: '2', name: 'Jane Smith', rate: 95 },
  ];

  it('adds a genuinely new name with a fresh unique id', () => {
    const { table: out, result } = upsertRule(table, 'Acme CFO', 220);
    expect(result).toBe('added');
    expect(out).toHaveLength(3);
    expect(out[2]).toMatchObject({ name: 'Acme CFO', rate: 220 });
    expect(new Set(out.map((r) => r.id)).size).toBe(3); // ids unique
  });

  it('updates an existing name (normalized) instead of adding — count unchanged', () => {
    const { table: out, result } = upsertRule(table, ' thomas  cox. ', 300);
    expect(result).toBe('updated');
    expect(out).toHaveLength(2);
    expect(out.find((r) => r.name === 'Thomas Cox').rate).toBe(300);
  });

  it('does not add a second row for a duplicate name (the Fathom-bot case)', () => {
    let t = [{ id: '1', name: "Thomas's Fathom Notetaker", rate: 0 }];
    ({ table: t } = upsertRule(t, "Thomas's Fathom Notetaker", 0));
    ({ table: t } = upsertRule(t, "Thomas's Fathom Notetaker", 0));
    expect(t).toHaveLength(1);
  });

  it('rejects a new name at the cap but still allows upserting an existing one', () => {
    const full = Array.from({ length: MAX_RATES }, (_, i) => ({
      id: String(i + 1),
      name: `P${i}`,
      rate: 10,
    }));
    const rejected = upsertRule(full, 'New Person', 50);
    expect(rejected.result).toBe('rejected-cap');
    expect(rejected.table).toHaveLength(MAX_RATES);

    const updated = upsertRule(full, 'P0', 99);
    expect(updated.result).toBe('updated');
    expect(updated.table).toHaveLength(MAX_RATES);
    expect(updated.table[0].rate).toBe(99);
  });

  it('ignores empty/whitespace names', () => {
    expect(upsertRule(table, '   ', 10).result).toBe('empty');
    expect(upsertRule(table, '   ', 10).table).toBe(table);
  });

  it('does not mutate the input table', () => {
    const snapshot = JSON.parse(JSON.stringify(table));
    upsertRule(table, 'Acme CFO', 220);
    expect(table).toEqual(snapshot);
  });
});

describe('upsertAlias', () => {
  const aliases = [{ id: '1', alias: 'Tom Cox', canonical: 'Thomas Cox' }];

  it('adds a new alias with a fresh id', () => {
    const { list, result } = upsertAlias(aliases, 'JS', 'Jane Smith');
    expect(result).toBe('added');
    expect(list).toHaveLength(2);
    expect(new Set(list.map((a) => a.id)).size).toBe(2);
  });

  it('re-maps an existing alias (normalized) instead of duplicating', () => {
    const { list, result } = upsertAlias(aliases, 'tom cox', 'Thomas B. Cox');
    expect(result).toBe('updated');
    expect(list).toHaveLength(1);
    expect(list[0].canonical).toBe('Thomas B. Cox');
  });

  it('requires both alias and canonical', () => {
    expect(upsertAlias(aliases, 'x', '  ').result).toBe('empty');
    expect(upsertAlias(aliases, '  ', 'x').result).toBe('empty');
  });

  it('enforces the cap on new aliases', () => {
    const full = Array.from({ length: MAX_RATES }, (_, i) => ({
      id: String(i + 1),
      alias: `A${i}`,
      canonical: `C${i}`,
    }));
    expect(upsertAlias(full, 'New', 'Target').result).toBe('rejected-cap');
    expect(upsertAlias(full, 'A0', 'Changed').result).toBe('updated');
  });
});

describe('repairConfig', () => {
  it('is identity-preserving (no save echo) on a clean config', () => {
    const config = {
      rateTable: [
        { id: '1', name: 'Thomas Cox', rate: 250 },
        { id: '2', name: 'Jane Smith', rate: 95 },
      ],
      aliases: [{ id: '1', alias: 'Tom Cox', canonical: 'Thomas Cox' }],
    };
    const { config: out, changed } = repairConfig(config);
    expect(changed).toBe(false);
    expect(out).toBe(config); // same reference
  });

  it('re-ids colliding rows, keeping the first occurrence of each id', () => {
    // Two rows share id 'r100' (the reported collision).
    const config = {
      rateTable: [
        { id: 'r100', name: 'Alice', rate: 10 },
        { id: 'r100', name: 'Bob', rate: 20 },
      ],
      aliases: [],
    };
    const { config: out, changed } = repairConfig(config);
    expect(changed).toBe(true);
    const ids = out.rateTable.map((r) => r.id);
    expect(new Set(ids).size).toBe(2); // now unique
    expect(out.rateTable[0]).toEqual({ id: 'r100', name: 'Alice', rate: 10 }); // first kept as-is
    expect(out.rateTable[1].name).toBe('Bob'); // preserved, re-id'd
    expect(out.rateTable).toHaveLength(2); // distinct names → both kept
  });

  it('collapses duplicate normalized names, keeping the first (rate)', () => {
    const config = {
      rateTable: [
        { id: '1', name: "Thomas's Fathom Notetaker", rate: 0 },
        { id: '2', name: "thomas's fathom notetaker", rate: 999 },
        { id: '3', name: "Thomas's Fathom Notetaker", rate: 5 },
        { id: '4', name: 'Real Person', rate: 200 },
      ],
      aliases: [],
    };
    const { config: out, changed } = repairConfig(config);
    expect(changed).toBe(true);
    expect(out.rateTable).toHaveLength(2);
    expect(out.rateTable[0]).toMatchObject({ name: "Thomas's Fathom Notetaker", rate: 0 });
    expect(out.rateTable[1]).toMatchObject({ name: 'Real Person', rate: 200 });
  });

  it('does not truncate an over-cap but otherwise-clean list', () => {
    const rateTable = Array.from({ length: 12 }, (_, i) => ({
      id: String(i + 1),
      name: `P${i}`,
      rate: 10,
    }));
    const { config: out, changed } = repairConfig({ rateTable, aliases: [] });
    expect(changed).toBe(false);
    expect(out.rateTable).toHaveLength(12);
  });

  it('repairs aliases the same way (dup ids + dup normalized alias)', () => {
    const config = {
      rateTable: [],
      aliases: [
        { id: '1', alias: 'Tom Cox', canonical: 'Thomas Cox' },
        { id: '1', alias: 'tom cox', canonical: 'Someone Else' }, // dup id AND dup alias
      ],
    };
    const { config: out, changed } = repairConfig(config);
    expect(changed).toBe(true);
    expect(out.aliases).toHaveLength(1); // dup alias collapsed (first kept)
    expect(out.aliases[0].canonical).toBe('Thomas Cox');
  });

  it('is idempotent — repairing a repaired config makes no further change', () => {
    const config = {
      rateTable: [
        { id: 'r100', name: 'Alice', rate: 10 },
        { id: 'r100', name: 'Alice', rate: 20 },
      ],
      aliases: [],
    };
    const once = repairConfig(config).config;
    const { changed } = repairConfig(once);
    expect(changed).toBe(false);
  });
});
