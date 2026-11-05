// LedgerVault — durable vault storage.
//
// Two persistence doors over the same JSON snapshot:
//   1. localStorage  — synchronous, survives tab close and load-shedding;
//   2. IndexedDB     — larger quota, asynchronous, survives localStorage eviction.
//
// Every snapshot is COMPLETE: accounts, parties, items, statutory records and the full journal
// chain are written exactly as they live in memory. Money is bigint in memory, so the serializer
// rewrites bigint values to decimal strings and the reader revives every `*_poisha` key back to
// bigint — no floating-point round trip is ever introduced.
//
// The same snapshot format powers the portable `.vault.json` export/import used for backups,
// accountant hand-offs and migration between browsers.

import { revivePoishaDeep } from '../money';

export const VAULT_STORAGE_KEY = 'ledgervault.v2.vault';
export const VAULT_STORAGE_VERSION = 2;

export const VAULT_DB_NAME = 'ledgervault.vaultdb';
export const VAULT_DB_VERSION = 1;
export const VAULT_SNAPSHOT_STORE = 'snapshots';
export const VAULT_SNAPSHOT_KEY = 'current';

export const VAULT_FILE_FORMAT = 'ledgervault.vault';
export const VAULT_FILE_APP = 'LedgerVault';

export type VaultSnapshotSource = 'localstorage' | 'indexeddb';

export interface VaultSnapshotEnvelope {
  version: number;
  saved_at: string;
  state: unknown;
}

export interface RestoredVaultState<T> {
  state: T;
  saved_at: string;
  source: VaultSnapshotSource;
  version: number;
}

export interface VaultSaveResult {
  local: boolean;
  indexed: boolean;
  saved_at: string;
}

export interface VaultFileEnvelope {
  format: typeof VAULT_FILE_FORMAT;
  app: typeof VAULT_FILE_APP;
  version: number;
  exported_at: string;
  state: unknown;
}

export interface VaultFileImport<T> {
  state: T;
  version: number;
  saved_at: string | null;
  file_name?: string;
}

export interface VaultFileOptions {
  fileName?: string;
  companyName?: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

// ---------------------------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------------------------

function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value;
}

/** JSON with bigint-safe encoding. Never calls `Number()` on a money value. */
export function serializeVault(value: unknown): string {
  return JSON.stringify(value, bigintReplacer) ?? 'null';
}

