import { DemoRequestForm } from '../components/DemoRequestForm';
import { useMarketingUi } from '../MarketingApp';
import { l } from '../content';
import { usePageMeta } from '../usePageMeta';

export default function ContactPage() {
  const { t } = useMarketingUi();
  usePageMeta({
    title: 'Request a walkthrough — Fintuity Accounting Suite',
    description:
      'Request a 30-minute Fintuity Accounting Suite walkthrough covering company setup, VAT workflow, migration and the controls your finance team needs.',
    path: '/contact',
  });

  return (
    <div className="mkt-container mkt-section">
      <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
        <div>
          <p className="ql-eyebrow">{t(l('Talk to us', 'আমাদের সঙ্গে কথা বলুন'))}</p>
          <h1 className="mkt-h1 mt-4 text-ql-ink">
            {t(l('A 30-minute walkthrough, not a sales deck.', '৩০ মিনিটের ওয়াকথ্রু, বিক্রয় উপস্থাপনা নয়।'))}
          </h1>
          <p className="mkt-lead mt-5">
            {t(
              l(
                'We will look at your company structure, VAT workflow, opening balances, migration and the controls your finance team needs. You will see the real screens and the limits of the current release.',
                'আপনার কোম্পানির কাঠামো, ভ্যাট কর্মপ্রবাহ, প্রারম্ভিক ব্যালেন্স, মাইগ্রেশন এবং ফাইন্যান্স টিমের প্রয়োজনীয় নিয়ন্ত্রণ দেখব। আসল স্ক্রিন ও বর্তমান সংস্করণের সীমা দেখানো হবে।',
              ),
            )}
          </p>
          <ul className="mt-6 space-y-3 text-[15px] leading-7 text-ql-ink-muted">
            <li>{t(l('Company setup and chart of accounts', 'কোম্পানি সেটআপ ও হিসাবের তালিকা'))}</li>
            <li>{t(l('Sales, purchases, banking and VAT preparation', 'বিক্রয়, ক্রয়, ব্যাংকিং ও ভ্যাট প্রস্তুতি'))}</li>
            <li>{t(l('Roles, approvals, period close and audit evidence', 'ভূমিকা, অনুমোদন, সময়কাল সমাপনী ও অডিট প্রমাণ'))}</li>
            <li>{t(l('Migration from spreadsheets or another system', 'স্প্রেডশিট বা অন্য সিস্টেম থেকে মাইগ্রেশন'))}</li>
          </ul>
          <p className="mkt-small mt-6">
            {t(
              l(
                'Already have an account? ',
                'আগে থেকেই অ্যাকাউন্ট আছে? ',
              ),
            )}
            <a href="/login" className="ql-link">
              {t(l('Sign in', 'সাইন ইন'))}
            </a>
            .
          </p>
        </div>
        <div className="mkt-card">
          <h2 className="text-[20px] font-semibold tracking-[-0.02em] text-ql-ink">
            {t(l('Request a walkthrough', 'ওয়াকথ্রু চান'))}
          </h2>
          <p className="mkt-small mt-2">
            {t(
              l(
                'We use these details only to respond to your request. Do not include financial records, passwords or sensitive personal data.',
                'আমরা এই তথ্য শুধু আপনার অনুরোধের উত্তর দিতে ব্যবহার করি। আর্থিক রেকর্ড, পাসওয়ার্ড বা সংবেদনশীল ব্যক্তিগত তথ্য দেবেন না।',
              ),
            )}
          </p>
          <div className="mt-5">
            <DemoRequestForm id="contact-demo-request" source="contact" />
          </div>
        </div>
      </div>
    </div>
  );
}
