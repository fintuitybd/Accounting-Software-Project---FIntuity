// LedgerVault — workspace navigation context.
//
// The shell owns routing, so a flagship workspace (the cockpit, the Sankey drill-downs, the
// compliance rings) can ask to open Banking or the IFRS pack without prop-drilling through the
// twelve-screen registry. The default value is a safe no-op so a workspace can still be rendered
// in isolation by a test harness or the print preview.

import { createContext, useContext, type ReactNode } from 'react';
import type { WorkspaceKey } from '../../workspaces/registry';

export interface WorkspaceNavValue {
  navigate: (key: WorkspaceKey) => void;
  openPalette: () => void;
  openCreate: () => void;
}

const noop = (): void => undefined;

const WorkspaceNavContext = createContext<WorkspaceNavValue>({
  navigate: noop,
  openPalette: noop,
  openCreate: noop,
});

export function WorkspaceNavProvider({
  value,
  children,
}: {
  value: WorkspaceNavValue;
  children: ReactNode;
}) {
  return <WorkspaceNavContext.Provider value={value}>{children}</WorkspaceNavContext.Provider>;
}

export function useWorkspaceNav(): WorkspaceNavValue {
  return useContext(WorkspaceNavContext);
}

export default WorkspaceNavProvider;
