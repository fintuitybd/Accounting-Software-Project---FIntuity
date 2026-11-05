// LedgerVault — command palette.
//
// Ctrl/⌘ + K opens a single glass command surface: quick transaction actions, then every one of the
// twelve workspaces grouped into its four chapters. Search understands English, Bangla and Banglish
// — "kroy" lands on Purchases, "bikroy" on Sales, "mushak" on the VAT registers, "beton" on
// payroll, "ifrs" on the statements studio. Scoring is shared with the i18n dictionary.

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowRight, Command, CornerDownLeft, Search, Sparkles } from 'lucide-react';

import { banglishCandidates, fuzzyScore, normalizeSearch } from '../../core/i18n';
import {
  WORKSPACE_BY_KEY,
  WORKSPACE_GROUPS,
  WORKSPACES,
  type WorkspaceDescriptor,
  type WorkspaceKey,
} from '../../workspaces/registry';

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  onNavigate: (key: WorkspaceKey) => void;
  className?: string;
}

interface PaletteHit {
  workspace: WorkspaceDescriptor;
  score: number;
  matched: string;
}

interface PaletteAction {
  id: string;
  key: WorkspaceKey;
  label_en: string;
  label_bn: string;
  hint_en: string;
  hint_bn: string;
}

const ACTIONS_FIXED: PaletteAction[] = [
  {
    id: 'sales',
    key: 'W02',
    label_en: 'Create a sales invoice',
    label_bn: 'বিক্রয় চালান তৈরি',
    hint_en: 'Mushak 6.3 · VAT & VDS',
    hint_bn: 'মূসক ৬.৩ · ভ্যাট ও ভিডিএস',
  },
  {
    id: 'purchase',
    key: 'W03',
    label_en: 'Record a purchase bill',
    label_bn: 'ক্রয় বিল রেকর্ড',
    hint_en: 'VDS 4.5% · TDS schedule',
    hint_bn: 'ভিডিএস ৪.৫% · টিডিএস',
  },
  {
    id: 'challan',
    key: 'W04',
    label_en: 'Deposit a Treasury challan',
    label_bn: 'কোষাগার চালান জমা',
    hint_en: 'VAT / VDS / TDS deposit',
    hint_bn: 'ভ্যাট / ভিডিএস / টিডিএস জমা',
  },
  {
    id: 'bank',
    key: 'W06',
    label_en: 'Reconcile bank & MFS',
    label_bn: 'ব্যাংক ও এমএফএস মিলন',
    hint_en: 'Match bank, bKash, Nagad',
    hint_bn: 'ব্যাংক, বিকাশ, নগদ মিলান',
  },
  {
    id: 'close',
    key: 'W09',
    label_en: 'Run the month-end close',
    label_bn: 'মাস সমাপনী চালান',
    hint_en: 'Control proofs · lock the period',
    hint_bn: 'নিয়ন্ত্রণ প্রমাণ · সময়কাল লক',
  },
  {
    id: 'ifrs',
    key: 'W08',
    label_en: 'Open the IFRS 18 pack',
    label_bn: 'আইএফআরএস ১৮ প্যাক খুলুন',
    hint_en: 'Board-ready statements & notes',
    hint_bn: 'বোর্ড-প্রস্তুত বিবরণী ও নোট',
  },
];

const GROUP_META = new Map(WORKSPACE_GROUPS.map((group) => [group.key, group]));

function haystacks(workspace: WorkspaceDescriptor): string[] {
  return [
    workspace.code,
    workspace.label_en,
    workspace.label_bn,
    workspace.hint_en,
    workspace.hint_bn,
    ...workspace.keywords,
    ...workspace.banglish,
  ];
}

/** Score one workspace: fuzzy text match plus exact keyword / Banglish / code bonuses. */
function scoreWorkspace(workspace: WorkspaceDescriptor, query: string): { score: number; matched: string } {
  const terms = banglishCandidates(query);
  const texts = haystacks(workspace);
  let best = 0;
  let matched = workspace.label_en;

  for (const term of terms) {
    for (const text of texts) {
      const score = fuzzyScore(term, text);
      if (score > best) {
        best = score;
        matched = text;
      }
    }
  }

  const normalized = normalizeSearch(query);
  if (normalized) {
    if (workspace.keywords.some((keyword) => normalizeSearch(keyword) === normalized)) best += 1500;
    if (workspace.banglish.some((term) => normalizeSearch(term) === normalized)) best += 1300;
    if (normalizeSearch(workspace.code) === normalized) best += 1800;
  }

  return { score: best, matched };
}

