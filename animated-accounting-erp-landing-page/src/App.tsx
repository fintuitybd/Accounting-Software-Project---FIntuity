import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  AnimatePresence,
  motion,
  useInView,
  useReducedMotion,
  useScroll,
  useSpring,
} from "framer-motion";
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
} from "lucide-react";

const navLinks = [
  { label: "Why Fintuity", href: "#why" },
  { label: "Platform", href: "#platform" },
  { label: "Compliance", href: "#compliance" },
  { label: "Built for Bangladesh", href: "#bangladesh" },
  { label: "FAQs", href: "#faqs" },
];

const sidebarItems: { label: string; icon: LucideIcon; active?: boolean }[] = [
  { label: "Overview", icon: LayoutDashboard, active: true },
  { label: "Accounting", icon: Wallet },
  { label: "Sales & invoices", icon: FileText },
  { label: "Purchases", icon: ShoppingBag },
  { label: "Inventory", icon: Package },
  { label: "Banking", icon: Landmark },
  { label: "Team", icon: Users },
];

type Module = {
  number: string;
  title: string;
  description: string;
  metricLabel: string;
  metric: string;
  change: string;
  chartLabel: string;
  bars: number[];
  rows: { name: string; detail: string; amount: string }[];
};

const modules: Module[] = [
  {
    number: "01",
    title: "Accounting",
    description: "A beautifully clear view of your books, cash flow, and financial health.",
    metricLabel: "Total balance",
    metric: "৳ 24,86,420",
    change: "+12.8% from last month",
    chartLabel: "Cash flow this year",
    bars: [43, 58, 48, 70, 62, 75, 68, 84, 76, 92, 82, 96],
    rows: [
      { name: "Bank reconciliation", detail: "Completed today", amount: "Reconciled" },
      { name: "Operating expenses", detail: "This month", amount: "৳ 4,24,800" },
      { name: "Accounts receivable", detail: "12 open invoices", amount: "৳ 6,18,300" },
    ],
  },
  {
    number: "02",
    title: "Sales & invoicing",
    description: "Create polished invoices, track payments, and keep every sale moving.",
    metricLabel: "Sales this month",
    metric: "৳ 18,42,500",
    change: "+18.4% from last month",
    chartLabel: "Monthly sales performance",
    bars: [31, 46, 42, 57, 51, 69, 61, 74, 71, 81, 77, 94],
    rows: [
      { name: "INV-0284 · Arco Textiles", detail: "Paid today", amount: "৳ 1,85,000" },
      { name: "INV-0283 · Northstar Ltd", detail: "Awaiting payment", amount: "৳ 84,000" },
      { name: "INV-0282 · Bengal Studio", detail: "Paid yesterday", amount: "৳ 42,500" },
    ],
  },
  {
    number: "03",
    title: "Inventory",
    description: "Know what you have, where it is, and what needs your attention next.",
    metricLabel: "Products in stock",
    metric: "1,248",
    change: "Across 3 locations",
    chartLabel: "Stock movement",
    bars: [63, 54, 69, 59, 75, 68, 81, 72, 86, 77, 89, 94],
    rows: [
      { name: "Cotton fabric · CT-102", detail: "Dhaka warehouse", amount: "320 units" },
      { name: "Packaging set · PK-024", detail: "Chattogram branch", amount: "186 units" },
      { name: "Office supplies · OS-018", detail: "Low stock alert", amount: "24 units" },
    ],
  },
  {
    number: "04",
    title: "VAT & reporting",
    description: "Keep records organized and turn everyday data into ready-to-use reports.",
    metricLabel: "Taxable sales",
    metric: "৳ 12,16,800",
    change: "Current reporting period",
    chartLabel: "Reporting overview",
    bars: [37, 48, 56, 51, 66, 59, 71, 78, 72, 84, 81, 92],
    rows: [
      { name: "Sales summary", detail: "Updated automatically", amount: "Ready" },
      { name: "Purchase register", detail: "Current period", amount: "Ready" },
      { name: "VAT working report", detail: "Last updated today", amount: "View report" },
    ],
  },
];

const complianceSteps = [
  {
    when: "Every sale",
    what: "Mushak 6.3 challan issued with QR & e-BIN validation",
  },
  {
    when: "7th of month",
    what: "e-TDS deposit certificate prepared from payroll & vendors",
  },
  {
    when: "15th of month",
    what: "Mushak 9.1 return compiled, reviewed, one-click filed",
  },
  {
    when: "Every SRO",
    what: "VAT & SD rates updated across all books within 24 hours",
  },
];

