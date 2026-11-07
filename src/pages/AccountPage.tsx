import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { BadgeCheck, KeyRound, Loader2, LogOut, MonitorSmartphone, RefreshCw, ShieldCheck } from 'lucide-react';
import { ApiError, authApi } from '../auth/api';
import { useAuth } from '../auth/AuthContext';
import { ROLE_LABELS } from '../auth/roles';
import type { SessionSummary } from '../auth/types';
import { localized } from '../core/i18n';
import { usePreferences } from '../preferences/AppPreferences';

export default function AccountPage() {
  const auth = useAuth();
  const { locale } = usePreferences();
  const navigate = useNavigate();
  const L = useCallback((en: string, bn: string): string => localized(locale, en, bn), [locale]);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);

  const loadSessions = useCallback(async (): Promise<void> => {
    if (auth.demoMode) return;
    setLoadingSessions(true);
    try {
      const response = await authApi.sessions();
      setSessions(response.sessions);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : L('Sessions could not be loaded.', 'সেশন লোড করা যায়নি।'));
    } finally {
      setLoadingSessions(false);
    }
  }, [auth.demoMode, L]);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  const changePassword = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setError(null);
    setNotice(null);
    if (newPassword !== confirmPassword) {
      setError(L('The two new passwords do not match.', 'নতুন দুইটি পাসওয়ার্ড মিলছে না।'));
      return;
    }
    setSavingPassword(true);
    try {
      const response = await authApi.changePassword(currentPassword, newPassword);
      setNotice(response.message);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      await loadSessions();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : L('The password could not be changed.', 'পাসওয়ার্ড পরিবর্তন করা যায়নি।'));
    } finally {
      setSavingPassword(false);
    }
  };

  const revoke = async (session: SessionSummary): Promise<void> => {
    if (!window.confirm(session.current
      ? L('Sign out this session now? You will need to sign in again.', 'এই সেশনটি এখন সাইন আউট করবেন? আবার সাইন ইন করতে হবে।')
      : L('Revoke this session? That device will need to sign in again.', 'এই সেশন বাতিল করবেন? ওই ডিভাইসে আবার সাইন ইন করতে হবে।'))) {
      return;
    }
    try {
      const result = await authApi.revokeSession(session.id);
      if (result.current) {
        auth.markSignedOut();
        navigate('/login', { replace: true });
        return;
      }
      setNotice(L('Session revoked.', 'সেশন বাতিল হয়েছে।'));
      await loadSessions();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : L('The session could not be revoked.', 'সেশন বাতিল করা যায়নি।'));
    }
  };

  const resendVerification = async (): Promise<void> => {
    setError(null);
    try {
      const response = await authApi.resendVerification();
      setNotice(response.message);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : L('Verification could not be requested.', 'যাচাইয়ের অনুরোধ করা যায়নি।'));
    }
  };

  const signOut = async (): Promise<void> => {
    setError(null);
    try {
      await auth.logout();
      navigate('/login', { replace: true });
    } catch {
      setError(
        L(
          'The server session could not be revoked. Check the connection and try again; do not leave this device unattended.',
          'সার্ভার সেশন বাতিল করা যায়নি। সংযোগ পরীক্ষা করে আবার চেষ্টা করুন; এই ডিভাইসটি অরক্ষিত রেখে যাবেন না।',
        ),
      );
    }
  };

  return (
    <div className="space-y-4">
      <section className="ql-card p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="ql-kicker flex items-center gap-1.5"><ShieldCheck size={13} /> {L('Your account', 'আপনার অ্যাকাউন্ট')}</p>
            <h2 className="mt-1 text-[24px] font-semibold tracking-[-0.035em] text-ink-900">{auth.user?.name}</h2>
            <p className="mt-1 text-[14px] text-ink-500">{auth.user?.email}</p>
          </div>
          <button type="button" onClick={() => void signOut()} className="ql-btn ql-btn-secondary min-h-10 text-[13px]">
            <LogOut size={14} /> {L('Sign out', 'সাইন আউট')}
          </button>
        </div>
        <dl className="mt-5 grid gap-3 text-[13px] sm:grid-cols-3">
          <div className="rounded-xl border border-line bg-surface-2/40 p-3">
            <dt className="text-ink-400">{L('Organisation role', 'প্রতিষ্ঠানের ভূমিকা')}</dt>
            <dd className="mt-1 font-semibold text-ink-900">
              {auth.activeMembership ? L(ROLE_LABELS[auth.activeMembership.role].label_en, ROLE_LABELS[auth.activeMembership.role].label_bn) : '—'}
            </dd>
          </div>
          <div className="rounded-xl border border-line bg-surface-2/40 p-3">
            <dt className="text-ink-400">{L('Company role', 'কোম্পানির ভূমিকা')}</dt>
            <dd className="mt-1 font-semibold text-ink-900">
              {auth.activeCompany ? L(ROLE_LABELS[auth.activeCompany.role].label_en, ROLE_LABELS[auth.activeCompany.role].label_bn) : '—'}
            </dd>
          </div>
          <div className="rounded-xl border border-line bg-surface-2/40 p-3">
            <dt className="text-ink-400">{L('Email status', 'ইমেইলের অবস্থা')}</dt>
            <dd className="mt-1 flex flex-wrap items-center gap-2 font-semibold text-ink-900">
              {auth.user?.emailVerified ? (
                <><BadgeCheck size={15} className="text-emerald-500" /> {L('Verified', 'যাচাইকৃত')}</>
              ) : (
                <>
                  <span className="text-amber-700 dark:text-amber-300">{L('Not verified', 'যাচাই হয়নি')}</span>
                  <button type="button" onClick={() => void resendVerification()} className="rounded-lg border border-line px-2 py-1 text-[12px] font-semibold text-ink-700">
                    {L('Resend', 'আবার পাঠান')}
                  </button>
                </>
              )}
            </dd>
          </div>
        </dl>
        {error ? <div role="alert" className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2.5 text-[13px] text-rose-700 dark:text-rose-300">{error}</div> : null}
        {notice ? <div role="status" className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5 text-[13px] text-emerald-700 dark:text-emerald-300">{notice}</div> : null}
      </section>

      <section className="ql-card p-5 sm:p-6">
        <h3 className="flex items-center gap-2 text-[17px] font-semibold text-ink-900"><KeyRound size={17} /> {L('Change password', 'পাসওয়ার্ড পরিবর্তন')}</h3>
        <p className="mt-1 text-[13px] text-ink-500">
          {L('Changing your password signs out every other session. The current session stays active.', 'পাসওয়ার্ড পরিবর্তনে অন্য সব সেশন সাইন আউট হয়। বর্তমান সেশন সক্রিয় থাকে।')}
        </p>
        <form onSubmit={changePassword} className="mt-4 grid gap-3 sm:grid-cols-3">
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-semibold text-ink-700">{L('Current password', 'বর্তমান পাসওয়ার্ড')}</span>
            <input className="ql-input min-h-11 w-full text-[14px]" type="password" autoComplete="current-password" required value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} disabled={savingPassword} />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-semibold text-ink-700">{L('New password', 'নতুন পাসওয়ার্ড')}</span>
            <input className="ql-input min-h-11 w-full text-[14px]" type="password" autoComplete="new-password" required minLength={12} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} disabled={savingPassword} />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-semibold text-ink-700">{L('Confirm new password', 'নতুন পাসওয়ার্ড নিশ্চিত করুন')}</span>
            <input className="ql-input min-h-11 w-full text-[14px]" type="password" autoComplete="new-password" required minLength={12} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} disabled={savingPassword} />
          </label>
          <div className="sm:col-span-3">
            <button type="submit" disabled={savingPassword} className="ql-btn ql-btn-primary min-h-11 justify-center text-[14px]">
              {savingPassword ? <Loader2 size={16} className="animate-spin" /> : <KeyRound size={16} />}
              {L('Update password', 'পাসওয়ার্ড আপডেট করুন')}
            </button>
          </div>
        </form>
      </section>

      <section className="ql-card overflow-hidden">
        <div className="ql-card-header flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 text-[17px] font-semibold text-ink-900"><MonitorSmartphone size={17} /> {L('Active sessions', 'সক্রিয় সেশন')}</h3>
            <p className="mt-0.5 text-[13px] text-ink-500">{L('Sessions are server-side records. Revoking one takes effect immediately.', 'সেশন সার্ভারে সংরক্ষিত। বাতিল করলে সাথে সাথে কার্যকর হয়।')}</p>
          </div>
          <button type="button" onClick={() => void loadSessions()} className="ql-btn ql-btn-secondary min-h-10 text-[13px]">
            {loadingSessions ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} {L('Refresh', 'রিফ্রেশ')}
          </button>
        </div>
        {auth.demoMode ? (
          <p className="px-4 py-6 text-[14px] text-ink-500">{L('Session management is available only with the real identity service.', 'সেশন পরিচালনা শুধুমাত্র বাস্তব পরিচয় সেবায় উপলব্ধ।')}</p>
        ) : sessions.length === 0 && !loadingSessions ? (
          <p className="px-4 py-6 text-[14px] text-ink-500">{L('No sessions found.', 'কোনো সেশন পাওয়া যায়নি।')}</p>
        ) : (
          <div className="divide-y divide-line/70">
            {sessions.map((session) => (
              <div key={session.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-[13px]">
                <div className="min-w-0">
                  <p className="font-semibold text-ink-900">
                    {session.current ? L('This device', 'এই ডিভাইস') : (session.userAgent ?? L('Unknown device', 'অজানা ডিভাইস'))}
                    {session.current ? <span className="ml-2 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[12px] font-semibold text-emerald-700 dark:text-emerald-300">{L('Current', 'বর্তমান')}</span> : null}
                  </p>
                  <p className="text-[12px] text-ink-500">
                    {session.ip ?? L('No IP recorded', 'আইপি নেই')} · {L('Last seen', 'শেষ দেখা')} {new Date(session.lastSeenAt).toLocaleString()} · {L('Expires', 'মেয়াদ')} {new Date(session.idleExpiresAt).toLocaleString()}
                  </p>
                </div>
                {session.revokedAt ? (
                  <span className="text-[12px] font-semibold text-ink-400">{L('Revoked', 'বাতিল')}</span>
                ) : (
                  <button type="button" onClick={() => void revoke(session)} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-rose-500/30 px-2.5 text-[12px] font-semibold text-rose-700 transition hover:bg-rose-500/10 dark:text-rose-300">
                    <LogOut size={13} /> {session.current ? L('Sign out', 'সাইন আউট') : L('Revoke', 'বাতিল')}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
