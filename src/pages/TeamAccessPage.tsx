import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Loader2, MailPlus, RefreshCw, ShieldCheck, Trash2, Users } from 'lucide-react';
import { ApiError, authApi } from '../auth/api';
import { useAuth } from '../auth/AuthContext';
import { ROLE_LABELS, SERVER_ROLES } from '../auth/roles';
import type { ServerRole, TeamInvitation, TeamMember } from '../auth/types';
import { localized } from '../core/i18n';
import { usePreferences } from '../preferences/AppPreferences';

export default function TeamAccessPage() {
  const auth = useAuth();
  const { locale } = usePreferences();
  const L = useCallback((en: string, bn: string): string => localized(locale, en, bn), [locale]);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [invitations, setInvitations] = useState<TeamInvitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<ServerRole>('ACCOUNTANT');
  const [selectedCompanies, setSelectedCompanies] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const canManage = auth.hasOrganisationPermission('MANAGE_USERS_AND_ORG');
  const organisationId = auth.activeMembership?.organisationId;
  const orgCompanies = useMemo(
    () => auth.companies.filter((company) => company.organisationId === organisationId),
    [auth.companies, organisationId],
  );

  const load = useCallback(async (): Promise<void> => {
    if (!organisationId || !canManage) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [memberResponse, invitationResponse] = await Promise.all([
        authApi.members(organisationId),
        authApi.invitations(organisationId),
      ]);
      setMembers(memberResponse.members);
      setInvitations(invitationResponse.invitations);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : L('Team data could not be loaded.', 'টিমের তথ্য লোড করা যায়নি।'));
    } finally {
      setLoading(false);
    }
  }, [organisationId, canManage, L]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleCompany = (companyId: string): void => {
    setSelectedCompanies((current) =>
      current.includes(companyId) ? current.filter((id) => id !== companyId) : [...current, companyId],
    );
  };

  const invite = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!organisationId) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const result = await authApi.createInvitation(organisationId, {
        email: email.trim(),
        role,
        companyIds: selectedCompanies,
      });
      setNotice(result.message);
      setEmail('');
      setSelectedCompanies([]);
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : L('The invitation could not be created.', 'আমন্ত্রণ তৈরি করা যায়নি।'));
    } finally {
      setSaving(false);
    }
  };

  const changeRole = async (member: TeamMember, nextRole: ServerRole): Promise<void> => {
    if (!organisationId || member.userId === auth.user?.id) return;
    if (nextRole === member.role) return;
    if (!window.confirm(L(`Change ${member.name}'s role to ${nextRole}? Their existing sessions will be signed out.`, `${member.name}-এর ভূমিকা ${nextRole}-এ পরিবর্তন করবেন? তাদের চলমান সেশন সাইন আউট হবে।`))) {
      return;
    }
    setBusyId(member.userId);
    setError(null);
    try {
      await authApi.updateMember(organisationId, member.userId, { role: nextRole });
      setNotice(L('Member role updated. Their sessions were revoked.', 'সদস্যের ভূমিকা আপডেট হয়েছে। তাদের সেশন বাতিল হয়েছে।'));
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : L('The role could not be changed.', 'ভূমিকা পরিবর্তন করা যায়নি।'));
    } finally {
      setBusyId(null);
    }
  };

  const removeMember = async (member: TeamMember): Promise<void> => {
    if (!organisationId || member.userId === auth.user?.id) return;
    if (!window.confirm(L(`Remove ${member.name} from this organisation? Their sessions will end and company access will stop immediately.`, `${member.name}-কে প্রতিষ্ঠান থেকে সরাবেন? তাদের সেশন শেষ হবে এবং কোম্পানি প্রবেশাধিকার সাথে সাথে বন্ধ হবে।`))) {
      return;
    }
    setBusyId(member.userId);
    setError(null);
    try {
      await authApi.updateMember(organisationId, member.userId, { status: 'REMOVED' });
      setNotice(L('Member removed and sessions revoked.', 'সদস্য সরানো হয়েছে এবং সেশন বাতিল হয়েছে।'));
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : L('The member could not be removed.', 'সদস্য সরানো যায়নি।'));
    } finally {
      setBusyId(null);
    }
  };

  const resend = async (invitation: TeamInvitation): Promise<void> => {
    if (!organisationId) return;
    setBusyId(invitation.id);
    setError(null);
    try {
      const result = await authApi.resendInvitation(organisationId, invitation.id);
      setNotice(result.message);
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : L('The invitation could not be resent.', 'আমন্ত্রণ আবার পাঠানো যায়নি।'));
    } finally {
      setBusyId(null);
    }
  };

  const revoke = async (invitation: TeamInvitation): Promise<void> => {
    if (!organisationId) return;
    if (!window.confirm(L(`Revoke the invitation to ${invitation.email}? The current link will stop working immediately.`, `${invitation.email}-এর আমন্ত্রণ প্রত্যাহার করবেন? বর্তমান লিংক সাথে সাথে অকার্যকর হবে।`))) {
      return;
    }
    setBusyId(invitation.id);
    setError(null);
    try {
      await authApi.revokeInvitation(organisationId, invitation.id);
      setNotice(L('Invitation revoked.', 'আমন্ত্রণ প্রত্যাহার হয়েছে।'));
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : L('The invitation could not be revoked.', 'আমন্ত্রণ প্রত্যাহার করা যায়নি।'));
    } finally {
      setBusyId(null);
    }
  };

  if (auth.demoMode) {
    return (
      <section className="ql-card p-6">
        <h2 className="text-[22px] font-semibold tracking-[-0.03em] text-ink-900">{L('Team & access', 'টিম ও প্রবেশাধিকার')}</h2>
        <p className="mt-2 text-[14px] text-ink-500">
          {L(
            'Team management requires the real identity service. The synthetic demo is isolated and cannot invite or change users.',
            'টিম পরিচালনার জন্য বাস্তব পরিচয় সেবা প্রয়োজন। কৃত্রিম ডেমো আলাদা এবং ব্যবহারকারী আমন্ত্রণ বা পরিবর্তন করতে পারে না।',
          )}
        </p>
      </section>
    );
  }

  if (!canManage) {
    return (
      <section className="ql-card p-6">
        <h2 className="text-[22px] font-semibold tracking-[-0.03em] text-ink-900">{L('Team & access', 'টিম ও প্রবেশাধিকার')}</h2>
        <p className="mt-2 text-[14px] text-ink-500">
          {L('Your role cannot manage users or invitations. Ask an owner or administrator.', 'আপনার ভূমিকা ব্যবহারকারী বা আমন্ত্রণ পরিচালনা করতে পারে না। মালিক বা প্রশাসকের কাছে জিজ্ঞাসা করুন।')}
        </p>
      </section>
    );
  }

  return (
    <div className="space-y-4">
      <section className="ql-card p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="ql-kicker flex items-center gap-1.5"><Users size={13} /> {L('Organisation access', 'প্রতিষ্ঠানের প্রবেশাধিকার')}</p>
            <h2 className="mt-1 text-[24px] font-semibold tracking-[-0.035em] text-ink-900">{L('Team & access', 'টিম ও প্রবেশাধিকার')}</h2>
            <p className="mt-1 text-[14px] text-ink-500">
              {L('Invite people to this organisation, assign a role and restrict them to specific companies.', 'এই প্রতিষ্ঠানে ব্যক্তি আমন্ত্রণ করুন, ভূমিকা দিন এবং নির্দিষ্ট কোম্পানিতে সীমাবদ্ধ করুন।')}
            </p>
          </div>
          <span className="ql-badge ql-badge-neutral"><ShieldCheck size={12} /> {L('Server-enforced permissions', 'সার্ভার-নিয়ন্ত্রিত অনুমতি')}</span>
        </div>

        {error ? <div role="alert" className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2.5 text-[13px] text-rose-700 dark:text-rose-300">{error}</div> : null}
        {notice ? <div role="status" className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5 text-[13px] text-emerald-700 dark:text-emerald-300">{notice}</div> : null}

        <form onSubmit={invite} className="mt-5 grid gap-4 rounded-2xl border border-line bg-surface-2/40 p-4 lg:grid-cols-[1.2fr_0.8fr_1.6fr_auto] lg:items-end">
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-semibold text-ink-700">{L('Email address', 'ইমেইল ঠিকানা')}</span>
            <input
              className="ql-input min-h-11 w-full text-[14px]"
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="name@company.com"
              disabled={saving}
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-semibold text-ink-700">{L('Role', 'ভূমিকা')}</span>
            <select
              className="ql-input min-h-11 w-full text-[14px]"
              value={role}
              onChange={(event) => setRole(event.target.value as ServerRole)}
              disabled={saving}
            >
              {SERVER_ROLES.filter((entry) => entry !== 'OWNER' || auth.activeMembership?.role === 'OWNER').map((entry) => (
                <option key={entry} value={entry}>{L(ROLE_LABELS[entry].label_en, ROLE_LABELS[entry].label_bn)} — {L(ROLE_LABELS[entry].note_en, ROLE_LABELS[entry].note_bn)}</option>
              ))}
            </select>
          </label>
          <fieldset>
            <legend className="mb-1.5 text-[13px] font-semibold text-ink-700">{L('Company scope', 'কোম্পানির পরিধি')}</legend>
            <div className="flex flex-wrap gap-1.5">
              {orgCompanies.map((company) => (
                <label key={company.id} className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-xl border border-line bg-surface px-2.5 text-[13px] text-ink-700">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-line"
                    checked={selectedCompanies.includes(company.id)}
                    onChange={() => toggleCompany(company.id)}
                    disabled={saving}
                  />
                  {company.legalName}
                </label>
              ))}
              {orgCompanies.length === 0 ? (
                <span className="text-[13px] text-ink-500">{L('No company assigned yet.', 'এখনও কোনো কোম্পানি নির্ধারিত নেই।')}</span>
              ) : null}
            </div>
            <p className="mt-1 text-[12px] text-ink-400">
              {L('Owner and Admin invitations may be organisation-wide. Other roles need at least one company.', 'মালিক ও প্রশাসক আমন্ত্রণ প্রতিষ্ঠান-ব্যাপী হতে পারে। অন্য ভূমিকার জন্য অন্তত একটি কোম্পানি প্রয়োজন।')}
            </p>
          </fieldset>
          <button type="submit" disabled={saving} className="ql-btn ql-btn-primary min-h-11 justify-center text-[14px]">
            {saving ? <Loader2 size={16} className="animate-spin" /> : <MailPlus size={16} />}
            {L('Send invitation', 'আমন্ত্রণ পাঠান')}
          </button>
        </form>
      </section>

      <section className="ql-card overflow-hidden">
        <div className="ql-card-header flex items-center justify-between gap-3">
          <div>
            <h3 className="text-[16px] font-semibold text-ink-900">{L('Members', 'সদস্য')}</h3>
            <p className="mt-0.5 text-[13px] text-ink-500">{L('Role changes revoke the member’s active sessions.', 'ভূমিকা পরিবর্তনে সদস্যের চলমান সেশন বাতিল হয়।')}</p>
          </div>
          <button type="button" onClick={() => void load()} className="ql-btn ql-btn-secondary min-h-10 text-[13px]">
            <RefreshCw size={14} /> {L('Refresh', 'রিফ্রেশ')}
          </button>
        </div>
        {loading ? (
          <div className="flex items-center gap-2 px-4 py-6 text-[14px] text-ink-500"><Loader2 size={17} className="animate-spin" /> {L('Loading members…', 'সদস্য লোড হচ্ছে…')}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-[13px]">
              <thead className="bg-surface-2/60 text-[12px] uppercase tracking-[0.08em] text-ink-400">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">{L('Member', 'সদস্য')}</th>
                  <th className="px-4 py-2.5 font-semibold">{L('Role', 'ভূমিকা')}</th>
                  <th className="px-4 py-2.5 font-semibold">{L('Company scope', 'কোম্পানির পরিধি')}</th>
                  <th className="px-4 py-2.5 font-semibold">{L('Last sign-in', 'শেষ সাইন ইন')}</th>
                  <th className="px-4 py-2.5 font-semibold">{L('Actions', 'কার্যক্রম')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/70">
                {members.map((member) => (
                  <tr key={member.userId} className="align-top">
                    <td className="px-4 py-3">
                      <p className="font-semibold text-ink-900">{member.name}</p>
                      <p className="text-[12px] text-ink-500">{member.email}</p>
                      {member.status !== 'ACTIVE' ? <p className="text-[12px] font-semibold text-amber-700 dark:text-amber-300">{member.status}</p> : null}
                    </td>
                    <td className="px-4 py-3">
                      <select
                        className="ql-input min-h-10 text-[13px]"
                        value={member.role}
                        onChange={(event) => void changeRole(member, event.target.value as ServerRole)}
                        disabled={busyId === member.userId || member.userId === auth.user?.id}
                        aria-label={L(`Role for ${member.name}`, `${member.name}-এর ভূমিকা`)}
                      >
                        {SERVER_ROLES.map((entry) => (
                          <option key={entry} value={entry}>{L(ROLE_LABELS[entry].label_en, ROLE_LABELS[entry].label_bn)}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-3 text-ink-600">
                      {member.companyScope.length > 0
                        ? member.companyScope.map((company) => company.legalName).join(', ')
                        : member.explicitScope
                          ? L('No company access', 'কোনো কোম্পানির প্রবেশাধিকার নেই')
                          : member.role === 'OWNER' || member.role === 'ADMIN'
                            ? L('All organisation companies', 'প্রতিষ্ঠানের সব কোম্পানি')
                            : L('No company access', 'কোনো কোম্পানির প্রবেশাধিকার নেই')}
                    </td>
                    <td className="px-4 py-3 text-ink-500">
                      {member.lastLoginAt ? new Date(member.lastLoginAt).toLocaleString() : L('Never', 'কখনও নয়')}
                    </td>
                    <td className="px-4 py-3">
                      {member.userId === auth.user?.id ? (
                        <span className="text-[12px] text-ink-400">{L('Your account', 'আপনার অ্যাকাউন্ট')}</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void removeMember(member)}
                          disabled={busyId === member.userId}
                          className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-rose-500/30 px-2.5 text-[12px] font-semibold text-rose-700 transition hover:bg-rose-500/10 dark:text-rose-300"
                        >
                          {busyId === member.userId ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                          {L('Remove', 'সরান')}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="ql-card overflow-hidden">
        <div className="ql-card-header">
          <h3 className="text-[16px] font-semibold text-ink-900">{L('Pending invitations', 'অপেক্ষমাণ আমন্ত্রণ')}</h3>
          <p className="mt-0.5 text-[13px] text-ink-500">{L('Single-use links expire automatically. Resending rotates the link.', 'একক-ব্যবহারের লিংক স্বয়ংক্রিয়ভাবে মেয়াদোত্তীর্ণ হয়। আবার পাঠালে লিংক পরিবর্তিত হয়।')}</p>
        </div>
        {invitations.length === 0 ? (
          <p className="px-4 py-6 text-[14px] text-ink-500">{L('No invitations yet.', 'এখনও কোনো আমন্ত্রণ নেই।')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-[13px]">
              <thead className="bg-surface-2/60 text-[12px] uppercase tracking-[0.08em] text-ink-400">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">{L('Email', 'ইমেইল')}</th>
                  <th className="px-4 py-2.5 font-semibold">{L('Role', 'ভূমিকা')}</th>
                  <th className="px-4 py-2.5 font-semibold">{L('Status', 'অবস্থা')}</th>
                  <th className="px-4 py-2.5 font-semibold">{L('Expires', 'মেয়াদ')}</th>
                  <th className="px-4 py-2.5 font-semibold">{L('Actions', 'কার্যক্রম')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/70">
                {invitations.map((invitation) => (
                  <tr key={invitation.id}>
                    <td className="px-4 py-3 font-medium text-ink-800">{invitation.email}</td>
                    <td className="px-4 py-3 text-ink-600">{L(ROLE_LABELS[invitation.role].label_en, ROLE_LABELS[invitation.role].label_bn)}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-[12px] font-semibold ${invitation.status === 'PENDING' ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300' : 'bg-ink-100 text-ink-600 dark:bg-white/[0.06] dark:text-ink-300'}`}>
                        {invitation.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-ink-500">{new Date(invitation.expiresAt).toLocaleString()}</td>
                    <td className="px-4 py-3">
                      {invitation.status === 'PENDING' ? (
                        <div className="flex flex-wrap gap-1.5">
                          <button
                            type="button"
                            onClick={() => void resend(invitation)}
                            disabled={busyId === invitation.id}
                            className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-line px-2.5 text-[12px] font-semibold text-ink-700 transition hover:border-line-strong"
                          >
                            {busyId === invitation.id ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                            {L('Resend', 'আবার পাঠান')}
                          </button>
                          <button
                            type="button"
                            onClick={() => void revoke(invitation)}
                            disabled={busyId === invitation.id}
                            className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-rose-500/30 px-2.5 text-[12px] font-semibold text-rose-700 transition hover:bg-rose-500/10 dark:text-rose-300"
                          >
                            <Trash2 size={13} /> {L('Revoke', 'প্রত্যাহার')}
                          </button>
                        </div>
                      ) : (
                        <span className="text-[12px] text-ink-400">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
