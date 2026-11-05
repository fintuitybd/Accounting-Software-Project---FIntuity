import { createElement, type ComponentType } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import App from '../src/App';
import type { WorkspaceKey } from '../src/workspaces/registry';

const views: WorkspaceKey[] = ['W01', 'W02', 'W03', 'W04', 'W05', 'W06', 'W07', 'W08', 'W09', 'W10', 'W11', 'W12'];
// App is a plain function component with optional props; bind its prop shape explicitly for
// createElement so the test is type-checked rather than relying on the legacy smoke script.
const TypedApp = App as ComponentType<{ initialView?: WorkspaceKey }>;

describe('application render smoke', () => {
  it.each(views)('renders workspace %s without throwing', (view) => {
    const html = renderToString(createElement(TypedApp, { initialView: view }));

    expect(html.length).toBeGreaterThan(4000);
    expect(html).not.toContain('undefined');
  });
});