const complianceBadges = [
  { icon: ShieldCheck, label: "e-BIN validation" },
  { icon: QrCode, label: "QR challans" },
  { icon: FileSearch, label: "Full audit trail" },
];

const localFeatures = [
  {
    number: "01",
    title: "Taka comes naturally.",
    copy: "Work in BDT from day one, with a clear view of multi-currency transactions when business takes you further.",
  },
  {
    number: "02",
    title: "Stay ready for VAT.",
    copy: "Keep the records behind your VAT workflows organized, accessible, and easier to prepare for reporting.",
  },
  {
    number: "03",
    title: "Every branch, one picture.",
    copy: "Bring teams and locations together without losing sight of the details that make each one different.",
  },
];

const faqs = [
  {
    question: "Is Fintuity made for businesses in Bangladesh?",
    answer:
      "Yes. Fintuity is designed around the day-to-day needs of growing Bangladeshi businesses, with BDT-first workflows, organized VAT records, and visibility across branches.",
  },
  {
    question: "Can I manage more than one branch or location?",
    answer:
      "Yes. Keep an eye on activity across multiple branches from one workspace while maintaining a clear view of each location.",
  },
  {
    question: "What if our business currently uses spreadsheets?",
    answer:
      "That is a common starting point. A personal demo can walk your team through the right way to bring your existing processes and data into a more connected workspace.",
  },
  {
    question: "Does Fintuity help with VAT reporting?",
    answer:
      "Fintuity helps you keep transaction records and reporting information in one place, making preparation easier. Your tax advisor can guide you on the specific requirements for your business.",
  },
];

