export type MarketingLocale = 'en-BD' | 'bn-BD';

export interface LocalizedText {
  en: string;
  bn: string;
}

export interface WorkflowCopy {
  id: string;
  title: LocalizedText;
  description: LocalizedText;
  details: LocalizedText[];
}

export interface CapabilityCopy {
  title: LocalizedText;
  description: LocalizedText;
}

export interface FaqCopy {
  question: LocalizedText;
  answer: LocalizedText;
}

export const l = (en: string, bn: string): LocalizedText => ({ en, bn });

export function text(value: LocalizedText, locale: MarketingLocale): string {
  return locale === 'bn-BD' ? value.bn : value.en;
}

export const marketingCopy = {
  nav: {
    product: l('Product', 'পণ্য'),
    workflows: l('How it works', 'কীভাবে কাজ করে'),
    capabilities: l("What's included", 'যা অন্তর্ভুক্ত'),
    security: l('Controls', 'নিয়ন্ত্রণ'),
    faq: l('Questions', 'প্রশ্ন'),
  },
  actions: {
    signIn: l('Sign in', 'সাইন ইন'),
    requestDemo: l('Book a 30-minute walkthrough', '৩০ মিনিটের ওয়াকথ্রু বুক করুন'),
    seeHow: l('See how it works', 'কীভাবে কাজ করে দেখুন'),
    readSecurity: l('Read the security details', 'নিরাপত্তার বিস্তারিত দেখুন'),
    backHome: l('Back to the home page', 'হোম পেজে ফিরে যান'),
    contact: l('Contact', 'যোগাযোগ'),
    legal: l('Legal and privacy', 'আইন ও গোপনীয়তা'),
    switchLanguage: l('Bangla', 'English'),
    switchLanguageLabel: l('Switch to Bangla', 'Switch to English'),
    openMenu: l('Open menu', 'মেনু খুলুন'),
    closeMenu: l('Close menu', 'মেনু বন্ধ করুন'),
  },
  hero: {
    eyebrow: l('Accounting software for Bangladesh', 'বাংলাদেশের জন্য হিসাব সফটওয়্যার'),
    title: l(
      'Close the month without rebuilding it.',
      'মাস শেষ করুন, আবার সব নতুন করে বানানো ছাড়াই।',
    ),
    subtitle: l(
      'Fintuity keeps sales, purchases, VAT, banking and reports in one server-backed system. The invoice, the receipt and the report finally tell the same story.',
      'ফিনটুইটি বিক্রয়, ক্রয়, ভ্যাট, ব্যাংকিং ও প্রতিবেদন এক সার্ভার-ভিত্তিক সিস্টেমে রাখে। ইনভয়েস, রসিদ ও প্রতিবেদন শেষ পর্যন্ত একই কথা বলে।',
    ),
    note: l(
      'Start with one company. Sales, purchases, banking, VAT preparation, reporting and controlled close are ready. Payroll and statutory filing are not.',
      'এক কোম্পানি দিয়ে শুরু করুন। বিক্রয়, ক্রয়, ব্যাংকিং, ভ্যাট প্রস্তুতি, প্রতিবেদন ও নিয়ন্ত্রিত সমাপনী প্রস্তুত। পে-রোল ও সংবিধিবদ্ধ ফাইলিং এখনো নেই।',
    ),
  },
  trust: [
    l('Built for BDT, lakh and crore', 'বিডিটি, লাখ ও কোটি জন্য তৈরি'),
    l('Bangla and English, properly', 'বাংলা ও ইংরেজি, যথাযথভাবে'),
    l('Server-checked permissions', 'সার্ভারে যাচাইকৃত অনুমতি'),
    l('Corrections leave a trail', 'সংশোধনে থাকে অডিট ট্রেইল'),
  ],
  problem: {
    eyebrow: l('The problem', 'সমস্যাটি'),
    title: l(
      'When the books live in five places, month-end becomes a rebuild.',
      'যখন হিসাব পাঁচ জায়গায় থাকে, মাস শেষে সব আবার নতুন করে বানাতে হয়।',
    ),
    intro: l(
      'Most finance teams do not need another dashboard. They need the invoice, the receipt, the VAT register and the report to agree — without someone re-keying the difference at 11pm.',
      'অধিকাংশ ফাইন্যান্স টিমের আরেকটি ড্যাশবোর্ড দরকার নেই। তাদের দরকার—ইনভয়েস, রসিদ, ভ্যাট রেজিস্টার ও প্রতিবেদন যেন মিলে যায়, রাত ১১টায় কেউ আবার পার্থক্য টাইপ না করে।',
    ),
    items: [
      {
        title: l('Spreadsheets and disconnected tools', 'স্প্রেডশিট ও বিচ্ছিন্ন টুল'),
        description: l(
          'Invoices sit in one file, VAT in another and stock in a third. Someone re-keys the difference at month-end.',
          'ইনভয়েস এক ফাইলে, ভ্যাট আরেকটিতে, স্টক তৃতীয়টিতে। মাস শেষে কেউ আবার পার্থক্যটা টাইপ করে।',
        ),
      },
      {
        title: l('Tax returns assembled twice', 'দুইবার তৈরি করা ট্যাক্স রিটার্ন'),
        description: l(
          'The return is rebuilt from exports instead of being derived from the transactions that were already posted.',
          'আগে পোস্ট করা লেনদেন থেকে রিটার্ন তৈরি না করে এক্সপোর্ট থেকে আবার বানানো হয়।',
        ),
      },
      {
        title: l('Receipts that do not settle invoices', 'রসিদে ইনভয়েস নিষ্পত্তি হয় না'),
        description: l(
          'The bank balance moves, but the receivable stays open. Ageing and the ledger drift apart.',
          'ব্যাংক ব্যালেন্স বদলায়, কিন্তু প্রাপ্য খোলা থেকে যায়। বয়স বিশ্লেষণ ও লেজার আলাদা হয়ে যায়।',
        ),
      },
      {
        title: l('Corrections with no evidence', 'প্রমাণহীন সংশোধন'),
        description: l(
          'A figure is overwritten and the reason disappears. Nobody can prove who changed what.',
          'একটি সংখ্যা মুছে নতুনটি লেখা হয়, কারণ হারিয়ে যায়। কে কী বদলেছে তা আর প্রমাণ করা যায় না।',
        ),
      },
    ],
  },
  workflows: {
    eyebrow: l('How it works', 'কীভাবে কাজ করে'),
    title: l(
      'From document to report, without the re-keying.',
      'ডকুমেন্ট থেকে প্রতিবেদন—আবার টাইপ না করেই।',
    ),
    intro: l(
      'Every step below runs on the server. Drafts survive a refresh, posting is atomic, and a correction is a linked reversal with a reason — not a silent edit.',
      'নিচের প্রতিটি ধাপ সার্ভারে চলে। খসড়া রিফ্রেশেও থাকে, পোস্টিং পারমাণবিক, আর সংশোধন মানে কারণসহ সংযুক্ত বিপরীত এন্ট্রি—নীরব সম্পাদনা নয়।',
    ),
    items: [
      {
        id: 'invoice-to-receipt',
        title: l('Sell, collect, and see what is still owed', 'বিক্রি করুন, আদায় করুন, বাকি দেখুন'),
        description: l(
          'Raise a sales invoice with line-level tax, review the journal, post it, then allocate a customer receipt. The invoice stays open until the money is applied.',
          'লাইনভিত্তিক করসহ বিক্রয় ইনভয়েস তৈরি করুন, জার্নাল দেখুন, পোস্ট করুন, তারপর গ্রাহকের রসিদ বরাদ্দ করুন। টাকা প্রয়োগ না হওয়া পর্যন্ত ইনভয়েস খোলা থাকে।',
        ),
        details: [
          l('Draft, review and post with a tax and journal preview', 'কর ও জার্নাল প্রিভিউসহ খসড়া, পর্যালোচনা ও পোস্ট'),
          l('Partial and multiple receipts with allocation', 'আংশিক ও একাধিক রসিদ বরাদ্দ'),
          l('Credit notes linked to the original invoice', 'মূল ইনভয়েসের সঙ্গে সংযুক্ত ক্রেডিট নোট'),
          l('AR ageing and control-account proof', 'প্রাপ্য বয়স বিশ্লেষণ ও নিয়ন্ত্রণ হিসাবের প্রমাণ'),
        ],
      },
      {
        id: 'bill-to-payment',
        title: l('Buy, pay, and keep withholding straight', 'কিনুন, পরিশোধ করুন, উৎসে কর ঠিক রাখুন'),
        description: l(
          'Record a supplier bill or expense, keep input VAT and withholding facts, then pay partially or fully. Payables and the withholding queue update in the same transaction.',
          'সরবরাহকারীর বিল বা খরচ লিখুন, ইনপুট ভ্যাট ও উৎসে করের তথ্য রাখুন, তারপর আংশিক বা সম্পূর্ণ পরিশোধ করুন। একই লেনদেনে প্রদেয় ও উৎসে করের তালিকা হালনাগাদ হয়।',
        ),
        details: [
          l('Inventory or expense classification per line', 'প্রতি লাইনে ইনভেন্টরি বা খরচের শ্রেণি'),
          l('Missing-TIN and withholding effects in the posted amount', 'পোস্টকৃত অঙ্কে টিআইএন অনুপস্থিতি ও উৎসে করের প্রভাব'),
          l('Partial payments and AP ageing', 'আংশিক পরিশোধ ও প্রদেয় বয়স বিশ্লেষণ'),
          l('Withholding liabilities linked to treasury challans', 'কোষাগার চালানের সঙ্গে সংযুক্ত উৎসে কর দায়'),
        ],
      },
      {
        id: 'bank-to-book',
        title: l('Match the bank without the spreadsheet', 'স্প্রেডশিট ছাড়াই ব্যাংক মিলান'),
        description: l(
          'Import a bank or MFS statement, match it against the ledger with duplicate protection, and sign off the reconciliation. A mismatch stays visible instead of becoming a plug.',
          'ব্যাংক বা এমএফএস স্টেটমেন্ট আমদানি করুন, পুনরাবৃত্তি সুরক্ষাসহ লেজারের সঙ্গে মেলান, এবং সমন্বয়ে স্বাক্ষর করুন। অমিল লুকানো না করে দৃশ্যমান থাকে।',
        ),
        details: [
          l('CSV/XLSX statement import with error rows', 'ত্রুটিপূর্ণ সারিসহ সিএসভি/এক্সএলএসএক্স আমদানি'),
          l('Amount, date and reference matching', 'অঙ্ক, তারিখ ও রেফারেন্স মিলিয়ে দেখা'),
          l('Duplicate and double-match protection', 'পুনরাবৃত্তি ও দ্বৈত মিল প্রতিরোধ'),
          l('Reviewed reconciliation sign-off', 'পর্যালোচিত সমন্বয় স্বাক্ষর'),
        ],
      },
      {
        id: 'close-with-evidence',
        title: l('Close the month with evidence', 'প্রমাণসহ মাস শেষ করুন'),
        description: l(
          'Run control proofs, resolve exceptions, close and lock the period, then produce management reports from posted journals. Reopening needs permission, a reason and an audit record.',
          'নিয়ন্ত্রণ প্রমাণ চালান, ব্যতিক্রম সমাধান করুন, সময়কাল বন্ধ ও লক করুন, তারপর পোস্টকৃত জার্নাল থেকে ব্যবস্থাপনা প্রতিবেদন তৈরি করুন। পুনরায় খুলতে অনুমতি, কারণ ও অডিট রেকর্ড লাগে।',
        ),
        details: [
          l('Trial balance, balance sheet and ledger proof', 'রেওয়ামিল, ব্যালান্স শিট ও লেজার প্রমাণ'),
          l('AR, AP, bank and VAT control proofs', 'প্রাপ্য, প্রদেয়, ব্যাংক ও ভ্যাট নিয়ন্ত্রণ প্রমাণ'),
          l('Maker-checker close approval and period lock', 'নির্মাতা-পরীক্ষক সমাপনী অনুমোদন ও সময়কাল লক'),
          l('Append-only audit log with CSV export', 'সিএসভি এক্সপোর্টসহ কেবল-সংযোজনযোগ্য অডিট লগ'),
        ],
      },
    ] satisfies WorkflowCopy[],
  },
  screens: {
    eyebrow: l('Inside the product', 'পণ্যের ভেতরে'),
    title: l('A look inside the product.', 'পণ্যের ভেতরে এক নজর।'),
    intro: l(
      'A real sales invoice capture from the running application, plus an illustrative report layout in the current design system. The data is synthetic and clearly labelled.',
      'চলমান অ্যাপ্লিকেশনের আসল বিক্রয় ইনভয়েসের স্ক্রিন, সঙ্গে বর্তমান ডিজাইন সিস্টেমে একটি উদাহরণ প্রতিবেদন লেআউট। ডেটা কৃত্রিম ও স্পষ্টভাবে চিহ্নিত।',
    ),
    salesAlt: l(
      'Current Fintuity Accounting Suite sales invoice screen showing line-level tax, totals and synthetic test data.',
      'বর্তমান ফিনটুইটি অ্যাকাউন্টিং স্যুট বিক্রয় ইনভয়েস স্ক্রিন—লাইনভিত্তিক কর, মোট ও কৃত্রিম পরীক্ষামূলক ডেটা।',
    ),
    reportsAlt: l(
      'Current Fintuity Accounting Suite management accounts screen marked unaudited, with period controls and control proofs.',
      'বর্তমান লেজারভোল্ট ব্যবস্থাপনা হিসাব স্ক্রিন—অনিরীক্ষিত হিসেবে চিহ্নিত, সময়কাল নিয়ন্ত্রণ ও প্রমাণসহ।',
    ),
    salesCaption: l(
      'Line-level tax, document totals and control evidence from a posted sales invoice.',
      'পোস্টকৃত বিক্রয় ইনভয়েস থেকে লাইনভিত্তিক কর, ডকুমেন্ট মোট ও নিয়ন্ত্রণ প্রমাণ।',
    ),
    reportsCaption: l(
      'An illustrative management-accounts layout: unaudited, with control proofs beside the figures. Synthetic amounts.',
      'একটি উদাহরণ ব্যবস্থাপনা-হিসাব লেআউট: অনিরীক্ষিত, সংখ্যার পাশে নিয়ন্ত্রণ প্রমাণ। কৃত্রিম অঙ্ক।',
    ),
  },
  capabilities: {
    eyebrow: l("What's included", 'যা অন্তর্ভুক্ত'),
    title: l('Everything the finance team needs to close.', 'হিসাব বন্ধ করতে ফাইন্যান্স টিমের যা যা দরকার।'),
    intro: l(
      "These are the workflows in the current release. No half-finished module pretending to be live, and no fake filing button.",
      'এগুলো বর্তমান সংস্করণের কর্মপ্রবাহ। অসম্পূর্ণ মডিউল চালু বলে দেখানো হয় না, কোনো ভুয়া ফাইলিং বোতামও নেই।',
    ),
    items: [
      {
        title: l('One ledger everyone trusts', 'সবাই যে লেজারে ভরসা করে'),
        description: l(
          'Double-entry journals, a trial balance and linked reversals. Once an entry is posted, it stays put.',
          'দ্বৈত-এন্ট্রি জার্নাল, রেওয়ামিল ও সংযুক্ত বিপরীত এন্ট্রি। একবার পোস্ট হলে এন্ট্রি আর বদলায় না।',
        ),
      },
      {
        title: l('Sell, collect, and see who owes you', 'বিক্রি করুন, আদায় করুন, বাকি দেখুন'),
        description: l(
          'Invoices, credit notes, customer receipts and ageing — with the receivable control proved to the ledger.',
          'ইনভয়েস, ক্রেডিট নোট, গ্রাহক রসিদ ও বয়স বিশ্লেষণ—লেজারের সঙ্গে প্রাপ্য নিয়ন্ত্রণ মিলিয়ে দেখানো হয়।',
        ),
      },
      {
        title: l('Buy, pay, and keep withholding straight', 'কিনুন, পরিশোধ করুন, উৎসে কর ঠিক রাখুন'),
        description: l(
          'Supplier bills, expense vouchers, payments, withholding records and payables ageing.',
          'সরবরাহকারীর বিল, খরচ ভাউচার, পরিশোধ, উৎসে কর রেকর্ড ও প্রদেয় বয়স বিশ্লেষণ।',
        ),
      },
      {
        title: l('Match the bank without the spreadsheet', 'স্প্রেডশিট ছাড়াই ব্যাংক মিলান'),
        description: l(
          'Import statements, match transactions, move money between accounts and sign off the reconciliation.',
          'স্টেটমেন্ট আমদানি করুন, লেনদেন মিলান, হিসাবের মধ্যে টাকা সরান এবং সমন্বয়ে স্বাক্ষর করুন।',
        ),
      },
      {
        title: l('Prepare VAT from what was actually posted', 'যা সত্যিই পোস্ট হয়েছে তা থেকেই ভ্যাট প্রস্তুত করুন'),
        description: l(
          'Sales and purchase registers, draft VAT 9.1, VDS/TDS liabilities and treasury challans.',
          'বিক্রয় ও ক্রয় রেজিস্টার, খসড়া ভ্যাট ৯.১, ভিডিএস/টিডিএস দায় ও কোষাগার চালান।',
        ),
      },
      {
        title: l('Close with evidence, not a plug', 'সমন্বয় নয়, প্রমাণসহ সমাপনী'),
        description: l(
          'Management statements, control proofs, a controlled close and an exportable audit trail.',
          'ব্যবস্থাপনা বিবরণী, নিয়ন্ত্রণ প্রমাণ, নিয়ন্ত্রিত সমাপনী ও এক্সপোর্টযোগ্য অডিট ট্রেইল।',
        ),
      },
    ] satisfies CapabilityCopy[],
  },
  bangladesh: {
    eyebrow: l('Built for Bangladesh', 'বাংলাদেশের জন্য তৈরি'),
    title: l('Made for the way Bangladesh does finance.', 'বাংলাদেশ যেভাবে হিসাব করে, তার জন্যই তৈরি।'),
    intro: l(
      'BDT, Bangla and English, BIN/TIN, Mushak register preparation and local bank/MFS reconciliation are part of the product — not a translation layer bolted on later.',
      'বিডিটি, বাংলা ও ইংরেজি, বিআইএন/টিআইএন, মূসক রেজিস্টার প্রস্তুতি এবং স্থানীয় ব্যাংক/এমএফএস সমন্বয়—সবই পণ্যের অংশ, পরে জোড়া দেওয়া অনুবাদ নয়।',
    ),
    items: [
      {
        title: l('Money in poisha', 'পয়সায় হিসাব'),
        description: l(
          'Authoritative amounts use integer poisha. Lakh and crore grouping, Bangla numerals and Taka in words are built in.',
          'প্রামাণ্য অঙ্ক পূর্ণসংখ্যা পয়সায় থাকে। লাখ ও কোটি গ্রুপিং, বাংলা সংখ্যা ও কথায় টাকা অন্তর্ভুক্ত।',
        ),
      },
      {
        title: l('Bilingual interface', 'দ্বিভাষিক ইন্টারফেস'),
        description: l(
          'Switch between Bangla and English without losing the accounting vocabulary or the figures.',
          'হিসাবের পরিভাষা বা সংখ্যা না হারিয়ে বাংলা ও ইংরেজির মধ্যে বদলান।',
        ),
      },
      {
        title: l('BIN and TIN fields', 'বিআইএন ও টিআইএন ফিল্ড'),
        description: l(
          'Capture and format-check party tax identifiers. These checks are not a statutory validation service.',
          'পক্ষের কর শনাক্তকরণ নম্বর লিখুন ও ফরম্যাট যাচাই করুন। এটি সংবিধিবদ্ধ যাচাই সেবা নয়।',
        ),
      },
      {
        title: l('Mushak preparation', 'মূসক প্রস্তুতি'),
        description: l(
          'Sales and purchase registers and a draft VAT 9.1 schedule are derived from posted transactions.',
          'বিক্রয় ও ক্রয় রেজিস্টার এবং খসড়া ভ্যাট ৯.১ সিডিউল পোস্টকৃত লেনদেন থেকে তৈরি হয়।',
        ),
      },
      {
        title: l('Local banking and MFS', 'স্থানীয় ব্যাংকিং ও এমএফএস'),
        description: l(
          'Import statements, match transactions and sign off reconciliations for bank, cash and MFS accounts.',
          'ব্যাংক, নগদ ও এমএফএস অ্যাকাউন্টের স্টেটমেন্ট আমদানি, লেনদেন মিলকরণ ও সমন্বয়ে স্বাক্ষর করুন।',
        ),
      },
      {
        title: l('Professional review stays explicit', 'পেশাদার পর্যালোচনা স্পষ্ট থাকে'),
        description: l(
          'Draft statutory outputs are labelled as drafts. Filing and sign-off remain with your team and advisers.',
          'খসড়া সংবিধিবদ্ধ আউটপুট খসড়া হিসেবেই চিহ্নিত। ফাইলিং ও স্বাক্ষর আপনার টিম ও উপদেষ্টাদের কাছে থাকে।',
        ),
      },
    ],
    disclaimer: l(
      'Fintuity Accounting Suite prepares accounting records, registers and draft schedules. It does not file returns, issue audit opinions or replace a qualified accountant or tax adviser. Statutory positions must be reviewed against the current law and signed off by the responsible professional.',
      'ফিনটুইটি অ্যাকাউন্টিং স্যুট হিসাবের রেকর্ড, রেজিস্টার ও খসড়া সিডিউল প্রস্তুত করে। এটি রিটার্ন দাখিল করে না, অডিট মতামত দেয় না, বা যোগ্য হিসাবরক্ষক/কর উপদেষ্টার বিকল্প নয়। সংবিধিবদ্ধ অবস্থান বর্তমান আইনের সঙ্গে যাচাই করে দায়িত্বপ্রাপ্ত পেশাদারকে স্বাক্ষর করতে হবে।',
    ),
  },
  controls: {
    eyebrow: l('Controls and trust', 'নিয়ন্ত্রণ ও আস্থা'),
    title: l('Quiet controls that hold when the month gets busy.', 'মাস ব্যস্ত হলেও যে নিয়ন্ত্রণ টিকে থাকে।'),
    intro: l(
      'Permissions, approvals and period locks are enforced by the server, not by hiding a button in the browser.',
      'অনুমতি, অনুমোদন ও সময়কাল লক সার্ভারে প্রয়োগ হয়—ব্রাউজারে বোতাম লুকিয়ে নয়।',
    ),
    items: [
      {
        title: l('Company-scoped access', 'কোম্পানি-সীমাবদ্ধ প্রবেশ'),
        description: l(
          "Every company request checks membership and permission. Another company's records return not found.",
          'প্রতিটি কোম্পানি অনুরোধে সদস্যপদ ও অনুমতি যাচাই হয়। অন্য কোম্পানির রেকর্ড পাওয়া যায় না।',
        ),
      },
      {
        title: l('Maker-checker approvals', 'নির্মাতা-পরীক্ষক অনুমোদন'),
        description: l(
          'High-value invoices, bills, journals, payments and reversals require a different authorised user above your threshold.',
          'নির্ধারিত সীমার বেশি মূল্যের ইনভয়েস, বিল, জার্নাল, পরিশোধ ও বিপরীত এন্ট্রিতে ভিন্ন অনুমোদিত ব্যবহারকারী লাগে।',
        ),
      },
      {
        title: l('Explicit periods', 'স্পষ্ট সময়কাল'),
        description: l(
          'A period is OPEN, CLOSED or LOCKED. Posting outside an open period is rejected; reopening is permissioned and audited.',
          'সময়কাল OPEN, CLOSED বা LOCKED। খোলা সময়কালের বাইরে পোস্টিং প্রত্যাখ্যাত; পুনরায় খুলতে অনুমতি ও অডিট লাগে।',
        ),
      },
      {
        title: l('Immutable posted records', 'অপরিবর্তনীয় পোস্টকৃত রেকর্ড'),
        description: l(
          'Posted journals cannot be edited or deleted. Corrections create a linked reversal with a reason.',
          'পোস্টকৃত জার্নাল সম্পাদনা বা মুছে ফেলা যায় না। সংশোধনে কারণসহ সংযুক্ত বিপরীত এন্ট্রি তৈরি হয়।',
        ),
      },
      {
        title: l('Append-only audit log', 'কেবল-সংযোজনযোগ্য অডিট লগ'),
        description: l(
          'Material actions record the actor, session, request and before/after values. The log is queryable and exportable.',
          'গুরুত্বপূর্ণ কাজে ব্যবহারকারী, সেশন, অনুরোধ ও আগের/পরের মান সংরক্ষিত হয়। লগ অনুসন্ধান ও এক্সপোর্ট করা যায়।',
        ),
      },
      {
        title: l('Honest boundaries', 'সৎ সীমারেখা'),
        description: l(
          'No audit opinion, no certification badge and no claim that a return was filed. Those are not software features.',
          'কোনো অডিট মতামত, সার্টিফিকেশন ব্যাজ বা রিটার্ন দাখিলের দাবি নেই। এগুলো সফটওয়্যারের বৈশিষ্ট্য নয়।',
        ),
      },
    ],
  },
  audience: {
    eyebrow: l('Who it is for', 'কাদের জন্য'),
    title: l('Built for the finance team that has to close the books.', 'যে ফাইন্যান্স টিমকে হিসাব বন্ধ করতে হয়, তাদের জন্য।'),
    intro: l(
      'Designed for small and medium finance teams. Group consolidation and a practice-wide client cockpit are not part of the first release.',
      'ছোট ও মাঝারি ফাইন্যান্স টিমের জন্য তৈরি। গ্রুপ কনসোলিডেশন ও সম্পূর্ণ প্র্যাকটিস ক্লায়েন্ট ককপিট প্রথম সংস্করণে নেই।',
    ),
    items: [
      {
        title: l('Trading companies', 'বাণিজ্যিক প্রতিষ্ঠান'),
        description: l('Invoices, bills, stock, receivables, payables and VAT registers in one flow.', 'ইনভয়েস, বিল, স্টক, প্রাপ্য, প্রদেয় ও ভ্যাট রেজিস্টার এক প্রবাহে।'),
      },
      {
        title: l('Service firms', 'সেবা প্রতিষ্ঠান'),
        description: l('Expense vouchers, client receipts and withholding without inventory overhead.', 'ইনভেন্টরি ছাড়াই খরচ ভাউচার, ক্লায়েন্ট রসিদ ও উৎসে কর।'),
      },
      {
        title: l('Light manufacturing', 'হালকা উৎপাদন'),
        description: l('Stock receipts, issues and weighted-average valuation linked to the ledger.', 'লেজারের সঙ্গে সংযুক্ত স্টক গ্রহণ, ইস্যু ও ভারিত গড় মূল্যায়ন।'),
      },
      {
        title: l('Finance teams of 10–500', '১০–৫০০ জনের ফাইন্যান্স টিম'),
        description: l('Role-scoped access for owners, controllers, accountants, operators and auditors.', 'মালিক, নিয়ন্ত্রক, হিসাবরক্ষক, অপারেটর ও অডিটরের জন্য ভূমিকা-ভিত্তিক প্রবেশ।'),
      },
    ],
    later: l(
      'Accounting practices and group finance teams are on the roadmap, not in this release.',
      'অ্যাকাউন্টিং প্র্যাকটিস ও গ্রুপ ফাইন্যান্স টিম রোডম্যাপে আছে, এই সংস্করণে নেই।',
    ),
  },
  onboarding: {
    eyebrow: l('Implementation', 'বাস্তবায়ন'),
    title: l('Start with one company. Expand when the books are ready.', 'এক কোম্পানি দিয়ে শুরু করুন। হিসাব প্রস্তুত হলে বাড়ান।'),
    steps: [
      {
        title: l('Set up the company', 'কোম্পানি সেট আপ'),
        description: l('Legal identity, fiscal year, chart of accounts and bank or MFS accounts.', 'আইনি পরিচয়, অর্থবছর, হিসাবের তালিকা এবং ব্যাংক বা এমএফএস অ্যাকাউন্ট।'),
      },
      {
        title: l('Bring the opening position', 'প্রারম্ভিক অবস্থান আনুন'),
        description: l(
          'Prepare a balanced opening batch with account, party and item detail. It posts once through the same ledger.',
          'হিসাব, পক্ষ ও আইটেমের বিবরণসহ সুষম প্রারম্ভিক ব্যাচ তৈরি করুন। এটি একই লেজার দিয়ে একবার পোস্ট হয়।',
        ),
      },
      {
        title: l('Invite the team', 'টিমকে আমন্ত্রণ জানান'),
        description: l('Give each person a role and the companies they need. Auditors can read without writing.', 'প্রত্যেককে ভূমিকা ও প্রয়োজনীয় কোম্পানি দিন। অডিটর পড়তে পারেন, লিখতে পারেন না।'),
      },
      {
        title: l('Turn on the workflow', 'কর্মপ্রবাহ চালু করুন'),
        description: l(
          'Start with sales, purchases, banking, VAT and reports. Add the next workspace when the team is ready.',
          'বিক্রয়, ক্রয়, ব্যাংকিং, ভ্যাট ও প্রতিবেদন দিয়ে শুরু করুন। টিম প্রস্তুত হলে পরের ওয়ার্কস্পেস যোগ করুন।',
        ),
      },
    ],
  },
  contact: {
    eyebrow: l('Next step', 'পরবর্তী ধাপ'),
    title: l("Let's look at your month-end together.", 'আপনার মাস-শেষের কাজটা একসঙ্গে দেখি।'),
    description: l(
      "We don't publish a price list yet. In 30 minutes we'll walk through your company structure, VAT workflow, migration and the controls you need. You'll leave with a clear scope and a next step — no pressure.",
      'আমরা এখনো মূল্যতালিকা প্রকাশ করছি না। ৩০ মিনিটে আপনার কোম্পানির কাঠামো, ভ্যাট কর্মপ্রবাহ, মাইগ্রেশন ও প্রয়োজনীয় নিয়ন্ত্রণ দেখব। শেষে স্পষ্ট পরিধি ও পরবর্তী ধাপ থাকবে—কোনো চাপ নেই।',
    ),
    note: l(
      'Use a work email. Do not include financial records, passwords or sensitive personal data in the message.',
      'কর্মস্থলের ইমেইল ব্যবহার করুন। বার্তায় আর্থিক রেকর্ড, পাসওয়ার্ড বা সংবেদনশীল ব্যক্তিগত তথ্য দেবেন না।',
    ),
    privacy: l(
      'We use these details only to respond to your request. Read the legal and privacy notice.',
      'আমরা এই তথ্য শুধু আপনার অনুরোধের উত্তর দিতে ব্যবহার করি। আইন ও গোপনীয়তা বিজ্ঞপ্তি পড়ুন।',
    ),
    success: l(
      'Request received. We will contact you at the work email you provided.',
      'অনুরোধ পাওয়া গেছে। আপনার দেওয়া কর্মস্থলের ইমেইলে আমরা যোগাযোগ করব।',
    ),
    error: l(
      'The request could not be sent. Try again in a moment or contact your Fintuity Accounting Suite representative.',
      'অনুরোধ পাঠানো যায়নি। কিছুক্ষণ পরে আবার চেষ্টা করুন বা আপনার ফিনটুইটি প্রতিনিধির সঙ্গে যোগাযোগ করুন।',
    ),
    labels: {
      name: l('Your name', 'আপনার নাম'),
      email: l('Work email', 'কর্মস্থলের ইমেইল'),
      company: l('Company', 'কোম্পানি'),
      message: l('What would you like to cover? (optional)', 'কী নিয়ে আলোচনা করতে চান? (ঐচ্ছিক)'),
      submit: l('Request a walkthrough', 'ওয়াকথ্রু চান'),
      pending: l('Sending request…', 'অনুরোধ পাঠানো হচ্ছে…'),
    },
  },
  faq: {
    eyebrow: l('Questions', 'প্রশ্ন'),
    title: l('The questions finance teams ask us.', 'ফাইন্যান্স টিম যে প্রশ্নগুলো করে।'),
    items: [
      {
        question: l('Is Fintuity Accounting Suite a replacement for my accountant?', 'ফিনটুইটি অ্যাকাউন্টিং স্যুট কি আমার হিসাবরক্ষকের বিকল্প?'),
        answer: l(
          'No. It is software for the finance team and their advisers. Your accountant still reviews statutory positions and signs off filings.',
          'না। এটি ফাইন্যান্স টিম ও তাদের উপদেষ্টাদের জন্য সফটওয়্যার। সংবিধিবদ্ধ অবস্থান আপনার হিসাবরক্ষকই পর্যালোচনা ও ফাইলিংয়ে স্বাক্ষর করবেন।',
        ),
      },
      {
        question: l('Can we use Bangla?', 'আমরা কি বাংলা ব্যবহার করতে পারি?'),
        answer: l(
          'Yes. The interface, number formatting and Taka-in-words support Bangla and English.',
          'হ্যাঁ। ইন্টারফেস, সংখ্যা ফরম্যাটিং ও কথায় টাকা বাংলা ও ইংরেজি সমর্থন করে।',
        ),
      },
      {
        question: l('Does it file VAT returns?', 'এটি কি ভ্যাট রিটার্ন দাখিল করে?'),
        answer: l(
          'No. It prepares VAT registers and a draft 9.1 schedule from posted transactions. Filing, verification and professional sign-off remain with your team.',
          'না। এটি পোস্টকৃত লেনদেন থেকে ভ্যাট রেজিস্টার ও খসড়া ৯.১ সিডিউল তৈরি করে। দাখিল, যাচাই ও পেশাদার স্বাক্ষর আপনার টিমের কাছে থাকে।',
        ),
      },
      {
        question: l('Can we import our chart of accounts?', 'আমরা কি হিসাবের তালিকা আমদানি করতে পারি?'),
        answer: l(
          'Yes, as CSV or XLSX with validation. Opening balances are prepared as a balanced batch and posted once through the ledger.',
          'হ্যাঁ, যাচাইসহ সিএসভি বা এক্সএলএসএক্স হিসেবে। প্রারম্ভিক ব্যালেন্স সুষম ব্যাচ হিসেবে প্রস্তুত হয়ে একবার লেজারে পোস্ট হয়।',
        ),
      },
      {
        question: l('Can we export our data?', 'আমরা কি আমাদের তথ্য এক্সপোর্ট করতে পারি?'),
        answer: l(
          'Yes. Reports and registers export to CSV/XLSX; the audit log exports to CSV. A complete self-service backup/restore is not yet available.',
          'হ্যাঁ। প্রতিবেদন ও রেজিস্টার সিএসভি/এক্সএলএসএক্সে, অডিট লগ সিএসভিতে এক্সপোর্ট হয়। সম্পূর্ণ স্ব-পরিষেবা ব্যাকআপ/রিস্টোর এখনো নেই।',
        ),
      },
      {
        question: l('Is the product audited or certified?', 'পণ্যটি কি অডিটেড বা সার্টিফাইড?'),
        answer: l(
          'No. Fintuity Accounting Suite has not commissioned an audit or certification. It prepares records; it does not provide an audit opinion.',
          'না। ফিনটুইটি অ্যাকাউন্টিং স্যুট কোনো অডিট বা সার্টিফিকেশন করায়নি। এটি রেকর্ড প্রস্তুত করে; অডিট মতামত দেয় না।',
        ),
      },
      {
        question: l('What is not in this release?', 'এই সংস্করণে কী নেই?'),
        answer: l(
          'Payroll, fixed assets, direct NBR filing integrations and group consolidation are not in the first release. Demo-only workspaces are labelled and never presented as live.',
          'পে-রোল, স্থায়ী সম্পদ, এনবিআর-এ সরাসরি ফাইলিং ও গ্রুপ কনসোলিডেশন প্রথম সংস্করণে নেই। শুধু-ডেমো ওয়ার্কস্পেস চিহ্নিত এবং কখনো চালু হিসেবে দেখানো হয় না।',
        ),
      },
      {
        question: l('How are backups handled?', 'ব্যাকআপ কীভাবে পরিচালিত হয়?'),
        answer: l(
          'Company data is stored in PostgreSQL. The hosting operator must configure and test database backups. A self-service backup/restore screen is not yet available.',
          'কোম্পানির তথ্য পোস্টগ্রেসকিউএলে সংরক্ষিত। হোস্টিং অপারেটরকে ডেটাবেস ব্যাকআপ কনফিগার ও পরীক্ষা করতে হবে। স্ব-পরিষেবা ব্যাকআপ/রিস্টোর স্ক্রিন এখনো নেই।',
        ),
      },
    ] satisfies FaqCopy[],
  },
  finalCta: {
    title: l(
      'Bring the books, the tax registers and the reports back into agreement.',
      'হিসাব, কর রেজিস্টার ও প্রতিবেদনকে আবার একই সুরে ফিরিয়ে আনুন।',
    ),
    description: l(
      'Start with a walkthrough. We will show you the real screens, the controls behind them and the parts that are deliberately not in this release.',
      'ওয়াকথ্রু দিয়ে শুরু করুন। আসল স্ক্রিন, তার পেছনের নিয়ন্ত্রণ এবং এই সংস্করণে ইচ্ছাকৃতভাবে যা নেই—সব দেখাব।',
    ),
  },
  footer: {
    product: l('Product', 'পণ্য'),
    workflows: l('Workflows', 'কর্মপ্রবাহ'),
    capabilities: l('Capabilities', 'সক্ষমতা'),
    bangladesh: l('Bangladesh fit', 'বাংলাদেশ উপযোগী'),
    controls: l('Controls', 'নিয়ন্ত্রণ'),
    faq: l('FAQ', 'সাধারণ প্রশ্ন'),
    company: l('Company', 'প্রতিষ্ঠান'),
    security: l('Security', 'নিরাপত্তা'),
    legal: l('Legal and privacy', 'আইন ও গোপনীয়তা'),
    contact: l('Contact', 'যোগাযোগ'),
    signIn: l('Sign in', 'সাইন ইন'),
    line: l(
      'Accounting and finance operations for Bangladeshi businesses. Demo data is synthetic and labelled.',
      'বাংলাদেশি ব্যবসার জন্য হিসাব ও অর্থ পরিচালনা। ডেমো ডেটা কৃত্রিম ও চিহ্নিত।',
    ),
    disclaimer: l(
      'Fintuity Accounting Suite is accounting software, not an audit, legal or tax practice. Statutory outputs require professional review and sign-off.',
      'ফিনটুইটি অ্যাকাউন্টিং স্যুট হিসাব সফটওয়্যার, অডিট/আইন/কর প্রতিষ্ঠান নয়। সংবিধিবদ্ধ আউটপুট পেশাদার পর্যালোচনা ও স্বাক্ষর প্রয়োজন।',
    ),
  },
} as const;
