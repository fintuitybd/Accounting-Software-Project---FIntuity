// Fintuity Accounting Suite — shell entry.
//
// Production loads only the server-backed shell. The synthetic demo is an explicit, separately
// loaded chunk used when VITE_DEMO_MODE=true; it is never the default and cannot share real books.

import { lazy, Suspense } from 'react';
import { DEMO_MODE } from './auth/AuthContext';
import type { WorkspaceKey } from './workspaces/registry';

const ProductionShell = lazy(() => import('./shell/ProductionShell'));
const DemoShell = lazy(() => import('./demo/DemoShell'));

function ShellLoading() {
  return (
    <div className="ql-theme flex min-h-screen items-center justify-center bg-ql-paper px-6 text-ql-ink" role="status" aria-live="polite">
      <p className="flex items-center gap-2 text-[14px]">
        <span className="ql-spinner" aria-hidden="true" />
        Loading workspace…
      </p>
    </div>
  );
}

export default function ErpShell({ initialView = 'W01' }: { initialView?: WorkspaceKey } = {}) {
  return (
    <Suspense fallback={<ShellLoading />}>
      {DEMO_MODE ? <DemoShell initialView={initialView} /> : <ProductionShell />}
    </Suspense>
  );
}
