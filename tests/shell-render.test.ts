import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { AuthProvider, createDemoMe } from '../src/auth/AuthContext';
import type { MeResponse } from '../src/auth/types';
import ProductionShell from '../src/shell/ProductionShell';

function ownerMe(): MeResponse {
  return createDemoMe();
}

function auditorMe(): MeResponse {
  const me = createDemoMe();
  const permissions = ['VIEW_REPORTS', 'EXPORT_DATA'] as const;
  return {
    ...me,
    memberships: me.memberships.map((membership) => ({
      ...membership,
      role: 'AUDITOR',
      permissions: [...permissions],
    })),
    companies: me.companies.map((company) => ({
      ...company,
      role: 'AUDITOR',
      permissions: [...permissions],
    })),
  };
}

function renderShell(me: MeResponse): string {
  return renderToString(
    createElement(AuthProvider, {
      demoModeOverride: true,
      initialMe: me,
      children: createElement(MemoryRouter, { initialEntries: ['/app'], children: createElement(ProductionShell) }),
    }),
  );
}

describe('production shell', () => {
  it('renders the server-backed shell with a skip link and no demo persona controls', () => {
    const html = renderShell(ownerMe());
    expect(html).toContain('Skip to main content');
    expect(html).toContain('Sales &amp; receivables');
    expect(html).toContain('General ledger');
    expect(html).toContain('Company setup');
    expect(html).toContain('Team &amp; access');
    expect(html).not.toContain('Switch role');
    expect(html).not.toContain('Payroll');
    expect(html).not.toContain('Secretarial');
    expect(html).not.toContain('Practice cockpit');
  });

  it('hides configuration and team administration from an auditor', () => {
    const html = renderShell(auditorMe());
    expect(html).toContain('Reports &amp; statements');
    expect(html).toContain('Audit log');
    expect(html).toContain('Close &amp; controls');
    expect(html).not.toContain('Company setup');
    expect(html).not.toContain('Team &amp; access');
    expect(html).not.toContain('Master data');
  });
});
