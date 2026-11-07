import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function collectFiles(dir: string): string[] {
  const results: string[] = [];
  const entries = readdirSync(dir);
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      results.push(...collectFiles(fullPath));
    } else {
      results.push(fullPath);
    }
  }
  return results;
}

describe('Quiet Ledger design system purity', () => {
  const srcFiles = collectFiles('src');

  it('asserts 0 occurrences of /\\blv-[a-z0-9-]+/i across src/', () => {
    const tokenRegex = /\blv-[a-z0-9-]+/i;
    const violations: { file: string; line: number; match: string }[] = [];

    for (const file of srcFiles) {
      const content = readFileSync(file, 'utf8');
      const lines = content.split('\n');
      lines.forEach((line, index) => {
        const match = line.match(tokenRegex);
        if (match) {
          violations.push({
            file,
            line: index + 1,
            match: match[0],
          });
        }
      });
    }

    expect(
      violations,
      `Expected 0 legacy lv-* tokens across src/, but found ${violations.length} violations:\n` +
        violations.map((v) => `  ${v.file}:${v.line} -> "${v.match}"`).slice(0, 30).join('\n'),
    ).toEqual([]);
  });

  it('asserts 0 occurrences of /LedgerVault/i across src/', () => {
    const nameRegex = /LedgerVault/i;
    const violations: { file: string; line: number; lineContent: string }[] = [];

    for (const file of srcFiles) {
      const content = readFileSync(file, 'utf8');
      const lines = content.split('\n');
      lines.forEach((line, index) => {
        if (nameRegex.test(line)) {
          violations.push({
            file,
            line: index + 1,
            lineContent: line.trim(),
          });
        }
      });
    }

    expect(
      violations,
      `Expected 0 occurrences of /LedgerVault/i across src/, but found ${violations.length} violations:\n` +
        violations.map((v) => `  ${v.file}:${v.line} -> "${v.lineContent}"`).slice(0, 30).join('\n'),
    ).toEqual([]);
  });
});
