import { createElement, type ComponentType, type ReactNode } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AuthProvider, createDemoMe } from '../src/auth/AuthContext';
import { VaultProvider } from '../src/context/VaultContext';
import { WORKSPACE_VIEWS } from '../src/workspaces/views';
import type { WorkspaceKey } from '../src/workspaces/registry';
import type { MeResponse } from '../src/auth/types';

const DemoAuthProvider = AuthProvider as ComponentType<{
  demoModeOverride?: boolean;
  initialMe?: MeResponse;
  children?: ReactNode;
}>;
const DemoVaultProvider = VaultProvider as ComponentType<{ demoMode: boolean; children?: ReactNode }>;

const views: WorkspaceKey[] = ['W01', 'W02', 'W03', 'W04', 'W05', 'W06', 'W07', 'W08', 'W09', 'W10', 'W11', 'W12'];

/**
 * Render the synthetic demo workspace directly inside the two providers. The production App now
 * starts at the identity gate, so the smoke test must not bypass that gate accidentally; it uses
 * the explicit test-only demo override instead.
 */
function WorkspaceHarness({ view }: { view: WorkspaceKey }) {
  const Workspace = WORKSPACE_VIEWS[view] as ComponentType;
  return createElement(
    DemoAuthProvider,
    { demoModeOverride: true, initialMe: createDemoMe() },
    createElement(DemoVaultProvider, { demoMode: true }, createElement(Workspace)),
  );
}

describe('application render smoke', () => {
  it.each(views)('renders workspace %s without throwing', (view) => {
    const html = renderToString(createElement(WorkspaceHarness, { view }));

    expect(html.length).toBeGreaterThan(4000);
    expect(html).not.toContain('undefined');
  });
});
