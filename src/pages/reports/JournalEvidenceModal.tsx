import { useEffect, useState } from 'react';
import { ArrowUpRight, X } from 'lucide-react';
import { localized } from '../../core/i18n';
import { formatDate } from '../../core/money';
import { ledgerApi, type JournalDetail } from '../../ledger/api';
import { apiErrorMessage, ErrorBanner, Notice } from '../setup/setupUi';

export function JournalEvidenceModal({
  companyId,
  journalId,
  locale,
  money,
  onClose,
}: {
  companyId: string;
  journalId: string | null;
  locale: 'en-BD' | 'bn-BD';
  money: (poisha: bigint, options?: { sign?: boolean; symbol?: boolean }) => string;
  onClose: () => void;
}) {
  const L = (en: string, bn: string) => localized(locale, en, bn);
  const [journal, setJournal] = useState<JournalDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!journalId) {
      setJournal(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void ledgerApi
      .journal(companyId, journalId)
      .then((response) => {
        if (!cancelled) setJournal(response.journal);
      })
      .catch((caught) => {
        if (!cancelled) setError(apiErrorMessage(caught));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [companyId, journalId]);

  if (!journalId) return null;

  return (
    <div className="fixed inset-0 z-[65] flex items-end justify-center bg-ink-950/60 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={L('Journal evidence', 'জার্নাল প্রমাণ')}>
      <div className="max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-t-2xl bg-surface p-4 shadow-2xl sm:rounded-2xl sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="lv-kicker">{L('Journal evidence', 'জার্নাল প্রমাণ')}</p>
            <h2 className="mt-1 text-[20px] font-semibold text-ink-900">
              {journal?.journalNumber ?? L('Loading journal…', 'জার্নাল লোড হচ্ছে…')}
            </h2>
            {journal ? (
              <p className="mt-1 text-[12px] text-ink-500">
                {formatDate(journal.postingDate, locale)} · {journal.status} · {journal.sourceModule}
                {journal.branchCode ? ` · ${journal.branchCode}` : ''}
              </p>
            ) : null}
          </div>
          <button type="button" onClick={onClose} className="lv-btn lv-btn-secondary min-h-11 text-[13px]">
            <X size={14} /> {L('Close', 'বন্ধ')}
          </button>
        </div>

        {error ? <div className="mt-4"><ErrorBanner message={error} /></div> : null}
        {loading && !journal ? <div className="mt-4"><Notice message={L('Loading the journal and its audit trail…', 'জার্নাল ও অডিট ট্রেইল লোড হচ্ছে…')} tone="info" /></div> : null}

        {journal ? (
          <div className="mt-4 space-y-4">
            <section className="rounded-xl border border-line bg-surface-2/30 p-3">
              <p className="text-[12px] font-semibold text-ink-900">{L('Source evidence', 'উৎস প্রমাণ')}</p>
              <dl className="mt-2 grid gap-2 text-[12px] sm:grid-cols-2 xl:grid-cols-3">
                {[
                  [L('Evidence type', 'প্রমাণের ধরন'), journal.sourceEvidence.kind],
                  [L('Reference', 'রেফারেন্স'), journal.sourceEvidence.reference ?? '—'],
                  [L('Source status', 'উৎসের অবস্থা'), journal.sourceEvidence.status ?? '—'],
                  [L('Source date', 'উৎসের তারিখ'), journal.sourceEvidence.documentDate ?? '—'],
                  [L('Party', 'পক্ষ'), journal.sourceEvidence.partyName ?? '—'],
                  [L('Tax decision', 'কর সিদ্ধান্ত'), journal.sourceEvidence.taxDecisionState ?? '—'],
                  [L('Rule pack', 'রুল প্যাক'), journal.sourceEvidence.rulePackVersion ?? '—'],
                  [L('Tax trace', 'কর ট্রেস'), journal.sourceEvidence.taxTraceId ?? '—'],
                  [L('Source id', 'উৎস আইডি'), journal.sourceEvidence.id ?? '—'],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-ink-400">{label}</dt>
                    <dd className="mt-0.5 break-all font-medium text-ink-800">{value}</dd>
                  </div>
                ))}
              </dl>
              {journal.sourceEvidence.note ? <p className="mt-2 text-[12px] text-ink-600">{journal.sourceEvidence.note}</p> : null}
              {journal.reversalOfJournalId ? (
                <p className="mt-2 rounded-lg bg-amber-50 p-2 text-[12px] text-amber-900">
                  {L('This journal is a linked reversal of', 'এই জার্নালটি লিংকড রিভার্সাল')}{' '}
                  <span className="font-mono">{journal.originalJournalNumber ?? journal.reversalOfJournalId}</span>
                  {journal.reversalReason ? ` — ${journal.reversalReason}` : ''}
                </p>
              ) : null}
              {journal.reversedByJournalId ? (
                <p className="mt-2 rounded-lg bg-rose-50 p-2 text-[12px] text-rose-900">
                  {L('This journal was reversed by', 'এই জার্নালটি রিভার্স করা হয়েছে')}{' '}
                  <span className="font-mono">{journal.reversalJournalNumber ?? journal.reversedByJournalId}</span>
                  {journal.reversalReason ? ` — ${journal.reversalReason}` : ''}
                </p>
              ) : null}
            </section>

            <section className="overflow-x-auto rounded-xl border border-line">
              <table className="lv-table w-full min-w-[720px] text-[12px]">
                <caption className="sr-only">{L('Journal lines', 'জার্নাল লাইন')}</caption>
                <thead>
                  <tr>
                    <th scope="col" className="text-left">#</th>
                    <th scope="col" className="text-left">{L('Account', 'হিসাব')}</th>
                    <th scope="col" className="text-left">{L('Party / memo', 'পক্ষ / মেমো')}</th>
                    <th scope="col" className="text-right">{L('Debit', 'ডেবিট')}</th>
                    <th scope="col" className="text-right">{L('Credit', 'ক্রেডিট')}</th>
                  </tr>
                </thead>
                <tbody>
                  {journal.lines.map((line) => (
                    <tr key={line.id}>
                      <td>{line.lineNo}</td>
                      <td>
                        <span className="font-mono text-ink-500">{line.accountCode}</span> {line.accountNameEn}
                      </td>
                      <td>{line.partyName ?? line.memo ?? '—'}</td>
                      <td className="text-right font-money">{line.debitPoisha === '0' ? '—' : money(BigInt(line.debitPoisha))}</td>
                      <td className="text-right font-money">{line.creditPoisha === '0' ? '—' : money(BigInt(line.creditPoisha))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            <section className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-line p-3">
                <p className="text-[12px] font-semibold text-ink-900">{L('Document events', 'ডকুমেন্ট ইভেন্ট')}</p>
                {journal.sourceEvidence.events.length === 0 ? (
                  <p className="mt-1 text-[12px] text-ink-500">{L('No document events recorded for this source.', 'এই উৎসের জন্য কোনো ডকুমেন্ট ইভেন্ট নেই।')}</p>
                ) : (
                  <ul className="mt-1 space-y-1.5 text-[12px] text-ink-600">
                    {journal.sourceEvidence.events.map((event, index) => (
                      <li key={`${event.action}-${index}`}>
                        <span className="font-semibold text-ink-800">{event.action}</span>
                        {event.actorName ? ` · ${event.actorName}` : ''}
                        {event.reason ? ` · ${event.reason}` : ''}
                        <span className="block text-ink-400">{new Date(event.createdAt).toLocaleString(locale === 'bn-BD' ? 'bn-BD' : 'en-GB')}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="rounded-xl border border-line p-3">
                <p className="text-[12px] font-semibold text-ink-900">{L('Audit trail', 'অডিট ট্রেইল')}</p>
                {journal.auditTrail.length === 0 ? (
                  <p className="mt-1 text-[12px] text-ink-500">{L('No audit events recorded for this journal.', 'এই জার্নালের জন্য কোনো অডিট ইভেন্ট নেই।')}</p>
                ) : (
                  <ul className="mt-1 space-y-1.5 text-[12px] text-ink-600">
                    {journal.auditTrail.map((event) => (
                      <li key={event.id}>
                        <span className="font-semibold text-ink-800">{event.action}</span>
                        {event.actorName ? ` · ${event.actorName}` : ''}
                        {event.reason ? ` · ${event.reason}` : ''}
                        <span className="block text-ink-400">{new Date(event.createdAt).toLocaleString(locale === 'bn-BD' ? 'bn-BD' : 'en-GB')}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>

            <p className="flex items-start gap-1.5 text-[12px] text-ink-500">
              <ArrowUpRight size={13} className="mt-0.5 shrink-0" />
              {L('This evidence is read-only. Posted journals are immutable; corrections use linked reversals.', 'এই প্রমাণ শুধুমাত্র পঠনযোগ্য। পোস্টকৃত জার্নাল অপরিবর্তনীয়; সংশোধনে লিংকড রিভার্সাল ব্যবহার করা হয়।')}
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
