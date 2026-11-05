// Phase 2 render smoke test — server-renders every shell view to prove no view crashes on mount.
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import App from '../src/App';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exitCode = 1;
  } else {
    console.log(`ok   ${message}`);
  }
}

const views = ['cockpit', 'ledger', 'statements', 'import', 'rulepack'] as const;
const expectations: Record<(typeof views)[number], string[]> = {
  cockpit: ['Executive cockpit', 'Subledger control proof', 'Cash, bank', 'Mushak 9.1'],
  ledger: ['Immutable journal register', 'Double-entry inspector', 'SHA-256 audit chain', 'Post a transaction'],
  statements: ['IAS 1 balance sheet', 'IFRS 18', 'Trial balance', 'TOTAL ASSETS'],
  import: ['Dry-run simulator', 'Load 25-row demo batch', 'Download .xlsx audit pack'],
  rulepack: ['LedgerVault Core Lab', 'Golden vectors', 'bd-2026-v1'],
};

for (const view of views) {
  try {
    const html = renderToString(createElement(App, { initialView: view }));
    assert(html.length > 8000, `${view}: rendered ${(html.length / 1024).toFixed(0)} KB of markup`);
    for (const needle of expectations[view]) {
      assert(html.includes(needle), `${view}: contains "${needle}"`);
    }
    assert(!html.includes('undefined'), `${view}: no literal "undefined" leaked into the markup`);
  } catch (error) {
    console.error(`FAIL: ${view}: render threw ${error instanceof Error ? error.stack : String(error)}`);
    process.exitCode = 1;
  }
}
