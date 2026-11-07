import { useCallback, useEffect, useState } from 'react';
import { Download, RefreshCcw } from 'lucide-react';
import { localized } from '../../core/i18n';
import { useAuth } from '../../auth/AuthContext';
import { usePreferences } from '../../preferences/AppPreferences';
import { apiErrorMessage, ErrorBanner, INPUT_CLASS, Notice } from '../setup/setupUi';
import { PageHeader } from '../../shell/PageHeader';
import { auditApi, type AuditEvent } from '../../audit/api';

function formatInstant(value: string): string {
  return new Date(value).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'medium' });
}

function downloadText(text: string, filename: string): void {
  if (typeof window === 'undefined') return;
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function jsonText(value: Record<string, unknown> | null): string {
  if (!value) return '—';
  try {
    return JSON.stringify(value);
  } catch {
    return '—';
  }
}

export default function AuditLogPage() {
  const { locale } = usePreferences();
  const auth = useAuth();
  const companyId = auth.activeCompany?.id ?? '';
  const L = useCallback((en: string, bn: string) => localized(locale, en, bn), [locale]);
  const canExport = auth.hasCompanyPermission('EXPORT_DATA');

  const [entries, setEntries] = useState<AuditEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [action, setAction] = useState('');
  const [actorUserId, setActorUserId] = useState('');
  const [q, setQ] = useState('');
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const limit = 50;

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    setError(null);
    try {
      const response = await auditApi.list(companyId, {
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
        ...(action ? { action } : {}),
        ...(actorUserId ? { actorUserId } : {}),
        ...(q ? { q } : {}),
        limit,
        offset,
      });
      setEntries(response.entries);
      setTotal(response.total);
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [action, actorUserId, companyId, from, offset, q, to]);

  useEffect(() => {
    void load();
  }, [load]);

  const exportLog = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const exported = await auditApi.exportCsv(companyId, {
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
        ...(action ? { action } : {}),
        ...(actorUserId ? { actorUserId } : {}),
        ...(q ? { q } : {}),
      });
      downloadText(exported.text, exported.filename ?? `audit-log-${companyId}.csv`);
      setNotice(L('Audit log exported and the export was recorded.', 'অডিট লগ রপ্তানি হয়েছে এবং রপ্তানি কার্যক্রম নথিভুক্ত হয়েছে।'));
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const page = Math.floor(offset / limit) + 1;
  const pages = Math.max(Math.ceil(total / limit), 1);

  if (!auth.hasCompanyPermission('VIEW_REPORTS')) {
    return (
      <Notice
        tone="warning"
        message={L(
          'Your role cannot view the audit log. Ask a controller, owner, administrator or auditor for access.',
          'আপনার ভূমিকা অডিট লগ দেখতে পারে না। প্রবেশাধিকারের জন্য নিয়ন্ত্রক, মালিক, প্রশাসক বা নিরীক্ষকের কাছে জিজ্ঞাসা করুন।',
        )}
      />
    );
  }

  return (
    <div className="space-y-4">
      <section className="ql-card p-4 sm:p-6">
        <PageHeader
          eyebrow={L('Audit log', 'অডিট লগ')}
          title={L('Append-only activity trail', 'সংযোজন-শুধু কার্যক্রমের ইতিহাস')}
          description={L(
            'Who did what, when, from where, why and what changed. The database rejects updates and deletes. The log includes identity, company, master-data, document, journal, payment, reversal, period, close, approval and export events.',
            'কে কী করেছে, কখন, কোথা থেকে, কেন এবং কী পরিবর্তন হয়েছে। ডেটাবেস আপডেট ও ডিলিট প্রত্যাখ্যান করে। লগে পরিচয়, কোম্পানি, মাস্টার ডেটা, নথি, জার্নাল, পেমেন্ট, রিভার্সাল, সময়কাল, সমাপনী, অনুমোদন ও রপ্তানি ঘটনা থাকে।',
          )}
          actions={
            canExport ? (
              <button type="button" className="ql-btn ql-btn-secondary" disabled={busy} onClick={() => void exportLog()}>
                <Download size={15} aria-hidden /> {busy ? L('Exporting…', 'রপ্তানি হচ্ছে…') : L('Export CSV', 'সিএসভি রপ্তানি')}
              </button>
            ) : null
          }
        />

        {error ? <div className="mt-4"><ErrorBanner message={error} /></div> : null}
        {notice ? <div className="mt-4"><Notice message={notice} tone="success" /></div> : null}

        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <label className="block text-[12px] font-semibold text-ink-600">
            {L('From', 'থেকে')}
            <input type="date" className={`${INPUT_CLASS} mt-1`} value={from} onChange={(event) => { setFrom(event.target.value); setOffset(0); }} />
          </label>
          <label className="block text-[12px] font-semibold text-ink-600">
            {L('To', 'পর্যন্ত')}
            <input type="date" className={`${INPUT_CLASS} mt-1`} value={to} onChange={(event) => { setTo(event.target.value); setOffset(0); }} />
          </label>
          <label className="block text-[12px] font-semibold text-ink-600">
            {L('Action', 'কার্যক্রম')}
            <input className={`${INPUT_CLASS} mt-1`} value={action} onChange={(event) => { setAction(event.target.value); setOffset(0); }} placeholder="journal.posted" />
          </label>
          <label className="block text-[12px] font-semibold text-ink-600">
            {L('Actor user ID', 'ব্যবহারকারীর আইডি')}
            <input className={`${INPUT_CLASS} mt-1`} value={actorUserId} onChange={(event) => { setActorUserId(event.target.value); setOffset(0); }} placeholder="UUID" />
          </label>
          <label className="block text-[12px] font-semibold text-ink-600">
            {L('Search', 'অনুসন্ধান')}
            <input className={`${INPUT_CLASS} mt-1`} value={q} onChange={(event) => { setQ(event.target.value); setOffset(0); }} placeholder={L('Entity, reason or action', 'সত্তা, কারণ বা কার্যক্রম')} />
          </label>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" className="ql-btn ql-btn-secondary min-h-9 text-[12px]" onClick={() => void load()} disabled={loading}>
            <RefreshCcw size={13} /> {L('Refresh', 'রিফ্রেশ')}
          </button>
          <span className="text-[12px] text-ink-500">{total.toLocaleString('en-US')} {L('events', 'ঘটনা')}</span>
        </div>
      </section>

      <section className="ql-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="ql-table min-w-[1100px]">
            <thead>
              <tr>
                <th>{L('Time', 'সময়')}</th>
                <th>{L('Actor', 'ব্যবহারকারী')}</th>
                <th>{L('Action', 'কার্যক্রম')}</th>
                <th>{L('Entity', 'সত্তা')}</th>
                <th>{L('Reason', 'কারণ')}</th>
                <th>{L('Source', 'উৎস')}</th>
                <th>{L('Before / after', 'আগে / পরে')}</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((event) => (
                <tr key={event.id} className="align-top">
                  <td className="whitespace-nowrap text-[12px] text-ink-600">{formatInstant(event.createdAt)}</td>
                  <td className="text-[12px]">
                    <p className="font-semibold text-ink-800">{event.actorName ?? '—'}</p>
                    <p className="font-mono text-[12px] text-ink-400">{event.actorUserId?.slice(0, 8) ?? '—'}</p>
                  </td>
                  <td className="font-mono text-[12px] font-semibold text-vault-700">{event.action}</td>
                  <td className="text-[12px]">
                    <p>{event.entityType}</p>
                    <p className="font-mono text-[12px] text-ink-400">{event.entityId ?? '—'}</p>
                  </td>
                  <td className="max-w-[260px] text-[12px] text-ink-700">{event.reason ?? '—'}</td>
                  <td className="text-[12px] text-ink-600">
                    <p>{event.ip ?? '—'}</p>
                    <p className="max-w-[180px] truncate text-[12px] text-ink-400" title={event.userAgent ?? ''}>{event.userAgent ?? '—'}</p>
                  </td>
                  <td className="max-w-[360px] text-[12px] text-ink-600">
                    <details>
                      <summary className="cursor-pointer text-[12px] font-semibold text-vault-700">{L('Inspect', 'দেখুন')}</summary>
                      <p className="mt-1 break-all font-mono">{jsonText(event.before)}</p>
                      <p className="mt-1 break-all font-mono">{jsonText(event.after)}</p>
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {entries.length === 0 && !loading ? (
          <p className="px-5 py-8 text-center text-[13px] text-ink-500">{L('No audit event matches these filters.', 'এই ফিল্টারে কোনো অডিট ঘটনা নেই।')}</p>
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-ink-100 px-4 py-3">
          <span className="text-[12px] text-ink-500">{L('Page', 'পৃষ্ঠা')} {page} / {pages}</span>
          <div className="flex gap-2">
            <button type="button" className="ql-btn ql-btn-secondary min-h-9 text-[12px]" disabled={offset === 0} onClick={() => setOffset(Math.max(offset - limit, 0))}>{L('Previous', 'আগের')}</button>
            <button type="button" className="ql-btn ql-btn-secondary min-h-9 text-[12px]" disabled={offset + limit >= total} onClick={() => setOffset(offset + limit)}>{L('Next', 'পরের')}</button>
          </div>
        </div>
      </section>
    </div>
  );
}
