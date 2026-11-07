// Fintuity Accounting Suite route shell.
//
// Authentication pages are the only screens in this entry. The authenticated shell (providers,
// workspaces, ledger, layout and command palette) is a separate lazy chunk, so signing in does not
// download the financial application before the user is authenticated.
import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import { RequireAuth } from './auth/guards';
import { FintuityLoader } from './components/brand/FintuityBrand';
import LoginPage from './pages/auth/LoginPage';
import ForgotPasswordPage from './pages/auth/ForgotPasswordPage';
import ResetPasswordPage from './pages/auth/ResetPasswordPage';
import AcceptInvitationPage from './pages/auth/AcceptInvitationPage';
import VerifyEmailPage from './pages/auth/VerifyEmailPage';
import SessionExpiredPage from './pages/auth/SessionExpiredPage';
import type { WorkspaceKey } from './workspaces/registry';

const ErpShell = lazy(() => import('./ErpShell'));

function AppLoading() {
  return (
    <div className="ql-theme flex min-h-screen items-center justify-center bg-ql-paper px-6 text-ql-ink">
      <FintuityLoader size={48} label="Loading workspace…" labelBn="কার্যস্থান লোড হচ্ছে…" />
    </div>
  );
}

export default function App({ initialView = 'W01' }: { initialView?: WorkspaceKey } = {}) {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<Navigate to="/app" replace />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/accept-invitation/:token" element={<AcceptInvitationPage />} />
          <Route path="/verify-email" element={<VerifyEmailPage />} />
          <Route path="/session-expired" element={<SessionExpiredPage />} />
          <Route
            path="/app/*"
            element={
              <RequireAuth>
                <Suspense fallback={<AppLoading />}>
                  <ErpShell initialView={initialView} />
                </Suspense>
              </RequireAuth>
            }
          />
          <Route path="*" element={<Navigate to="/app" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
