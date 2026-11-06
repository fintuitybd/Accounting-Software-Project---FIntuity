import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { useAuth } from './AuthContext';
import { FintuityLoader } from '../components/brand/FintuityBrand';
import { loadStoredPreferences } from '../core/storage/preferences';

export function AuthLoading({ label = 'Checking your session…' }: { label?: string }) {
  const locale = loadStoredPreferences().locale ?? 'en-BD';
  return (
    <div className="ql-theme grid min-h-screen place-items-center bg-ql-paper px-4">
      <div className="rounded-ql border border-ql-border bg-ql-surface px-6 py-5 shadow-ql-card">
        <FintuityLoader
          size={40}
          label={label}
          labelBn="আপনার সেশন যাচাই করা হচ্ছে…"
          locale={locale}
        />
      </div>
    </div>
  );
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const location = useLocation();
  if (auth.status === 'loading') return <AuthLoading />;
  if (auth.status === 'error') {
    return (
      <div className="grid min-h-screen place-items-center bg-canvas px-4">
        <div className="max-w-md rounded-2xl border border-line bg-surface p-6 text-center shadow-sm">
          <ShieldAlert size={28} className="mx-auto text-rose-500" />
          <h1 className="mt-3 text-[20px] font-semibold text-ink-900">Identity service unavailable</h1>
          <p className="mt-2 text-[14px] text-ink-500">
            {auth.error ?? 'The server could not be reached. No financial data has been loaded.'}
          </p>
          <button type="button" onClick={() => void auth.refresh().catch(() => undefined)} className="lv-btn lv-btn-primary mt-4 min-h-11 justify-center text-[14px]">
            Try again
          </button>
        </div>
      </div>
    );
  }
  if (auth.status === 'expired') {
    const returnTo = `${location.pathname}${location.search}`;
    return <Navigate to={`/session-expired?returnTo=${encodeURIComponent(returnTo)}`} replace />;
  }
  if (auth.status !== 'authenticated') {
    const returnTo = `${location.pathname}${location.search}`;
    return <Navigate to={`/login?returnTo=${encodeURIComponent(returnTo)}`} replace />;
  }
  return <>{children}</>;
}

export function PublicOnly({ children }: { children: ReactNode }) {
  const auth = useAuth();
  if (auth.status === 'loading') return <AuthLoading />;
  if (auth.status === 'authenticated') return <Navigate to="/app" replace />;
  return <>{children}</>;
}
