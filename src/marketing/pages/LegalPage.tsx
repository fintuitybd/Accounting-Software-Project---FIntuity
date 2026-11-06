import { CircleAlert } from '../icons';
import { useMarketingUi } from '../MarketingApp';
import { l } from '../content';
import { usePageMeta } from '../usePageMeta';

export default function LegalPage() {
  const { t } = useMarketingUi();
  usePageMeta({
    title: 'Legal and privacy — Fintuity Accounting Suite',
    description:
      'Current legal and privacy notice for Fintuity Accounting Suite: software disclaimer, statutory-output limits, demo-data policy and demo-request handling. Formal terms are pending legal review.',
    path: '/legal',
  });

  return (
    <div className="mkt-container mkt-section">
      <div className="mkt-prose">
        <p className="ql-eyebrow">{t(l('Legal and privacy', 'আইন ও গোপনীয়তা'))}</p>
        <h1 className="mkt-h1 mt-4 text-ql-ink">
          {t(l('The current notice, stated plainly.', 'বর্তমান বিজ্ঞপ্তি, স্পষ্ট ভাষায়।'))}
        </h1>

        <div className="ql-alert ql-alert-warning mt-6">
          <CircleAlert size={18} className="mt-0.5 shrink-0 text-ql-warning" aria-hidden="true" />
          <p>
            {t(
              l(
                'Formal terms of service, a full privacy policy and company registration details are pending legal review and will be published before commercial launch. This page describes the current software limits and the data handled by the demo-request form. It is not a substitute for those documents.',
                'আনুষ্ঠানিক সেবা শর্ত, সম্পূর্ণ গোপনীয়তা নীতি ও কোম্পানির নিবন্ধন বিবরণ আইনি পর্যালোচনার অপেক্ষায় এবং বাণিজ্যিকভাবে চালু করার আগে প্রকাশ করা হবে। এই পৃষ্ঠায় বর্তমান সফটওয়্যার সীমা ও ডেমো-অনুরোধ ফর্মে ব্যবহৃত তথ্য বর্ণিত। এটি সেই নথির বিকল্প নয়।',
              ),
            )}
          </p>
        </div>

        <h2>{t(l('Software, not professional advice', 'সফটওয়্যার, পেশাদার পরামর্শ নয়'))}</h2>
        <p>
          {t(
            l(
              'Fintuity Accounting Suite is accounting and finance software. It is not an audit firm, law firm, tax practice or investment adviser. Nothing on this site or in the product is audit, legal, tax or investment advice. Your organisation remains responsible for its records, filings and decisions.',
              'ফিনটুইটি অ্যাকাউন্টিং স্যুট হিসাব ও অর্থ সফটওয়্যার। এটি অডিট ফার্ম, আইন প্রতিষ্ঠান, কর প্র্যাকটিস বা বিনিয়োগ উপদেষ্টা নয়। এই সাইট বা পণ্যের কিছুই অডিট, আইনি, কর বা বিনিয়োগ পরামর্শ নয়। আপনার প্রতিষ্ঠানই তার রেকর্ড, ফাইলিং ও সিদ্ধান্তের দায়িত্বে থাকে।',
            ),
          )}
        </p>

        <h2>{t(l('Statutory outputs are drafts until reviewed', 'পর্যালোচনার আগে সংবিধিবদ্ধ আউটপুট খসড়া'))}</h2>
        <p>
          {t(
            l(
              'VAT registers, draft VAT 9.1 schedules, withholding records, certificates and management statements are preparation tools. They must be reviewed against the current law and signed off by the responsible qualified professional. Fintuity Accounting Suite does not file a return, issue an audit opinion, certify a filing or promise that an authority will accept an output.',
              'ভ্যাট রেজিস্টার, খসড়া ভ্যাট ৯.১ সিডিউল, উৎসে কর রেকর্ড, সনদ ও ব্যবস্থাপনা বিবরণী প্রস্তুতির হাতিয়ার। বর্তমান আইনের সঙ্গে পর্যালোচনা করে দায়িত্বপ্রাপ্ত যোগ্য পেশাদারকে স্বাক্ষর করতে হবে। ফিনটুইটি অ্যাকাউন্টিং স্যুট রিটার্ন দাখিল করে না, অডিট মতামত দেয় না, ফাইলিং সার্টিফাই করে না, বা কর্তৃপক্ষ গ্রহণ করবে বলে প্রতিশ্রুতি দেয় না।',
            ),
          )}
        </p>

        <h2>{t(l('Demo data is synthetic and isolated', 'ডেমো ডেটা কৃত্রিম ও বিচ্ছিন্ন'))}</h2>
        <p>
          {t(
            l(
              'The optional demo environment uses synthetic browser data and is clearly labelled. It never shares the real identity service, sessions or company records. Do not enter real financial or personal data into demo mode.',
              'ঐচ্ছিক ডেমো পরিবেশ কৃত্রিম ব্রাউজার ডেটা ব্যবহার করে এবং স্পষ্টভাবে চিহ্নিত। এটি প্রকৃত পরিচয় সেবা, সেশন বা কোম্পানির রেকর্ড ভাগ করে না। ডেমো মোডে বাস্তব আর্থিক বা ব্যক্তিগত তথ্য দেবেন না।',
            ),
          )}
        </p>

        <h2>{t(l('Demo-request details', 'ডেমো-অনুরোধের তথ্য'))}</h2>
        <p>
          {t(
            l(
              'The walkthrough form collects your name, work email, company name and an optional message. The server stores these details in PostgreSQL and uses them only to respond to your request. Do not include financial records, passwords, session cookies or sensitive personal data in the message.',
              'ওয়াকথ্রু ফর্মে আপনার নাম, কর্মস্থলের ইমেইল, কোম্পানির নাম ও ঐচ্ছিক বার্তা নেওয়া হয়। সার্ভার এই তথ্য পোস্টগ্রেসকিউএলে সংরক্ষণ করে এবং শুধু আপনার অনুরোধের উত্তর দিতে ব্যবহার করে। বার্তায় আর্থিক রেকর্ড, পাসওয়ার্ড, সেশন কুকি বা সংবেদনশীল ব্যক্তিগত তথ্য দেবেন না।',
            ),
          )}
        </p>
        <p>
          {t(
            l(
              'The details are not sold and are not used for an automated marketing sequence. To request access or deletion, use the contact form and write “Data request” in the message. A formal retention schedule is pending legal review.',
              'তথ্য বিক্রি করা হয় না এবং স্বয়ংক্রিয় মার্কেটিং ধারাবাহিকে ব্যবহার করা হয় না। অ্যাক্সেস বা মুছে ফেলার অনুরোধ করতে যোগাযোগ ফর্মে “Data request” লিখুন। আনুষ্ঠানিক সংরক্ষণ সময়সূচি আইনি পর্যালোচনার অপেক্ষায়।',
            ),
          )}
        </p>

        <h2>{t(l('Company details', 'কোম্পানির বিবরণ'))}</h2>
        <p>
          {t(
            l(
              'The legal entity name, registered address, trade licence and direct contact details are not yet published. They will be added before commercial launch; this site deliberately does not invent them.',
              'আইনি প্রতিষ্ঠানের নাম, নিবন্ধিত ঠিকানা, ট্রেড লাইসেন্স ও সরাসরি যোগাযোগের বিবরণ এখনো প্রকাশ করা হয়নি। বাণিজ্যিকভাবে চালু করার আগে যোগ করা হবে; এই সাইট ইচ্ছাকৃতভাবে সেগুলো বানিয়ে বলে না।',
            ),
          )}
        </p>

        <div className="mt-8">
          <a href="/#contact" className="ql-btn ql-btn-primary">
            {t(l('Contact us', 'যোগাযোগ করুন'))}
          </a>
        </div>
      </div>
    </div>
  );
}