/** Parse a snapshot and revive all `*_poisha` keys to bigint. */
export function reviveVaultSnapshot<T>(raw: unknown): T | null {
  try {
    if (typeof raw === 'string') {
      return revivePoishaDeep(JSON.parse(raw) as T);
    }
    return revivePoishaDeep(raw) as T;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// localStorage — complete synchronous snapshot
// ---------------------------------------------------------------------------------------------

function writeLocalSnapshot(state: unknown, savedAt: string): boolean {
  if (!isBrowser()) return false;
  try {
    const envelope: VaultSnapshotEnvelope = {
      version: VAULT_STORAGE_VERSION,
      saved_at: savedAt,
      state,
    };
    window.localStorage.setItem(VAULT_STORAGE_KEY, serializeVault(envelope));
    return true;
  } catch {
    // Quota exceeded or private mode — IndexedDB remains the durable fallback.
    return false;
  }
}

function readLocalEnvelope(): VaultSnapshotEnvelope | null {
  if (!isBrowser()) return null;
  try {
    const raw = window.localStorage.getItem(VAULT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    const version = typeof record.version === 'number' ? record.version : VAULT_STORAGE_VERSION;
    const savedAt = typeof record.saved_at === 'string' ? record.saved_at : '';
    if ('state' in record) {
      return { version, saved_at: savedAt, state: record.state };
    }
    // A raw, unwrapped state written by an older build.
    return { version, saved_at: savedAt, state: parsed };
  } catch {
    return null;
  }
}

export function saveLocalVaultSnapshot(state: unknown): boolean {
  return writeLocalSnapshot(state, nowIso());
}

export function loadLocalVaultSnapshot<T>(): RestoredVaultState<T> | null {
  const envelope = readLocalEnvelope();
  if (!envelope) return null;
  const state = reviveVaultSnapshot<T>(envelope.state);
  if (!state) return null;
  return {
    state,
    saved_at: envelope.saved_at,
    source: 'localstorage',
    version: envelope.version,
  };
}

export function hasLocalVaultSnapshot(): boolean {
  if (!isBrowser()) return false;
  try {
    return window.localStorage.getItem(VAULT_STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

export function clearLocalVaultSnapshot(): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.removeItem(VAULT_STORAGE_KEY);
  } catch {
    // Nothing to clear.
  }
}

// ---------------------------------------------------------------------------------------------
// IndexedDB — high-capacity durable snapshot
// ---------------------------------------------------------------------------------------------

function openVaultDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(VAULT_DB_NAME, VAULT_DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      try {
        const db = request.result;
        if (!db.objectStoreNames.contains(VAULT_SNAPSHOT_STORE)) {
          db.createObjectStore(VAULT_SNAPSHOT_STORE);
        }
      } catch {
        // The open request will surface the failure through onerror.
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

async function writeIndexedSnapshot(state: unknown, savedAt: string): Promise<boolean> {
  const db = await openVaultDb();
  if (!db) return false;
  return new Promise((resolve) => {
    let settled = false;
    const settle = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      try {
        db.close();
      } catch {
        // Already closed.
      }
      resolve(ok);
    };
    try {
      const transaction = db.transaction(VAULT_SNAPSHOT_STORE, 'readwrite');
      transaction.oncomplete = () => settle(true);
      transaction.onerror = () => settle(false);
      transaction.onabort = () => settle(false);
      const envelope: VaultSnapshotEnvelope = {
        version: VAULT_STORAGE_VERSION,
        saved_at: savedAt,
        state,
      };
      transaction.objectStore(VAULT_SNAPSHOT_STORE).put(serializeVault(envelope), VAULT_SNAPSHOT_KEY);
    } catch {
      settle(false);
    }
  });
}

export async function saveIndexedVaultSnapshot(state: unknown): Promise<boolean> {
  return writeIndexedSnapshot(state, nowIso());
}

export async function loadIndexedVaultSnapshot<T>(): Promise<RestoredVaultState<T> | null> {
  const db = await openVaultDb();
  if (!db) return null;
  return new Promise((resolve) => {
    let settled = false;
    const settle = (value: RestoredVaultState<T> | null): void => {
      if (settled) return;
      settled = true;
      try {
        db.close();
      } catch {
        // Already closed.
      }
      resolve(value);
    };
    try {
      const transaction = db.transaction(VAULT_SNAPSHOT_STORE, 'readonly');
      const request = transaction.objectStore(VAULT_SNAPSHOT_STORE).get(VAULT_SNAPSHOT_KEY);
      request.onsuccess = () => {
        const raw = request.result as unknown;
        if (typeof raw !== 'string' || raw.length === 0) {
          settle(null);
          return;
        }
        try {
          const parsed = JSON.parse(raw) as Record<string, unknown>;
          const stateRaw = 'state' in parsed ? parsed.state : parsed;
          const state = reviveVaultSnapshot<T>(stateRaw);
          if (!state) {
            settle(null);
            return;
          }
          settle({
            state,
            saved_at: typeof parsed.saved_at === 'string' ? parsed.saved_at : '',
            source: 'indexeddb',
            version: typeof parsed.version === 'number' ? parsed.version : VAULT_STORAGE_VERSION,
          });
        } catch {
          settle(null);
        }
      };
      request.onerror = () => settle(null);
      transaction.onerror = () => settle(null);
      transaction.onabort = () => settle(null);
    } catch {
      settle(null);
    }
  });
}

export async function clearIndexedVaultSnapshot(): Promise<void> {
  const db = await openVaultDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const transaction = db.transaction(VAULT_SNAPSHOT_STORE, 'readwrite');
      transaction.objectStore(VAULT_SNAPSHOT_STORE).delete(VAULT_SNAPSHOT_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => resolve();
      transaction.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
  try {
    db.close();
  } catch {
    // Already closed.
  }
}

// ---------------------------------------------------------------------------------------------
// Combined lifecycle
// ---------------------------------------------------------------------------------------------

/**
 * Write the complete snapshot to both stores. localStorage is written first so that even if the
 * IndexedDB transaction is interrupted, a synchronous reload still sees the latest state.
 */
export async function saveVaultSnapshot(state: unknown): Promise<VaultSaveResult> {
  const savedAt = nowIso();
  const local = writeLocalSnapshot(state, savedAt);
  const indexed = await writeIndexedSnapshot(state, savedAt);
  return { local, indexed, saved_at: savedAt };
}

/** Read both stores and return whichever snapshot was written most recently. */
export async function loadLatestVaultSnapshot<T>(): Promise<RestoredVaultState<T> | null> {
  const local = loadLocalVaultSnapshot<T>();
  const indexed = await loadIndexedVaultSnapshot<T>();
  if (!local) return indexed;
  if (!indexed) return local;
  const localTime = Date.parse(local.saved_at);
  const indexedTime = Date.parse(indexed.saved_at);
  if (!Number.isFinite(localTime)) return indexed;
  if (!Number.isFinite(indexedTime)) return local;
  return indexedTime > localTime ? indexed : local;
}

// ---------------------------------------------------------------------------------------------
// Portable `.vault.json` file export / import
// ---------------------------------------------------------------------------------------------

export function buildVaultFilePayload(state: unknown): string {
  const envelope: VaultFileEnvelope = {
    format: VAULT_FILE_FORMAT,
    app: VAULT_FILE_APP,
    version: VAULT_STORAGE_VERSION,
    exported_at: nowIso(),
    state,
  };
  return serializeVault(envelope);
}

export function vaultFileName(companyName?: string, at: Date = new Date()): string {
  const base = (companyName ?? 'ledgervault')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  const stamp = at.toISOString().slice(0, 10);
  return `${base || 'ledgervault'}-${stamp}.vault.json`;
}

/** Trigger a browser download of the complete vault and return the generated file name. */
export function downloadVaultFile(state: unknown, options: VaultFileOptions = {}): string | null {
  if (typeof document === 'undefined' || typeof URL === 'undefined' || typeof Blob === 'undefined') {
    return null;
  }
  const fileName = options.fileName ?? vaultFileName(options.companyName);
  try {
    const blob = new Blob([buildVaultFilePayload(state)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    return fileName;
  } catch {
    return null;
  }
}

/** Parse an exported `.vault.json` string (or a legacy raw snapshot string). */
export function parseVaultFile<T>(raw: string): VaultFileImport<T> | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    const isEnvelope = record.format === VAULT_FILE_FORMAT || 'state' in record;
    const stateRaw = isEnvelope ? record.state : parsed;
    if (!stateRaw || typeof stateRaw !== 'object') return null;
    const state = reviveVaultSnapshot<T>(stateRaw);
    if (!state) return null;
    return {
      state,
      version: typeof record.version === 'number' ? record.version : VAULT_STORAGE_VERSION,
      saved_at: typeof record.exported_at === 'string' ? record.exported_at : null,
    };
  } catch {
    return null;
  }
}

export async function importVaultFile<T>(file: File): Promise<VaultFileImport<T> | null> {
  try {
    const raw = await file.text();
    const parsed = parseVaultFile<T>(raw);
    if (!parsed) return null;
    return { ...parsed, file_name: file.name };
  } catch {
    return null;
  }
}
