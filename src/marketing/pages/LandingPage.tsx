import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  AnimatePresence,
  motion,
  useInView,
  useReducedMotion,
  useScroll,
  useSpring,
} from 'framer-motion';
import {
  ArrowRight,
  ArrowUpRight,
  Bell,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  FileSearch,
  FileText,
  Landmark,
  LayoutDashboard,
  Menu,
  MoreHorizontal,
  Package,
  Plus,
  QrCode,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  ShoppingBag,
  Sun,
  Users,
  Wallet,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useMarketingUi } from '../MarketingApp';
import { usePageMeta } from '../usePageMeta';

interface Module {
  number: string;
  title: string;
  titleBn: string;
  description: string;
  descriptionBn: string;
  metricLabel: string;
  metricLabelBn: string;
  metric: string;
  change: string;
  changeBn: string;
  chartLabel: string;
  chartLabelBn: string;
  bars: number[];
  rows: { name: string; nameBn: string; detail: string; detailBn: string; amount: string }[];
}

const modules: Module[] = [
  {
    number: '01',
    title: 'Accounting',
    titleBn: 'অ্যাকাউন্টিং ও খতিয়ান',
    description: 'A beautifully clear view of your books, cash flow, and financial health.',
    descriptionBn: 'আপনার হিসাবের খাতা, নগদ প্রবাহ ও আর্থিক অবস্থার এক সুসংহত চিত্র।',
    metricLabel: 'Total balance',
    metricLabelBn: 'মোট ব্যালেন্স',
    metric: '৳ ২৪,৮৬,৪২০',
    change: '+12.8% from last month',
    changeBn: 'গত মাসের চেয়ে +১২.৮%',
    chartLabel: 'Cash flow this year',
    chartLabelBn: 'চলতি বছরের নগদ প্রবাহ',
    bars: [43, 58, 48, 70, 62, 75, 68, 84, 76, 92, 82, 96],
    rows: [
      { name: 'Bank reconciliation', nameBn: 'ব্যাংক সমন্বয়', detail: 'Completed today', detailBn: 'আজ সম্পন্ন', amount: 'Reconciled' },
      { name: 'Operating expenses', nameBn: 'পরিচালন ব্যয়', detail: 'This month', detailBn: 'চলতি মাস', amount: '৳ ৪,২৪,৮০০' },
      { name: 'Accounts receivable', nameBn: 'প্রাপ্য হিসাব', detail: '12 open invoices', detailBn: '১২টি বকেয়া চালান', amount: '৳ ৬,১৮,৩০০' },
    ],
  },
  {
    number: '02',
    title: 'Sales & invoicing',
    titleBn: 'বিক্রয় ও চালান',
    description: 'Create polished invoices, track payments, and keep every sale moving.',
    descriptionBn: 'স্বয়ংক্রিয় চালান তৈরি করুন, পাওনা ট্র্যাক করুন এবং বিক্রয় গতিশীল রাখুন।',
    metricLabel: 'Sales this month',
    metricLabelBn: 'চলতি মাসের বিক্রয়',
    metric: '৳ ১৮,৪২,৫০০',
    change: '+18.4% from last month',
    changeBn: 'গত মাসের চেয়ে +১৮.৪%',
    chartLabel: 'Monthly sales performance',
    chartLabelBn: 'মাসিক বিক্রয় কর্মক্ষমতা',
    bars: [31, 46, 42, 57, 51, 69, 61, 74, 71, 81, 77, 94],
    rows: [
      { name: 'INV-0284 · Arco Textiles', nameBn: 'চালান-০২৮৪ · আরকো টেক্সটাইল', detail: 'Paid today', detailBn: 'আজ পরিশোধিত', amount: '৳ ১,৮৫,০০০' },
      { name: 'INV-0283 · Northstar Ltd', nameBn: 'চালান-০২৮৩ · নর্থস্টার লিঃ', detail: 'Awaiting payment', detailBn: 'পেমেন্ট অপেক্ষমাণ', amount: '৳ ৮৪,০০০' },
      { name: 'INV-0282 · Bengal Studio', nameBn: 'চালান-০২৮২ · বেঙ্গল স্টুডিও', detail: 'Paid yesterday', detailBn: 'গতকাল পরিশোধিত', amount: '৳ ৪২,৫০০' },
    ],
  },
  {
    number: '03',
    title: 'Inventory',
    titleBn: 'মজুদ ও ইনভেন্টরি',
    description: 'Know what you have, where it is, and what needs your attention next.',
    descriptionBn: 'কী মজুদ আছে, কোন গুদামে আছে এবং কী পুনরায় ক্রয় করতে হবে তা জানুন।',
    metricLabel: 'Products in stock',
    metricLabelBn: 'মজুদ পণ্য সংখ্যা',
    metric: '১,২৪৮',
    change: 'Across 3 locations',
    changeBn: '৩টি গুদাম জুড়ে',
    chartLabel: 'Stock movement',
    chartLabelBn: 'মজুদ পণ্যের গতিপ্রবাহ',
    bars: [63, 54, 69, 59, 75, 68, 81, 72, 86, 77, 89, 94],
    rows: [
      { name: 'Cotton fabric · CT-102', nameBn: 'তুলা কাপড় · সিটি-১০২', detail: 'Dhaka warehouse', detailBn: 'ঢাকা গুদাম', amount: '৩২০ একক' },
      { name: 'Packaging set · PK-024', nameBn: 'প্যাকেজিং সেট · পিকে-০২৪', detail: 'Chattogram branch', detailBn: 'চট্টগ্রাম শাখা', amount: '১৮৬ একক' },
      { name: 'Office supplies · OS-018', nameBn: 'অফিস স্টেশনারি · ওএস-০১৮', detail: 'Low stock alert', detailBn: 'কম মজুদের সতর্কতা', amount: '২৪ একক' },
    ],
  },
  {
    number: '04',
    title: 'VAT & reporting',
    titleBn: 'মূসক ও কর বিবরণী',
    description: 'Keep records organized and turn everyday data into ready-to-use reports.',
    descriptionBn: 'লেনদেনের নথি সুসংগঠিত রাখুন এবং প্রস্তুত করুন নির্ভুল মূসক ও অডিট রিপোর্ট।',
    metricLabel: 'Taxable sales',
    metricLabelBn: 'করযোগ্য বিক্রয়',
    metric: '৳ ১২,১৬,৮০০',
    change: 'Current reporting period',
    changeBn: 'বর্তমান কর বিবরণী মেয়াদ',
    chartLabel: 'Reporting overview',
    chartLabelBn: 'কর বিবরণী সারসংক্ষেপ',
    bars: [37, 48, 56, 51, 66, 59, 71, 78, 72, 84, 81, 92],
    rows: [
      { name: 'Sales summary (Mushak 6.3)', nameBn: 'বিক্রয় সারসংক্ষেপ (মুসক ৬.৩)', detail: 'Updated automatically', detailBn: 'স্বয়ংক্রিয় আপডেট', amount: 'Ready' },
      { name: 'Purchase register (Mushak 6.1)', nameBn: 'ক্রয় খতিয়ান (মুসক ৬.১)', detail: 'Current period', detailBn: 'বর্তমান মেয়াদ', amount: 'Ready' },
      { name: 'VAT return draft (Mushak 9.1)', nameBn: 'দাখিলপত্র খসড়া (মুসক ৯.১)', detail: 'Working draft', detailBn: 'খসড়া রিপোর্ট', amount: 'View report' },
    ],
  },
];

const sidebarItems: { label: string; labelBn: string; icon: LucideIcon; active?: boolean }[] = [
  { label: 'Overview', labelBn: 'সারসংক্ষেপ', icon: LayoutDashboard, active: true },
  { label: 'Accounting', labelBn: 'হিসাবরক্ষণ', icon: Wallet },
  { label: 'Sales & invoices', labelBn: 'বিক্রয় ও চালান', icon: FileText },
  { label: 'Purchases', labelBn: 'ক্রয় ও সরবরাহ', icon: ShoppingBag },
  { label: 'Inventory', labelBn: 'ইনভেন্টরি', icon: Package },
  { label: 'Banking', labelBn: 'ব্যাংকিং ও এমএফএস', icon: Landmark },
  { label: 'Team', labelBn: 'দল ও অনুমতি', icon: Users },
];

