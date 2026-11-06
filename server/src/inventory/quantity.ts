import { AppError } from '../errors.ts';
import { parseQuantity } from '../company/money.ts';
import { QUANTITY_SCALE } from '../master/constants.ts';

/**
 * Quantities are stored as ten-thousandths (NUMERIC(18,4)). Four decimal places are the documented
 * precision for kg, metres and other fractional units. All arithmetic below is BigInt; no JavaScript
 * floating point is used for an authoritative quantity or value.
 */
export function parsePositiveQuantity(value: unknown, label = 'Quantity'): bigint {
  const parsed = parseQuantity(value);
  if (parsed === null || parsed <= 0n) {
    throw new AppError(400, 'QUANTITY_INVALID', `${label} must be a positive number with at most four decimal places.`);
  }
  return parsed;
}

export function parseStoredQuantity(value: string | number): bigint {
  const text = String(value).trim();
  const match = /^(-?)(0|[1-9][0-9]*)(?:\.([0-9]{1,4}))?$/.exec(text);
  if (!match) return 0n;
  const sign = match[1] === '-' ? -1n : 1n;
  const whole = BigInt(match[2] ?? '0');
  const fraction = BigInt(((match[3] ?? '') + '0000').slice(0, 4));
  return sign * (whole * QUANTITY_SCALE + fraction);
}

export function formatQuantity(value: bigint): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / QUANTITY_SCALE;
  const fraction = absolute % QUANTITY_SCALE;
  return `${negative ? '-' : ''}${whole.toString()}.${fraction.toString().padStart(4, '0')}`;
}

/** Half-up integer division with an explicit sign. Used for deterministic valuation. */
export function divideRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) {
    throw new AppError(409, 'STOCK_VALUATION_DIVIDE_BY_ZERO', 'Cannot value a movement against a zero balance.');
  }
  const negative = numerator < 0n !== denominator < 0n;
  const absoluteNumerator = numerator < 0n ? -numerator : numerator;
  const absoluteDenominator = denominator < 0n ? -denominator : denominator;
  const quotient = (absoluteNumerator + absoluteDenominator / 2n) / absoluteDenominator;
  return negative ? -quotient : quotient;
}

/** Value of a receipt at an integer poisha unit cost. */
export function receiptValuePoisha(quantity: bigint, unitCostPoisha: bigint): bigint {
  if (quantity <= 0n || unitCostPoisha < 0n) {
    throw new AppError(400, 'STOCK_COST_INVALID', 'Receipt quantity must be positive and unit cost non-negative.');
  }
  return divideRoundHalfUp(quantity * unitCostPoisha, QUANTITY_SCALE);
}

/** The displayed integer unit cost implied by a value and quantity. */
export function impliedUnitCostPoisha(quantity: bigint, valuePoisha: bigint): bigint {
  if (quantity === 0n) return 0n;
  return divideRoundHalfUp(valuePoisha * QUANTITY_SCALE, quantity);
}

/**
 * Value of an outbound movement at the current weighted-average cost. A movement that empties the
 * balance takes the whole remaining value, so rounding cannot strand a poisha in an empty balance.
 */
export function outboundValuePoisha(quantity: bigint, balanceQuantity: bigint, balanceValuePoisha: bigint): bigint {
  if (quantity === balanceQuantity) return balanceValuePoisha;
  return divideRoundHalfUp(quantity * balanceValuePoisha, balanceQuantity);
}

export function isReceiptType(type: string): boolean {
  return (
    type === 'OPENING_RECEIPT' ||
    type === 'GRN_RECEIPT' ||
    type === 'RETURN_IN' ||
    type === 'TRANSFER_IN' ||
    type === 'ADJUSTMENT_IN' ||
    type === 'REVERSAL_IN'
  );
}

export function signedQuantity(type: string, quantity: bigint): bigint {
  return isReceiptType(type) ? quantity : -quantity;
}
