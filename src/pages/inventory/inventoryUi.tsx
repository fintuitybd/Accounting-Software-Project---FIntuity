import type { SetupAccount } from '../../setup/api';
import type { Item, Warehouse } from '../../masters/api';

export interface InventoryRefs {
  accounts: SetupAccount[];
  items: Item[];
  warehouses: Warehouse[];
}

export const MOVEMENT_TYPE_LABELS: Record<string, [string, string]> = {
  OPENING_RECEIPT: ['Opening stock', 'উদ্বোধনী স্টক'],
  GRN_RECEIPT: ['GRN receipt', 'জিআরএন গ্রহণ'],
  ISSUE: ['Issue / COGS', 'ইস্যু / সিওজিএস'],
  RETURN_IN: ['Return in', 'ফেরত গ্রহণ'],
  TRANSFER_OUT: ['Transfer out', 'স্থানান্তর বাহির'],
  TRANSFER_IN: ['Transfer in', 'স্থানান্তর আগমন'],
  ADJUSTMENT_IN: ['Adjustment increase', 'সমন্বয় বৃদ্ধি'],
  ADJUSTMENT_OUT: ['Adjustment decrease', 'সমন্বয় হ্রাস'],
  REVERSAL_IN: ['Reversal in', 'রিভার্সাল আগমন'],
  REVERSAL_OUT: ['Reversal out', 'রিভার্সাল বাহির'],
};

export function movementTypeLabel(type: string, localized: (en: string, bn: string) => string): string {
  const labels = MOVEMENT_TYPE_LABELS[type] ?? [type, type];
  return localized(labels[0], labels[1]);
}

export function movementTone(type: string): string {
  if (type === 'ISSUE' || type === 'TRANSFER_OUT' || type === 'ADJUSTMENT_OUT' || type === 'REVERSAL_OUT') {
    return 'text-rose-700 dark:text-rose-300';
  }
  return 'text-emerald-700 dark:text-emerald-300';
}

/** Quantities are decimal strings with four places, so never pass them to BigInt. */
export function isNegativeQuantity(quantity: string): boolean {
  return quantity.trim().startsWith('-');
}
