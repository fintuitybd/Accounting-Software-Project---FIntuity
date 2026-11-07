import { CircleAlert, CircleCheck, Info, ShieldAlert } from 'lucide-react';
import { localized } from '../../core/i18n';
import type {
  ReportCheck,
  ReportException,
  ReportReviewStatus,
  ReportSection,
  ReportTemplate,
} from '../../reports/api';

type MoneyFn = (poisha: bigint, options?: { sign?: boolean; symbol?: boolean }) => string;

export function ReportAmount({
  value,
  money,
  muted = false,
}: {
  value: string;
  money: MoneyFn;
  muted?: boolean;
}) {
  const poisha = BigInt(value);
  if (poisha === 0n) return <span className="text-ink-300">—</span>;
  return (
    <span className={`font-money tabular-nums ${muted ? 'text-ink-500' : 'text-ink-900'}`}>
      {money(poisha)}
    </span>
  );
}

export function TemplateBadge({
  template,
  locale,
}: {
  template: ReportTemplate;
  locale: 'en-BD' | 'bn-BD';
}) {
  const status = template.reviewStatus;
  const tone =
    status === 'APPROVED'
      ? 'ql-badge-success'
      : 'ql-badge-warn';
  const label =
    status === 'APPROVED'
      ? localized(locale, 'Template approved', 'টেমপ্লেট অনুমোদিত')
      : status === 'PENDING_TAX_COUNSEL'
        ? localized(locale, 'Template pending tax-counsel review', 'টেমপ্লেট কর পরামর্শকের পর্যালোচনার অপেক্ষায়')
        : localized(locale, 'Template pending accountant review', 'টেমপ্লেট হিসাবরক্ষকের পর্যালোচনার অপেক্ষায়');
  return (
    <span className={`ql-badge ${tone}`} title={template.source}>
      <ShieldAlert size={12} /> {label} · v{template.version}
    </span>
  );
}

export function ReviewStatusBadge({
  status,
  locale,
}: {
  status: ReportReviewStatus;
  locale: 'en-BD' | 'bn-BD';
}) {
  if (status === 'APPROVED') {
    return <span className="ql-badge ql-badge-success">{localized(locale, 'Approved', 'অনুমোদিত')}</span>;
  }
  return (
    <span className="ql-badge ql-badge-warn">
      {localized(locale, 'Review required', 'পর্যালোচনা প্রয়োজন')}
    </span>
  );
}

