/** Phase 6 master-data vocabularies. They mirror the existing domain types and are not tax advice. */

export const PARTY_TYPES = ['CUSTOMER', 'SUPPLIER', 'BOTH'] as const;
export const MASTER_STATUSES = ['ACTIVE', 'INACTIVE'] as const;

export const PARTY_OPENING_DOCUMENT_TYPES = [
  'SALES_INVOICE',
  'CREDIT_NOTE',
  'PURCHASE_BILL',
  'EXPENSE_VOUCHER',
] as const;

export const PARTY_OPENING_STATUSES = ['OPEN', 'CANCELLED'] as const;

export const INVENTORY_MOVEMENT_TYPES = [
  'OPENING_RECEIPT',
  'GRN_RECEIPT',
  'ISSUE',
  'RETURN_IN',
  'TRANSFER_OUT',
  'TRANSFER_IN',
  'ADJUSTMENT_IN',
  'ADJUSTMENT_OUT',
  'REVERSAL_IN',
  'REVERSAL_OUT',
] as const;

export const QUANTITY_DECIMAL_PLACES = 4;
export const QUANTITY_SCALE = 10_000n;

/** Codes are stored upper-case so a SKU or party code cannot differ only by case. */
export function normaliseMasterCode(value: string): string {
  return value.trim().toUpperCase();
}

/** Strip spaces, hyphens and other formatting from a BIN/TIN before validating the digits. */
export function digitsOnly(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const digits = value.replace(/[^0-9]/g, '');
  return digits.length > 0 ? digits : null;
}

/** Format checks only. The product does not claim that NBR has verified these identifiers. */
export function isValidBinDigits(value: string | null | undefined): boolean {
  if (!value) return false;
  if (!/^[0-9]{13}$/.test(value)) return false;
  if (/^0+$/.test(value)) return false;
  return !/^(\d)\1{12}$/.test(value);
}

export function isValidTinDigits(value: string | null | undefined): boolean {
  if (!value) return false;
  if (!/^[0-9]{12}$/.test(value)) return false;
  if (/^0+$/.test(value)) return false;
  return !/^(\d)\1{11}$/.test(value);
}

export function cleanOptionalText(value: string | null | undefined, maxLength: number): string | null {
  if (value === null || value === undefined) return null;
  const text = value.trim();
  if (!text) return null;
  if (text.length > maxLength) {
    throw new Error(`Text exceeds the supported length of ${maxLength}.`);
  }
  return text;
}
