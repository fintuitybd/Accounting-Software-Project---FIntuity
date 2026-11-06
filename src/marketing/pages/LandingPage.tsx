import { CheckCircle2, ChevronRight, ShieldCheck } from '../icons';
import { formatPoisha } from '../../core/money';
import { DemoRequestForm } from '../components/DemoRequestForm';
import { ProductFrame } from '../components/ProductFrame';
import { ReportFrame } from '../components/ReportFrame';
import { useMarketingUi } from '../MarketingApp';
import { marketingCopy } from '../content';
import { usePageMeta } from '../usePageMeta';

export default function LandingPage() {
  const { t } = useMarketingUi();
  usePageMeta({
    title: 'Fintuity Accounting Suite — accounting that agrees with itself',
    description:
      'Server-backed accounting, VAT preparation, receivables, payables, banking reconciliation and controlled close for Bangladeshi businesses. BDT, Bangla and English.',
    path: '/',
  });

  return (
    <>
      <section className="mkt-hero" aria-labelledby="hero-title">
        <div className="mkt-container">
          <div className="mkt-hero-grid">
            <div>
              <p className="mkt-eyebrow-chip">{t(marketingCopy.hero.eyebrow)}</p>
              <h1 id="hero-title" className="mkt-h1 mkt-hero-title mt-4 text-ql-ink">
                {t(marketingCopy.hero.title)}
              </h1>
              <p className="mkt-lead mt-5 max-w-xl">{t(marketingCopy.hero.subtitle)}</p>
              <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                <a href="#contact" className="ql-btn ql-btn-primary">
                  {t(marketingCopy.actions.requestDemo)}
                </a>
                <a href="#workflows" className="ql-btn ql-btn-secondary">
                  {t(marketingCopy.actions.seeHow)}
                  <ChevronRight size={16} aria-hidden="true" />
                </a>
              </div>
              <p className="mkt-small mt-5 max-w-xl">{t(marketingCopy.hero.note)}</p>
              <ul className="mt-7 grid gap-2 sm:grid-cols-2">
                {marketingCopy.trust.map((item) => (
                  <li key={item.en} className="flex items-start gap-2 text-[14px] text-ql-ink-muted">
                    <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-ql-brand" aria-hidden="true" />
                    <span>{t(item)}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="relative">
              <ProductFrame />
              <div className="mkt-floating-note" aria-hidden="true">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-ql-success-soft text-ql-success">
                  <CheckCircle2 size={17} />
                </span>
                <span>
                  <span className="block text-[12px] font-semibold text-ql-ink">
                    {t({ en: 'Trial balance', bn: 'রেওয়ামিল' })}
                  </span>
                  <span className="block text-[12px] text-ql-ink-muted">
                    {t({ en: 'Balanced to 0 poisha', bn: '০ পয়সা পর্যন্ত সুষম' })}
                  </span>
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="product" className="mkt-section border-t border-ql-border" aria-labelledby="problem-title">
        <div className="mkt-container">
          <SectionHeading
            eyebrow={t(marketingCopy.problem.eyebrow)}
            title={t(marketingCopy.problem.title)}
            intro={t(marketingCopy.problem.intro)}
            titleId="problem-title"
          />
          <div className="mkt-grid-4 mt-10">
            {marketingCopy.problem.items.map((item, index) => (
              <article key={item.title.en} className="mkt-card">
                <span className="mkt-number" aria-hidden="true">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <h3 className="mkt-h3 mt-4 text-ql-ink">{t(item.title)}</h3>
                <p className="mkt-body mt-2">{t(item.description)}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="workflows" className="mkt-section border-t border-ql-border bg-ql-surface/60" aria-labelledby="workflows-title">
        <div className="mkt-container">
          <SectionHeading
            eyebrow={t(marketingCopy.workflows.eyebrow)}
            title={t(marketingCopy.workflows.title)}
            intro={t(marketingCopy.workflows.intro)}
            titleId="workflows-title"
          />
          <div className="mt-10 grid gap-4 lg:grid-cols-2">
            {marketingCopy.workflows.items.map((workflow, index) => (
              <article key={workflow.id} className="mkt-card flex flex-col">
                <div className="flex items-start gap-3">
                  <span className="mkt-number" aria-hidden="true">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <div>
                    <h3 className="mkt-h3 text-ql-ink">{t(workflow.title)}</h3>
                    <p className="mkt-body mt-2">{t(workflow.description)}</p>
                  </div>
                </div>
                <ul className="mt-4 space-y-2">
                  {workflow.details.map((detail) => (
                    <li key={detail.en} className="flex items-start gap-2 text-[14px] leading-6 text-ql-ink-muted">
                      <CheckCircle2 size={15} className="mt-1 shrink-0 text-ql-brand" aria-hidden="true" />
                      <span>{t(detail)}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-5">
                  <WorkflowVisual workflow={workflow.id} />
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section
        id="product-screens"
        className="mkt-section border-t border-ql-border bg-ql-surface-muted/40"
        aria-labelledby="screens-title"
      >
        <div className="mkt-container">
          <SectionHeading
            eyebrow={t(marketingCopy.screens.eyebrow)}
            title={t(marketingCopy.screens.title)}
            intro={t(marketingCopy.screens.intro)}
            titleId="screens-title"
          />
          <div className="mt-10 grid gap-4 lg:grid-cols-2">
            <ProductScreenshot
              src="/marketing/screens/sales-lines.jpg"
              width={1100}
              height={520}
              alt={t(marketingCopy.screens.salesAlt)}
              caption={t(marketingCopy.screens.salesCaption)}
            />
            <div className="flex flex-col">
              <ReportFrame />
              <p className="mt-3 text-[13px] leading-6 text-ql-ink-muted">
                {t(marketingCopy.screens.reportsCaption)}
              </p>
            </div>
          </div>
        </div>
      </section>

      <section
        id="capabilities"
        className="mkt-section border-t border-ql-border"
        aria-labelledby="capabilities-title"
      >
        <div className="mkt-container">
          <SectionHeading
            eyebrow={t(marketingCopy.capabilities.eyebrow)}
            title={t(marketingCopy.capabilities.title)}
            intro={t(marketingCopy.capabilities.intro)}
            titleId="capabilities-title"
          />
          <div className="mkt-grid-3 mt-10">
            {marketingCopy.capabilities.items.map((capability) => (
              <article key={capability.title.en} className="mkt-card">
                <h3 className="text-[17px] font-semibold tracking-[-0.02em] text-ql-ink">
                  {t(capability.title)}
                </h3>
                <p className="mkt-body mt-2">{t(capability.description)}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section
        id="bangladesh"
        className="mkt-section border-t border-ql-border bg-ql-surface/50"
        aria-labelledby="bangladesh-title"
      >
        <div className="mkt-container grid gap-10 lg:grid-cols-[0.85fr_1.15fr] lg:gap-16">
          <div>
            <SectionHeading
              eyebrow={t(marketingCopy.bangladesh.eyebrow)}
              title={t(marketingCopy.bangladesh.title)}
              intro={t(marketingCopy.bangladesh.intro)}
              titleId="bangladesh-title"
            />
            <div className="ql-alert ql-alert-warning mt-6">
              <ShieldCheck size={18} className="mt-0.5 shrink-0 text-ql-warning" aria-hidden="true" />
              <p className="text-[14px] leading-6 text-ql-ink">{t(marketingCopy.bangladesh.disclaimer)}</p>
            </div>
          </div>
          <div className="mkt-rule-list">
            {marketingCopy.bangladesh.items.map((item) => (
              <div key={item.title.en} className="py-5 first:pt-0 last:pb-0">
                <h3 className="text-[16px] font-semibold text-ql-ink">{t(item.title)}</h3>
                <p className="mkt-body mt-1.5">{t(item.description)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="controls" className="mkt-section border-t border-ql-border" aria-labelledby="controls-title">
        <div className="mkt-container grid gap-10 lg:grid-cols-[0.85fr_1.15fr] lg:gap-16">
          <div>
            <SectionHeading
              eyebrow={t(marketingCopy.controls.eyebrow)}
              title={t(marketingCopy.controls.title)}
              intro={t(marketingCopy.controls.intro)}
              titleId="controls-title"
            />
            <a href="/security" className="ql-link mt-5 inline-flex text-[14px]">
              {t(marketingCopy.actions.readSecurity)}
              <ChevronRight size={15} className="ml-1" aria-hidden="true" />
            </a>
          </div>
          <div className="mkt-rule-list">
            {marketingCopy.controls.items.map((item) => (
              <div key={item.title.en} className="py-5 first:pt-0 last:pb-0">
                <h3 className="text-[16px] font-semibold text-ql-ink">{t(item.title)}</h3>
                <p className="mkt-body mt-1.5">{t(item.description)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="audience" className="mkt-section border-t border-ql-border bg-ql-surface-muted/30" aria-labelledby="audience-title">
        <div className="mkt-container">
          <SectionHeading
            eyebrow={t(marketingCopy.audience.eyebrow)}
            title={t(marketingCopy.audience.title)}
            intro={t(marketingCopy.audience.intro)}
            titleId="audience-title"
          />
          <div className="mkt-grid-4 mt-10">
            {marketingCopy.audience.items.map((item) => (
              <article key={item.title.en} className="mkt-card">
                <h3 className="text-[16px] font-semibold text-ql-ink">{t(item.title)}</h3>
                <p className="mkt-body mt-2">{t(item.description)}</p>
              </article>
            ))}
          </div>
          <p className="mkt-small mt-5">{t(marketingCopy.audience.later)}</p>
        </div>
      </section>

      <section
        id="onboarding"
        className="mkt-section border-t border-ql-border"
        aria-labelledby="onboarding-title"
      >
        <div className="mkt-container">
          <SectionHeading
            eyebrow={t(marketingCopy.onboarding.eyebrow)}
            title={t(marketingCopy.onboarding.title)}
            titleId="onboarding-title"
          />
          <ol className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {marketingCopy.onboarding.steps.map((step, index) => (
              <li key={step.title.en} className="mkt-card">
                <span className="mkt-number" aria-hidden="true">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <h3 className="mt-4 text-[16px] font-semibold text-ql-ink">{t(step.title)}</h3>
                <p className="mkt-body mt-2">{t(step.description)}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section id="contact" className="mkt-section border-t border-ql-border" aria-labelledby="contact-title">
        <div className="mkt-container grid gap-10 lg:grid-cols-[0.85fr_1.15fr] lg:gap-16">
          <div>
            <SectionHeading
              eyebrow={t(marketingCopy.contact.eyebrow)}
              title={t(marketingCopy.contact.title)}
              intro={t(marketingCopy.contact.description)}
              titleId="contact-title"
            />
            <p className="mkt-small mt-5 max-w-md">{t(marketingCopy.contact.note)}</p>
          </div>
          <div className="mkt-card">
            <DemoRequestForm />
          </div>
        </div>
      </section>

      <section id="faq" className="mkt-section border-t border-ql-border" aria-labelledby="faq-title">
        <div className="mkt-container grid gap-10 lg:grid-cols-[0.7fr_1.3fr] lg:gap-16">
          <SectionHeading
            eyebrow={t(marketingCopy.faq.eyebrow)}
            title={t(marketingCopy.faq.title)}
            titleId="faq-title"
          />
          <div className="mkt-faq">
            {marketingCopy.faq.items.map((item) => (
              <details key={item.question.en}>
                <summary>{t(item.question)}</summary>
                <div>
                  <p className="mkt-body">{t(item.answer)}</p>
                </div>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="mkt-section-tight border-t border-ql-border" aria-labelledby="final-cta-title">
        <div className="mkt-container">
          <div className="relative overflow-hidden rounded-ql ql-brand-gradient p-6 text-white shadow-ql-brand md:p-10">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -right-16 -top-24 h-72 w-72 rounded-full border border-white/15"
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -bottom-28 right-16 h-64 w-64 rounded-full border border-white/10"
            />
            <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
              <div className="max-w-2xl">
                <h2 id="final-cta-title" className="mkt-h2 text-white">
                  {t(marketingCopy.finalCta.title)}
                </h2>
                <p className="mt-3 max-w-xl text-[16px] leading-7 text-white/80">
                  {t(marketingCopy.finalCta.description)}
                </p>
              </div>
              <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
                <a href="#contact" className="ql-btn bg-white text-ql-brand hover:bg-ql-brand-soft">
                  {t(marketingCopy.actions.requestDemo)}
                </a>
                <a href="/login" className="ql-btn border border-white/30 bg-white/10 text-white hover:bg-white/20">
                  {t(marketingCopy.actions.signIn)}
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

function SectionHeading({
  eyebrow,
  title,
  intro,
  titleId,
}: {
  eyebrow: string;
  title: string;
  intro?: string;
  titleId: string;
}) {
  return (
    <div className="max-w-2xl">
      <p className="ql-eyebrow">{eyebrow}</p>
      <h2 id={titleId} className="mkt-h2 mt-3 text-ql-ink">
        {title}
      </h2>
      {intro ? <p className="mkt-lead mt-4">{intro}</p> : null}
    </div>
  );
}

function WorkflowVisual({ workflow }: { workflow: string }) {
  const { locale, t } = useMarketingUi();
  const currency = locale === 'bn-BD' ? '৳' : 'BDT';
  const money = (taka: number): string =>
    `${currency} ${formatPoisha(BigInt(taka) * 100n, { locale, grouping: 'LAKH_CRORE', showSymbol: false })}`;

  return (
    <div className="rounded-ql border border-ql-border bg-ql-surface-muted p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="font-ql-mono text-[12px] text-ql-ink-subtle">
          {t({ en: 'Illustrative interface', bn: 'উদাহরণ ইন্টারফেস' })}
        </span>
        <span className="ql-badge ql-badge-neutral">{t({ en: 'Sample data', bn: 'নমুনা ডেটা' })}</span>
      </div>
      {workflow === 'invoice-to-receipt' ? (
        <dl className="mt-3 space-y-1.5 text-[13px]">
          <Row label={t({ en: 'Invoice INV-2026-0042', bn: 'ইনভয়েস INV-2026-0042' })} value={money(115_000)} />
          <Row label={t({ en: 'Receipt allocated', bn: 'রসিদ বরাদ্দ' })} value={money(40_000)} />
          <Row label={t({ en: 'Outstanding', bn: 'বাকি' })} value={money(75_000)} strong />
        </dl>
      ) : workflow === 'bill-to-payment' ? (
        <dl className="mt-3 space-y-1.5 text-[13px]">
          <Row label={t({ en: 'Bill BILL-2026-0017', bn: 'বিল BILL-2026-0017' })} value={money(92_000)} />
          <Row label={t({ en: 'Withholding recorded', bn: 'উৎসে কর রেকর্ড' })} value={money(3_000)} />
          <Row label={t({ en: 'Net payment', bn: 'নিট পরিশোধ' })} value={money(89_000)} strong />
        </dl>
      ) : workflow === 'bank-to-book' ? (
        <dl className="mt-3 space-y-1.5 text-[13px]">
          <Row label={t({ en: 'Statement lines imported', bn: 'স্টেটমেন্ট লাইন আমদানি' })} value="42" />
          <Row label={t({ en: 'Matched', bn: 'মিলেছে' })} value="39" />
          <Row label={t({ en: 'Exceptions to review', bn: 'পর্যালোচনার ব্যতিক্রম' })} value="3" strong />
        </dl>
      ) : (
        <dl className="mt-3 space-y-1.5 text-[13px]">
          <Row label={t({ en: 'Trial balance', bn: 'রেওয়ামিল' })} value={t({ en: 'Balanced', bn: 'সুষম' })} />
          <Row label={t({ en: 'AR / AP control', bn: 'প্রাপ্য / প্রদেয় নিয়ন্ত্রণ' })} value={t({ en: 'Agrees', bn: 'মিলে' })} />
          <Row label={t({ en: 'Period', bn: 'সময়কাল' })} value={t({ en: 'Ready to close', bn: 'সমাপনীর জন্য প্রস্তুত' })} strong />
        </dl>
      )}
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-ql-border pb-1.5 last:border-0 last:pb-0">
      <dt className="text-ql-ink-muted">{label}</dt>
      <dd className={`mkt-money ${strong ? 'font-semibold text-ql-ink' : 'text-ql-ink'}`}>{value}</dd>
    </div>
  );
}

function ProductScreenshot({
  src,
  alt,
  caption,
  width,
  height,
}: {
  src: string;
  alt: string;
  caption: string;
  width: number;
  height: number;
}) {
  const { t } = useMarketingUi();
  return (
    <figure className="overflow-hidden rounded-ql border border-ql-border bg-ql-surface">
      <div className="relative bg-ql-surface-muted">
        <span className="absolute left-3 top-3 z-10 rounded-full bg-ql-surface/95 px-2.5 py-1 text-[12px] font-semibold text-ql-ink-muted shadow-sm">
          {t({ en: 'Synthetic test data', bn: 'কৃত্রিম পরীক্ষামূলক ডেটা' })}
        </span>
        <img
          src={src}
          alt={alt}
          width={width}
          height={height}
          loading="lazy"
          decoding="async"
          className="block w-full object-cover object-top"
          style={{ aspectRatio: '16 / 10' }}
        />
      </div>
      <figcaption className="border-t border-ql-border px-4 py-3 text-[13px] leading-6 text-ql-ink-muted">
        {caption}
      </figcaption>
    </figure>
  );
}
