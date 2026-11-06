import { CheckCircle2 } from '../icons';
import { formatPoisha } from '../../core/money';
import { useMarketingUi } from '../MarketingApp';

const poisha = (taka: number): bigint => BigInt(taka) * 100n;

export function ProductFrame({
  image,
  imageAlt,
}: {
  image?: string;
  imageAlt?: string;
}) {
  const { locale, t } = useMarketingUi();
  /* Use ISO-style BDT on the English page so the small Taka glyph does not pull the 107 KB
     Bengali font into the initial paint. The Bangla page uses the local symbol and numerals. */
  const currency = locale === 'bn-BD' ? '৳' : 'BDT';
  const money = (taka: number): string =>
    `${currency} ${formatPoisha(poisha(taka), { locale, grouping: 'LAKH_CRORE', showSymbol: false })}`;

  return (
    <figure className="mkt-product-frame" aria-label={t({ en: 'Product preview', bn: 'পণ্যের পূর্বরূপ' })}>
      <div className="mkt-product-chrome">
        <div className="flex items-center gap-3">
          <span className="mkt-product-dots" aria-hidden="true">
            <span className="mkt-product-dot" />
            <span className="mkt-product-dot" />
            <span className="mkt-product-dot" />
          </span>
          <span className="font-ql-mono text-[12px] text-ql-ink-subtle">Fintuity Accounting Suite / Sales</span>
        </div>
        <span className="ql-badge ql-badge-warning">
          {t({ en: 'Sample data', bn: 'নমুনা ডেটা' })}
        </span>
      </div>

      {image ? (
        <img
          src={image}
          alt={imageAlt ?? t({ en: 'Fintuity Accounting Suite product screen with sample data', bn: 'নমুনা ডেটাসহ ফিনটুইটি অ্যাকাউন্টিং স্যুট পণ্যের স্ক্রিন' })}
          className="block h-auto w-full"
          loading="eager"
          decoding="async"
          width={1200}
          height={760}
        />
      ) : (
        <div className="mkt-product-layout">
          <div className="mkt-product-main">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[12px] font-semibold text-ql-ink-subtle">
                  {t({ en: 'Sales invoice', bn: 'বিক্রয় ইনভয়েস' })}
                </p>
                <p className="mt-0.5 font-ql-mono text-[14px] font-semibold text-ql-ink">INV-2026-0042</p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <span className="ql-badge ql-badge-success">
                  <CheckCircle2 size={12} aria-hidden="true" />
                  {t({ en: 'Posted', bn: 'পোস্টকৃত' })}
                </span>
                <span className="ql-badge ql-badge-neutral">
                  {t({ en: 'Open', bn: 'খোলা' })}
                </span>
              </div>
            </div>

            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-[12px]">
              <div>
                <dt className="text-ql-ink-subtle">{t({ en: 'Customer', bn: 'গ্রাহক' })}</dt>
                <dd className="mt-0.5 font-medium text-ql-ink">Meghna Traders</dd>
              </div>
              <div>
                <dt className="text-ql-ink-subtle">{t({ en: 'Date', bn: 'তারিখ' })}</dt>
                <dd className="mt-0.5 font-medium text-ql-ink">12 Nov 2026</dd>
              </div>
            </dl>

            <div className="mt-4 overflow-x-auto">
              <table className="mkt-table">
                <caption className="sr-only">
                  {t({ en: 'Sample sales invoice lines', bn: 'নমুনা বিক্রয় ইনভয়েসের লাইন' })}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">{t({ en: 'Description', bn: 'বিবরণ' })}</th>
                    <th scope="col" className="text-right">
                      {t({ en: 'Qty', bn: 'পরিমাণ' })}
                    </th>
                    <th scope="col" className="text-right">
                      {t({ en: 'Rate', bn: 'দর' })}
                    </th>
                    <th scope="col" className="text-right">
                      {t({ en: 'Amount', bn: 'অঙ্ক' })}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Cotton fabric</td>
                    <td className="mkt-money">40 rolls</td>
                    <td className="mkt-money">{money(1_500)}</td>
                    <td className="mkt-money">{money(60_000)}</td>
                  </tr>
                  <tr>
                    <td>Delivery</td>
                    <td className="mkt-money">1</td>
                    <td className="mkt-money">{money(5_000)}</td>
                    <td className="mkt-money">{money(5_000)}</td>
                  </tr>
                  <tr>
                    <td>Installation</td>
                    <td className="mkt-money">1</td>
                    <td className="mkt-money">{money(35_000)}</td>
                    <td className="mkt-money">{money(35_000)}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <dl className="mt-4 ml-auto max-w-[260px] space-y-1.5 text-[13px]">
              <div className="flex justify-between gap-4">
                <dt className="text-ql-ink-muted">{t({ en: 'Subtotal', bn: 'উপমোট' })}</dt>
                <dd className="mkt-money text-ql-ink">{money(100_000)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-ql-ink-muted">{t({ en: 'VAT 15%', bn: 'ভ্যাট ১৫%' })}</dt>
                <dd className="mkt-money text-ql-ink">{money(15_000)}</dd>
              </div>
              <div className="flex justify-between gap-4 border-t border-ql-border pt-1.5 font-semibold">
                <dt className="text-ql-ink">{t({ en: 'Total', bn: 'মোট' })}</dt>
                <dd className="mkt-money text-ql-ink">{money(115_000)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-ql-ink-muted">{t({ en: 'Received', bn: 'গৃহীত' })}</dt>
                <dd className="mkt-money text-ql-success">{money(40_000)}</dd>
              </div>
              <div className="flex justify-between gap-4 font-semibold">
                <dt className="text-ql-ink">{t({ en: 'Outstanding', bn: 'বাকি' })}</dt>
                <dd className="mkt-money text-ql-accent">{money(75_000)}</dd>
              </div>
            </dl>
          </div>

          <aside className="mkt-product-side" aria-label={t({ en: 'Journal preview', bn: 'জার্নাল পূর্বরূপ' })}>
            <p className="text-[12px] font-semibold text-ql-ink">
              {t({ en: 'Journal preview', bn: 'জার্নাল পূর্বরূপ' })}
            </p>
            <dl className="mt-3 space-y-2 text-[12px]">
              <div className="flex justify-between gap-2">
                <dt className="text-ql-ink-muted">Dr Accounts receivable</dt>
                <dd className="mkt-money text-ql-ink">{money(115_000)}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-ql-ink-muted">Cr Sales revenue</dt>
                <dd className="mkt-money text-ql-ink">{money(100_000)}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-ql-ink-muted">Cr VAT payable</dt>
                <dd className="mkt-money text-ql-ink">{money(15_000)}</dd>
              </div>
            </dl>
            <div className="mt-3 border-t border-ql-border pt-3">
              <span className="ql-badge ql-badge-success">
                <CheckCircle2 size={12} aria-hidden="true" />
                {t({ en: 'Balanced to 0 poisha', bn: '০ পয়সায় সুষম' })}
              </span>
            </div>
            <p className="mt-3 text-[12px] leading-5 text-ql-ink-subtle">
              {t({
                en: 'The posted journal is immutable. A correction creates a linked reversal with a reason.',
                bn: 'পোস্টকৃত জার্নাল অপরিবর্তনীয়। সংশোধনে কারণসহ সংযুক্ত বিপরীত এন্ট্রি তৈরি হয়।',
              })}
            </p>
          </aside>
        </div>
      )}
    </figure>
  );
}

export default ProductFrame;
