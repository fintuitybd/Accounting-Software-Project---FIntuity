import { Link } from 'react-router-dom';
import { BookOpen, Boxes, Building2, Database, Landmark, Receipt, Settings2, ShieldCheck, UserCog } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { ROLE_LABELS } from '../auth/roles';
import { localized } from '../core/i18n';
import { usePreferences } from '../preferences/AppPreferences';

export default function CompanyWorkspacePlaceholder() {
  const auth = useAuth();
  const { locale } = usePreferences();
  const L = (en: string, bn: string): string => localized(locale, en, bn);

  if (!auth.activeCompany) {
    return (
      <section className="lv-card mx-auto mt-6 max-w-3xl p-6 sm:p-8">
        <span className="grid h-11 w-11 place-items-center rounded-2xl bg-amber-500/10 text-amber-700 dark:text-amber-300">
          <Building2 size={20} />
        </span>
        <h2 className="mt-4 text-[24px] font-semibold tracking-[-0.035em] text-ink-900">
          {L('No company access yet', 'এখনও কোনো কোম্পানির প্রবেশাধিকার নেই')}
        </h2>
        <p className="mt-2 text-[14px] leading-relaxed text-ink-500">
          {L(
            'Your account is signed in, but no company is assigned to your membership. Ask an organisation owner or administrator to grant company access.',
            'আপনার অ্যাকাউন্ট সাইন ইন করা আছে, কিন্তু আপনার সদস্যপদে কোনো কোম্পানি নির্ধারিত নেই। প্রতিষ্ঠানের মালিক বা প্রশাসককে কোম্পানি প্রবেশাধিকার দিতে বলুন।',
          )}
        </p>
        {auth.hasOrganisationPermission('MANAGE_USERS_AND_ORG') ? (
          <Link to="/app/team" className="lv-btn lv-btn-primary mt-5 min-h-11 text-[14px]">
            <UserCog size={16} /> {L('Manage team access', 'টিম প্রবেশাধিকার পরিচালনা')}
          </Link>
        ) : null}
        <Link to="/app/setup" className="lv-btn lv-btn-secondary mt-5 ml-2 min-h-11 text-[14px]">
          <Building2 size={16} /> {L('Create or configure a company', 'কোম্পানি তৈরি বা কনফিগার করুন')}
        </Link>
      </section>
    );
  }

  return (
    <section className="lv-card mx-auto mt-6 max-w-4xl p-6 sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="grid h-12 w-12 place-items-center rounded-2xl brand-gradient text-white shadow-lift ring-1 ring-white/20">
            <Building2 size={22} />
          </span>
          <div>
            <p className="lv-kicker">{L('Company context', 'কোম্পানির প্রেক্ষাপট')}</p>
            <h2 className="mt-1 text-[26px] font-semibold tracking-[-0.04em] text-ink-900">{auth.activeCompany.legalName}</h2>
            <p className="mt-1 text-[14px] text-ink-500">{auth.activeCompany.organisationName}</p>
          </div>
        </div>
        <span className="lv-chip lv-chip-neutral">
          <ShieldCheck size={13} />
          {L(ROLE_LABELS[auth.activeCompany.role].label_en, ROLE_LABELS[auth.activeCompany.role].label_bn)}
        </span>
      </div>

      <div className="mt-6 rounded-2xl border border-line bg-surface-2/40 p-5">
        <h3 className="text-[17px] font-semibold text-ink-900">
          {L('Server-authoritative ledger, close, approvals and audit trail are available', 'সার্ভার-ভিত্তিক লেজার, সমাপনী, অনুমোদন ও অডিট ট্রেইল উপলব্ধ')}
        </h3>
        <p className="mt-2 text-[14px] leading-relaxed text-ink-500">
          {L(
            'The server-backed modules cover identity, chart of accounts and periods, the ledger, masters and inventory, sales and credit notes, purchases and payables, treasury challans/certificates, banking reconciliation and management reporting. Phase 12 adds persisted close runs with maker-checker evidence, server-enforced OPEN/CLOSED/LOCKED periods, permissioned reopen, high-value document/journal/payment/reversal approvals, suspense resolution with a named target and evidence, an append-only audit log viewer and CSV export, and a close-pack export. Payroll and statutory filing remain outside this phase.',
            'সার্ভার-ভিত্তিক মডিউলগুলোতে পরিচয়, হিসাবের তালিকা ও সময়কাল, খতিয়ান, মাস্টার ও ইনভেন্টরি, বিক্রয় ও ক্রেডিট নোট, ক্রয় ও প্রদেয়, কোষাগার চালান/সনদ, ব্যাংক মিলকরণ ও ব্যবস্থাপনা রিপোর্টিং অন্তর্ভুক্ত। ফেজ ১২-এ সংরক্ষিত সমাপনী রান ও মেকার-চেকার প্রমাণ, সার্ভার-প্রয়োগকৃত OPEN/CLOSED/LOCKED সময়কাল, অনুমতিসাপেক্ষ পুনরায় খোলা, উচ্চ-মূল্যের নথি/জার্নাল/পেমেন্ট/রিভার্সাল অনুমোদন, নির্দিষ্ট লক্ষ্য ও প্রমাণসহ সাসপেন্স নিষ্পত্তি, সংযোজন-শুধু অডিট লগ ভিউয়ার ও সিএসভি রপ্তানি এবং সমাপনী প্যাক রপ্তানি যোগ হয়েছে। পে-রোল ও সংবিধিবদ্ধ দাখিল এই ফেজের বাইরে।',
          )}
        </p>
        <dl className="mt-4 grid gap-3 text-[13px] sm:grid-cols-3">
          <div>
            <dt className="text-ink-400">{L('Role', 'ভূমিকা')}</dt>
            <dd className="mt-1 font-semibold text-ink-900">{auth.activeCompany.role}</dd>
          </div>
          <div>
            <dt className="text-ink-400">{L('TIN', 'টিআইএন')}</dt>
            <dd className="mt-1 font-semibold text-ink-900">{auth.activeCompany.tin ?? L('Not configured', 'নির্ধারিত নয়')}</dd>
          </div>
          <div>
            <dt className="text-ink-400">{L('BIN', 'বিআইএন')}</dt>
            <dd className="mt-1 font-semibold text-ink-900">{auth.activeCompany.bin ?? L('Not configured', 'নির্ধারিত নয়')}</dd>
          </div>
        </dl>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        <Link to="/app/ledger" className="lv-btn lv-btn-primary min-h-11 text-[14px]">
          <BookOpen size={16} /> {L('Open general ledger', 'সাধারণ লেজার খুলুন')}
        </Link>
        <Link to="/app/reports" className="lv-btn lv-btn-secondary min-h-11 text-[14px]">
          <BookOpen size={16} /> {L('Reports & financial statements', 'রিপোর্ট ও আর্থিক বিবরণী')}
        </Link>
        <Link to="/app/close" className="lv-btn lv-btn-secondary min-h-11 text-[14px]">
          <ShieldCheck size={16} /> {L('Close & controls', 'সমাপনী ও নিয়ন্ত্রণ')}
        </Link>
        <Link to="/app/audit" className="lv-btn lv-btn-secondary min-h-11 text-[14px]">
          <ShieldCheck size={16} /> {L('Audit log', 'অডিট লগ')}
        </Link>
        <Link to="/app/sales" className="lv-btn lv-btn-secondary min-h-11 text-[14px]">
          <Receipt size={16} /> {L('Sales & receivables', 'বিক্রয় ও প্রাপ্য')}
        </Link>
        <Link to="/app/purchases" className="lv-btn lv-btn-secondary min-h-11 text-[14px]">
          <Receipt size={16} /> {L('Purchases & payables', 'ক্রয় ও প্রদেয়')}
        </Link>
        <Link to="/app/treasury" className="lv-btn lv-btn-secondary min-h-11 text-[14px]">
          <Landmark size={16} /> {L('Treasury & certificates', 'ট্রেজারি ও প্রত্যয়নপত্র')}
        </Link>
        <Link to="/app/banking" className="lv-btn lv-btn-secondary min-h-11 text-[14px]">
          <Landmark size={16} /> {L('Banking & reconciliation', 'ব্যাংকিং ও মিলকরণ')}
        </Link>
        <Link to="/app/masters" className="lv-btn lv-btn-secondary min-h-11 text-[14px]">
          <Database size={16} /> {L('Master data', 'মাস্টার ডেটা')}
        </Link>
        <Link to="/app/inventory" className="lv-btn lv-btn-secondary min-h-11 text-[14px]">
          <Boxes size={16} /> {L('Inventory & stock', 'ইনভেন্টরি ও স্টক')}
        </Link>
        <Link to="/app/setup" className="lv-btn lv-btn-secondary min-h-11 text-[14px]">
          <Settings2 size={16} /> {L('Company setup & settings', 'কোম্পানি সেটআপ ও সেটিংস')}
        </Link>
        <Link to="/app/account" className="lv-btn lv-btn-secondary min-h-11 text-[14px]">
          {L('Account & sessions', 'অ্যাকাউন্ট ও সেশন')}
        </Link>
        {auth.hasOrganisationPermission('MANAGE_USERS_AND_ORG') ? (
          <Link to="/app/team" className="lv-btn lv-btn-secondary min-h-11 text-[14px]">
            {L('Team & access', 'টিম ও প্রবেশাধিকার')}
          </Link>
        ) : null}
      </div>
    </section>
  );
}
