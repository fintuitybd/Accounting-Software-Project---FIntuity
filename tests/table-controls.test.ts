import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  loadSavedViews,
  loadVisibleColumns,
  persistSavedViews,
  saveVisibleColumns,
} from '../src/pages/tables/TableControls';

function installStorage() {
  const values = new Map<string, string>();
  const localStorage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
    clear: () => values.clear(),
  };
  vi.stubGlobal('window', { localStorage });
  return values;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('saved table views', () => {
  it('round-trips named filter states and drops malformed entries', () => {
    const values = installStorage();
    persistSavedViews('sales-test', [
      { id: 'view-1', name: 'Overdue drafts', state: { status: 'DRAFT', search: 'acme' } },
      { id: 'bad', name: 'Bad state', state: null as never },
    ]);
    const loaded = loadSavedViews('sales-test');
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.name).toBe('Overdue drafts');
    expect(loaded[0]?.state.status).toBe('DRAFT');

    values.set('ledgervault.v2.tableviews.broken', '{not json');
    expect(loadSavedViews('broken')).toEqual([]);
  });

  it('returns an empty set when storage is unavailable', () => {
    vi.stubGlobal('window', undefined);
    expect(loadSavedViews('missing')).toEqual([]);
    expect(loadVisibleColumns('missing', ['a', 'b'] as const)).toEqual(['a', 'b']);
  });
});

describe('column choice', () => {
  it('persists only known columns and restores them', () => {
    installStorage();
    saveVisibleColumns<string>('sales-columns', ['document', 'status', 'unknown']);
    expect(loadVisibleColumns('sales-columns', ['document', 'customer', 'status'] as const)).toEqual([
      'document',
      'status',
    ]);
  });

  it('falls back when every stored column is unknown', () => {
    installStorage();
    saveVisibleColumns<string>('sales-columns', ['unknown']);
    expect(loadVisibleColumns('sales-columns', ['document', 'customer'] as const)).toEqual(['document', 'customer']);
  });
});
