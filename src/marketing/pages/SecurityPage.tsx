import { CheckCircle2, ShieldCheck } from '../icons';
import { useMarketingUi } from '../MarketingApp';
import { l } from '../content';
import { usePageMeta } from '../usePageMeta';

export default function SecurityPage() {
  const { t } = useMarketingUi();
  usePageMeta({
    title: 'Security — Fintuity Accounting Suite',
    description:
      'How Fintuity Accounting Suite enforces server-side access, company isolation, session security, period locks, immutable posting and audit evidence. No certification or audit claim is made.',
    path: '/security',
  });

  const enforced = [
    {
      title: l('Server-side identity', 'সার্ভার-ভিত্তিক পরিচয়'),
      body: l(
        'Passwords are hashed with Argon2id. Sessions are opaque server-side records delivered in HTTP-only, SameSite cookies. Production cookies are Secure. Password reset revokes existing sessions.',
        'পাসওয়ার্ড আর্গন২আইডি দিয়ে হ্যাশ করা হয়। সেশন সার্ভারে সংরক্ষিত অস্বচ্ছ রেকর্ড, যা এইচটিটিপি-অনলি, সেমসাইট কুকিতে দেওয়া হয়। প্রোডাকশনে কুকি সিকিউর। পাসওয়ার্ড রিসেটে চলমান সেশন বাতিল হয়।',
      ),
    },
    {
      title: l('CSRF and rate limiting', 'সিএসআরএফ ও রেট সীমা'),
      body: l(
        'Authenticated mutations require a CSRF token. Login, reset and invitation endpoints are rate-limited in PostgreSQL so the limit is shared across API instances. Authentication errors are deliberately generic.',
        'প্রমাণিত পরিবর্তনে সিএসআরএফ টোকেন লাগে। লগইন, রিসেট ও আমন্ত্রণে পোস্টগ্রেসকিউএল-ভিত্তিক রেট সীমা, যা সব এপিআই ইনস্ট্যান্সে ভাগ হয়। প্রমাণীকরণ ত্রুটি ইচ্ছাকৃতভাবে সাধারণ।',
      ),
    },
    {
      title: l('Company membership, checked server-side', 'কোম্পানি সদস্যপদ, সার্ভারে যাচাই'),
      body: l(
        "Every company-scoped request resolves the signed-in user's membership and permission from PostgreSQL. A request for another company's record returns not found rather than confirming that it exists.",
        'প্রতিটি কোম্পানি-সীমাবদ্ধ অনুরোধে সাইন-ইন ব্যবহারকারীর সদস্যপদ ও অনুমতি পোস্টগ্রেসকিউএল থেকে যাচাই হয়। অন্য কোম্পানির রেকর্ড চাইলে তা নেই বলে উত্তর আসে, অস্তিত্ব নিশ্চিত করা হয় না।',
      ),
    },
    {
      title: l('Period locks and immutable posting', 'সময়কাল লক ও অপরিবর্তনীয় পোস্টিং'),
      body: l(
        'Normal posting requires an OPEN period. CLOSED, LOCKED and unknown dates are rejected. Posted journals cannot be edited or deleted; corrections use a linked reversal with a reason and permission.',
        'সাধারণ পোস্টিংয়ের জন্য OPEN সময়কাল লাগে। CLOSED, LOCKED ও অজানা তারিখ প্রত্যাখ্যাত। পোস্টকৃত জার্নাল সম্পাদনা বা মোছা যায় না; সংশোধনে কারণ ও অনুমতিসহ সংযুক্ত বিপরীত এন্ট্রি লাগে।',
      ),
    },
    {
      title: l('Maker-checker approvals', 'নির্মাতা-পরীক্ষক অনুমোদন'),
      body: l(
        'Company-configured thresholds require a different authorised user to approve high-value invoices, bills, journals, payments and reversals. Self-approval is rejected by the server.',
        'কোম্পানির নির্ধারিত সীমার বেশি মূল্যের ইনভয়েস, বিল, জার্নাল, পরিশোধ ও বিপরীত এন্ট্রিতে ভিন্ন অনুমোদিত ব্যবহারকারী লাগে। নিজের অনুমোদন সার্ভার প্রত্যাখ্যান করে।',
      ),
    },
    {
      title: l('Append-only audit evidence', 'কেবল-সংযোজনযোগ্য অডিট প্রমাণ'),
      body: l(
        'Material actions write an audit event with actor, session, request id and before/after values. Database triggers reject updates and deletes on audit and close evidence. Authorised users can query and export CSV.',
        'গুরুত্বপূর্ণ কাজে ব্যবহারকারী, সেশন, অনুরোধ আইডি ও আগের/পরের মানসহ অডিট ইভেন্ট লেখা হয়। ডেটাবেস ট্রিগার অডিট ও সমাপনী প্রমাণের সম্পাদনা/মুছে ফেলা প্রত্যাখ্যান করে। অনুমোদিত ব্যবহারকারী অনুসন্ধান ও সিএসভি এক্সপোর্ট করতে পারেন।',
      ),
    },
  ];

  const notClaimed = [
    l(
      'No independent audit, ISO certification, PCI certification or “bank-grade” security claim.',
      'স্বাধীন অডিট, আইএসও সার্টিফিকেশন, পিসিআই সার্টিফিকেশন বা “ব্যাংক-মানের” নিরাপত্তার দাবি নেই।',
    ),
    l(
      'No guarantee that a VAT return, certificate or statutory form is accepted by an authority.',
      'কোনো ভ্যাট রিটার্ন, সনদ বা সংবিধিবদ্ধ ফরম কর্তৃপক্ষ গ্রহণ করবে—এমন নিশ্চয়তা নেই।',
    ),
    l(
      'No self-service backup/restore screen. Database backup, point-in-time recovery and retention are hosting/operations responsibilities until a product feature exists.',
      'স্ব-পরিষেবা ব্যাকআপ/রিস্টোর স্ক্রিন নেই। পণ্য বৈশিষ্ট্য না আসা পর্যন্ত ডেটাবেস ব্যাকআপ, পয়েন্ট-ইন-টাইম রিকভারি ও সংরক্ষণ হোস্টিং/অপারেশনের দায়িত্ব।',
    ),
    l(
      'No claim that the current release is production-ready for every company. Payroll, fixed assets, statutory filing integrations and group consolidation are not in scope.',
      'বর্তমান সংস্করণ প্রতিটি কোম্পানির জন্য প্রোডাকশন-প্রস্তুত—এমন দাবি নেই। পে-রোল, স্থায়ী সম্পদ, সংবিধিবদ্ধ ফাইলিং ইন্টিগ্রেশন ও গ্রুপ কনসোলিডেশন পরিধিতে নেই।',
    ),
  ];

  return (
    <div className="mkt-container mkt-section">
      <p className="ql-eyebrow">{t(l('Security and controls', 'নিরাপত্তা ও নিয়ন্ত্রণ'))}</p>
      <h1 className="mkt-h1 mt-4 max-w-3xl text-ql-ink">
        {t(l('Specific controls, not vague badges.', 'নির্দিষ্ট নিয়ন্ত্রণ, অস্পষ্ট ব্যাজ নয়।'))}
      </h1>
      <p className="mkt-lead mt-5 max-w-2xl">
        {t(
          l(
            'This page describes what the server actually enforces today. It is deliberately narrower than a certification page because no independent audit or certification has been commissioned.',
            'এই পৃষ্ঠায় সার্ভার আজ প্রকৃতপক্ষে কী প্রয়োগ করে তা বলা হয়েছে। এটি ইচ্ছাকৃতভাবে সার্টিফিকেশন পৃষ্ঠার চেয়ে সংকীর্ণ, কারণ কোনো স্বাধীন অডিট বা সার্টিফিকেশন করানো হয়নি।',
          ),
        )}
      </p>

      <div className="mt-10 grid gap-4 md:grid-cols-2">
        {enforced.map((item) => (
          <article key={item.title.en} className="mkt-card">
            <h2 className="flex items-start gap-2 text-[17px] font-semibold text-ql-ink">
              <ShieldCheck size={18} className="mt-0.5 shrink-0 text-ql-brand" aria-hidden="true" />
              {t(item.title)}
            </h2>
            <p className="mkt-body mt-2">{t(item.body)}</p>
          </article>
        ))}
      </div>

      <section className="mt-12" aria-labelledby="not-claimed">
        <h2 id="not-claimed" className="mkt-h2 text-ql-ink">
          {t(l('What we do not claim', 'যা আমরা দাবি করি না'))}
        </h2>
        <ul className="mt-5 space-y-3">
          {notClaimed.map((item) => (
            <li key={item.en} className="flex items-start gap-2 text-[15px] leading-7 text-ql-ink-muted">
              <CheckCircle2 size={16} className="mt-1.5 shrink-0 text-ql-accent" aria-hidden="true" />
              <span>{t(item)}</span>
            </li>
          ))}
        </ul>
      </section>

      <div className="ql-alert ql-alert-info mt-10 max-w-3xl">
        <ShieldCheck size={18} className="mt-0.5 shrink-0 text-ql-info" aria-hidden="true" />
        <p className="text-[14px] leading-6 text-ql-ink">
          {t(
            l(
              'To report a suspected security issue, use the contact form and include only the minimum information needed. Do not send passwords, session cookies or customer financial records.',
              'নিরাপত্তা সমস্যা সন্দেহ হলে যোগাযোগ ফর্ম ব্যবহার করুন এবং শুধু প্রয়োজনীয় তথ্য দিন। পাসওয়ার্ড, সেশন কুকি বা গ্রাহকের আর্থিক রেকর্ড পাঠাবেন না।',
            ),
          )}{' '}
          <a href="/#contact" className="ql-link">
            {t(l('Contact us', 'যোগাযোগ করুন'))}
          </a>
          .
        </p>
      </div>
    </div>
  );
}