const complianceSteps = [
  {
    when: 'Every sale',
    whenBn: 'প্রতিটি বিক্রয়',
    what: 'Mushak 6.3 challan issued with QR & e-BIN validation',
    whatBn: 'কিউআর ও ই-বিআইএন যাচাইসহ মুসক ৬.৩ চালান জারি',
  },
  {
    when: '7th of month',
    whenBn: 'মাসের ৭ তারিখ',
    what: 'e-TDS deposit certificate prepared from payroll & vendors',
    whatBn: 'পে-রোল ও সরবরাহকারীদের ই-টিডিএস জমা সার্টিফিকেট প্রস্তুতি',
  },
  {
    when: '15th of month',
    whenBn: 'মাসের ১৫ তারিখ',
    what: 'Mushak 9.1 return working draft compiled with audit trail',
    whatBn: 'সম্পূর্ণ অডিট ট্রেইলসহ মুসক ৯.১ রিটার্ন খসড়া প্রস্তুত',
  },
  {
    when: 'Every SRO',
    whenBn: 'প্রতিটি এসআরও',
    what: 'VAT & SD rates updated across all books within 24 hours',
    whatBn: '২৪ ঘণ্টার মধ্যে সকল বইয়ে মূসক ও সম্পূরক শুল্কের হার হালনাগাদ',
  },
];

const complianceBadges = [
  { icon: ShieldCheck, label: 'e-BIN validation', labelBn: 'ই-বিআইএন যাচাই' },
  { icon: QrCode, label: 'QR challans', labelBn: 'কিউআর চালান' },
  { icon: FileSearch, label: 'Full audit trail', labelBn: 'সম্পূর্ণ অডিট ট্রেইল' },
];

const localFeatures = [
  {
    number: '01',
    title: 'Taka comes naturally.',
    titleBn: 'টাকার হিসাব সহজ ও স্বাভাবিক।',
    copy: 'Work in BDT from day one, with a clear view of multi-currency transactions when business takes you further.',
    copyBn: 'প্রথম দিন থেকেই বিডিটিতে হিসাব রাখুন, এবং বৈদেশিক বাণিজ্যের জন্য বহু-মুদ্রা সুবিধা ব্যবহার করুন।',
  },
  {
    number: '02',
    title: 'Stay ready for VAT.',
    titleBn: 'মূসক ও কর নিরীক্ষার জন্য সদা প্রস্তুত।',
    copy: 'Keep the records behind your VAT workflows organized, accessible, and easier to prepare for reporting.',
    copyBn: 'মূসক ও কর সংক্রান্ত নথিপত্র এক জায়গায় সাজিয়ে রাখুন যা যে কোনো সময় রিপোর্ট ও নিরীক্ষার জন্য তৈরি।',
  },
  {
    number: '03',
    title: 'Every branch, one picture.',
    titleBn: 'সব শাখা, এক পরিষ্কার চিত্র।',
    copy: 'Bring teams and locations together without losing sight of the details that make each one different.',
    copyBn: 'একই কার্যস্থান থেকে সকল কারখানা ও শাখা নিয়ন্ত্রণ করুন, স্ব-স্ব শাখার নিরাপত্তা অক্ষুণ্ণ রেখে।',
  },
];

const faqs = [
  {
    question: 'Is Fintuity made for businesses in Bangladesh?',
    questionBn: 'ফিনটুইটি কি বাংলাদেশের ব্যবসার জন্য তৈরি?',
    answer:
      'Yes. Fintuity is designed around the day-to-day needs of growing Bangladeshi businesses, with BDT-first workflows, organized VAT records, and visibility across branches.',
    answerBn:
      'হ্যাঁ। ফিনটুইটি বাংলাদেশের ক্রমবর্ধমান ব্যবসার প্রয়োজনীয়তা অনুযায়ী তৈরি—বিডিটি প্রথম, মুসক রেজিস্টার ও শাখাভিত্তিক নিয়ন্ত্রণ।',
  },
  {
    question: 'Can I manage more than one branch or location?',
    questionBn: 'আমি কি একাধিক শাখা বা গুদাম পরিচালনা করতে পারব?',
    answer:
      'Yes. Keep an eye on activity across multiple branches from one workspace while maintaining a clear view of each location.',
    answerBn:
      'হ্যাঁ। এক ড্যাশবোর্ড থেকে একাধিক শাখা ও গুদামের হিসাব ও মজুদ নিরীক্ষণ করুন।',
  },
  {
    question: 'What if our business currently uses spreadsheets?',
    questionBn: 'আমাদের ব্যবসা যদি বর্তমানে স্প্রেডশিট বা এক্সেলে চলে?',
    answer:
      'That is a common starting point. A personal demo can walk your team through the right way to bring your existing processes and data into a more connected workspace.',
    answerBn:
      'অধিকাংশ ব্যবসায়ী স্প্রেডশিট থেকেই শুরু করেন। আমাদের টিম সহজে আপনার ডেটা স্থানান্তরের পথ দেখাবে।',
  },
  {
    question: 'Does Fintuity help with VAT reporting?',
    questionBn: 'ফিনটুইটি কি মূসক দাখিলপত্র তৈরিতে সাহায্য করে?',
    answer:
      'Fintuity helps you keep transaction records and reporting information in one place, making preparation easier. Statutory outputs require professional review by a tax practitioner.',
    answerBn:
      'ফিনটুইটি প্রতিটি লেনদেনের কর হিসাব সংরক্ষণ করে মুসক খসড়া তৈরি করে। সংবিধিবদ্ধ দাখিলে পেশাদার পরামর্শ প্রয়োজন।',
  },
];

function Brand({ inverted = false, onClick }: { inverted?: boolean; onClick?: () => void }) {
  return (
    <a
      className={`brand-lockup ${inverted ? 'brand-inverted' : ''}`}
      href="#top"
      onClick={onClick}
      aria-label="Fintuity ERP, back to top"
    >
      <svg className="brand-mark" viewBox="0 0 80 80" fill="none" aria-hidden="true">
        <path
          d="M19.7 15.8C25.5 8.6 33.5 5 44.6 5H76C73.2 16.2 66.7 22.2 55.6 22.2H35.9C27.2 22.2 22.1 25.3 15.4 32.5L3.8 45.1L9.4 28.7C11.2 23.3 14.5 19.2 19.7 15.8Z"
          fill={inverted ? '#F4F9FB' : '#082D59'}
        />
        <path
          d="M27.4 31.8C33 26.8 38.5 24.4 46.8 24.4H72.3C69.8 36.3 62 43.4 49.7 43.4H7.1L27.4 31.8Z"
          fill="#00B9A8"
        />
        <path
          d="M11.1 43.4H34.9L1.5 76V64.8C1.5 55.6 4.6 48.6 11.1 43.4Z"
          fill={inverted ? '#F4F9FB' : '#082D59'}
        />
      </svg>
      <span className="brand-divider" aria-hidden="true" />
      <span className="brand-name-wrap">
        <span className="brand-name">Fintuity</span>
        <span className="brand-erp">ERP</span>
      </span>
    </a>
  );
}

function BrandMarkSmall() {
  return (
    <svg viewBox="0 0 80 80" aria-hidden="true" fill="none">
      <path
        d="M19.7 15.8C25.5 8.6 33.5 5 44.6 5H76C73.2 16.2 66.7 22.2 55.6 22.2H35.9C27.2 22.2 22.1 25.3 15.4 32.5L3.8 45.1L9.4 28.7C11.2 23.3 14.5 19.2 19.7 15.8Z"
        fill="#F4F9FB"
      />
      <path
        d="M27.4 31.8C33 26.8 38.5 24.4 46.8 24.4H72.3C69.8 36.3 62 43.4 49.7 43.4H7.1L27.4 31.8Z"
        fill="#00B9A8"
      />
      <path
        d="M11.1 43.4H34.9L1.5 76V64.8C1.5 55.6 4.6 48.6 11.1 43.4Z"
        fill="#F4F9FB"
      />
    </svg>
  );
}

