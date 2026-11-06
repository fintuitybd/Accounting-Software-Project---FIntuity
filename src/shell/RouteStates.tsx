import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { CircleAlert, ShieldAlert } from 'lucide-react';
import { usePreferences } from '../preferences/AppPreferences';
import { FintuityLoader } from '../components/brand/FintuityBrand';

export function RouteLoading({ label, labelBn }: { label?: string; labelBn?: string }) {
  const { locale } = usePreferences();
  const text = locale === 'bn-BD' ? labelBn ?? 'কার্যস্থান লোড হচ্ছে…' : label ?? 'Loading workspace…';
  return (
    <div className="space-y-4">
      <FintuityLoader size={38} label={text} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className="rounded-ql border border-ql-border bg-ql-surface p-4">
            <div className="ql-skeleton h-3 w-24" />
            <div className="ql-skeleton mt-3 h-7 w-32" />
            <div className="ql-skeleton mt-3 h-3 w-full" />
          </div>
        ))}
      </div>
      <div className="ql-skeleton h-56 w-full rounded-ql" />
    </div>
  );
}

export function NotFoundPage({ pathname }: { pathname: string }) {
  const { locale } = usePreferences();
  const L = (en: string, bn: string) => (locale === 'bn-BD' ? bn : en);
  return (
    <section className="mx-auto max-w-2xl py-10">
      <p className="text-[13px] font-medium text-ql-brand">404</p>
      <h1 className="mt-1 text-[28px] font-semibold tracking-[-0.02em] text-ql-ink">
        {L('This page does not exist', 'এই পৃষ্ঠাটি নেই')}
      </h1>
      <p className="mt-2 text-[14px] leading-6 text-ql-ink-muted">
        {L('The address', 'ঠিকানা')} <code className="rounded bg-ql-surface-muted px-1.5 py-0.5 text-[13px]">{pathname}</code>{' '}
        {L(
          'is not a screen in this workspace. Nothing was changed.',
          'এই কার্যস্থানের কোনো স্ক্রিন নয়। কিছুই পরিবর্তন করা হয়নি।',
        )}
      </p>
      <div className="mt-5 flex flex-wrap gap-2">
        <Link to="/app" className="ql-btn ql-btn-primary">
          {L('Go to Home', 'হোমে যান')}
        </Link>
        <Link to="/app/reports" className="ql-btn ql-btn-secondary">
          {L('Open reports', 'রিপোর্ট খুলুন')}
        </Link>
      </div>
    </section>
  );
}

export function PermissionDeniedPage({ sectionLabel }: { sectionLabel?: string }) {
  const { locale } = usePreferences();
  const L = (en: string, bn: string) => (locale === 'bn-BD' ? bn : en);
  return (
    <section className="mx-auto max-w-2xl py-10">
      <ShieldAlert size={28} className="text-ql-warning" aria-hidden />
      <p className="mt-3 text-[13px] font-medium text-ql-warning">403</p>
      <h1 className="mt-1 text-[28px] font-semibold tracking-[-0.02em] text-ql-ink">
        {L('You do not have access to this screen', 'এই স্ক্রিনে আপনার প্রবেশাধিকার নেই')}
      </h1>
      <p className="mt-2 text-[14px] leading-6 text-ql-ink-muted">
        {sectionLabel ? `${sectionLabel} ${L('is restricted for your current company role. ', 'আপনার বর্তমান কোম্পানি ভূমিকার জন্য সীমাবদ্ধ। ')}` : ''}
        {L(
          'The server enforces the same permission; nothing was changed. Ask an organisation owner or administrator if you need access.',
          'সার্ভারও একই অনুমতি প্রয়োগ করে; কিছুই পরিবর্তন করা হয়নি। প্রবেশাধিকার প্রয়োজন হলে প্রতিষ্ঠানের মালিক বা প্রশাসককে জিজ্ঞাসা করুন।',
        )}
      </p>
      <div className="mt-5 flex flex-wrap gap-2">
        <Link to="/app" className="ql-btn ql-btn-primary">
          {L('Go to Home', 'হোমে যান')}
        </Link>
        <Link to="/app/account" className="ql-btn ql-btn-secondary">
          {L('Account & sessions', 'অ্যাকাউন্ট ও সেশন')}
        </Link>
      </div>
    </section>
  );
}

interface RouteErrorBoundaryProps {
  children: ReactNode;
  title?: string;
  message?: string;
  reloadLabel?: string;
}

interface RouteErrorBoundaryState {
  error: Error | null;
}

/**
 * Contains a rendering failure to the route area. The user sees a stable message and a reload
 * action; no stack trace, server detail or other company data is shown.
 */
export class RouteErrorBoundary extends Component<RouteErrorBoundaryProps, RouteErrorBoundaryState> {
  state: RouteErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): RouteErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Keep diagnostic detail in the browser console only. The server request id, if any, is shown by
    // the API error component rather than this boundary.
    console.error('Route rendering failed', error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <section className="mx-auto max-w-2xl py-10" role="alert">
          <CircleAlert size={28} className="text-ql-danger" aria-hidden />
          <h1 className="mt-3 text-[26px] font-semibold text-ql-ink">
            {this.props.title ?? 'This screen could not be displayed'}
          </h1>
          <p className="mt-2 text-[14px] leading-6 text-ql-ink-muted">
            {this.props.message ??
              'No financial action was submitted by this screen. Reload the page. If the problem continues, contact your administrator with the time it happened.'}
          </p>
          <button type="button" className="ql-btn ql-btn-primary mt-5" onClick={() => window.location.reload()}>
            {this.props.reloadLabel ?? 'Reload page'}
          </button>
        </section>
      );
    }
    return this.props.children;
  }
}