export function CheckList({
  checks,
  locale,
}: {
  checks: ReportCheck[];
  locale: 'en-BD' | 'bn-BD';
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {checks.map((check) => {
        const tone = check.passed ? 'border-emerald-200 bg-emerald-50/60' : check.blocksExport ? 'border-rose-200 bg-rose-50/60' : 'border-amber-200 bg-amber-50/60';
        const Icon = check.passed ? CircleCheck : check.blocksExport ? CircleAlert : Info;
        return (
          <div key={check.key} className={`rounded-xl border p-3 ${tone}`}>
            <p className="flex items-start gap-1.5 text-[12px] font-semibold text-ink-900">
              <Icon size={13} className={check.passed ? 'mt-0.5 text-emerald-700' : check.blocksExport ? 'mt-0.5 text-rose-700' : 'mt-0.5 text-amber-700'} />
              <span>{localized(locale, check.labelEn, check.labelBn)}</span>
            </p>
            <p className="mt-1 text-[12px] leading-relaxed text-ink-600">
              {localized(locale, check.detailEn, check.detailBn)}
            </p>
            {check.differencePoisha !== null && check.differencePoisha !== '0' ? (
              <p className="mt-1 font-mono text-[12px] font-semibold text-rose-700">
                {localized(locale, 'Difference (poisha)', 'পার্থক্য (পয়সা)')}: {check.differencePoisha}
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export function ExceptionList({
  exceptions,
  locale,
}: {
  exceptions: ReportException[];
  locale: 'en-BD' | 'bn-BD';
}) {
  if (exceptions.length === 0) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 text-[12px] text-emerald-900">
        <p className="flex items-center gap-1.5 font-semibold">
          <CircleCheck size={13} /> {localized(locale, 'No exceptions recorded', 'কোনো ব্যতিক্রম নেই')}
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {exceptions.map((entry) => (
        <div
          key={entry.code}
          className={`rounded-xl border p-3 ${entry.severity === 'BLOCKER' ? 'border-rose-200 bg-rose-50/60' : entry.severity === 'WARNING' ? 'border-amber-200 bg-amber-50/60' : 'border-line bg-surface-2/40'}`}
        >
          <p className="flex items-start gap-1.5 text-[12px] font-semibold text-ink-900">
            {entry.severity === 'BLOCKER' ? <CircleAlert size={13} className="mt-0.5 text-rose-700" /> : <Info size={13} className="mt-0.5 text-amber-700" />}
            {entry.code}
          </p>
          <p className="mt-1 text-[12px] leading-relaxed text-ink-600">
            {localized(locale, entry.messageEn, entry.messageBn)}
          </p>
        </div>
      ))}
    </div>
  );
}

export function SectionTable({
  section,
  locale,
  money,
  comparativeLabel,
  currentLabel,
  onDrillAccount,
  onDrillDown,
}: {
  section: ReportSection;
  locale: 'en-BD' | 'bn-BD';
  money: MoneyFn;
  comparativeLabel: string;
  currentLabel: string;
  onDrillAccount?: (accountId: string) => void;
  onDrillDown?: (target: { noteRef?: string; accountCode?: string; accountId?: string; title?: string }) => void;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-line">
      <div className="flex flex-wrap items-baseline justify-between gap-2 bg-surface-2/50 px-3 py-2">
        <h3 className="text-[13px] font-semibold text-ink-900">
          {localized(locale, section.titleEn, section.titleBn)}
        </h3>
        <p className="font-money text-[12px] font-semibold text-ink-700">{money(BigInt(section.totalPoisha))}</p>
      </div>
      <div className="hidden md:block overflow-x-auto">
        <table className="ql-table w-full min-w-[560px] text-[12px]">
          <thead>
            <tr>
              <th scope="col" className="text-left">{localized(locale, 'Account', 'হিসাব')}</th>
              <th scope="col" className="text-right">{currentLabel}</th>
              <th scope="col" className="text-right">{comparativeLabel}</th>
            </tr>
          </thead>
          <tbody>
            {section.lines.length === 0 ? (
              <tr>
                <td colSpan={3} className="text-center text-ink-500">
                  {localized(locale, 'No posted balance in this section.', 'এই অংশে কোনো পোস্টকৃত ব্যালেন্স নেই।')}
                </td>
              </tr>
            ) : (
              section.lines.map((line) => (
                <tr key={`${section.key}:${line.accountId ?? line.accountNameEn}`}>
                  <td>
                    <span className="font-mono text-[12px] text-ink-500">{line.accountCode ?? '—'}</span>{' '}
                    {onDrillDown ? (
                      <button
                        type="button"
                        onClick={() =>
                          onDrillDown({
                            noteRef: line.note ?? undefined,
                            accountCode: line.accountCode ?? undefined,
                            accountId: line.accountId ?? undefined,
                            title: line.accountNameEn,
                          })
                        }
                        className="text-left font-medium text-ink-900 hover:text-brand-bright hover:underline cursor-pointer"
                        title="Click to drill down (IAS/IFRS Studio)"
                      >
                        {localized(locale, line.accountNameEn, line.accountNameBn ?? line.accountNameEn)}
                      </button>
                    ) : line.accountId && onDrillAccount ? (
                      <button
                        type="button"
                        onClick={() => onDrillAccount(line.accountId!)}
                        className="text-left font-medium text-ink-900 hover:text-brand-bright hover:underline"
                      >
                        {localized(locale, line.accountNameEn, line.accountNameBn ?? line.accountNameEn)}
                      </button>
                    ) : (
                      <span className="text-ink-900">{localized(locale, line.accountNameEn, line.accountNameBn ?? line.accountNameEn)}</span>
                    )}
                    {line.note && onDrillDown ? (
                      <button
                        type="button"
                        onClick={() =>
                          onDrillDown({
                            noteRef: line.note!,
                            title: `${line.note} Drill-Down`,
                          })
                        }
                        className="ml-2 rounded-full border border-ql-border bg-surface-2 px-2 py-0.5 text-[10px] font-semibold text-brand-600 dark:text-brand-400 hover:bg-surface-3 cursor-pointer"
                        title={`Click to inspect ${line.note} underlying GL & documents`}
                      >
                        {line.note}
                      </button>
                    ) : null}
                    {line.kind === 'DERIVED' ? (
                      <span className="ml-1.5 rounded-full bg-vault-50 px-1.5 py-0.5 text-[12px] font-semibold text-vault-700">
                        {localized(locale, 'Derived', 'উৎপন্ন')}
                      </span>
                    ) : null}
                  </td>
                  <td className="text-right"><ReportAmount value={line.amountPoisha} money={money} /></td>
                  <td className="text-right"><ReportAmount value={line.comparativePoisha} money={money} muted /></td>
                </tr>
              ))
            )}
          </tbody>
          <tfoot>
            <tr className="bg-surface-2/40">
              <th scope="row" className="text-right text-[12px] uppercase tracking-[0.04em] text-ink-500">
                {localized(locale, 'Section total', 'অংশের মোট')}
              </th>
              <td className="text-right font-semibold"><ReportAmount value={section.totalPoisha} money={money} /></td>
              <td className="text-right"><ReportAmount value={section.comparativeTotalPoisha} money={money} muted /></td>
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="md:hidden space-y-2 p-2">
        {section.lines.length === 0 ? (
          <p className="text-center text-[12px] text-ink-500 py-2">
            {localized(locale, 'No posted balance in this section.', 'এই অংশে কোনো পোস্টকৃত ব্যালেন্স নেই।')}
          </p>
        ) : (
          section.lines.map((line) => (
            <div key={`${section.key}:${line.accountId ?? line.accountNameEn}`} className="ql-card p-2.5 text-[12px] space-y-1">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <span className="font-mono text-[11px] text-ink-500">{line.accountCode ?? '—'}</span>{' '}
                  {onDrillDown ? (
                    <button
                      type="button"
                      onClick={() =>
                        onDrillDown({
                          noteRef: line.note ?? undefined,
                          accountCode: line.accountCode ?? undefined,
                          accountId: line.accountId ?? undefined,
                          title: line.accountNameEn,
                        })
                      }
                      className="text-left font-medium text-ink-900 hover:text-brand-bright hover:underline cursor-pointer"
                      title="Click to drill down (IAS/IFRS Studio)"
                    >
                      {localized(locale, line.accountNameEn, line.accountNameBn ?? line.accountNameEn)}
                    </button>
                  ) : line.accountId && onDrillAccount ? (
                    <button
                      type="button"
                      onClick={() => onDrillAccount(line.accountId!)}
                      className="text-left font-medium text-ink-900 hover:text-brand-bright hover:underline"
                    >
                      {localized(locale, line.accountNameEn, line.accountNameBn ?? line.accountNameEn)}
                    </button>
                  ) : (
                    <span className="text-ink-900">{localized(locale, line.accountNameEn, line.accountNameBn ?? line.accountNameEn)}</span>
                  )}
                  {line.note && onDrillDown ? (
                    <button
                      type="button"
                      onClick={() =>
                        onDrillDown({
                          noteRef: line.note!,
                          title: `${line.note} Drill-Down`,
                        })
                      }
                      className="ml-2 rounded-full border border-ql-border bg-surface-2 px-2 py-0.5 text-[10px] font-semibold text-brand-600 dark:text-brand-400 hover:bg-surface-3 cursor-pointer"
                      title={`Click to inspect ${line.note} underlying GL & documents`}
                    >
                      {line.note}
                    </button>
                  ) : null}
                  {line.kind === 'DERIVED' ? (
                    <span className="ml-1.5 rounded-full bg-vault-50 px-1.5 py-0.5 text-[12px] font-semibold text-vault-700">
                      {localized(locale, 'Derived', 'উৎপন্ন')}
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="flex items-center justify-between pt-1 border-t border-line/60">
                <span className="text-ink-400 text-[11px]">{currentLabel}:</span>
                <span className="ql-mono font-semibold text-ink-900"><ReportAmount value={line.amountPoisha} money={money} /></span>
              </div>
              {line.comparativePoisha ? (
                <div className="flex items-center justify-between text-ink-500 text-[11px]">
                  <span>{comparativeLabel}:</span>
                  <span className="ql-mono"><ReportAmount value={line.comparativePoisha} money={money} muted /></span>
                </div>
              ) : null}
            </div>
          ))
        )}
      </div>
    </section>
  );
}

export function ReportEmpty({ messageEn, messageBn, locale }: { messageEn: string; messageBn: string; locale: 'en-BD' | 'bn-BD' }) {
  return (
    <div className="rounded-xl border border-line bg-surface-2/30 p-6 text-center text-[13px] text-ink-500">
      {localized(locale, messageEn, messageBn)}
    </div>
  );
}
