import { useEffect, useMemo, useState } from 'react';
import { Columns3, Save, Trash2 } from 'lucide-react';
import { usePreferences } from '../../preferences/AppPreferences';

export interface SavedTableView {
  id: string;
  name: string;
  state: Record<string, string>;
}

const STORAGE_PREFIX = 'fintuity.v2.tableviews.';

export function loadSavedViews(key: string): SavedTableView[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(`${STORAGE_PREFIX}${key}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is SavedTableView => {
        if (!entry || typeof entry !== 'object') return false;
        const candidate = entry as SavedTableView;
        return typeof candidate.id === 'string' && typeof candidate.name === 'string' && !!candidate.state && typeof candidate.state === 'object';
      })
      .slice(0, 20);
  } catch {
    return [];
  }
}

export function persistSavedViews(key: string, views: SavedTableView[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(`${STORAGE_PREFIX}${key}`, JSON.stringify(views.slice(0, 20)));
  } catch {
    // Saved views are a display convenience only; blocked storage loses no financial data.
  }
}

export function SavedViews({
  storageKey,
  currentState,
  onApply,
}: {
  storageKey: string;
  currentState: Record<string, string>;
  onApply: (state: Record<string, string>) => void;
}) {
  const { locale } = usePreferences();
  const L = (en: string, bn: string) => (locale === 'bn-BD' ? bn : en);
  const [views, setViews] = useState<SavedTableView[]>([]);
  const [selected, setSelected] = useState('');

  useEffect(() => {
    setViews(loadSavedViews(storageKey));
  }, [storageKey]);

  const saveCurrent = () => {
    const name = window.prompt(L('Name this view', 'এই ভিউয়ের নাম দিন'));
    if (!name || !name.trim()) return;
    const next: SavedTableView[] = [
      ...views,
      {
        id: `view-${Date.now().toString(36)}`,
        name: name.trim().slice(0, 60),
        state: currentState,
      },
    ].slice(-20);
    setViews(next);
    persistSavedViews(storageKey, next);
    setSelected(next[next.length - 1]?.id ?? '');
  };

  const removeSelected = () => {
    if (!selected) return;
    const next = views.filter((view) => view.id !== selected);
    setViews(next);
    persistSavedViews(storageKey, next);
    setSelected('');
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="flex items-center gap-2 text-[12px] text-ql-ink-muted">
        <span className="font-medium">{L('Saved view', 'সংরক্ষিত ভিউ')}</span>
        <select
          value={selected}
          onChange={(event) => {
            const next = event.target.value;
            setSelected(next);
            const view = views.find((entry) => entry.id === next);
            if (view) onApply(view.state);
          }}
          className="ql-select min-h-10 w-[190px] text-[13px]"
        >
          <option value="">{L('Choose a view', 'একটি ভিউ নির্বাচন করুন')}</option>
          {views.map((view) => (
            <option key={view.id} value={view.id}>{view.name}</option>
          ))}
        </select>
      </label>
      <button type="button" onClick={saveCurrent} className="ql-btn ql-btn-secondary ql-btn-sm">
        <Save size={14} aria-hidden /> {L('Save view', 'ভিউ সংরক্ষণ')}
      </button>
      {selected ? (
        <button
          type="button"
          onClick={removeSelected}
          className="ql-btn ql-btn-secondary ql-btn-sm"
          aria-label={L('Delete selected view', 'নির্বাচিত ভিউ মুছুন')}
        >
          <Trash2 size={14} aria-hidden />
        </button>
      ) : null}
    </div>
  );
}

export function ColumnPicker<T extends string>({
  columns,
  visible,
  onChange,
}: {
  columns: ReadonlyArray<{ key: T; label: string }>;
  visible: ReadonlyArray<T>;
  onChange: (next: T[]) => void;
}) {
  const { locale } = usePreferences();
  const L = (en: string, bn: string) => (locale === 'bn-BD' ? bn : en);
  const [open, setOpen] = useState(false);
  const visibleSet = useMemo(() => new Set(visible), [visible]);

  return (
    <details
      className="relative"
      open={open}
      onToggle={(event) => setOpen((event.currentTarget as HTMLDetailsElement).open)}
    >
      <summary className="ql-btn ql-btn-secondary ql-btn-sm cursor-pointer list-none">
        <Columns3 size={14} aria-hidden /> {L('Columns', 'কলাম')}
      </summary>
      <fieldset className="absolute right-0 z-20 mt-1 w-[220px] rounded-ql border border-ql-border bg-ql-surface p-2 shadow-ql-popover">
        <legend className="px-1 pb-1 text-[12px] font-semibold text-ql-ink-muted">{L('Visible columns', 'দৃশ্যমান কলাম')}</legend>
        {columns.map((column) => {
          const checked = visibleSet.has(column.key);
          return (
            <label key={column.key} className="flex min-h-9 items-center gap-2 rounded px-1.5 text-[13px] text-ql-ink hover:bg-ql-surface-muted">
              <input
                type="checkbox"
                checked={checked}
                onChange={() => {
                  if (checked && visible.length <= 1) return;
                  onChange(
                    checked
                      ? visible.filter((entry) => entry !== column.key)
                      : columns.filter((entry) => visibleSet.has(entry.key) || entry.key === column.key).map((entry) => entry.key),
                  );
                }}
              />
              {column.label}
            </label>
          );
        })}
      </fieldset>
    </details>
  );
}

export function loadVisibleColumns<T extends string>(key: string, fallback: readonly T[]): T[] {
  if (typeof window === 'undefined') return [...fallback];
  try {
    const raw = window.localStorage.getItem(`fintuity.v2.columns.${key}`);
    if (!raw) return [...fallback];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [...fallback];
    const valid = parsed.filter((entry): entry is T => typeof entry === 'string' && (fallback as readonly string[]).includes(entry));
    return valid.length > 0 ? valid : [...fallback];
  } catch {
    return [...fallback];
  }
}

export function saveVisibleColumns<T extends string>(key: string, columns: readonly T[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(`fintuity.v2.columns.${key}`, JSON.stringify(columns));
  } catch {
    // Display preference only.
  }
}