function searchWorkspaces(query: string): PaletteHit[] {
  const trimmed = query.trim();
  if (!trimmed) {
    return WORKSPACES.map((workspace) => ({
      workspace,
      score: 0,
      matched: GROUP_META.get(workspace.group)?.label_en ?? workspace.label_en,
    }));
  }
  return WORKSPACES.map((workspace) => ({ workspace, ...scoreWorkspace(workspace, trimmed) }))
    .filter((hit) => hit.score > 0)
    .sort((left, right) => right.score - left.score || left.workspace.key.localeCompare(right.workspace.key))
    .slice(0, 10);
}

function searchActions(query: string): PaletteAction[] {
  const trimmed = query.trim();
  if (!trimmed) return ACTIONS_FIXED;
  const normalized = normalizeSearch(trimmed);
  return ACTIONS_FIXED.filter((action) => {
    const texts = [action.label_en, action.label_bn, action.hint_en, action.hint_bn];
    return texts.some((text) => normalizeSearch(text).includes(normalized) || fuzzyScore(trimmed, text) > 0);
  }).slice(0, 4);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function HighlightedText({ text, query }: { text: string; query: string }) {
  const trimmed = query.trim();
  if (!trimmed) return <>{text}</>;
  try {
    const parts = text.split(new RegExp(`(${escapeRegExp(trimmed)})`, 'ig'));
    return (
      <>
        {parts.map((part, index) =>
          part.toLowerCase() === trimmed.toLowerCase() ? (
            <mark key={index} className="rounded-[3px] bg-saffron/20 px-0.5 text-inherit">
              {part}
            </mark>
          ) : (
            <span key={index}>{part}</span>
          ),
        )}
      </>
    );
  } catch {
    return <>{text}</>;
  }
}

type Row =
  | { kind: 'action'; id: string; action: PaletteAction }
  | { kind: 'workspace'; id: string; hit: PaletteHit };

export function CommandPalette({ open, onClose, onNavigate, className = '' }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const workspaceHits = useMemo(() => searchWorkspaces(query), [query]);
  const actionHits = useMemo(() => searchActions(query), [query]);

  const rows = useMemo<Row[]>(() => {
    const actionRows: Row[] = actionHits.map((action) => ({ kind: 'action', id: `action:${action.id}`, action }));
    const workspaceRows: Row[] = workspaceHits.map((hit) => ({
      kind: 'workspace',
      id: `workspace:${hit.workspace.key}`,
      hit,
    }));
    return [...actionRows, ...workspaceRows];
  }, [actionHits, workspaceHits]);

  const queryTrimmed = query.trim();

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActiveIndex(0);
    const timer = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  useEffect(() => {
    setActiveIndex((current) => (rows.length === 0 ? 0 : Math.min(current, rows.length - 1)));
  }, [rows.length]);

  useEffect(() => {
    if (!open || rows.length === 0) return;
    const row = rows[activeIndex];
    if (!row) return;
    document.getElementById(`lv-cmd-${row.id}`)?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open, rows]);

  if (!open) return null;

  const choose = (row: Row): void => {
    onNavigate(row.kind === 'action' ? row.action.key : row.hit.workspace.key);
    onClose();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((current) => (rows.length === 0 ? 0 : (current + 1) % rows.length));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((current) => (rows.length === 0 ? 0 : (current - 1 + rows.length) % rows.length));
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const row = rows[activeIndex];
      if (row) choose(row);
    }
  };

  return createPortal(
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.16 }}
        className={`fixed inset-0 z-[90] flex items-start justify-center bg-ink-950/55 px-3 pt-[9vh] backdrop-blur-xl sm:px-4 ${className}`}
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
      >
        <motion.div
          initial={{ opacity: 0, y: 14, scale: 0.985 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
          role="dialog"
          aria-modal="true"
          aria-label="Command palette"
          onKeyDown={handleKeyDown}
          className="glass-panel relative w-full max-w-2xl overflow-hidden rounded-[26px] border-line/80"
        >
          <span className="brand-gradient absolute inset-x-10 top-0 h-px opacity-70" aria-hidden />
          {/* Search bar */}
          <div className="relative border-b border-line/70 px-4 py-4 sm:px-5">
            <div className="flex items-center gap-3">
              <span className="brand-gradient grid h-9 w-9 shrink-0 place-items-center rounded-[11px] text-white shadow-lift ring-1 ring-white/20">
                <Command size={16} />
              </span>
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActiveIndex(0);
                }}
                placeholder="Search workspaces, actions, “kroy”, “bikroy”, “mushak”, “beton”…"
                aria-label="Search workspaces and actions in English, Bangla or Banglish"
                className="min-w-0 flex-1 bg-transparent text-[15px] font-medium tracking-[-0.01em] text-ink-900 outline-none placeholder:text-ink-400"
              />
              <kbd className="lv-kbd hidden sm:inline-flex">esc</kbd>
            </div>
            <div className="mt-2 flex items-center gap-2 pl-12 text-[10px] text-ink-400">
              <Sparkles size={10} className="text-saffron" />
              <span>
                {queryTrimmed
                  ? `${rows.length} result${rows.length === 1 ? '' : 's'} · English · বাংলা · Banglish`
                  : 'Twelve workspaces · deterministic search, no network'}
              </span>
            </div>
          </div>

          {/* Results */}
          <div ref={listRef} className="max-h-[58vh] overflow-y-auto px-2 py-2" role="listbox" aria-label="Command results">
            {rows.length === 0 && (
              <div className="px-5 py-12 text-center">
                <p className="text-sm font-semibold text-ink-800">No match for “{query.trim()}”.</p>
                <p className="lv-hint mt-1">
                  Try English (“sales”, “close”), Bangla (“বিক্রয়”, “বেতন”) or Banglish (“bikroy”, “borton”).
                </p>
              </div>
            )}

            {rows.map((row, index) => {
              const active = index === activeIndex;
              let header: ReactNode | null = null;

              if (row.kind === 'action' && index === 0) {
                header = (
                  <SectionHeader
                    label="Quick actions"
                    caption="One-click workflows"
                    count={actionHits.length}
                  />
                );
              } else if (row.kind === 'workspace') {
                const previous = rows[index - 1];
                const previousGroup =
                  previous && previous.kind === 'workspace' ? previous.hit.workspace.group : null;
                if (previousGroup !== row.hit.workspace.group) {
                  const group = GROUP_META.get(row.hit.workspace.group);
                  header = (
                    <SectionHeader
                      label={group?.label_en ?? row.hit.workspace.group}
                      caption={group?.caption_en ?? ''}
                      count={
                        workspaceHits.filter((hit) => hit.workspace.group === row.hit.workspace.group).length
                      }
                    />
                  );
                }
              }

              if (row.kind === 'action') {
                const iconWorkspace = WORKSPACE_BY_KEY[row.action.key];
                const Icon = iconWorkspace.icon;
                return (
                  <div key={row.id}>
                    {header}
                    <button
                      type="button"
                      id={`lv-cmd-${row.id}`}
                      role="option"
                      aria-selected={active}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => choose(row)}
                      className={`group relative flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition ${
                        active ? 'text-white' : 'text-ink-800 hover:bg-ink-100/60 dark:hover:bg-white/[0.045]'
                      }`}
                    >
                      {active && (
                        <motion.span
                          layoutId="paletteActiveRow"
                          className="lv-nav-pill absolute inset-0 rounded-xl"
                          transition={{ type: 'spring', stiffness: 600, damping: 45 }}
                        />
                      )}
                      <span
                        className={`relative z-10 grid h-8 w-8 shrink-0 place-items-center rounded-[10px] ${
                          active ? 'bg-white/15 text-white' : 'bg-surface-2 text-ink-500 ring-1 ring-inset ring-line/70'
                        }`}
                      >
                        <Icon size={15} />
                      </span>
                      <span className="relative z-10 min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="truncate text-[12.5px] font-semibold">
                            <HighlightedText text={row.action.label_en} query={queryTrimmed} />
                          </span>
                          <span className={`truncate text-[11px] ${active ? 'text-white/70' : 'text-ink-400'}`}>
                            {row.action.label_bn}
                          </span>
                        </span>
                        <span className={`mt-0.5 block truncate text-[10px] ${active ? 'text-white/60' : 'text-ink-400'}`}>
                          {row.action.hint_en} · {row.action.hint_bn}
                        </span>
                      </span>
                      <span className="relative z-10 flex shrink-0 items-center gap-2">
                        <span className={`font-mono text-[9px] ${active ? 'text-white/60' : 'text-ink-400'}`}>
                          {row.action.key}
                        </span>
                        <ArrowRight size={13} className={active ? 'text-white/80' : 'text-ink-300'} />
                      </span>
                    </button>
                  </div>
                );
              }

              const { workspace, matched } = row.hit;
              const Icon = workspace.icon;
              return (
                <div key={row.id}>
                  {header}
                  <button
                    type="button"
                    id={`lv-cmd-${row.id}`}
                    role="option"
                    aria-selected={active}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => choose(row)}
                    className={`group relative flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition ${
                      active ? 'text-white' : 'text-ink-800 hover:bg-ink-100/60 dark:hover:bg-white/[0.045]'
                    }`}
                  >
                    {active && (
                      <motion.span
                        layoutId="paletteActiveRow"
                        className="lv-nav-pill absolute inset-0 rounded-xl"
                        transition={{ type: 'spring', stiffness: 600, damping: 45 }}
                      />
                    )}
                    <span
                      className={`relative z-10 grid h-8 w-8 shrink-0 place-items-center rounded-[10px] ${
                        active ? 'bg-white/15 text-white' : 'bg-surface-2 text-ink-500 ring-1 ring-inset ring-line/70'
                      }`}
                    >
                      <Icon size={15} />
                    </span>
                    <span className="relative z-10 min-w-0 flex-1">
                      <span className="flex items-baseline gap-2">
                        <span className={`font-mono text-[9px] font-semibold ${active ? 'text-white/60' : 'text-ink-400'}`}>
                          {workspace.code}
                        </span>
                        <span className="truncate text-[12.5px] font-semibold">
                          <HighlightedText text={workspace.label_en} query={queryTrimmed} />
                        </span>
                        <span className={`truncate text-[11px] ${active ? 'text-white/70' : 'text-ink-500'}`}>
                          {workspace.label_bn}
                        </span>
                      </span>
                      <span className={`mt-0.5 block truncate text-[10px] ${active ? 'text-white/60' : 'text-ink-400'}`}>
                        {queryTrimmed
                          ? `${GROUP_META.get(workspace.group)?.label_en ?? ''} · matched “${matched}”`
                          : workspace.hint_en}
                      </span>
                    </span>
                    <span className="relative z-10 flex shrink-0 items-center gap-2">
                      <kbd
                        className={`hidden font-mono text-[8.5px] sm:inline ${
                          active ? 'text-white/60' : 'text-ink-400'
                        }`}
                      >
                        {workspace.shortcut}
                      </kbd>
                      <ArrowRight size={13} className={active ? 'text-white/80' : 'text-ink-300'} />
                    </span>
                  </button>
                </div>
              );
            })}
          </div>

          {/* Footer */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line/70 bg-ink-50/55 px-4 py-2.5 text-[9.5px] text-ink-500 sm:px-5 dark:bg-white/[0.02]">
            <span className="flex flex-wrap items-center gap-3">
              <span className="flex items-center gap-1">
                <kbd className="lv-kbd !px-1 !py-0.5">↑</kbd>
                <kbd className="lv-kbd !px-1 !py-0.5">↓</kbd>
                navigate
              </span>
              <span className="flex items-center gap-1">
                <CornerDownLeft size={10} /> open
              </span>
              <span className="flex items-center gap-1">
                <Command size={10} /> K toggle
              </span>
              <span className="flex items-center gap-1">
                <kbd className="lv-kbd !px-1 !py-0.5">esc</kbd> close
              </span>
            </span>
            <span className="font-mono text-[8.5px] uppercase tracking-[0.1em] text-ink-400">
              LedgerVault OS · 12 workspaces · 3 languages
            </span>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body,
  );
}

function SectionHeader({ label, caption, count }: { label: string; caption: string; count: number }) {
  return (
    <div className="mt-2 flex items-center gap-2 px-2.5 pb-1 pt-2 first:mt-0">
      <span className="text-[8.5px] font-semibold uppercase tracking-[0.18em] text-ink-500">{label}</span>
      {caption ? <span className="text-[8.5px] text-ink-400">· {caption}</span> : null}
      <span className="ml-auto font-mono text-[8.5px] tabular-nums text-ink-400">{String(count).padStart(2, '0')}</span>
    </div>
  );
}

export default CommandPalette;
