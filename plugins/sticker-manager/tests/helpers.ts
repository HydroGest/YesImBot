/* eslint-disable vitest/require-mock-type-parameters */
import { vi } from "vitest";

type Row = Record<string, unknown>;

export function createMemoryModel<T extends Row>() {
  const tables = new Map<string, T[]>();
  const extend = vi.fn();
  const get = vi.fn(async (table: string, query: Record<string, unknown>) => (tables.get(table) ?? []).filter((row) => matches(row, query)));
  const create = vi.fn(async (table: string, row: T) => {
    const rows = tables.get(table) ?? [];
    rows.push(row);
    tables.set(table, rows);
    return row;
  });
  const set = vi.fn(async (table: string, query: Record<string, unknown>, patch: Partial<T>) => {
    const rows = tables.get(table) ?? [];
    let matched = 0;
    for (const row of rows) {
      if (matches(row, query)) {
        Object.assign(row, patch);
        matched += 1;
      }
    }
    return { matched };
  });
  const remove = vi.fn(async (table: string, query: Record<string, unknown>) => {
    const rows = tables.get(table) ?? [];
    const removed = rows.filter((row) => matches(row, query));
    tables.set(
      table,
      rows.filter((row) => !matches(row, query)),
    );
    return { removed: removed.length, matched: removed.length };
  });
  return { tables, extend, get, create, set, remove };
}

function matches(row: Row, query: Record<string, unknown>): boolean {
  return Object.entries(query).every(([key, value]) => row[key] === value);
}
