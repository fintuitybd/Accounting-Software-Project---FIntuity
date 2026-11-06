import { useState, type ReactNode } from 'react';
import { CheckCircle2, CircleAlert, Info, LockKeyhole, Search, TriangleAlert } from '../icons';
import { Dialog } from '../../components/ui/Dialog';
import { formatPoisha } from '../../core/money';
import { useMarketingUi } from '../MarketingApp';
import { l } from '../content';
import { usePageMeta } from '../usePageMeta';

const colours = [
  { name: 'ql-paper', className: 'bg-ql-paper', note: 'Page canvas / warm paper' },
  { name: 'ql-surface', className: 'bg-ql-surface', note: 'Working surface' },
  { name: 'ql-surface-muted', className: 'bg-ql-surface-muted', note: 'Muted surface / table head' },
  { name: 'ql-ink', className: 'bg-ql-ink', note: 'Primary text' },
  { name: 'ql-ink-muted', className: 'bg-ql-ink-muted', note: 'Secondary text' },
  { name: 'ql-brand', className: 'bg-ql-brand', note: 'Primary action / brand' },
  { name: 'ql-brand-soft', className: 'bg-ql-brand-soft', note: 'Brand tint' },
  { name: 'ql-accent', className: 'bg-ql-accent', note: 'Attention / due dates' },
  { name: 'ql-success', className: 'bg-ql-success', note: 'Posted / balanced' },
  { name: 'ql-warning', className: 'bg-ql-warning', note: 'Pending / attention' },
  { name: 'ql-danger', className: 'bg-ql-danger', note: 'Error / overdue' },
  { name: 'ql-info', className: 'bg-ql-info', note: 'Informational' },
  { name: 'ql-border', className: 'bg-ql-border', note: 'Hairline border' },
  { name: 'ql-focus', className: 'bg-ql-focus', note: 'Keyboard focus ring' },
];