function Brand({ inverted = false, onClick }: { inverted?: boolean; onClick?: () => void }) {
  return (
    <a className={`brand-lockup ${inverted ? "brand-inverted" : ""}`} href="#top" onClick={onClick} aria-label="Fintuity ERP, back to top">
      <svg className="brand-mark" viewBox="0 0 80 80" fill="none" aria-hidden="true">
        <path
          d="M19.7 15.8C25.5 8.6 33.5 5 44.6 5H76C73.2 16.2 66.7 22.2 55.6 22.2H35.9C27.2 22.2 22.1 25.3 15.4 32.5L3.8 45.1L9.4 28.7C11.2 23.3 14.5 19.2 19.7 15.8Z"
          fill={inverted ? "#F4F9FB" : "#082D59"}
        />
        <path
          d="M27.4 31.8C33 26.8 38.5 24.4 46.8 24.4H72.3C69.8 36.3 62 43.4 49.7 43.4H7.1L27.4 31.8Z"
          fill="#00B9A8"
        />
        <path
          d="M11.1 43.4H34.9L1.5 76V64.8C1.5 55.6 4.6 48.6 11.1 43.4Z"
          fill={inverted ? "#F4F9FB" : "#082D59"}
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

function Reveal({ children, className = "", delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
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

  return <span ref={ref}>৳ {value.toLocaleString("en-IN")}</span>;
}

function DashboardChart() {
  const reduceMotion = useReducedMotion();
  const incomePath = "M0 170 C42 161 59 130 104 141 S167 169 212 123 S275 113 322 119 S390 75 438 85 S498 97 548 70 S613 78 664 40 S707 50 740 27";
  const expensePath = "M0 186 C52 172 70 184 110 171 S175 178 218 156 S275 170 325 151 S390 164 440 140 S501 155 549 129 S616 142 665 115 S710 126 740 104";

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
          transition={{ duration: 1.6, delay: 0.55, ease: "easeInOut" }}
        />
        <motion.path
          d={incomePath}
          fill="none"
          stroke="#05B8A8"
          strokeWidth="3.5"
          strokeLinecap="round"
          initial={reduceMotion ? false : { pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 1.8, delay: 0.35, ease: "easeInOut" }}
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
          transition={{ delay: 2.05, type: "spring" }}
        />
      </svg>
      <div className="chart-months" aria-hidden="true">
        <span>Jan</span><span>Feb</span><span>Mar</span><span>Apr</span><span>May</span><span>Jun</span><span>Jul</span><span>Aug</span>
      </div>
    </div>
  );
}

function DashboardPreview() {
  const reduceMotion = useReducedMotion();
  const today = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date()).toUpperCase();

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
            <span className="sidebar-brand-icon"><BrandMarkSmall /></span>
            <span>fintuity<span className="sidebar-brand-dot">.</span></span>
          </div>
          <span className="sidebar-caption">WORKSPACE</span>
          <div className="sidebar-nav">
            {sidebarItems.map(({ label, icon: Icon, active }) => (
              <div className={`sidebar-nav-item ${active ? "is-active" : ""}`} key={label}>
                <Icon size={17} strokeWidth={1.8} />
                <span>{label}</span>
                {active && <span className="sidebar-active-indicator" />}
              </div>
            ))}
          </div>
          <div className="sidebar-bottom">
            <div className="sidebar-nav-item"><Settings2 size={17} strokeWidth={1.8} /><span>Settings</span></div>
            <div className="sidebar-workspace">
              <span className="workspace-avatar">AT</span>
              <span><strong>Apex Trading Ltd.</strong><small>Demo workspace</small></span>
              <ChevronDown size={14} />
            </div>
          </div>
        </aside>

        <div className="dashboard-main">
          <div className="dashboard-topbar">
            <div className="dashboard-breadcrumb"><span>Workspace</span><ChevronRight size={14} /><strong>Overview</strong></div>
            <div className="dashboard-top-actions">
              <div className="dashboard-search"><Search size={15} /><span>Search anything...</span><kbd>⌘ K</kbd></div>
              <span className="topbar-icon"><Bell size={17} /><i /></span>
              <span className="topbar-avatar">NA</span>
            </div>
          </div>

          <div className="dashboard-content">
            <div className="dashboard-heading">
              <div>
                <div className="dashboard-greeting">{today}</div>
                <h3>Good morning, Nabila <Sun className="greeting-sun" size={19} strokeWidth={1.8} aria-hidden="true" /></h3>
                <p>Here's what's happening with your business today.</p>
              </div>
              <div className="dashboard-period"><CalendarDays size={15} /><span>This month</span><ChevronDown size={13} /></div>
            </div>

            <div className="dashboard-metrics">
              <div className="dashboard-metric">
                <span>Total revenue</span>
                <strong><AnimatedAmount amount={3284900} /></strong>
                <small><span className="metric-positive">↗ 12.8%</span> vs. last month</small>
              </div>
              <div className="dashboard-metric">
                <span>Net profit</span>
                <strong><AnimatedAmount amount={1264280} /></strong>
                <small><span className="metric-positive">↗ 8.2%</span> vs. last month</small>
              </div>
              <div className="dashboard-metric">
                <span>Outstanding invoices</span>
                <strong><AnimatedAmount amount={482350} /></strong>
                <small>Across <b>12</b> open invoices</small>
              </div>
            </div>

            <div className="dashboard-bottom-grid">
              <div className="dashboard-chart-panel">
                <div className="panel-header">
                  <div><h4>Cash flow overview</h4><p>How money moves through your business</p></div>
                  <MoreHorizontal size={19} />
                </div>
                <div className="chart-legend"><span><i className="legend-income" />Income</span><span><i className="legend-expense" />Expenses</span></div>
                <DashboardChart />
              </div>
              <div className="dashboard-activity">
                <div className="panel-header"><div><h4>Recent activity</h4><p>Your latest transactions</p></div><MoreHorizontal size={19} /></div>
                <div className="activity-list">
                  <div className="activity-item"><span className="activity-symbol income">↓</span><span><strong>Invoice payment</strong><small>Arco Textiles · Today</small></span><b>+৳ 1,85,000</b></div>
                  <div className="activity-item"><span className="activity-symbol expense">↑</span><span><strong>Office supplies</strong><small>Expense · Yesterday</small></span><b>-৳ 12,400</b></div>
                  <div className="activity-item"><span className="activity-symbol income">↓</span><span><strong>Invoice payment</strong><small>Bengal Studio · This week</small></span><b>+৳ 42,500</b></div>
                  <div className="activity-item"><span className="activity-symbol expense">↑</span><span><strong>Utility payment</strong><small>Expense · Last week</small></span><b>-৳ 8,200</b></div>
                </div>
                <span className="activity-view-all">View all activity <ArrowRight size={13} /></span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function BrandMarkSmall() {
  return (
    <svg viewBox="0 0 80 80" aria-hidden="true" fill="none">
      <path d="M19.7 15.8C25.5 8.6 33.5 5 44.6 5H76C73.2 16.2 66.7 22.2 55.6 22.2H35.9C27.2 22.2 22.1 25.3 15.4 32.5L3.8 45.1L9.4 28.7C11.2 23.3 14.5 19.2 19.7 15.8Z" fill="#F4F9FB" />
      <path d="M27.4 31.8C33 26.8 38.5 24.4 46.8 24.4H72.3C69.8 36.3 62 43.4 49.7 43.4H7.1L27.4 31.8Z" fill="#00B9A8" />
      <path d="M11.1 43.4H34.9L1.5 76V64.8C1.5 55.6 4.6 48.6 11.1 43.4Z" fill="#F4F9FB" />
    </svg>
  );
}

function PlatformPanel({ module }: { module: Module }) {
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
        <div><span className="screen-eyebrow">OVERVIEW / {module.title.toUpperCase()}</span><h3>{module.title}</h3></div>
        <div className="screen-live"><span /> Live overview</div>
      </div>
      <div className="module-screen-metric">
        <span>{module.metricLabel}</span>
        <strong>{module.metric}</strong>
        <small><span className="screen-trend">↗</span> {module.change}</small>
      </div>
      <div className="module-chart-heading"><span>{module.chartLabel}</span><span>JAN - DEC</span></div>
      <div className="module-bars" aria-hidden="true">
        {module.bars.map((height, index) => (
          <div className="module-bar-track" key={`${module.title}-${index}`}>
            <motion.div
              className="module-bar"
              initial={{ height: "0%" }}
              animate={{ height: `${height}%` }}
              transition={{ duration: 0.75, delay: index * 0.035, ease: [0.22, 1, 0.36, 1] }}
            />
          </div>
        ))}
      </div>
      <div className="module-rows">
        {module.rows.map((row) => (
          <div className="module-row" key={row.name}>
            <span><strong>{row.name}</strong><small>{row.detail}</small></span>
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
  className = "",
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
      transition={{ delay, type: "spring", stiffness: 115, damping: 18 }}
    >
      <div className="mushak-card-header">
        <span className="mushak-code">{code}</span>
        <span className="mushak-title">{title}</span>
      </div>
      <div style={{ fontSize: "9px", color: "#71889a", fontWeight: 500, marginTop: "4px", letterSpacing: "-0.01em" }}>
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
                backgroundColor: "#092e56",
                opacity: 0.78,
                borderRadius: "0.5px",
                display: "inline-block",
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

function ComplianceSection() {
  const reduceMotion = useReducedMotion();

  return (
    <section className="compliance-section" id="compliance" aria-labelledby="compliance-heading">
      <div className="compliance-watermark" aria-hidden="true">মুসক</div>
      <div className="section-container compliance-container">
        <div className="compliance-intro">
          <Reveal className="section-kicker">
            <span className="kicker-dot" /> NBR COMPLIANCE · এনবিআর
          </Reveal>
          <Reveal delay={0.08}>
            <h2 id="compliance-heading">
              The 15th never<br /><span>scares you again.</span>
            </h2>
          </Reveal>
          <Reveal delay={0.14}>
            <p>
              VAT returns, TDS certificates, SRO rate changes — Fintuity’s compliance desk tracks every NBR circular so
              your books are audit-ready before the deadline exists.
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
                    transition={{ delay: 0.4 + index * 0.15, type: "spring", stiffness: 350, damping: 14 }}
                  />
                </div>
                <div className="compliance-step-body">
                  <span className="compliance-step-when">{step.when}</span>
                  <p className="compliance-step-what">{step.what}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>

        <Reveal className="compliance-visual-wrap" delay={0.16}>
          <div className="mushak-stage group">
            <div className="mushak-ambient" aria-hidden="true" />
            <MushakDoc
              code="মুসক ৬.১"
              title="Purchase Reg."
              subform="বিধি ৪০ (১) · Form 6.1"
              amount="1,26,180"
              lines={[88, 65, 78, 52]}
              delay={0.15}
              reduceMotion={reduceMotion}
              className="mushak-card-left"
            />
            <MushakDoc
              code="মুসক ৯.১"
              title="VAT Return"
              subform="বিধি ৪৭ (১) · Subform A-G"
              amount="4,86,220"
              lines={[94, 72, 85, 60]}
              delay={0.3}
              reduceMotion={reduceMotion}
              className="mushak-card-right"
            />
            <MushakDoc
              code="মুসক ৬.৩"
              title="VAT Challan"
              subform="বিধি ৪০ (১) (গ) ও ৪২ (১)"
              amount="5,870"
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
              transition={{ delay: 0.95, type: "spring", stiffness: 260, damping: 14 }}
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
              transition={{ delay: 1.2, type: "spring", stiffness: 180, damping: 16 }}
            >
              <span className="sro-chip-icon">
                <RefreshCw size={15} className="animate-spin" style={{ animationDuration: "8s" }} />
              </span>
              <div className="sro-chip-text">
                <strong className="sro-chip-title">SRO 240/Ain/2026 applied</strong>
                <span className="sro-chip-desc">SD 5% → 7.5% · updated across all books, 2h ago</span>
              </div>
            </motion.div>
          </div>

          <div className="compliance-badges">
            {complianceBadges.map(({ icon: Icon, label }) => (
              <span className="compliance-badge" key={label}>
                <Icon size={14} strokeWidth={2} />
                <span>{label}</span>
              </span>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function DemoModal({ onClose }: { onClose: () => void }) {
  const [emailDraft, setEmailDraft] = useState("");
  const modalRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement as HTMLElement | null;
    document.body.style.overflow = "hidden";
    (modalRef.current?.querySelector<HTMLInputElement>('input[name="name"]') || modalRef.current?.querySelector<HTMLElement>("button"))?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeRef.current();
      if (event.key !== "Tab") return;

      const focusable = modalRef.current?.querySelectorAll<HTMLElement>('button, a[href], input, select, [tabindex]:not([tabindex="-1"])');
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
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
      previousFocus?.focus();
    };
  }, []);

  useEffect(() => {
    if (emailDraft) modalRef.current?.querySelector<HTMLElement>(".modal-success .button")?.focus();
  }, [emailDraft]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") || "").trim();
    const email = String(form.get("email") || "").trim();
    const company = String(form.get("company") || "").trim();
    const team = String(form.get("team") || "").trim();
    const subject = `Fintuity ERP demo request - ${company}`;
    const body = `Hello Fintuity team,\n\nI would like to book a personal demo.\n\nName: ${name}\nWork email: ${email}\nCompany: ${company}\nTeam size: ${team}\n\nThank you!`;
    const draft = `mailto:hello@fintuityerp.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    setEmailDraft(draft);
    window.location.href = draft;
  }

  return (
    <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={onClose}>
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
        <button className="modal-close" type="button" onClick={onClose} aria-label="Close demo form"><X size={20} /></button>
        <div className="modal-mark"><BrandMarkSmall /></div>
        {emailDraft ? (
          <div className="modal-success">
            <span className="success-icon"><Check size={25} /></span>
            <h2 id="demo-modal-title">Your request is ready.</h2>
            <p>Your email app should open with a prepared message to our team. If it didn't, use the button below to open the draft.</p>
            <a className="button button-primary modal-submit" href={emailDraft}>Open email draft <ArrowUpRight size={18} /></a>
            <small>Or write to <a href="mailto:hello@fintuityerp.com">hello@fintuityerp.com</a></small>
          </div>
        ) : (
          <>
            <span className="modal-eyebrow">LET'S TALK BUSINESS</span>
            <h2 id="demo-modal-title">See clarity in action.</h2>
            <p className="modal-intro">Tell us a little about your business. We'll help you explore what Fintuity can do for you.</p>
            <form className="demo-form" onSubmit={handleSubmit}>
              <div className="form-grid">
                <label>Full name<input name="name" type="text" placeholder="Your name" autoComplete="name" required /></label>
                <label>Work email<input name="email" type="email" placeholder="you@company.com" autoComplete="email" required /></label>
                <label>Company name<input name="company" type="text" placeholder="Your company" autoComplete="organization" required /></label>
                <label>Team size<select name="team" defaultValue="" required><option value="" disabled>Select team size</option><option>1-10 people</option><option>11-50 people</option><option>51-200 people</option><option>201+ people</option></select></label>
              </div>
              <button className="button button-primary modal-submit" type="submit">Prepare demo request <ArrowUpRight size={18} /></button>
              <p className="form-note">This opens a prepared email in your mail app. No information is sent from this website.</p>
            </form>
          </>
        )}
      </motion.div>
    </motion.div>
  );
}

export default function App() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [demoOpen, setDemoOpen] = useState(false);
  const [activeModule, setActiveModule] = useState(0);
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const reduceMotion = useReducedMotion();
  const { scrollYProgress } = useScroll();
  const progress = useSpring(scrollYProgress, { stiffness: 100, damping: 30, restDelta: 0.001 });

  useEffect(() => {
    const updateScroll = () => setScrolled(window.scrollY > 20);
    updateScroll();
    window.addEventListener("scroll", updateScroll, { passive: true });
    return () => window.removeEventListener("scroll", updateScroll);
  }, []);

  const openDemo = () => {
    setMobileOpen(false);
    setDemoOpen(true);
  };

  return (
    <div id="top" className="site-wrap">
      <motion.div className="scroll-progress" style={{ scaleX: progress }} aria-hidden="true" />
      <header className={`site-header ${scrolled ? "is-scrolled" : ""}`}>
        <div className="nav-inner">
          <Brand onClick={() => setMobileOpen(false)} />
          <nav className="desktop-nav" aria-label="Main navigation">
            {navLinks.map((link) => <a key={link.href} href={link.href}>{link.label}</a>)}
          </nav>
          <div className="nav-actions">
            <a className="nav-contact" href="mailto:hello@fintuityerp.com">Contact us</a>
            <button className="button button-primary nav-demo" type="button" onClick={openDemo}>Book a demo <ArrowUpRight size={17} /></button>
          </div>
          <button className="mobile-toggle" type="button" onClick={() => setMobileOpen((open) => !open)} aria-label={mobileOpen ? "Close menu" : "Open menu"} aria-expanded={mobileOpen}>
            {mobileOpen ? <X size={25} /> : <Menu size={25} />}
          </button>
        </div>
        <AnimatePresence>
          {mobileOpen && (
            <motion.nav className="mobile-menu" aria-label="Mobile navigation" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.28 }}>
              {navLinks.map((link) => <a key={link.href} href={link.href} onClick={(event) => {
                event.preventDefault();
                setMobileOpen(false);
                window.history.pushState(null, "", link.href);
                window.setTimeout(() => document.querySelector(link.href)?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth" }), 320);
              }}>{link.label}<ArrowUpRight size={17} /></a>)}
              <button type="button" onClick={openDemo}>Book a demo <ArrowUpRight size={17} /></button>
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
            ><span className="eyebrow-line" /> THE BUSINESS PLATFORM BUILT FOR BANGLADESH</motion.div>
            <div className="hero-content">
              <h1 id="hero-title">
                <motion.span className="hero-brand" initial={reduceMotion ? false : { opacity: 0, y: 55, filter: "blur(9px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} transition={{ duration: 0.95, delay: 0.16, ease: [0.22, 1, 0.36, 1] }}>Fintuity<span className="hero-dot">.</span></motion.span>
                <motion.span className="hero-promise" initial={reduceMotion ? false : { opacity: 0, y: 34 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.85, delay: 0.38, ease: [0.22, 1, 0.36, 1] }}>Finance in focus.</motion.span>
              </h1>
              <motion.div className="hero-aside" initial={reduceMotion ? false : { opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, delay: 0.62, ease: [0.22, 1, 0.36, 1] }}>
                <p>The all-in-one accounting and ERP platform that brings your whole business into one clear view.</p>
                <div className="hero-actions">
                  <button className="button button-primary hero-button" type="button" onClick={openDemo}>Get a personal demo <ArrowUpRight size={18} /></button>
                  <a className="text-link" href="#platform">Explore the platform <ArrowRight size={18} /></a>
                </div>
              </motion.div>
            </div>
          </div>
          <DashboardPreview />
        </section>

        <section className="vision-section" id="why" aria-labelledby="vision-heading">
          <div className="section-container vision-container">
            <Reveal className="section-kicker"><span className="kicker-dot" /> A BETTER WAY TO SEE BUSINESS</Reveal>
            <Reveal delay={0.08}>
              <h2 id="vision-heading">Less time finding answers.<br /><span>More time moving forward.</span></h2>
            </Reveal>
            <div className="vision-bottom">
              <motion.div className="vision-rule" initial={reduceMotion ? false : { scaleX: 0 }} whileInView={{ scaleX: 1 }} viewport={{ once: true }} transition={{ duration: 1.2, delay: 0.2, ease: [0.22, 1, 0.36, 1] }} />
              <Reveal delay={0.16}><p>Fintuity brings accounting, sales, inventory, and reporting together, so the whole picture is always within reach.</p></Reveal>
            </div>
          </div>
        </section>

        <section className="platform-section" id="platform" aria-labelledby="platform-heading">
          <div className="section-container platform-container">
            <div className="platform-intro">
              <Reveal className="section-kicker section-kicker-light"><span className="kicker-dot" /> ONE CONNECTED PLATFORM</Reveal>
              <Reveal delay={0.08}><h2 id="platform-heading">Everything works<br />better together.</h2></Reveal>
              <Reveal delay={0.14}><p>Powerful tools for every moving part of your business, all working from the same source of truth.</p></Reveal>
              <div className="module-tabs" role="tablist" aria-label="Explore Fintuity modules">
                {modules.map((module, index) => (
                  <button
                    className={`module-tab ${activeModule === index ? "is-active" : ""}`}
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
                      if (event.key === "ArrowDown" || event.key === "ArrowRight") next = (index + 1) % modules.length;
                      else if (event.key === "ArrowUp" || event.key === "ArrowLeft") next = (index - 1 + modules.length) % modules.length;
                      else if (event.key === "Home") next = 0;
                      else if (event.key === "End") next = modules.length - 1;
                      else return;
                      event.preventDefault();
                      setActiveModule(next);
                      requestAnimationFrame(() => document.getElementById(`module-tab-${next}`)?.focus());
                    }}
                  >
                    <span className="module-tab-number">{module.number}</span>
                    <span className="module-tab-title">{module.title}</span>
                    <ArrowUpRight className="module-tab-arrow" size={20} strokeWidth={1.7} />
                    {activeModule === index && <motion.span className="module-tab-active-line" layoutId="active-module-line" />}
                  </button>
                ))}
              </div>
            </div>
            <Reveal className="platform-visual-wrap" delay={0.2}>
              <div className="platform-screen" id="module-preview" role="tabpanel" aria-labelledby={`module-tab-${activeModule}`}>
                <div className="module-screen-topbar"><span className="module-screen-logo"><BrandMarkSmall /></span><span>Fintuity / {modules[activeModule].title}</span><span className="module-screen-top-right"><Search size={16} /><span className="screen-user">NA</span></span></div>
                <AnimatePresence mode="wait"><PlatformPanel module={modules[activeModule]} /></AnimatePresence>
              </div>
              <div className="platform-visual-caption"><span>AN INSIDE LOOK AT FINTUITY</span><span>{modules[activeModule].number} / 04</span></div>
            </Reveal>
          </div>
        </section>

        <ComplianceSection />

        <section className="local-section" id="bangladesh" aria-labelledby="local-heading">
          <div className="local-symbol" aria-hidden="true">৳</div>
          <div className="section-container local-container">
            <div className="local-intro">
              <Reveal className="section-kicker"><span className="kicker-dot" /> ROOTED HERE, READY FOR MORE</Reveal>
              <Reveal delay={0.08}><h2 id="local-heading">Made for<br />Bangladesh.<br /><span>Built to grow.</span></h2></Reveal>
              <Reveal delay={0.14}><p>Thoughtful details for the way business really happens here, with the flexibility to go wherever you do.</p></Reveal>
            </div>
            <div className="local-feature-list">
              {localFeatures.map((feature, index) => (
                <Reveal className="local-feature" key={feature.number} delay={index * 0.09}>
                  <span className="local-feature-number">{feature.number}</span>
                  <div><h3>{feature.title}</h3><p>{feature.copy}</p></div>
                  <ArrowUpRight size={21} strokeWidth={1.5} aria-hidden="true" />
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        <section className="control-section" aria-labelledby="control-heading">
          <div className="section-container control-container">
            <div className="control-copy">
              <Reveal className="section-kicker"><span className="kicker-dot" /> CONFIDENCE, BUILT IN</Reveal>
              <Reveal delay={0.08}><h2 id="control-heading">Know the details.<br /><span>Own the big picture.</span></h2></Reveal>
              <Reveal delay={0.15}><p>From everyday transactions to the decisions that shape tomorrow, stay close to what matters without getting lost in the work.</p></Reveal>
              <Reveal className="control-points" delay={0.22}>
                <div><ShieldCheck size={21} strokeWidth={1.7} /><span>Clear access for every role</span></div>
                <div><Check size={21} strokeWidth={1.8} /><span>Every action, easy to trace</span></div>
              </Reveal>
            </div>
            <Reveal className="audit-visual" delay={0.18}>
              <div className="audit-heading"><div><span>ACTIVITY LOG</span><h3>Every detail has a place.</h3></div><MoreHorizontal size={21} /></div>
              <div className="audit-timeline">
                <motion.div className="audit-line" initial={reduceMotion ? false : { scaleY: 0 }} whileInView={{ scaleY: 1 }} viewport={{ once: true }} transition={{ duration: 1.25, delay: 0.35, ease: [0.22, 1, 0.36, 1] }} />
                <div className="audit-event"><span className="audit-node active" /><div><strong>Invoice INV-0284 approved</strong><small>By Nabila Ahmed · Sales</small></div><time>10:42 AM</time></div>
                <div className="audit-event"><span className="audit-node" /><div><strong>Payment reconciled</strong><small>Arco Textiles · ৳ 1,85,000</small></div><time>09:18 AM</time></div>
                <div className="audit-event"><span className="audit-node" /><div><strong>Monthly report generated</strong><small>Finance overview · Last month</small></div><time>Yesterday</time></div>
                <div className="audit-event"><span className="audit-node" /><div><strong>Inventory updated</strong><small>Dhaka warehouse · 28 items</small></div><time>Last week</time></div>
              </div>
              <div className="audit-footer"><span className="audit-status-dot" /> Your workspace is up to date <span>JUST NOW</span></div>
            </Reveal>
          </div>
        </section>

        <section className="faq-section" id="faqs" aria-labelledby="faq-heading">
          <div className="section-container faq-container">
            <div className="faq-intro">
              <Reveal className="section-kicker"><span className="kicker-dot" /> GOOD TO KNOW</Reveal>
              <Reveal delay={0.08}><h2 id="faq-heading">A few things you<br />might be wondering.</h2></Reveal>
              <Reveal delay={0.15}><p>Still have a question? <a href="mailto:hello@fintuityerp.com">Let's talk <ArrowUpRight size={16} /></a></p></Reveal>
            </div>
            <Reveal className="faq-list" delay={0.14}>
              {faqs.map((faq, index) => (
                <div className={`faq-item ${openFaq === index ? "is-open" : ""}`} key={faq.question}>
                  <button type="button" aria-expanded={openFaq === index} aria-controls={`faq-answer-${index}`} onClick={() => setOpenFaq(openFaq === index ? null : index)}>
                    <span>{faq.question}</span><motion.span animate={{ rotate: openFaq === index ? 45 : 0 }} transition={{ duration: 0.25 }}><Plus size={21} strokeWidth={1.7} /></motion.span>
                  </button>
                  <AnimatePresence initial={false}>
                    {openFaq === index && <motion.div id={`faq-answer-${index}`} className="faq-answer" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3 }}><p>{faq.answer}</p></motion.div>}
                  </AnimatePresence>
                </div>
              ))}
            </Reveal>
          </div>
        </section>

        <section className="final-cta" aria-labelledby="cta-heading">
          <div className="cta-ambient" aria-hidden="true" />
          <div className="section-container cta-container">
            <Reveal className="section-kicker section-kicker-light"><span className="kicker-dot" /> THE NEXT CHAPTER STARTS HERE</Reveal>
            <Reveal delay={0.08}><h2 id="cta-heading">A clearer future<br />starts with <span>Fintuity.</span></h2></Reveal>
            <Reveal className="cta-bottom" delay={0.16}>
              <p>See what happens when your whole business finally works together.</p>
              <button className="button button-teal" type="button" onClick={openDemo}>Book your personal demo <ArrowUpRight size={19} /></button>
            </Reveal>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <div className="section-container footer-top">
          <div><Brand inverted /><p>Beautifully balanced business.</p></div>
          <div className="footer-links"><div><span>EXPLORE</span><a href="#why">Why Fintuity</a><a href="#platform">Platform</a><a href="#compliance">NBR Compliance</a><a href="#bangladesh">Built for Bangladesh</a></div><div><span>GET IN TOUCH</span><a href="mailto:hello@fintuityerp.com">hello@fintuityerp.com</a><a href="#faqs">FAQs</a><button type="button" onClick={openDemo}>Book a demo</button></div></div>
        </div>
        <div className="section-container footer-bottom"><span>© {new Date().getFullYear()} Fintuity ERP. All rights reserved.</span><span>Made for ambitious businesses in Bangladesh.</span><a href="#top">Back to top ↑</a></div>
      </footer>

      <AnimatePresence>{demoOpen && <DemoModal onClose={() => setDemoOpen(false)} />}</AnimatePresence>
    </div>
  );
}