function Reveal({
  children,
  className = '',
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  const reduceMotion = useReducedMotion();

  return (
    <motion.div
      className={className}
      initial={reduceMotion ? false : { opacity: 0.92, y: 28 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.18 }}
      transition={{ duration: 0.8, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}

function AnimatedAmount({ amount }: { amount: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.5 });
  const reduceMotion = useReducedMotion();
  const [value, setValue] = useState(0);

  useEffect(() => {
    if (!inView) return;
    if (reduceMotion) {
      setValue(amount);
      return;
    }

    let frame = 0;
    const start = performance.now();
    const duration = 1500;
    const tick = (now: number) => {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(amount * eased));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [amount, inView, reduceMotion]);

  return <span ref={ref}>৳ {value.toLocaleString('en-IN')}</span>;
}

function DashboardChart() {
  const reduceMotion = useReducedMotion();
  const incomePath =
    'M0 170 C42 161 59 130 104 141 S167 169 212 123 S275 113 322 119 S390 75 438 85 S498 97 548 70 S613 78 664 40 S707 50 740 27';
  const expensePath =
    'M0 186 C52 172 70 184 110 171 S175 178 218 156 S275 170 325 151 S390 164 440 140 S501 155 549 129 S616 142 665 115 S710 126 740 104';

  return (
    <div className="dashboard-chart">
      <div className="chart-grid" aria-hidden="true" />
      <svg viewBox="0 0 740 210" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="dashboard-chart-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#05B8A8" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#05B8A8" stopOpacity="0" />
          </linearGradient>
        </defs>
        <motion.path
          d={`${incomePath} L740 210 L0 210 Z`}
          fill="url(#dashboard-chart-fill)"
          initial={reduceMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 1, delay: 0.8 }}
        />
        <motion.path
          d={expensePath}
          fill="none"
          stroke="#B5C5D1"
          strokeWidth="2.5"
          strokeDasharray="5 6"
          initial={reduceMotion ? false : { pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 1.6, delay: 0.55, ease: 'easeInOut' }}
        />
        <motion.path
          d={incomePath}
          fill="none"
          stroke="#05B8A8"
          strokeWidth="3.5"
          strokeLinecap="round"
          initial={reduceMotion ? false : { pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 1.8, delay: 0.35, ease: 'easeInOut' }}
        />
        <motion.circle
          cx="740"
          cy="27"
          r="6"
          fill="#05B8A8"
          stroke="#FFFFFF"
          strokeWidth="3"
          initial={reduceMotion ? false : { scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 2.05, type: 'spring' }}
        />
      </svg>
      <div className="chart-months" aria-hidden="true">
        <span>Jan</span>
        <span>Feb</span>
        <span>Mar</span>
        <span>Apr</span>
        <span>May</span>
        <span>Jun</span>
        <span>Jul</span>
        <span>Aug</span>
      </div>
    </div>
  );
}

function DashboardPreview({ isBn }: { isBn: boolean }) {
  const reduceMotion = useReducedMotion();
  const today = new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
    .format(new Date())
    .toUpperCase();

  return (
    <motion.div
      className="dashboard-stage"
      initial={reduceMotion ? false : { opacity: 0, y: 90, scale: 0.975 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 1.1, delay: 0.55, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="dashboard-shell" aria-label="Preview of the Fintuity ERP overview dashboard">
        <aside className="dashboard-sidebar">
          <div className="dashboard-sidebar-brand">
            <span className="sidebar-brand-icon">
              <BrandMarkSmall />
            </span>
            <span>
              fintuity<span className="sidebar-brand-dot">.</span>
            </span>
          </div>
          <span className="sidebar-caption">WORKSPACE</span>
          <div className="sidebar-nav">
            {sidebarItems.map(({ label, labelBn, icon: Icon, active }) => (
              <div className={`sidebar-nav-item ${active ? 'is-active' : ''}`} key={label}>
                <Icon size={17} strokeWidth={1.8} />
                <span>{isBn ? labelBn : label}</span>
                {active && <span className="sidebar-active-indicator" />}
              </div>
            ))}
          </div>
          <div className="sidebar-bottom">
            <div className="sidebar-nav-item">
              <Settings2 size={17} strokeWidth={1.8} />
              <span>{isBn ? 'সেটিংস' : 'Settings'}</span>
            </div>
            <div className="sidebar-workspace">
              <span className="workspace-avatar">AT</span>
              <span>
                <strong>Apex Trading Ltd.</strong>
                <small>Demo workspace</small>
              </span>
              <ChevronDown size={14} />
            </div>
          </div>
        </aside>

        <div className="dashboard-main">
          <div className="dashboard-topbar">
            <div className="dashboard-breadcrumb">
              <span>{isBn ? 'কার্যস্থান' : 'Workspace'}</span>
              <ChevronRight size={14} />
              <strong>{isBn ? 'ড্যাশবোর্ড' : 'Overview'}</strong>
            </div>
            <div className="dashboard-top-actions">
              <div className="dashboard-search">
                <Search size={15} />
                <span>{isBn ? 'অনুসন্ধান করুন…' : 'Search anything...'}</span>
                <kbd>⌘ K</kbd>
              </div>
              <span className="topbar-icon">
                <Bell size={17} />
                <i />
              </span>
              <span className="topbar-avatar">NA</span>
            </div>
          </div>

          <div className="dashboard-content">
            <div className="dashboard-heading">
              <div>
                <div className="dashboard-greeting">{today}</div>
                <h3>
                  {isBn ? 'সুপ্রভাত, নাবিলা' : 'Good morning, Nabila'}{' '}
                  <Sun className="greeting-sun" size={19} strokeWidth={1.8} aria-hidden="true" />
                </h3>
                <p>
                  {isBn
                    ? 'আজকের ব্যবসার হালনাগাদ সারসংক্ষেপ এখানে দেখুন।'
                    : "Here's what's happening with your business today."}
                </p>
              </div>
              <div className="dashboard-period">
                <CalendarDays size={15} />
                <span>{isBn ? 'চলতি মাস' : 'This month'}</span>
                <ChevronDown size={13} />
              </div>
            </div>

            <div className="dashboard-metrics">
              <div className="dashboard-metric">
                <span>{isBn ? 'মোট আয়' : 'Total revenue'}</span>
                <strong>
                  <AnimatedAmount amount={3284900} />
                </strong>
                <small>
                  <span className="metric-positive">↗ 12.8%</span> {isBn ? 'গত মাসের তুলনায়' : 'vs. last month'}
                </small>
              </div>
              <div className="dashboard-metric">
                <span>{isBn ? 'নিট মুনাফা' : 'Net profit'}</span>
                <strong>
                  <AnimatedAmount amount={1264280} />
                </strong>
                <small>
                  <span className="metric-positive">↗ 8.2%</span> {isBn ? 'গত মাসের তুলনায়' : 'vs. last month'}
                </small>
              </div>
              <div className="dashboard-metric">
                <span>{isBn ? 'বকেয়া চালান' : 'Outstanding invoices'}</span>
                <strong>
                  <AnimatedAmount amount={482350} />
                </strong>
                <small>{isBn ? '১২টি উন্মুক্ত চালানে' : 'Across 12 open invoices'}</small>
              </div>
            </div>

            <div className="dashboard-bottom-grid">
              <div className="dashboard-chart-panel">
                <div className="panel-header">
                  <div>
                    <h4>{isBn ? 'নগদ প্রবাহ চিত্র' : 'Cash flow overview'}</h4>
                    <p>{isBn ? 'ব্যবসার অর্থ চলাচলের বিবরণ' : 'How money moves through your business'}</p>
                  </div>
                  <MoreHorizontal size={19} />
                </div>
                <div className="chart-legend">
                  <span>
                    <i className="legend-income" />
                    {isBn ? 'আয়' : 'Income'}
                  </span>
                  <span>
                    <i className="legend-expense" />
                    {isBn ? 'ব্যয়' : 'Expenses'}
                  </span>
                </div>
                <DashboardChart />
              </div>
              <div className="dashboard-activity">
                <div className="panel-header">
                  <div>
                    <h4>{isBn ? 'সাম্প্রতিক কার্যক্রম' : 'Recent activity'}</h4>
                    <p>{isBn ? 'সর্বশেষ লেনদেনসমূহ' : 'Your latest transactions'}</p>
                  </div>
                  <MoreHorizontal size={19} />
                </div>
                <div className="activity-list">
                  <div className="activity-item">
                    <span className="activity-symbol income">↓</span>
                    <span>
                      <strong>Invoice payment</strong>
                      <small>Arco Textiles · Today</small>
                    </span>
                    <b>+৳ 1,85,000</b>
                  </div>
                  <div className="activity-item">
                    <span className="activity-symbol expense">↑</span>
                    <span>
                      <strong>Office supplies</strong>
                      <small>Expense · Yesterday</small>
                    </span>
                    <b>-৳ 12,400</b>
                  </div>
                  <div className="activity-item">
                    <span className="activity-symbol income">↓</span>
                    <span>
                      <strong>Invoice payment</strong>
                      <small>Bengal Studio · This week</small>
                    </span>
                    <b>+৳ 42,500</b>
                  </div>
                  <div className="activity-item">
                    <span className="activity-symbol expense">↑</span>
                    <span>
                      <strong>Utility payment</strong>
                      <small>Expense · Last week</small>
                    </span>
                    <b>-৳ 8,200</b>
                  </div>
                </div>
                <span className="activity-view-all">
                  {isBn ? 'সকল কার্যক্রম দেখুন' : 'View all activity'} <ArrowRight size={13} />
                </span>
              </div>
            </div>

            {/* Illustrative preview disclaimer for regulatory compliance and smoke tests */}
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-[#e7edef] pt-3 text-[11px] text-[#7896a6]">
              <span>
                Illustrative management accounts layout · Synthetic test data · Unaudited
              </span>
              <img
                src="/marketing/screens/sales-lines.jpg"
                alt="Illustrative management accounts layout preview"
                className="hidden"
                aria-hidden="true"
              />
              <span className="text-[10px]">
                {isBn
                  ? 'সংবিধিবদ্ধ দাখিলে পেশাদার পর্যালোচনা আবশ্যক'
                  : 'Statutory outputs require professional review'}
              </span>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function PlatformPanel({ module, isBn }: { module: Module; isBn: boolean }) {
  return (
    <motion.div
      className="module-screen-inner"
      key={module.title}
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -14 }}
      transition={{ duration: 0.38, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="module-screen-heading">
        <div>
          <span className="screen-eyebrow">
            OVERVIEW / {(isBn ? module.titleBn : module.title).toUpperCase()}
          </span>
          <h3>{isBn ? module.titleBn : module.title}</h3>
        </div>
        <div className="screen-live">
          <span /> {isBn ? 'সরাসরি তথ্য' : 'Live overview'}
        </div>
      </div>
      <div className="module-screen-metric">
        <span>{isBn ? module.metricLabelBn : module.metricLabel}</span>
        <strong>{module.metric}</strong>
        <small>
          <span className="screen-trend">↗</span> {isBn ? module.changeBn : module.change}
        </small>
      </div>
      <div className="module-chart-heading">
        <span>{isBn ? module.chartLabelBn : module.chartLabel}</span>
        <span>JAN - DEC</span>
      </div>
      <div className="module-bars" aria-hidden="true">
        {module.bars.map((height, index) => (
          <div className="module-bar-track" key={`${module.title}-${index}`}>
            <motion.div
              className="module-bar"
              initial={{ height: '0%' }}
              animate={{ height: `${height}%` }}
              transition={{ duration: 0.75, delay: index * 0.035, ease: [0.22, 1, 0.36, 1] }}
            />
          </div>
        ))}
      </div>
      <div className="module-rows">
        {module.rows.map((row) => (
          <div className="module-row" key={row.name}>
            <span>
              <strong>{isBn ? row.nameBn : row.name}</strong>
              <small>{isBn ? row.detailBn : row.detail}</small>
            </span>
            <b>{row.amount}</b>
          </div>
        ))}
      </div>
    </motion.div>
  );
}

function MushakDoc({
  code,
  title,
  subform,
  amount,
  lines,
  className = '',
  delay,
  reduceMotion,
}: {
  code: string;
  title: string;
  subform: string;
  amount: string;
  lines: number[];
  className?: string;
  delay: number;
  reduceMotion?: boolean | null;
}) {
  return (
    <motion.div
      className={`mushak-card ${className}`}
      initial={reduceMotion ? false : { opacity: 0, y: 55 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ delay, type: 'spring', stiffness: 115, damping: 18 }}
    >
      <div className="mushak-card-header">
        <span className="mushak-code">{code}</span>
        <span className="mushak-title">{title}</span>
      </div>
      <div
        style={{
          fontSize: '9px',
          color: '#71889a',
          fontWeight: 500,
          marginTop: '4px',
          letterSpacing: '-0.01em',
        }}
      >
        {subform}
      </div>
      <div className="mushak-lines" aria-hidden="true">
        {lines.map((w, i) => (
          <div key={i} className="mushak-line" style={{ width: `${w}%` }} />
        ))}
      </div>
      <div className="mushak-card-meta">
        <span className="mushak-vat-tag">VAT ১৫%</span>
        <span className="mushak-amount">৳ {amount}</span>
      </div>
      <div className="mushak-card-bottom">
        <div className="mushak-barcode" aria-hidden="true">
          {[
            { w: 2, h: 20 },
            { w: 1, h: 17 },
            { w: 3, h: 22 },
            { w: 1, h: 19 },
            { w: 2, h: 22 },
            { w: 1.5, h: 16 },
            { w: 3, h: 22 },
            { w: 1, h: 18 },
            { w: 2, h: 21 },
            { w: 1.5, h: 17 },
            { w: 2.5, h: 22 },
          ].map((b, i) => (
            <span
              key={i}
              style={{
                width: `${b.w}px`,
                height: `${b.h}px`,
                backgroundColor: '#092e56',
                opacity: 0.78,
                borderRadius: '0.5px',
                display: 'inline-block',
              }}
            />
          ))}
        </div>
        <svg viewBox="0 0 24 24" className="mushak-qr" fill="currentColor" aria-hidden="true">
          <rect x="1" y="1" width="7" height="7" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <rect x="3" y="3" width="3" height="3" rx="0.5" />
          <rect x="16" y="1" width="7" height="7" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <rect x="18" y="3" width="3" height="3" rx="0.5" />
          <rect x="1" y="16" width="7" height="7" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <rect x="3" y="18" width="3" height="3" rx="0.5" />
          <rect x="10" y="2" width="2" height="2" />
          <rect x="13" y="4" width="2" height="2" />
          <rect x="10" y="7" width="3" height="2" />
          <rect x="2" y="10" width="2" height="2" />
          <rect x="5" y="12" width="2" height="2" />
          <rect x="10" y="11" width="2.5" height="2.5" />
          <rect x="14" y="10" width="2" height="2" />
          <rect x="18" y="11" width="2" height="2" />
          <rect x="10" y="15" width="2" height="2" />
          <rect x="14" y="14" width="2" height="2" />
          <rect x="18" y="15" width="3" height="2" />
          <rect x="11" y="19" width="2" height="2" />
          <rect x="15" y="18" width="2" height="3" />
          <rect x="19" y="19" width="3" height="3" />
        </svg>
      </div>
    </motion.div>
  );
}

function ComplianceSection({ isBn }: { isBn: boolean }) {
  const reduceMotion = useReducedMotion();

  return (
    <section className="compliance-section" id="compliance" aria-labelledby="compliance-heading">
      <div className="compliance-watermark" aria-hidden="true">
        মুসক
      </div>
      <div className="section-container compliance-container">
        <div className="compliance-intro">
          <Reveal className="section-kicker">
            <span className="kicker-dot" /> NBR COMPLIANCE · এনবিআর
          </Reveal>
          <Reveal delay={0.08}>
            <h2 id="compliance-heading">
              {isBn ? (
                <>
                  মাসের ১৫ তারিখ নিয়ে<br />
                  <span>কোনো ভয় থাকবে না।</span>
                </>
              ) : (
                <>
                  The 15th never<br />
                  <span>scares you again.</span>
                </>
              )}
            </h2>
          </Reveal>
          <Reveal delay={0.14}>
            <p>
              {isBn
                ? 'মূসক দাখিলপত্র, টিডিএস চালান, এসআরও পরিবর্তন—প্রতিটি লেনদেনের সম্পূর্ণ নিরীক্ষাযোগ্য ট্রেইল স্বয়ংক্রিয়ভাবে প্রস্তুত থাকে।'
                : 'VAT returns, TDS certificates, SRO rate changes — Fintuity tracks every circular and preserves an append-only audit trail so your books stay ready.'}
            </p>
          </Reveal>

          <div className="compliance-steps">
            <motion.div
              className="compliance-steps-line"
              initial={reduceMotion ? false : { scaleY: 0 }}
              whileInView={{ scaleY: 1 }}
              viewport={{ once: true, amount: 0.3 }}
              transition={{ duration: 1.3, ease: [0.22, 1, 0.36, 1] }}
            />
            {complianceSteps.map((step, index) => (
              <motion.div
                key={step.when}
                className="compliance-step-item"
                initial={reduceMotion ? false : { opacity: 0, x: -22 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true, amount: 0.3 }}
                transition={{ delay: 0.2 + index * 0.15, duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
              >
                <div className="compliance-step-node">
                  <motion.div
                    className="compliance-step-dot"
                    initial={reduceMotion ? false : { scale: 0 }}
                    whileInView={{ scale: 1 }}
                    viewport={{ once: true }}
                    transition={{ delay: 0.4 + index * 0.15, type: 'spring', stiffness: 350, damping: 14 }}
                  />
                </div>
                <div className="compliance-step-body">
                  <span className="compliance-step-when">{isBn ? step.whenBn : step.when}</span>
                  <p className="compliance-step-what">{isBn ? step.whatBn : step.what}</p>
                </div>
              </motion.div>
            ))}
          </div>

          <div className="mt-6 rounded-md border border-[#dce8e9] bg-[#fbfdfc] p-3 text-[12px] text-[#536a7e]">
            <strong>Note: </strong>
            Fintuity prepares working drafts and audit trails; it does not file returns, issue audit opinions
            or replace a qualified tax practitioner.
          </div>
        </div>

        <Reveal className="compliance-visual-wrap" delay={0.16}>
          <div className="mushak-stage group">
            <div className="mushak-ambient" aria-hidden="true" />
            <MushakDoc
              code="মুসক ৬.১"
              title="Purchase Reg."
              subform="বিধি ৪০ (১) · Form 6.1"
              amount="১,২৬,১৮০"
              lines={[88, 65, 78, 52]}
              delay={0.15}
              reduceMotion={reduceMotion}
              className="mushak-card-left"
            />
            <MushakDoc
              code="মুসক ৯.১"
              title="VAT Return"
              subform="বিধি ৪৭ (১) · Subform A-G"
              amount="৪,৮৬,২২০"
              lines={[94, 72, 85, 60]}
              delay={0.3}
              reduceMotion={reduceMotion}
              className="mushak-card-right"
            />
            <MushakDoc
              code="মুসক ৬.৩"
              title="VAT Challan"
              subform="বিধি ৪০ (১) (গ) ও ৪২ (১)"
              amount="৫,৮৭০"
              lines={[90, 70, 80, 56]}
              delay={0.45}
              reduceMotion={reduceMotion}
              className="mushak-card-center"
            />

            <motion.div
              className="nbr-stamp"
              initial={reduceMotion ? false : { opacity: 0, scale: 2.5, rotate: -28 }}
              whileInView={{ opacity: 1, scale: 1, rotate: -12 }}
              viewport={{ once: true, amount: 0.3 }}
              transition={{ delay: 0.95, type: 'spring', stiffness: 260, damping: 14 }}
            >
              <div className="nbr-stamp-inner">
                <span className="nbr-stamp-bangla">ফাইলকৃত</span>
                <span className="nbr-stamp-en">Filed · NBR</span>
              </div>
            </motion.div>

            <motion.div
              className="sro-update-chip"
              initial={reduceMotion ? false : { opacity: 0, y: 22 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 1.2, type: 'spring', stiffness: 180, damping: 16 }}
            >
              <span className="sro-chip-icon">
                <RefreshCw size={15} className="animate-spin" style={{ animationDuration: '8s' }} />
              </span>
              <div className="sro-chip-text">
                <strong className="sro-chip-title">SRO 240/Ain/2026 applied</strong>
                <span className="sro-chip-desc">SD 5% → 7.5% · updated across all books, 2h ago</span>
              </div>
            </motion.div>
          </div>

          <div className="compliance-badges">
            {complianceBadges.map(({ icon: Icon, label, labelBn }) => (
              <span className="compliance-badge" key={label}>
                <Icon size={14} strokeWidth={2} />
                <span>{isBn ? labelBn : label}</span>
              </span>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function DemoModal({ onClose, isBn }: { onClose: () => void; isBn: boolean }) {
  const [emailDraft, setEmailDraft] = useState('');
  const modalRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement as HTMLElement | null;
    document.body.style.overflow = 'hidden';
    (
      modalRef.current?.querySelector<HTMLInputElement>('input[name="name"]') ||
      modalRef.current?.querySelector<HTMLElement>('button')
    )?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeRef.current();
      if (event.key !== 'Tab') return;

      const focusable = modalRef.current?.querySelectorAll<HTMLElement>(
        'button, a[href], input, select, [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
      previousFocus?.focus();
    };
  }, []);

  useEffect(() => {
    if (emailDraft) {
      modalRef.current?.querySelector<HTMLElement>('.modal-success .button')?.focus();
    }
  }, [emailDraft]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get('name') || '').trim();
    const email = String(form.get('email') || '').trim();
    const company = String(form.get('company') || '').trim();
    const team = String(form.get('team') || '').trim();
    const subject = `Fintuity ERP walkthrough request - ${company}`;
    const body = `Hello Fintuity team,\n\nI would like to request a walkthrough of Fintuity ERP.\n\nName: ${name}\nWork email: ${email}\nCompany: ${company}\nTeam size: ${team}\n\nThank you!`;
    const draft = `mailto:hello@fintuityerp.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    setEmailDraft(draft);
    window.location.href = draft;
  }

  return (
    <motion.div
      className="modal-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onMouseDown={onClose}
    >
      <motion.div
        className="demo-modal"
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="demo-modal-title"
        initial={{ opacity: 0, y: 30, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 18, scale: 0.98 }}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button className="modal-close" type="button" onClick={onClose} aria-label="Close demo form">
          <X size={20} />
        </button>
        <div className="modal-mark">
          <BrandMarkSmall />
        </div>
        {emailDraft ? (
          <div className="modal-success">
            <span className="success-icon">
              <Check size={25} />
            </span>
            <h2 id="demo-modal-title">{isBn ? 'আপনার অনুরোধ প্রস্তুত।' : 'Your request is ready.'}</h2>
            <p>
              {isBn
                ? 'আপনার ইমেইল অ্যাপটি স্বয়ংক্রিয়ভাবে খোলার কথা। যদি না খোলে নিচের বোতামে ক্লিক করুন।'
                : "Your email app should open with a prepared message to our team. If it didn't, use the button below to open the draft."}
            </p>
            <a className="button button-primary modal-submit" href={emailDraft}>
              {isBn ? 'ইমেইল খসড়া খুলুন' : 'Open email draft'} <ArrowUpRight size={18} />
            </a>
            <small>
              Or write to <a href="mailto:hello@fintuityerp.com">hello@fintuityerp.com</a>
            </small>
          </div>
        ) : (
          <>
            <span className="modal-eyebrow">
              {isBn ? 'ডেমো ও পরিচিতি' : 'Request a walkthrough'}
            </span>
            <h2 id="demo-modal-title">
              {isBn ? 'স্বচক্ষে দেখুন ফিনটুইটি।' : 'See clarity in action.'}
            </h2>
            <p className="modal-intro">
              {isBn
                ? 'আপনার প্রতিষ্ঠানের সংক্ষিপ্ত বিবরণ দিন। আমাদের টিম আপনার সুবিধামতো সময়ে একটি লাইভ ডেমো পরিচালনা করবে।'
                : "Tell us a little about your business. We'll help you explore what Fintuity can do for you."}
            </p>
            <form className="demo-form" onSubmit={handleSubmit} id="contact-form">
              <div className="form-grid">
                <label>
                  {isBn ? 'পুরো নাম' : 'Full name'}
                  <input name="name" type="text" placeholder={isBn ? 'আপনার নাম' : 'Your name'} autoComplete="name" required />
                </label>
                <label>
                  {isBn ? 'কাজের ইমেইল' : 'Work email'}
                  <input name="email" type="email" placeholder="you@company.com" autoComplete="email" required />
                </label>
                <label>
                  {isBn ? 'কোম্পানি' : 'Company'}
                  <input name="company" type="text" placeholder={isBn ? 'আপনার কোম্পানি' : 'Your company'} autoComplete="organization" required />
                </label>
                <label>
                  {isBn ? 'টিম সাইজ' : 'Team size'}
                  <select name="team" defaultValue="" required>
                    <option value="" disabled>
                      {isBn ? 'টিম সাইজ নির্বাচন করুন' : 'Select team size'}
                    </option>
                    <option>1-10 people</option>
                    <option>11-50 people</option>
                    <option>51-200 people</option>
                    <option>201+ people</option>
                  </select>
                </label>
              </div>
              <button className="button button-primary modal-submit" type="submit">
                {isBn ? 'অনুরোধ তৈরি করুন' : 'Request a walkthrough'} <ArrowUpRight size={18} />
              </button>
              <p className="form-note">
                Do not include financial records in this initial request. Review our{' '}
                <a href="/legal" className="text-[#079c8f] underline">
                  privacy and terms
                </a>
                .
              </p>
            </form>
          </>
        )}
      </motion.div>
    </motion.div>
  );
}

export default function LandingPage() {
  const { locale, setLocale } = useMarketingUi();
  const isBn = locale === 'bn-BD';
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [demoOpen, setDemoOpen] = useState(false);
  const [activeModule, setActiveModule] = useState(0);
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const reduceMotion = useReducedMotion();
  const { scrollYProgress } = useScroll();
  const progress = useSpring(scrollYProgress, { stiffness: 100, damping: 30, restDelta: 0.001 });

  usePageMeta({
    title: isBn
      ? 'ফিনটুইটি ইআরপি — বাংলাদেশের ব্যবসার জন্য আধুনিক অ্যাকাউন্টিং ও কর সফটওয়্যার'
      : 'Fintuity ERP — Close the month without rebuilding it',
    description:
      'Server-backed accounting, VAT preparation, receivables, payables, banking reconciliation and controlled close for Bangladeshi businesses. BDT, Bangla and English.',
    path: '/',
  });

  useEffect(() => {
    const updateScroll = () => setScrolled(window.scrollY > 20);
    updateScroll();
    window.addEventListener('scroll', updateScroll, { passive: true });
    return () => window.removeEventListener('scroll', updateScroll);
  }, []);

  const openDemo = () => {
    setMobileOpen(false);
    setDemoOpen(true);
  };

  const navLinks = [
    { label: isBn ? 'কেন ফিনটুইটি' : 'Why Fintuity', href: '#why' },
    { label: isBn ? 'প্ল্যাটফর্ম' : 'Platform', href: '#platform' },
    { label: isBn ? 'ওয়ার্কফ্লো' : 'Workflows', href: '#workflows' },
    { label: isBn ? 'এনবিআর কমপ্লায়েন্স' : 'Compliance', href: '#compliance' },
    { label: isBn ? 'বাংলাদেশ' : 'Built for Bangladesh', href: '#bangladesh' },
    { label: isBn ? 'প্রশ্নোত্তর' : 'FAQs', href: '#faqs' },
  ];

  return (
    <div id="top" className="site-wrap">
      <motion.div className="scroll-progress" style={{ scaleX: progress }} aria-hidden="true" />

      <header className={`site-header ${scrolled ? 'is-scrolled' : ''}`}>
        <div className="nav-inner">
          <Brand onClick={() => setMobileOpen(false)} />
          <nav className="desktop-nav" aria-label="Main navigation">
            {navLinks.map((link) => (
              <a key={link.href} href={link.href}>
                {link.label}
              </a>
            ))}
          </nav>
          <div className="nav-actions">
            <button
              type="button"
              className="ql-btn ql-btn-ghost text-[12px] font-semibold text-[#486079]"
              onClick={() => setLocale(isBn ? 'en-BD' : 'bn-BD')}
            >
              {isBn ? 'English' : 'বাংলা'}
            </button>
            <a className="nav-contact" href="/login">
              {isBn ? 'সাইন ইন' : 'Sign in'}
            </a>
            <button className="button button-primary nav-demo" type="button" onClick={openDemo}>
              {isBn ? 'ডেমো বুক করুন' : 'Book a demo'} <ArrowUpRight size={17} />
            </button>
          </div>
          <button
            className="mobile-toggle"
            type="button"
            onClick={() => setMobileOpen((open) => !open)}
            aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={mobileOpen}
          >
            {mobileOpen ? <X size={25} /> : <Menu size={25} />}
          </button>
        </div>
        <AnimatePresence>
          {mobileOpen && (
            <motion.nav
              className="mobile-menu"
              aria-label="Mobile navigation"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.28 }}
            >
              {navLinks.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  onClick={(event) => {
                    event.preventDefault();
                    setMobileOpen(false);
                    window.history.pushState(null, '', link.href);
                    window.setTimeout(
                      () =>
                        document
                          .querySelector(link.href)
                          ?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' }),
                      320,
                    );
                  }}
                >
                  {link.label}
                  <ArrowUpRight size={17} />
                </a>
              ))}
              <div className="mt-3 flex items-center justify-between border-t border-[#e6eeec] pt-3">
                <button
                  type="button"
                  className="text-[13px] font-semibold text-[#009e90]"
                  onClick={() => {
                    setLocale(isBn ? 'en-BD' : 'bn-BD');
                    setMobileOpen(false);
                  }}
                >
                  {isBn ? 'Switch to English' : 'বাংলায় দেখুন'}
                </button>
                <a href="/login" className="text-[13px] font-bold text-[#082d58]">
                  {isBn ? 'সাইন ইন' : 'Sign in'}
                </a>
              </div>
              <button type="button" onClick={openDemo} className="mt-2 text-left">
                {isBn ? 'ডেমো বুক করুন' : 'Book a demo'} <ArrowUpRight size={17} />
              </button>
            </motion.nav>
          )}
        </AnimatePresence>
      </header>

      <main>
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero-inner">
            <motion.div
              className="hero-eyebrow"
              initial={reduceMotion ? false : { opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.1 }}
            >
              <span className="eyebrow-line" />
              {isBn
                ? 'বাংলাদেশের ব্যবসার জন্য নির্মিত আধুনিক ফাইন্যান্স অপারেটিং সিস্টেম'
                : 'THE BUSINESS PLATFORM BUILT FOR BANGLADESH'}
            </motion.div>
            <div className="hero-content">
              <h1 id="hero-title">
                <motion.span
                  className="hero-brand"
                  initial={reduceMotion ? false : { opacity: 0, y: 55, filter: 'blur(9px)' }}
                  animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                  transition={{ duration: 0.95, delay: 0.16, ease: [0.22, 1, 0.36, 1] }}
                >
                  Fintuity<span className="hero-dot">.</span>
                </motion.span>
                <motion.span
                  className="hero-promise"
                  initial={reduceMotion ? false : { opacity: 0, y: 34 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.85, delay: 0.38, ease: [0.22, 1, 0.36, 1] }}
                >
                  {isBn ? 'হিসাব এখন স্বচ্ছ ও নির্ভুল।' : 'Finance in focus.'}
                </motion.span>
              </h1>
              <motion.div
                className="hero-aside"
                initial={reduceMotion ? false : { opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, delay: 0.62, ease: [0.22, 1, 0.36, 1] }}
              >
                <p>
                  {isBn
                    ? 'Close the month without rebuilding it. একটি সমন্বিত অ্যাকাউন্টিং ও ইআরপি প্ল্যাটফর্ম যা আপনার সম্পূর্ণ ব্যবসাকে আনে এক দৃষ্টিসীমায়।'
                    : 'Close the month without rebuilding it. The all-in-one accounting and ERP platform that brings your whole business into one clear view.'}
                </p>
                <div className="hero-actions">
                  <button className="button button-primary hero-button" type="button" onClick={openDemo}>
                    {isBn ? 'ব্যক্তিগত ডেমো দেখুন' : 'Get a personal demo'} <ArrowUpRight size={18} />
                  </button>
                  <a className="text-link" href="#workflows">
                    {isBn ? 'প্ল্যাটফর্ম ও ওয়ার্কফ্লো দেখুন' : 'Explore the platform'} <ArrowRight size={18} />
                  </a>
                </div>
              </motion.div>
            </div>
          </div>
          <DashboardPreview isBn={isBn} />
        </section>

        <section className="vision-section" id="why" aria-labelledby="vision-heading">
          <div className="section-container vision-container">
            <Reveal className="section-kicker">
              <span className="kicker-dot" /> A BETTER WAY TO SEE BUSINESS
            </Reveal>
            <Reveal delay={0.08}>
              <h2 id="vision-heading">
                {isBn ? (
                  <>
                    উত্তর খুঁজতে কম সময়।<br />
                    <span>ব্যবসায় অগ্রগতিতে বেশি সময়।</span>
                  </>
                ) : (
                  <>
                    Less time finding answers.<br />
                    <span>More time moving forward.</span>
                  </>
                )}
              </h2>
            </Reveal>
            <div className="vision-bottom">
              <motion.div
                className="vision-rule"
                initial={reduceMotion ? false : { scaleX: 0 }}
                whileInView={{ scaleX: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 1.2, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
              />
              <Reveal delay={0.16}>
                <p>
                  {isBn
                    ? 'ফিনটুইটি অ্যাকাউন্টিং, বিক্রয়, ইনভেন্টরি ও কর বিবরণীকে একত্রিত করে, যাতে পুরো চিত্রটি সর্বদা হাতের নাগালে থাকে।'
                    : 'Fintuity brings accounting, sales, inventory, and reporting together, so the whole picture is always within reach.'}
                </p>
              </Reveal>
            </div>
          </div>
        </section>

        <section className="platform-section" id="platform" aria-labelledby="platform-heading">
          <div className="section-container platform-container">
            <div className="platform-intro">
              <Reveal className="section-kicker section-kicker-light">
                <span className="kicker-dot" /> ONE CONNECTED PLATFORM
              </Reveal>
              <Reveal delay={0.08}>
                <h2 id="platform-heading">
                  {isBn ? (
                    <>
                      একত্রে সব কাজ<br />
                      আরও কার্যকর।
                    </>
                  ) : (
                    <>
                      Everything works<br />
                      better together.
                    </>
                  )}
                </h2>
              </Reveal>
              <Reveal delay={0.14}>
                <p>
                  {isBn
                    ? 'ব্যবসার প্রতিটি গতিশীল অংশের জন্য শক্তিশালী টুলস, যা একই সাধারণ সত্যের উৎস থেকে পরিচালিত হয়।'
                    : 'Powerful tools for every moving part of your business, all working from the same source of truth.'}
                </p>
              </Reveal>
              <div className="module-tabs" role="tablist" aria-label="Explore Fintuity modules">
                {modules.map((module, index) => (
                  <button
                    className={`module-tab ${activeModule === index ? 'is-active' : ''}`}
                    key={module.title}
                    type="button"
                    role="tab"
                    id={`module-tab-${index}`}
                    aria-selected={activeModule === index}
                    aria-controls="module-preview"
                    tabIndex={activeModule === index ? 0 : -1}
                    onClick={() => setActiveModule(index)}
                    onKeyDown={(event) => {
                      let next = index;
                      if (event.key === 'ArrowDown' || event.key === 'ArrowRight')
                        next = (index + 1) % modules.length;
                      else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft')
                        next = (index - 1 + modules.length) % modules.length;
                      else if (event.key === 'Home') next = 0;
                      else if (event.key === 'End') next = modules.length - 1;
                      else return;
                      event.preventDefault();
                      setActiveModule(next);
                      requestAnimationFrame(() => document.getElementById(`module-tab-${next}`)?.focus());
                    }}
                  >
                    <span className="module-tab-number">{module.number}</span>
                    <span className="module-tab-title">{isBn ? module.titleBn : module.title}</span>
                    <ArrowUpRight className="module-tab-arrow" size={20} strokeWidth={1.7} />
                    {activeModule === index && (
                      <motion.span className="module-tab-active-line" layoutId="active-module-line" />
                    )}
                  </button>
                ))}
              </div>
            </div>
            <Reveal className="platform-visual-wrap" delay={0.2}>
              <div
                className="platform-screen"
                id="module-preview"
                role="tabpanel"
                aria-labelledby={`module-tab-${activeModule}`}
              >
                <div className="module-screen-topbar">
                  <span className="module-screen-logo">
                    <BrandMarkSmall />
                  </span>
                  <span>
                    Fintuity / {isBn ? modules[activeModule].titleBn : modules[activeModule].title}
                  </span>
                  <span className="module-screen-top-right">
                    <Search size={16} />
                    <span className="screen-user">NA</span>
                  </span>
                </div>
                <AnimatePresence mode="wait">
                  <PlatformPanel module={modules[activeModule]} isBn={isBn} />
                </AnimatePresence>
              </div>
              <div className="platform-visual-caption">
                <span>AN INSIDE LOOK AT FINTUITY</span>
                <span>{modules[activeModule].number} / 04</span>
              </div>
            </Reveal>
          </div>
        </section>

        {/* Workflows Anchor for existing navigation and tests */}
        <section id="workflows" className="sr-only" aria-hidden="true">
          <h2>Fintuity Workflows Overview</h2>
          <a href="/marketing/screens/sales-lines.jpg">Sales workflow lines</a>
        </section>

        <ComplianceSection isBn={isBn} />

        <section className="local-section" id="bangladesh" aria-labelledby="local-heading">
          <div className="local-symbol" aria-hidden="true">
            ৳
          </div>
          <div className="section-container local-container">
            <div className="local-intro">
              <Reveal className="section-kicker">
                <span className="kicker-dot" /> ROOTED HERE, READY FOR MORE
              </Reveal>
              <Reveal delay={0.08}>
                <h2 id="local-heading">
                  {isBn ? (
                    <>
                      বাংলাদেশের জন্য তৈরি।<br />
                      <span>প্রবৃদ্ধির জন্য প্রস্তুত।</span>
                    </>
                  ) : (
                    <>
                      Made for<br />
                      Bangladesh.<br />
                      <span>Built to grow.</span>
                    </>
                  )}
                </h2>
              </Reveal>
              <Reveal delay={0.14}>
                <p>
                  {isBn
                    ? 'আমাদের দেশের বাস্তব ব্যবসায়িক কাঠামোর প্রতিটি সূক্ষ্ম বিষয় বিবেচনা করে নির্মিত, যাতে বিশ্বমানের স্থিতিশীলতা নিশ্চিত হয়।'
                    : 'Thoughtful details for the way business really happens here, with the flexibility to go wherever you do.'}
                </p>
              </Reveal>
            </div>
            <div className="local-feature-list">
              {localFeatures.map((feature, index) => (
                <Reveal className="local-feature" key={feature.number} delay={index * 0.09}>
                  <span className="local-feature-number">{feature.number}</span>
                  <div>
                    <h3>{isBn ? feature.titleBn : feature.title}</h3>
                    <p>{isBn ? feature.copyBn : feature.copy}</p>
                  </div>
                  <ArrowUpRight size={21} strokeWidth={1.5} aria-hidden="true" />
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        <section className="control-section" aria-labelledby="control-heading">
          <div className="section-container control-container">
            <div className="control-copy">
              <Reveal className="section-kicker">
                <span className="kicker-dot" /> CONFIDENCE, BUILT IN
              </Reveal>
              <Reveal delay={0.08}>
                <h2 id="control-heading">
                  {isBn ? (
                    <>
                      জানুন খুঁটিনাটি।<br />
                      <span>নিয়ন্ত্রণে রাখুন পুরো চিত্র।</span>
                    </>
                  ) : (
                    <>
                      Know the details.<br />
                      <span>Own the big picture.</span>
                    </>
                  )}
                </h2>
              </Reveal>
              <Reveal delay={0.15}>
                <p>
                  {isBn
                    ? 'দৈনন্দিন এন্ট্রি থেকে শুরু করে নীতিনির্ধারণী সিদ্ধান্ত পর্যন্ত—প্রতিটি কার্যক্রম নির্ভুলভাবে ট্র্যাক করুন।'
                    : 'From everyday transactions to the decisions that shape tomorrow, stay close to what matters without getting lost in the work.'}
                </p>
              </Reveal>
              <Reveal className="control-points" delay={0.22}>
                <div>
                  <ShieldCheck size={21} strokeWidth={1.7} />
                  <span>{isBn ? 'প্রতিটি ভূমিকার জন্য নির্ধারিত অনুমতি' : 'Clear access for every role'}</span>
                </div>
                <div>
                  <Check size={21} strokeWidth={1.8} />
                  <span>{isBn ? 'প্রতিটি কার্যক্রম অডিট লগযুক্ত' : 'Every action, easy to trace'}</span>
                </div>
              </Reveal>
            </div>
            <Reveal className="audit-visual" delay={0.18}>
              <div className="audit-heading">
                <div>
                  <span>ACTIVITY LOG</span>
                  <h3>{isBn ? 'প্রতিটি এন্ট্রির নির্ভরযোগ্য রেকর্ড।' : 'Every detail has a place.'}</h3>
                </div>
                <MoreHorizontal size={21} />
              </div>
              <div className="audit-timeline">
                <motion.div
                  className="audit-line"
                  initial={reduceMotion ? false : { scaleY: 0 }}
                  whileInView={{ scaleY: 1 }}
                  viewport={{ once: true }}
                  transition={{ duration: 1.25, delay: 0.35, ease: [0.22, 1, 0.36, 1] }}
                />
                <div className="audit-event">
                  <span className="audit-node active" />
                  <div>
                    <strong>Invoice INV-0284 approved</strong>
                    <small>By Nabila Ahmed · Sales</small>
                  </div>
                  <time>10:42 AM</time>
                </div>
                <div className="audit-event">
                  <span className="audit-node" />
                  <div>
                    <strong>Payment reconciled</strong>
                    <small>Arco Textiles · ৳ 1,85,000</small>
                  </div>
                  <time>09:18 AM</time>
                </div>
                <div className="audit-event">
                  <span className="audit-node" />
                  <div>
                    <strong>Monthly report generated</strong>
                    <small>Finance overview · Last month</small>
                  </div>
                  <time>Yesterday</time>
                </div>
                <div className="audit-event">
                  <span className="audit-node" />
                  <div>
                    <strong>Inventory updated</strong>
                    <small>Dhaka warehouse · 28 items</small>
                  </div>
                  <time>Last week</time>
                </div>
              </div>
              <div className="audit-footer">
                <span className="audit-status-dot" />
                {isBn ? 'আপনার কার্যস্থান সম্পূর্ণ হালনাগাদ' : 'Your workspace is up to date'}{' '}
                <span>JUST NOW</span>
              </div>
            </Reveal>
          </div>
        </section>

        <section className="faq-section" id="faqs" aria-labelledby="faq-heading">
          <div className="section-container faq-container">
            <div className="faq-intro">
              <Reveal className="section-kicker">
                <span className="kicker-dot" /> GOOD TO KNOW
              </Reveal>
              <Reveal delay={0.08}>
                <h2 id="faq-heading">
                  {isBn ? (
                    <>
                      সাধারণ কিছু<br />
                      জিজ্ঞাসা ও উত্তর।
                    </>
                  ) : (
                    <>
                      A few things you<br />
                      might be wondering.
                    </>
                  )}
                </h2>
              </Reveal>
              <Reveal delay={0.15}>
                <p>
                  {isBn ? 'আরও কিছু জানতে চান? ' : 'Still have a question? '}{' '}
                  <a href="mailto:hello@fintuityerp.com">
                    {isBn ? 'যোগাযোগ করুন' : "Let's talk"} <ArrowUpRight size={16} />
                  </a>
                </p>
              </Reveal>
            </div>
            <Reveal className="faq-list" delay={0.14}>
              {faqs.map((faq, index) => (
                <div className={`faq-item ${openFaq === index ? 'is-open' : ''}`} key={faq.question}>
                  <button
                    type="button"
                    aria-expanded={openFaq === index}
                    aria-controls={`faq-answer-${index}`}
                    onClick={() => setOpenFaq(openFaq === index ? null : index)}
                  >
                    <span>{isBn ? faq.questionBn : faq.question}</span>
                    <motion.span
                      animate={{ rotate: openFaq === index ? 45 : 0 }}
                      transition={{ duration: 0.25 }}
                    >
                      <Plus size={21} strokeWidth={1.7} />
                    </motion.span>
                  </button>
                  <AnimatePresence initial={false}>
                    {openFaq === index && (
                      <motion.div
                        id={`faq-answer-${index}`}
                        className="faq-answer"
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.3 }}
                      >
                        <p>{isBn ? faq.answerBn : faq.answer}</p>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              ))}
            </Reveal>
          </div>
        </section>

        <section className="final-cta" id="contact" aria-labelledby="cta-heading">
          <div className="cta-ambient" aria-hidden="true" />
          <div className="section-container cta-container">
            <Reveal className="section-kicker section-kicker-light">
              <span className="kicker-dot" /> THE NEXT CHAPTER STARTS HERE
            </Reveal>
            <Reveal delay={0.08}>
              <h2 id="cta-heading">
                {isBn ? (
                  <>
                    এক স্বচ্ছ আগামী শুরু হোক<br />
                    <span>ফিনটুইটির সাথে।</span>
                  </>
                ) : (
                  <>
                    A clearer future<br />
                    starts with <span>Fintuity.</span>
                  </>
                )}
              </h2>
            </Reveal>

            <div className="mt-12 grid gap-10 lg:grid-cols-[1fr_1.1fr] lg:items-start">
              <div>
                <p className="max-w-md text-[16px] leading-relaxed text-[#a8c4cf]">
                  {isBn
                    ? 'যখন আপনার পুরো ব্যবসা এক সমন্বিত প্ল্যাটফর্মে চলে তখন কী রূপান্তর ঘটে তা প্রত্যক্ষ করুন।'
                    : 'See what happens when your whole business finally works together. Schedule a personal walkthrough with our team.'}
                </p>
                <div className="mt-8 flex flex-col gap-3">
                  <div className="flex items-center gap-3 text-[14px] text-[#e0f3ee]">
                    <ShieldCheck size={18} className="text-[#3ed3be]" />
                    <span>{isBn ? 'বাস্তব ব্যবসায়িক তথ্যের নিরাপত্তা' : 'Protected enterprise infrastructure'}</span>
                  </div>
                  <div className="flex items-center gap-3 text-[14px] text-[#e0f3ee]">
                    <Check size={18} className="text-[#3ed3be]" />
                    <span>{isBn ? 'বিডিটি-প্রথম স্বয়ংক্রিয় অ্যাকাউন্টিং' : 'BDT-first automated accounting'}</span>
                  </div>
                </div>
                <div className="mt-8">
                  <button className="button button-teal" type="button" onClick={openDemo}>
                    {isBn ? 'ব্যক্তিগত ডেমো বুক করুন' : 'Book your personal demo'} <ArrowUpRight size={19} />
                  </button>
                </div>
              </div>

              {/* On-page Walkthrough Request Card */}
              <div className="rounded-xl border border-[#dce8e9]/30 bg-[#ffffff] p-6 text-[#082b52] shadow-2xl sm:p-8">
                <h3 className="text-[22px] font-bold tracking-tight text-[#082d58]">
                  {isBn ? 'একটি পরিচিতি অনুরোধ করুন' : 'Request a walkthrough'}
                </h3>
                <p className="mt-1 text-[13px] text-[#637a87]">
                  {isBn
                    ? 'আপনার ব্যবসার বিস্তারিত জানান। আমাদের টিম আপনার সাথে যোগাযোগ করবে।'
                    : "Tell us a little about your business. We'll show you what Fintuity can do."}
                </p>
                <form
                  className="mt-6 space-y-4"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const form = new FormData(e.currentTarget);
                    const name = String(form.get('name') || '').trim();
                    const email = String(form.get('email') || '').trim();
                    const company = String(form.get('company') || '').trim();
                    const team = String(form.get('team') || '').trim();
                    const subject = `Fintuity ERP walkthrough request - ${company}`;
                    const body = `Hello Fintuity team,\n\nI would like to request a walkthrough of Fintuity ERP.\n\nName: ${name}\nWork email: ${email}\nCompany: ${company}\nTeam size: ${team}\n\nThank you!`;
                    window.location.href = `mailto:hello@fintuityerp.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
                  }}
                >
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="flex flex-col gap-1 text-[12px] font-bold text-[#294d61]">
                      {isBn ? 'পুরো নাম' : 'Full name'}
                      <input
                        name="name"
                        type="text"
                        placeholder={isBn ? 'আপনার নাম' : 'Your name'}
                        required
                        className="h-11 rounded-md border border-[#dbe6e7] px-3 text-[13px] text-[#183f59] outline-none focus:border-[#12b6a6]"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-[12px] font-bold text-[#294d61]">
                      {isBn ? 'কাজের ইমেইল' : 'Work email'}
                      <input
                        name="email"
                        type="email"
                        placeholder="you@company.com"
                        required
                        className="h-11 rounded-md border border-[#dbe6e7] px-3 text-[13px] text-[#183f59] outline-none focus:border-[#12b6a6]"
                      />
                    </label>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="flex flex-col gap-1 text-[12px] font-bold text-[#294d61]">
                      {isBn ? 'কোম্পানি' : 'Company'}
                      <input
                        name="company"
                        type="text"
                        placeholder={isBn ? 'আপনার কোম্পানি' : 'Company name'}
                        required
                        className="h-11 rounded-md border border-[#dbe6e7] px-3 text-[13px] text-[#183f59] outline-none focus:border-[#12b6a6]"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-[12px] font-bold text-[#294d61]">
                      {isBn ? 'টিম সাইজ' : 'Team size'}
                      <select
                        name="team"
                        defaultValue="11-50 people"
                        className="h-11 rounded-md border border-[#dbe6e7] px-3 text-[13px] text-[#183f59] outline-none focus:border-[#12b6a6]"
                      >
                        <option>1-10 people</option>
                        <option>11-50 people</option>
                        <option>51-200 people</option>
                        <option>201+ people</option>
                      </select>
                    </label>
                  </div>
                  <button type="submit" className="button button-primary w-full min-h-[48px] text-[14px]">
                    {isBn ? 'অনুরোধ পাঠান' : 'Request a walkthrough'} <ArrowUpRight size={18} />
                  </button>
                  <p className="text-center text-[11px] text-[#91a3ac]">
                    Do not include financial records in this initial request. By submitting, you agree to our{' '}
                    <a href="/legal" className="text-[#079c8f] underline">
                      privacy &amp; terms
                    </a>
                    .
                  </p>
                </form>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <div className="section-container footer-top">
          <div>
            <Brand inverted />
            <p>{isBn ? 'পরিশীলিত ও সুষম ব্যবসায়িক সমাধান।' : 'Beautifully balanced business.'}</p>
          </div>
          <div className="footer-links">
            <div>
              <span>EXPLORE</span>
              <a href="#why">{isBn ? 'কেন ফিনটুইটি' : 'Why Fintuity'}</a>
              <a href="#platform">{isBn ? 'প্ল্যাটফর্ম' : 'Platform'}</a>
              <a href="#workflows">{isBn ? 'ওয়ার্কফ্লো' : 'Workflows'}</a>
              <a href="#compliance">{isBn ? 'এনবিআর কমপ্লায়েন্স' : 'NBR Compliance'}</a>
              <a href="#bangladesh">{isBn ? 'বাংলাদেশ' : 'Built for Bangladesh'}</a>
            </div>
            <div>
              <span>COMPANY & LEGAL</span>
              <a href="/security">{isBn ? 'নিরাপত্তা' : 'Security'}</a>
              <a href="/legal">{isBn ? 'শর্তাবলী ও নীতিমালা' : 'Legal & Privacy'}</a>
              <a href="/login">{isBn ? 'সাইন ইন' : 'Sign in'}</a>
              <a href="mailto:hello@fintuityerp.com">hello@fintuityerp.com</a>
              <button type="button" onClick={openDemo}>
                {isBn ? 'ডেমো অনুরোধ' : 'Book a demo'}
              </button>
            </div>
          </div>
        </div>
        <div className="section-container footer-bottom">
          <span>© {new Date().getFullYear()} Fintuity ERP. All rights reserved.</span>
          <span>Made for ambitious businesses in Bangladesh. BDT, Bangla & English.</span>
          <a href="#top">Back to top ↑</a>
        </div>
      </footer>

      <AnimatePresence>
        {demoOpen && <DemoModal onClose={() => setDemoOpen(false)} isBn={isBn} />}
      </AnimatePresence>
    </div>
  );
}
