import { createElement, type ComponentType, type ReactNode } from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { AuthProvider, createDemoMe } from '../src/auth/AuthContext';
import { VaultProvider } from '../src/context/VaultContext';
import { AppPreferencesProvider } from '../src/preferences/AppPreferences';
import ReportsPage from '../src/pages/reports/ReportsPage';
import type { MeResponse } from '../src/auth/types';

const DemoAuthProvider = AuthProvider as ComponentType<{
  demoModeOverride?: boolean;
  initialMe?: MeResponse;
  children?: ReactNode;
}>;
const DemoVaultProvider = VaultProvider as ComponentType<{ demoMode: boolean; children?: ReactNode }>;

function Harness() {
  return createElement(
    DemoAuthProvider,
    { demoModeOverride: true, initialMe: createDemoMe() },
    createElement(
      DemoVaultProvider,
      { demoMode: true },
      createElement(AppPreferencesProvider, {
        applyDocument: false,
        children: createElement(MemoryRouter, null, createElement(ReportsPage)),
      }),
    ),
  );
}

describe('reports screen render smoke', () => {
  it('renders the reports shell with the unaudited/management-accounts status', () => {
    const html = renderToString(createElement(Harness));
    expect(html.length).toBeGreaterThan(1000);
    expect(html).toContain('Reports, VAT registers and financial statements');
    expect(html).toContain('Management accounts — unaudited');
    expect(html).not.toContain('Audited financial statements');
  });
});