export default function DesignSystemPage() {
  const { t } = useMarketingUi();
  const [dialogOpen, setDialogOpen] = useState(false);
  const money = (taka: number): string =>
    `BDT ${formatPoisha(BigInt(taka) * 100n, {
      locale: 'en-BD',
      grouping: 'LAKH_CRORE',
      showSymbol: false,
    })}`;

  usePageMeta({
    title: 'Design system — Fintuity Accounting Suite internal',
    description: 'Internal Quiet Ledger component and token gallery. Not indexed.',
    path: '/design',
    robots: 'noindex,nofollow',
  });

  return (
    <div className="mkt-container mkt-section">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <p className="ql-eyebrow">{t(l('Internal design system', 'অভ্যন্তরীণ ডিজাইন সিস্টেম'))}</p>
          <h1 className="mkt-h1 mt-4 text-ql-ink">Quiet Ledger</h1>
          <p className="mkt-lead mt-4">
            {t(
              l(
                'Tokens and components for the public site, authentication and the Phase 14 workspace migration. This page is excluded from search.',
                'পাবলিক সাইট, প্রমাণীকরণ ও ফেজ ১৪ ওয়ার্কস্পেস মাইগ্রেশনের টোকেন ও কম্পোনেন্ট। এই পৃষ্ঠা সার্চ থেকে বাদ।',
              ),
            )}
          </p>
        </div>
        <span className="ql-badge ql-badge-warning">noindex</span>
      </div>

      <Section title={t(l('Colour tokens', 'রঙের টোকেন'))} description={t(l('Semantic names, never raw hex in components.', 'কম্পোনেন্টে কাঁচা হেক্স নয়, অর্থবহ নাম।'))}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {colours.map((colour) => (
            <div key={colour.name} className="flex items-center gap-3 rounded-ql border border-ql-border bg-ql-surface p-3">
              <span className={`h-9 w-9 shrink-0 rounded-ql-control border border-ql-border ${colour.className}`} aria-hidden="true" />
              <span>
                <code className="block font-ql-mono text-[12px] text-ql-ink">{colour.name}</code>
                <span className="block text-[13px] text-ql-ink-muted">{colour.note}</span>
              </span>
            </div>
          ))}
        </div>
      </Section>

      <Section title={t(l('Typography', 'টাইপোগ্রাফি'))} description={t(l('Inter and Noto Sans Bengali are self-hosted. Working text never drops below 12px.', 'ইন্টার ও নোটো সান্স বাংলা স্ব-হোস্টেড। কার্যকরী লেখা ১২ পিক্সেলের নিচে নয়।'))}>
        <div className="space-y-5 rounded-ql border border-ql-border bg-ql-surface p-5">
          <div>
            <p className="text-[37px] font-semibold leading-[1.05] tracking-[-0.04em] text-ql-ink">
              Close with evidence.
            </p>
            <code className="mt-1 block font-ql-mono text-[12px] text-ql-ink-subtle">mkt-h1 / 37–70px semibold</code>
          </div>
          <div>
            <p className="text-[25px] font-semibold leading-tight tracking-[-0.03em] text-ql-ink">Section title</p>
            <code className="mt-1 block font-ql-mono text-[12px] text-ql-ink-subtle">mkt-h2 / 28–42px semibold</code>
          </div>
          <div>
            <p className="text-[15px] leading-7 text-ql-ink-muted">
              Body copy uses 15px with a 1.7 line height. Bangla increases the line height for
              conjuncts and never uses uppercase transforms.
            </p>
            <code className="mt-1 block font-ql-mono text-[12px] text-ql-ink-subtle">mkt-body / 15px</code>
          </div>
          <div>
            <p className="text-[13px] font-semibold text-ql-ink">Field label</p>
            <p className="text-[13px] text-ql-ink-muted">Supporting hint and metadata</p>
            <code className="mt-1 block font-ql-mono text-[12px] text-ql-ink-subtle">ql-label / 13px</code>
          </div>
          <div>
            <p className="ql-money text-[22px] font-semibold text-ql-ink">{money(1_155_000)}</p>
            <code className="mt-1 block font-ql-mono text-[12px] text-ql-ink-subtle">money / tabular lining numerals</code>
          </div>
        </div>
      </Section>

      <Section title={t(l('Buttons', 'বোতাম'))} description={t(l('One primary action per area. Disabled controls state why in surrounding copy or a field hint.', 'প্রতি এলাকায় একটি প্রাথমিক কাজ। নিষ্ক্রিয় নিয়ন্ত্রণের কারণ আশপাশের লেখায় বা ফিল্ড ইঙ্গিতে থাকে।'))}>
        <div className="flex flex-wrap items-center gap-3 rounded-ql border border-ql-border bg-ql-surface p-5">
          <button type="button" className="ql-btn ql-btn-primary">
            Post invoice
          </button>
          <button type="button" className="ql-btn ql-btn-secondary">
            Save draft
          </button>
          <button type="button" className="ql-btn ql-btn-ghost">
            Cancel
          </button>
          <button type="button" className="ql-btn ql-btn-accent">
            Review exception
          </button>
          <button type="button" className="ql-btn ql-btn-danger">
            Reverse journal
          </button>
          <button type="button" className="ql-btn ql-btn-secondary" disabled>
            Post (period locked)
          </button>
        </div>
      </Section>

      <Section title={t(l('Form controls', 'ফর্ম নিয়ন্ত্রণ'))} description={t(l('Labels above fields, visible focus, inline error with a suggestion.', 'ফিল্ডের উপরে লেবেল, দৃশ্যমান ফোকাস, পরামর্শসহ ইনলাইন ত্রুটি।'))}>
        <div className="grid gap-5 rounded-ql border border-ql-border bg-ql-surface p-5 md:grid-cols-2">
          <div>
            <label className="ql-label" htmlFor="design-customer">
              Customer <span className="text-ql-danger">*</span>
            </label>
            <input id="design-customer" className="ql-input" defaultValue="Meghna Traders" />
            <span className="ql-hint">Search by name, code, BIN or TIN.</span>
          </div>
          <div>
            <label className="ql-label" htmlFor="design-period">
              Period
            </label>
            <select id="design-period" className="ql-select" defaultValue="2026-11">
              <option value="2026-11">November 2026 (open)</option>
              <option value="2026-10">October 2026 (closed)</option>
            </select>
            <span className="ql-hint">Posting is rejected outside an open period.</span>
          </div>
          <div>
            <label className="ql-label" htmlFor="design-amount">
              Amount (BDT)
            </label>
            <input id="design-amount" className="ql-input" inputMode="decimal" defaultValue="1,15,000.00" />
            <span className="ql-hint">Integer poisha is authoritative; paste normalisation is allowed.</span>
          </div>
          <div>
            <label className="ql-label" htmlFor="design-error">
              Counterparty BIN
            </label>
            <input
              id="design-error"
              className="ql-input"
              defaultValue="123"
              aria-invalid="true"
              aria-describedby="design-error-message"
            />
            <span className="ql-field-error" id="design-error-message">
              <CircleAlert size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
              Enter a 13-digit BIN, or record that the party is not registered.
            </span>
          </div>
          <div className="md:col-span-2">
            <label className="ql-label" htmlFor="design-note">
              Narration
            </label>
            <textarea id="design-note" className="ql-textarea" rows={3} defaultValue="Goods delivered against invoice INV-2026-0042." />
          </div>
          <div className="flex items-center gap-2">
            <input id="design-check" type="checkbox" className="h-4 w-4 rounded border-ql-border-strong text-ql-brand focus:ring-ql-focus" />
            <label htmlFor="design-check" className="text-[14px] text-ql-ink">
              Include a linked reversal
            </label>
          </div>
        </div>
      </Section>

      <Section title={t(l('Badges and alerts', 'ব্যাজ ও সতর্কতা'))} description={t(l('Status always carries text, never colour alone.', 'স্ট্যাটাসে সবসময় লেখা থাকে, শুধু রং নয়।'))}>
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2 rounded-ql border border-ql-border bg-ql-surface p-4">
            <span className="ql-badge ql-badge-neutral">Draft</span>
            <span className="ql-badge ql-badge-brand">In review</span>
            <span className="ql-badge ql-badge-success">Posted</span>
            <span className="ql-badge ql-badge-warning">Due in 3 days</span>
            <span className="ql-badge ql-badge-danger">Overdue</span>
            <span className="ql-badge ql-badge-info">Informational</span>
          </div>
          <div className="ql-alert ql-alert-info">
            <Info size={18} className="mt-0.5 shrink-0 text-ql-info" aria-hidden="true" />
            <p>A draft saved now will survive a refresh and remain visible to authorised users.</p>
          </div>
          <div className="ql-alert ql-alert-success">
            <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-ql-success" aria-hidden="true" />
            <p>The invoice posted and the journal balances to zero poisha.</p>
          </div>
          <div className="ql-alert ql-alert-warning">
            <TriangleAlert size={18} className="mt-0.5 shrink-0 text-ql-warning" aria-hidden="true" />
            <p>One bank statement line is unmatched. Resolve it before closing the period.</p>
          </div>
          <div className="ql-alert ql-alert-danger">
            <CircleAlert size={18} className="mt-0.5 shrink-0 text-ql-danger" aria-hidden="true" />
            <p>Posting failed because the period is LOCKED. Nothing was saved.</p>
          </div>
        </div>
      </Section>

      <Section title={t(l('Table and money', 'টেবিল ও অর্থ'))} description={t(l('Proper headers, right-aligned tabular money, and a balanced journal.', 'সঠিক হেডার, ডানে সংরক্ষিত ট্যাবুলার অর্থ ও সুষম জার্নাল।'))}>
        <div className="overflow-x-auto rounded-ql border border-ql-border bg-ql-surface">
          <table className="ql-table">
            <caption>Journal JE-2026-11-0001 · sample data</caption>
            <thead>
              <tr>
                <th scope="col">Account</th>
                <th scope="col">Description</th>
                <th scope="col" className="text-right">Debit</th>
                <th scope="col" className="text-right">Credit</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="font-ql-mono text-[13px]">1130</td>
                <td>Accounts receivable — Meghna Traders</td>
                <td className="ql-money">{money(115_000)}</td>
                <td className="ql-money">—</td>
              </tr>
              <tr>
                <td className="font-ql-mono text-[13px]">4100</td>
                <td>Sales revenue</td>
                <td className="ql-money">—</td>
                <td className="ql-money">{money(100_000)}</td>
              </tr>
              <tr>
                <td className="font-ql-mono text-[13px]">2210</td>
                <td>VAT payable</td>
                <td className="ql-money">—</td>
                <td className="ql-money">{money(15_000)}</td>
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" colSpan={2} className="border-t border-ql-border px-4 py-3 text-left text-[13px] text-ql-ink">
                  Total
                </th>
                <td className="border-t border-ql-border px-4 py-3 text-right font-semibold">{money(115_000)}</td>
                <td className="border-t border-ql-border px-4 py-3 text-right font-semibold">{money(115_000)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Section>

      <Section title={t(l('Loading, empty, error and permission states', 'লোডিং, খালি, ত্রুটি ও অনুমতি অবস্থা'))} description={t(l('Every table and panel needs all four states.', 'প্রতিটি টেবিল ও প্যানেলে চারটি অবস্থাই দরকার।'))}>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-ql border border-ql-border bg-ql-surface p-5">
            <p className="text-[13px] font-semibold text-ql-ink">Loading</p>
            <div className="mt-3 space-y-2" aria-label="Loading example" role="status">
              <div className="ql-skeleton h-4 w-2/3" />
              <div className="ql-skeleton h-4 w-full" />
              <div className="ql-skeleton h-4 w-5/6" />
            </div>
            <p className="mt-3 flex items-center gap-2 text-[13px] text-ql-ink-muted">
              <span className="ql-spinner" aria-hidden="true" /> Loading the trial balance…
            </p>
          </div>
          <div className="rounded-ql border border-ql-border bg-ql-surface p-5">
            <p className="text-[13px] font-semibold text-ql-ink">Empty</p>
            <div className="mt-6 text-center">
              <Search size={22} className="mx-auto text-ql-ink-subtle" aria-hidden="true" />
              <p className="mt-2 text-[14px] font-medium text-ql-ink">No invoices yet</p>
              <p className="mt-1 text-[13px] text-ql-ink-muted">Create your first invoice or import a batch.</p>
            </div>
          </div>
          <div className="rounded-ql border border-ql-border bg-ql-surface p-5">
            <p className="text-[13px] font-semibold text-ql-ink">Error</p>
            <div className="ql-alert ql-alert-danger mt-3">
              <CircleAlert size={18} className="mt-0.5 shrink-0 text-ql-danger" aria-hidden="true" />
              <div>
                <p>The report could not be loaded. Nothing was changed.</p>
                <button type="button" className="ql-btn ql-btn-secondary ql-btn-sm mt-2">
                  Try again
                </button>
              </div>
            </div>
          </div>
          <div className="rounded-ql border border-ql-border bg-ql-surface p-5">
            <p className="text-[13px] font-semibold text-ql-ink">Permission denied</p>
            <div className="mt-4 flex items-start gap-3">
              <LockKeyhole size={20} className="mt-0.5 shrink-0 text-ql-ink-subtle" aria-hidden="true" />
              <div>
                <p className="text-[14px] font-medium text-ql-ink">You do not have permission to post journals.</p>
                <p className="mt-1 text-[13px] text-ql-ink-muted">Ask a controller or owner to review the entry.</p>
              </div>
            </div>
          </div>
        </div>
      </Section>

      <Section title={t(l('Dialog', 'ডায়ালগ'))} description={t(l('Focus trap, Escape to close, restored focus and a consequence stated in plain language.', 'ফোকাস ট্র্যাপ, এস্কেপে বন্ধ, ফোকাস পুনরুদ্ধার এবং সহজ ভাষায় পরিণতি।'))}>
        <div className="rounded-ql border border-ql-border bg-ql-surface p-5">
          <button type="button" className="ql-btn ql-btn-danger" onClick={() => setDialogOpen(true)}>
            Reverse journal (example)
          </button>
          <p className="ql-hint mt-2">
            Reversing a posted journal creates a linked correcting entry. The original remains in history.
          </p>
        </div>
        <Dialog
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          title="Reverse journal JE-2026-11-0001?"
          description="This creates a new linked journal with equal and opposite lines. The original posted journal is not edited or deleted."
          footer={
            <>
              <button type="button" className="ql-btn ql-btn-secondary" onClick={() => setDialogOpen(false)}>
                Keep journal
              </button>
              <button type="button" className="ql-btn ql-btn-danger" onClick={() => setDialogOpen(false)}>
                Reverse journal
              </button>
            </>
          }
        >
          <label className="ql-label" htmlFor="design-reversal-reason">
            Reason <span className="text-ql-danger">*</span>
          </label>
          <textarea id="design-reversal-reason" className="ql-textarea" rows={3} placeholder="Explain why the correction is needed." />
          <p className="ql-hint">The reason is stored in the audit log with your user and session.</p>
        </Dialog>
      </Section>

      <div className="ql-alert ql-alert-info mt-8">
        <Info size={18} className="mt-0.5 shrink-0 text-ql-info" aria-hidden="true" />
        <p className="text-[14px] leading-6 text-ql-ink">
          {t(
            l(
              'Rules: 2px visible focus, 44px minimum touch target, no text below 12px, no colour-only status, reduced-motion respected, and no decorative gradients, grain or glass on financial surfaces.',
              'নিয়ম: ২ পিক্সেল দৃশ্যমান ফোকাস, ন্যূনতম ৪৪ পিক্সেল স্পর্শ লক্ষ্য, ১২ পিক্সেলের নিচে লেখা নয়, শুধু রঙে স্ট্যাটাস নয়, কম-মোশন সম্মান, এবং আর্থিক পৃষ্ঠায় আলংকারিক গ্রেডিয়েন্ট/গ্রেইন/গ্লাস নয়।',
            ),
          )}
        </p>
      </div>
    </div>
  );
}

function Section({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <section className="mt-10 border-t border-ql-border pt-8">
      <h2 className="text-[20px] font-semibold tracking-[-0.02em] text-ql-ink">{title}</h2>
      <p className="mt-1.5 max-w-2xl text-[14px] leading-6 text-ql-ink-muted">{description}</p>
      <div className="mt-4">{children}</div>
    </section>
  );
}
