import { useState } from 'react';
import { Lock, LockOpen, ShieldCheck } from 'lucide-react';
import { localized } from '../../core/i18n';
import { useAuth } from '../../auth/AuthContext';
import { usePreferences } from '../../preferences/AppPreferences';
import type { FiscalPeriod } from '../../setup/api';
import { closeApi } from '../../close/api';
import { apiErrorMessage, ErrorBanner, Notice } from '../setup/setupUi';
import { formatDate } from './ledgerUi';

const PERIOD_TONE: Record<string, string> = {
  OPEN: 'lv-chip-emerald',
  CLOSED: 'lv-chip-gold',
  LOCKED: 'lv-chip-rose',
};

export function PeriodsPanel({
  companyId,
  periods,
  canManage,
  onChanged,
}: {
  companyId: string;
  periods: FiscalPeriod[];
  canManage: boolean;
  onChanged: (message: string) => Promise<void> | void;
}) {
  const { locale } = usePreferences();
  const auth = useAuth();
  const L = (en: string, bn: string): string => localized(locale, en, bn);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canReopen = auth.hasCompanyPermission('REOPEN_PERIOD');

  const reopen = async (period: FiscalPeriod): Promise<void> => {
    const reason = window.prompt(
      L(
        `Enter the reason to reopen period ${period.code}. This is stored in the audit log and the prior close run is marked REOPENED.`,
        `${period.code} হিসাবকাল পুনরায় খোলার কারণ লিখুন। এটি অডিট লগে সংরক্ষিত হবে এবং পূর্ববর্তী সমাপনী রান REOPENED হবে।`,
      ),
    );
    if (reason === null) return;
    if (reason.trim().length < 3) {
      setError(L('The reason must be at least three characters.', 'কারণ কমপক্ষে তিন অক্ষরের হতে হবে।'));
      return;
    }
    if (!window.confirm(
      L(
        'Reopening permits new postings in this period. The controlled close and checker approval are required again before it can be locked. Continue?',
        'পুনরায় খুললে এই মেয়াদে নতুন পোস্টিং অনুমোদিত হবে। আবার লক করার আগে নিয়ন্ত্রিত সমাপনী ও চেকার অনুমোদন প্রয়োজন হবে। চালিয়ে যাবেন?',
      ),
    )) {
      return;
    }
    setBusy(period.id);
    setError(null);
    try {
      await closeApi.reopen(companyId, period.id, reason.trim());
      await onChanged(L(`Period ${period.code} is now OPEN.`, `হিসাবকাল ${period.code} এখন OPEN।`));
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="lv-card p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="lv-kicker">{L('Period control', 'হিসাবকাল নিয়ন্ত্রণ')}</p>
          <h2 className="mt-1 text-[22px] font-semibold tracking-[-0.03em] text-ink-900">
            {L('Period status and controlled reopen', 'হিসাবকালের অবস্থা ও নিয়ন্ত্রিত পুনরায় খোলা')}
          </h2>
          <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-ink-500">
            {L(
              'Posting is accepted only in an OPEN period and only when a configured period covers the date. Closing and locking are performed by the controlled close workflow on the Close & controls page; only a permissioned reopen is available here.',
              'শুধুমাত্র OPEN মেয়াদে এবং নির্ধারিত মেয়াদে পোস্টিং গ্রহণ করা হয়। বন্ধ ও লক করা হয় সমাপনী ও নিয়ন্ত্রণ পৃষ্ঠার নিয়ন্ত্রিত সমাপনী কার্যপ্রবাহে; এখানে শুধু অনুমতিসাপেক্ষ পুনরায় খোলা আছে।',
            )}
          </p>
        </div>
        {!canManage ? (
          <span className="lv-chip lv-chip-neutral">
            <ShieldCheck size={12} /> {L('Read-only', 'শুধু পাঠযোগ্য')}
          </span>
        ) : null}
      </div>

      {error ? <div className="mt-4"><ErrorBanner message={error} /></div> : null}
      {!canManage ? (
        <div className="mt-4">
          <Notice message={L('Your role cannot change period status.', 'আপনার ভূমিকা হিসাবকালের স্ট্যাটাস পরিবর্তন করতে পারে না।')} tone="warning" />
        </div>
      ) : null}

      <div className="mt-5 overflow-x-auto">
        <table className="lv-table w-full min-w-[760px] text-[13px]">
          <caption className="sr-only">{L('Accounting periods', 'হিসাবকালসমূহ')}</caption>
          <thead>
            <tr>
              <th scope="col" className="text-left">{L('Code', 'কোড')}</th>
              <th scope="col" className="text-left">{L('Period', 'হিসাবকাল')}</th>
              <th scope="col" className="text-left">{L('Dates', 'তারিখ')}</th>
              <th scope="col" className="text-left">{L('Status', 'স্ট্যাটাস')}</th>
              <th scope="col" className="text-right">{L('Actions', 'কার্যক্রম')}</th>
            </tr>
          </thead>
          <tbody>
            {periods.map((period) => (
              <tr key={period.id}>
                <td className="font-mono text-ink-500">{period.code}</td>
                <td className="text-ink-900">{period.label}</td>
                <td className="text-ink-500">{formatDate(period.startDate, locale)} – {formatDate(period.endDate, locale)}</td>
                <td>
                  <span className={`lv-chip ${PERIOD_TONE[period.status] ?? 'lv-chip-neutral'}`}>
                    {period.status === 'LOCKED' ? <Lock size={11} /> : period.status === 'OPEN' ? <LockOpen size={11} /> : null}
                    {period.status}
                  </span>
                  {period.reopenedReason ? <span className="ml-2 text-[12px] text-ink-400">{period.reopenedReason}</span> : null}
                </td>
                <td className="text-right">
                  {canReopen && period.status !== 'OPEN' ? (
                    <button type="button" onClick={() => void reopen(period)} disabled={busy !== null} className="lv-btn lv-btn-ghost min-h-9 text-[12px]">
                      <LockOpen size={12} /> {busy === period.id ? L('Reopening…', 'খোলা হচ্ছে…') : L('Reopen', 'পুনরায় খুলুন')}
                    </button>
                  ) : (
                    <span className="text-[12px] text-ink-400">{L('Close workflow', 'সমাপনী কার্যপ্রবাহ')}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default PeriodsPanel;
