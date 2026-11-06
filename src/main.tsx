// Application entry point.
//
// `./core/money` MUST be the first import: it installs the BigInt.prototype.toJSON patch before any
// module can call JSON.stringify on poisha values (snapshots, audit exports, clipboard payloads).
//
// The public marketing site and the authenticated application are separate lazy entries. A visitor
// on `/` never downloads the workspaces, providers, ledger engine or any financial screen; the
// app entry is fetched only for `/app` and the authentication routes.
import './core/money';
import './index.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

const APP_ROUTE_PREFIXES = [
  '/app',
  '/login',
  '/forgot-password',
  '/reset-password',
  '/accept-invitation',
  '/verify-email',
  '/session-expired',
];

function isApplicationRoute(pathname: string): boolean {
  return APP_ROUTE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

const container = document.getElementById('root');

if (!container) {
  throw new Error('Fintuity Accounting Suite could not start: #root is missing from index.html.');
}

const root = createRoot(container);
const pathname = typeof window === 'undefined' ? '/' : window.location.pathname;

const entry = isApplicationRoute(pathname) ? import('./App') : import('./marketing/MarketingApp');

entry
  .then(({ default: Root }) => {
    root.render(
      <StrictMode>
        <Root />
      </StrictMode>,
    );
  })
  .catch(() => {
    root.render(
      <div className="ql-theme flex min-h-screen items-center justify-center px-6">
        <div className="max-w-md text-center">
          <h1 className="text-[24px] font-semibold text-ql-ink">Fintuity Accounting Suite could not load</h1>
          <p className="mt-2 text-[14px] leading-6 text-ql-ink-muted">
            Refresh the page. If the problem continues, contact your organisation administrator.
          </p>
          <a href="/" className="ql-btn ql-btn-primary mt-5">
            Return to the home page
          </a>
        </div>
      </div>,
    );
  });
