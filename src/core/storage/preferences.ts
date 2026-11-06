import type { AppSettings } from '../types';

/**
 * Display preferences are not financial data. Keeping them in a separate key lets the real
 * (server-backed) shell remember language/theme without ever loading a legacy demo vault snapshot.
 */
export const PREFERENCES_KEY = 'ledgervault.v2.preferences';

export interface StoredPreferences {
  mode?: AppSettings['mode'];
  locale?: AppSettings['locale'];
  numeralScript?: AppSettings['numeral'];
  grouping?: AppSettings['grouping'];
  motionTier?: AppSettings['motion'];
  theme?: AppSettings['theme'];
  bookFilter?: AppSettings['bookFilter'];
  /** Display-only default used to prefill new documents; never a server authorization scope. */
  defaultBranchId?: string | null;
}

export function loadStoredPreferences(): StoredPreferences {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(PREFERENCES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as StoredPreferences;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function saveStoredPreferences(preferences: StoredPreferences): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
  } catch {
    // A blocked storage quota only loses display preferences.
  }
}
