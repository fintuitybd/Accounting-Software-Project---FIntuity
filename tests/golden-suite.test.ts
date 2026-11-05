import { describe, expect, it } from 'vitest';
import { runGoldenSuite } from '../src/core/tax-engine/goldenSuite';

describe('golden tax suite', () => {
  it('passes every hand-calculated vector against rule pack bd-2026-v1', () => {
    const result = runGoldenSuite();

    expect(result.rule_pack_version).toBe('bd-2026-v1');
    expect(result.total).toBe(25);
    expect(result.passed).toBe(25);
    expect(result.failed).toBe(0);
    expect(result.ok).toBe(true);
    expect(result.checks_run).toBeGreaterThan(0);
  });
});
