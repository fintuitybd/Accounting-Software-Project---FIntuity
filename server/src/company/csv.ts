/** Minimal RFC-4180-style CSV parser used for the chart-of-accounts import. */

export interface CsvParseResult {
  rows: string[][];
  errors: string[];
}

export function parseCsv(input: string): CsvParseResult {
  const text = input.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  const errors: string[] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let fieldStarted = false;

  const pushField = (): void => {
    row.push(field);
    field = '';
    fieldStarted = false;
  };
  const pushRow = (): void => {
    pushField();
    if (row.some((cell) => cell.trim() !== '')) rows.push(row);
    row = [];
  };

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      if (fieldStarted || field.length > 0) {
        errors.push('A quote character appeared inside an unquoted field.');
        return { rows: [], errors };
      }
      inQuotes = true;
      fieldStarted = true;
      continue;
    }
    if (char === ',') {
      pushField();
      continue;
    }
    if (char === '\r') {
      if (text[index + 1] === '\n') index += 1;
      pushRow();
      continue;
    }
    if (char === '\n') {
      pushRow();
      continue;
    }
    field += char;
    fieldStarted = true;
  }

  if (inQuotes) {
    errors.push('The CSV ended inside a quoted field.');
    return { rows: [], errors };
  }
  if (field.length > 0 || row.length > 0) pushRow();
  return { rows, errors };
}

export function escapeCsvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
