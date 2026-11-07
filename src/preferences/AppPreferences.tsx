// Fintuity Accounting Suite — display preferences for the authenticated shell.
//
// The production shell must not depend on the synthetic demo vault. This provider owns only
// non-financial display state (language, numerals, grouping, theme, density and motion) plus the
// transient toast queue. Financial data always comes from the server APIs.
//
// Preferences are written to a dedicated localStorage key; no ledger, journal or document data is
// ever stored here. When `applyDocument` is false the provider leaves the document theme/lang
// attributes alone, which lets the isolated demo shell keep its own presentation state.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { formatPoisha } from '../core/money';
import { loadStoredPreferences, saveStoredPreferences, type StoredPreferences } from '../core/storage/preferences';
import type { AppSettings, ToastMessage } from '../core/types';
import type { Locale } from '../core/i18n';

export interface AppPreferences {
  locale: Locale;
  numeralScript: AppSettings['numeral'];
  grouping: AppSettings['grouping'];
  mode: AppSettings['mode'];
  motionTier: AppSettings['motion'];
  theme: AppSettings['theme'];
  bookFilter: AppSettings['bookFilter'];
  defaultBranchId: string | null;
}

export interface AppPreferencesValue extends AppPreferences {
  money: (poisha: bigint, options?: { sign?: boolean; symbol?: boolean }) => string;
  toasts: ToastMessage[];
  publishToast: (toast: Omit<ToastMessage, 'id'>) => void;
  dismissToast: (id: string) => void;
  setLocale: (locale: Locale) => void;
  setNumeralScript: (numeral: AppSettings['numeral']) => void;
  setGrouping: (grouping: AppSettings['grouping']) => void;
  setMode: (mode: AppSettings['mode']) => void;
  setMotionTier: (motion: AppSettings['motion']) => void;
  setTheme: (theme: AppSettings['theme']) => void;
  setBookFilter: (bookFilter: AppSettings['bookFilter']) => void;
  setDefaultBranchId: (branchId: string | null) => void;
  toggleTheme: () => void;
}

const Context = createContext<AppPreferencesValue | null>(null);

const TOAST_TIMEOUT_MS = 5200;

function initialState(): AppPreferences {
  const stored: StoredPreferences = loadStoredPreferences();
  return {
    locale: stored.locale ?? 'en-BD',
    numeralScript: stored.numeralScript ?? 'latin',
    grouping: stored.grouping ?? 'LAKH_CRORE',
    mode: stored.mode ?? 'PRO',
    motionTier: stored.motionTier ?? 'FULL',
    theme: stored.theme ?? 'LIGHT',
    bookFilter: stored.bookFilter ?? 'ALL_IFRS_BOOKS',
    defaultBranchId: stored.defaultBranchId ?? null,
  };
}

export function AppPreferencesProvider({
  children,
  applyDocument = true,
}: {
  children: ReactNode;
  /** The isolated demo shell owns the document attributes; production sets them here. */
  applyDocument?: boolean;
}) {
  const [state, setState] = useState<AppPreferences>(initialState);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const timers = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    saveStoredPreferences({
      mode: state.mode,
      locale: state.locale,
      numeralScript: state.numeralScript,
      grouping: state.grouping,
      motionTier: state.motionTier,
      theme: state.theme,
      bookFilter: state.bookFilter,
      defaultBranchId: state.defaultBranchId,
    });
  }, [state]);

  useEffect(() => {
    if (!applyDocument || typeof document === 'undefined') return;
    document.documentElement.lang = state.locale;
    document.documentElement.dataset.locale = state.locale;
    document.documentElement.dataset.motion = state.motionTier;
    document.documentElement.dataset.mode = state.mode;
    document.documentElement.dataset.theme = state.theme;
    document.documentElement.classList.toggle('dark', state.theme === 'DARK');
    document.documentElement.classList.toggle('hc', state.theme === 'CONTRAST');
    document.documentElement.style.colorScheme = state.theme === 'DARK' ? 'dark' : 'light';
    const themeMeta = document.querySelector('meta[name="theme-color"]');
    if (themeMeta) {
      themeMeta.setAttribute(
        'content',
        state.theme === 'DARK' ? '#0c1210' : state.theme === 'CONTRAST' ? '#ffffff' : '#f7f5ef',
      );
    }
  }, [applyDocument, state.locale, state.mode, state.motionTier, state.theme]);

  useEffect(
    () => () => {
      for (const timer of timers.current.values()) window.clearTimeout(timer);
      timers.current.clear();
    },
    [],
  );

  const dismissToast = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const publishToast = useCallback((toast: Omit<ToastMessage, 'id'>) => {
    const id = `TOAST-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setToasts((current) => [...current.slice(-3), { ...toast, id }]);
    const timer = window.setTimeout(() => {
      timers.current.delete(id);
      setToasts((current) => current.filter((entry) => entry.id !== id));
    }, TOAST_TIMEOUT_MS);
    timers.current.set(id, timer);
  }, []);

  const money = useCallback(
    (poisha: bigint, options?: { sign?: boolean; symbol?: boolean }) =>
      formatPoisha(poisha, {
        locale: state.locale,
        numeral: state.numeralScript,
        grouping: state.grouping,
        showSign: options?.sign,
        showSymbol: options?.symbol,
      }),
    [state.grouping, state.locale, state.numeralScript],
  );

  const setLocale = useCallback((locale: Locale) => {
    setState((current) => ({ ...current, locale }));
  }, []);
  const setNumeralScript = useCallback((numeralScript: AppSettings['numeral']) => {
    setState((current) => ({ ...current, numeralScript }));
  }, []);
  const setGrouping = useCallback((grouping: AppSettings['grouping']) => {
    setState((current) => ({ ...current, grouping }));
  }, []);
  const setMode = useCallback((mode: AppSettings['mode']) => {
    setState((current) => ({ ...current, mode }));
  }, []);
  const setMotionTier = useCallback((motionTier: AppSettings['motion']) => {
    setState((current) => ({ ...current, motionTier }));
  }, []);
  const setTheme = useCallback((theme: AppSettings['theme']) => {
    setState((current) => ({ ...current, theme }));
  }, []);
  const setBookFilter = useCallback((bookFilter: AppSettings['bookFilter']) => {
    setState((current) => ({ ...current, bookFilter }));
  }, []);
  const setDefaultBranchId = useCallback((defaultBranchId: string | null) => {
    setState((current) => ({ ...current, defaultBranchId: defaultBranchId || null }));
  }, []);
  const toggleTheme = useCallback(() => {
    setState((current) => ({ ...current, theme: current.theme === 'DARK' ? 'LIGHT' : 'DARK' }));
  }, []);

  const value = useMemo<AppPreferencesValue>(
    () => ({
      ...state,
      money,
      toasts,
      publishToast,
      dismissToast,
      setLocale,
      setNumeralScript,
      setGrouping,
      setMode,
      setMotionTier,
      setTheme,
      setBookFilter,
      setDefaultBranchId,
      toggleTheme,
    }),
    [
      state,
      money,
      toasts,
      publishToast,
      dismissToast,
      setLocale,
      setNumeralScript,
      setGrouping,
      setMode,
      setMotionTier,
      setTheme,
      setBookFilter,
      setDefaultBranchId,
      toggleTheme,
    ],
  );

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function usePreferences(): AppPreferencesValue {
  const value = useContext(Context);
  if (!value) throw new Error('usePreferences must be used inside AppPreferencesProvider.');
  return value;
}
