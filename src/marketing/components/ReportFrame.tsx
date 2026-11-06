import { CheckCircle2 } from '../icons';
import { formatPoisha } from '../../core/money';
import { useMarketingUi } from '../MarketingApp';

const taka = (value: number): bigint => BigInt(value) * 100n;

export function ReportFrame() {
  const { locale, t } = useMarketingUi();
  const currency = locale === 'bn-BD' ? '৳' : 'BDT';
  const money = (value: number): string =>
    formatPoisha(taka(value), { locale, grouping: 'LAKH_CRORE', showSymbol: false });

  const figures = [
    { label: t({ en: 'Revenue', bn: 'রাজস্ব' }), value: money(1_150_000) },
    { label: t({ en: 'Gross profit', bn: 'মোট মুনাফা' }), value: money(410_000) },
    { label: t({ en: 'Operating profit', bn: 'পরিচালন মুনাফা' }), value: money(260_000) },
    { label: t({ en: 'Profit for the period', bn: 'সময়কালের মুনাফা' }), value: money(174_000) },
  ];

  const controls = [
    t({ en: 'Trial balance', bn: 'রেওয়ামিল' }),
    t({ en: 'Receivable control', bn: 'প্রাপ্য নিয়ন্ত্রণ' }),
    t({ en: 'Payable control', bn: 'প্রদেয় নিয়ন্ত্রণ' }),
    t({ en: 'VAT current account', bn: 'ভ্যাট চলতি হিসাব' }),
  ];

  return (
    <figure
      className="mkt-product-frame h-full"
      aria-label={t({ en: 'Illustrative management accounts layout', bn: 'উদাহরণ ব্যবস্থাপনা হিসাব লেআউট' })}
    >
      <div className="mkt-product-chrome">
        <div className="flex items-center gap-3">
          <span className="mkt-product-dots" aria-hidden="true">
            <span className="mkt-product-dot" />
            <span className="mkt-product-dot" />
            <span className="mkt-product-dot" />
          </span>
          <span className="font-ql-mono text-[12px] text-ql-ink-subtle">
            {t({ en: 'Fintuity / Reports', bn: 'ফিনটুইটি / প্রতিবেদন' })}
          </span>
        </div>
        <span className="ql-badge ql-badge-warning">
          {t({ en: 'Illustrative layout', bn: 'উদাহরণ লেআউট' })}
        </span>
      </div>

      <div className="p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ql-ink-subtle">
              {t({ en: 'Management accounts', bn: 'ব্যবস্থাপনা হিসাব' })}
            </p>
            <p className="mt-1 text-[18px] font-semibold tracking-[-0.02em] text-ql-ink">
              {t({ en: 'For the month ended 31 Dec 2026', bn: '৩১ ডিসেম্বর ২০২৬-এ শেষ হওয়া মাসের জন্য' })}
            </p>
          </div>
          <span className="ql-badge ql-badge-warning">
            {t({ en: 'Unaudited', bn: 'অনিরীক্ষিত' })}
          </span>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {figures.map((figure) => (
            <div key={figure.label} className="rounded-ql border border-ql-border bg-ql-surface-muted p-3">
              <p className="text-[12px] leading-4 text-ql-ink-subtle">{figure.label}</p>
              <p className="font-money mt-1 text-[15px] font-semibold text-ql-ink">
                <span className="mr-1 text-[12px] font-medium text-ql-ink-subtle">{currency}</span>
                {figure.value}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-4 overflow-hidden rounded-ql border border-ql-border">
          {controls.map((control, index) => (
            <div
              key={control}
              className={`flex items-center justify-between gap-3 px-3 py-2.5 text-[13px] ${
                index > 0 ? 'border-t border-ql-border' : ''
              }`}
            >
              <span className="text-ql-ink">{control}</span>
              <span className="inline-flex items-center gap-1.5 font-semibold text-ql-success">
                <CheckCircle2 size={14} aria-hidden="true" />
                {t({ en: 'Agrees', bn: 'মিলে যায়' })}
              </span>
            </div>
          ))}
        </div>

        <p className="mt-3 text-[12px] leading-5 text-ql-ink-subtle">
          {t({
            en: 'Illustrative layout and synthetic amounts. Management accounts are unaudited and are not a statutory filing.',
            bn: 'উদাহরণ লেআউট ও কৃত্রিম অঙ্ক। ব্যবস্থাপনা হিসাব অনিরীক্ষিত এবং এটি সংবিধিবদ্ধ ফাইলিং নয়।',
          })}
        </p>
      </div>
    </figure>
  );
}

export default ReportFrame;
