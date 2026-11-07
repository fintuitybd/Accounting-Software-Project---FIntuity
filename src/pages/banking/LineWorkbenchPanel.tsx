import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRightLeft,
  Ban,
  CheckCircle2,
  FilePlus2,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Split,
  UserCheck,
  Wallet,
} from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import type { BankGlRequest, BankMatchType, BankStatementLine, BankStatementMatch, MatchCandidate } from '../../banking/api';
import { bankingApi } from '../../banking/api';
import type { Party } from '../../masters/api';
import type { SetupAccount } from '../../setup/api';
import type { BankAccount } from '../../setup/api';
import { usePreferences } from '../../preferences/AppPreferences';
import { apiErrorMessage, ErrorBanner, Field, INPUT_CLASS, Notice, poishaToBdtString } from '../setup/setupUi';
import { formatDate, newKey, statusChip } from './bankingUi';

type StatusFilter = 'ALL' | 'UNMATCHED' | 'PARTIALLY_MATCHED' | 'MATCHED' | 'CATEGORIZED' | 'EXCLUDED';

function activeMatches(matches: BankStatementMatch[]): BankStatementMatch[] {
  return matches.filter((match) => match.status === 'ACTIVE');
}

function lineTotal(line: BankStatementLine): bigint {
  return BigInt(line.debitPoisha) + BigInt(line.creditPoisha);
}

function minBigInt(left: bigint, right: bigint): bigint {
  return left < right ? left : right;
}

function bdtStringToPoisha(value: string): bigint | null {
  const text = value.trim();
  if (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,2})?$/.test(text)) return null;
  const [whole = '', fraction = ''] = text.split('.');
  return BigInt(whole) * 100n + BigInt((fraction + '00').slice(0, 2));
}

export function LineWorkbenchPanel({
  companyId,
  bank,
  accounts,
  parties,
  canPost,
  canApprove,
  canView,
  refreshKey,
  onChanged,
}: {
  companyId: string;
  bank: BankAccount;
  accounts: SetupAccount[];
  parties: Party[];
  canPost: boolean;
  canApprove: boolean;
  canView: boolean;
  refreshKey: number;
  onChanged: () => void;
}) {
  const auth = useAuth();
  const { money } = usePreferences();
  const [lines, setLines] = useState<BankStatementLine[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);
  const [selectedLine, setSelectedLine] = useState<BankStatementLine | null>(null);
  const [matches, setMatches] = useState<BankStatementMatch[]>([]);
  const [glRequests, setGlRequests] = useState<BankGlRequest[]>([]);
  const [candidates, setCandidates] = useState<MatchCandidate[]>([]);
  const [candidateId, setCandidateId] = useState('');
  const [matchAmount, setMatchAmount] = useState('');
  const [matchReason, setMatchReason] = useState('');
  const [windowDays, setWindowDays] = useState(7);
  const [unmatchReason, setUnmatchReason] = useState('');
  const [excludeReason, setExcludeReason] = useState('');
  const [exceptionNote, setExceptionNote] = useState('');
  const [glAmount, setGlAmount] = useState('');
  const [glPrimaryAccountId, setGlPrimaryAccountId] = useState('');
  const [glPartyId, setGlPartyId] = useState('');
  const [glTaxEnabled, setGlTaxEnabled] = useState(false);
  const [glTaxAmount, setGlTaxAmount] = useState('0.00');
  const [glTaxAccountId, setGlTaxAccountId] = useState('');
  const [glReason, setGlReason] = useState('');
  const [glEvidence, setGlEvidence] = useState('');
  const [feePosting, setFeePosting] = useState<Awaited<ReturnType<typeof bankingApi.feeForLine>>['posting']>(null);
  const [feeOverrideAmount, setFeeOverrideAmount] = useState('');
  const [feeOverrideReason, setFeeOverrideReason] = useState('');
  const [feeEvidence, setFeeEvidence] = useState('');
  const [feeAccountId, setFeeAccountId] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const expenseAccounts = useMemo(
    () => accounts.filter((account) => account.isActive && account.accountType === 'EXPENSE'),
    [accounts],
  );
  const primaryAccounts = useMemo(
    () =>
      accounts.filter(
        (account) =>
          account.isActive &&
          account.id !== bank.glAccountId &&
          account.accountType !== 'EQUITY',
      ),
    [accounts, bank.glAccountId],
  );
  const taxAccounts = useMemo(
    () =>
      accounts.filter(
        (account) =>
          account.isActive &&
          account.id !== bank.glAccountId &&
          ['ASSET', 'LIABILITY', 'EXPENSE'].includes(account.accountType),
      ),
    [accounts, bank.glAccountId],
  );

  const loadLines = useCallback(async () => {
    if (!companyId || !bank.id || !canView) return;
    setLoading(true);
    setError(null);
    try {
      const response = await bankingApi.lines(companyId, bank.id, {
        ...(statusFilter === 'ALL' ? {} : { status: statusFilter }),
        limit: 500,
      });
      setLines(response.entries);
      setSelectedLineId((current) => {
        if (current && response.entries.some((line) => line.id === current)) return current;
        return response.entries.find((line) => line.status !== 'MATCHED')?.id ?? response.entries[0]?.id ?? null;
      });
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [companyId, bank.id, statusFilter, canView]);

  useEffect(() => {
    void loadLines();
  }, [loadLines, refreshKey]);

  const loadDetail = useCallback(async () => {
    if (!companyId || !selectedLineId) {
      setSelectedLine(null);
      setMatches([]);
      setGlRequests([]);
      setCandidates([]);
      setFeePosting(null);
      return;
    }
    setError(null);
    try {
      const [detail, candidateResponse, feeResponse] = await Promise.all([
        bankingApi.line(companyId, selectedLineId),
        bankingApi.candidates(companyId, selectedLineId, { windowDays, limit: 20 }),
        bankingApi.feeForLine(companyId, selectedLineId),
      ]);
      setSelectedLine(detail.line);
      setMatches(detail.matches);
      setGlRequests(detail.glRequests);
      setCandidates(candidateResponse.candidates);
      setFeePosting(feeResponse.posting);
      setCandidateId((current) =>
        candidateResponse.candidates.some((candidate) => candidate.journalLineId === current)
          ? current
          : candidateResponse.candidates[0]?.journalLineId ?? '',
      );
    } catch (caught) {
      setError(apiErrorMessage(caught));
    }
  }, [companyId, selectedLineId, windowDays]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail, refreshKey]);

  const selectedCandidate = candidates.find((candidate) => candidate.journalLineId === candidateId) ?? null;
  const active = useMemo(() => activeMatches(matches), [matches]);
  const matchedPoisha = active.reduce((total, match) => total + BigInt(match.amountPoisha), 0n);
  const totalPoisha = selectedLine ? lineTotal(selectedLine) : 0n;
  const remainingPoisha = selectedLine ? totalPoisha - matchedPoisha : 0n;
  const openGlRequest = glRequests.find((request) =>
    ['DRAFT', 'SUBMITTED', 'APPROVED'].includes(request.status),
  );

  useEffect(() => {
    if (!selectedCandidate) {
      setMatchAmount('');
      return;
    }
    const available = BigInt(selectedCandidate.availablePoisha);
    setMatchAmount(poishaToBdtString(minBigInt(available, remainingPoisha).toString()));
    setMatchReason(
      selectedCandidate.score >= 80
        ? 'Exact amount, date and reference agree with the posted journal.'
        : 'Manual reconciliation after checking the statement line and journal evidence.',
    );
  }, [selectedCandidate, remainingPoisha]);

  useEffect(() => {
    if (!selectedLine) return;
    setGlAmount(poishaToBdtString(remainingPoisha.toString()));
    setGlReason('');
    setGlEvidence('');
    setGlPartyId('');
    setGlTaxEnabled(false);
    setGlTaxAmount('0.00');
    setGlTaxAccountId('');
    setExceptionNote('');
  }, [selectedLine?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const effectiveMatchType = (): BankMatchType => {
    if (!selectedCandidate) return 'MANUAL';
    if (selectedCandidate.usesOtherStatementLines) return 'SPLIT';
    if (active.length > 0) return 'PARTIAL';
    const amount = bdtStringToPoisha(matchAmount) ?? 0n;
    if (amount < remainingPoisha) return 'PARTIAL';
    if (selectedCandidate.suggestedType === 'EXACT') return 'EXACT';
    return 'MANUAL';
  };

  const doMatch = async (): Promise<void> => {
    if (!selectedLine || !selectedCandidate) {
      setError('Select a journal candidate first.');
      return;
    }
    if (matchReason.trim().length < 3) {
      setError('Enter a matching reason of at least 3 characters.');
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await bankingApi.match(companyId, selectedLine.id, {
        allocations: [
          {
            journalId: selectedCandidate.journalId,
            journalLineId: selectedCandidate.journalLineId,
            amount: matchAmount,
          },
        ],
        matchType: effectiveMatchType(),
        reason: matchReason.trim(),
      });
      setSelectedLine(response.line);
      setMatches(response.matches);
      setNotice(`Line ${response.line.status === 'MATCHED' ? 'fully matched' : 'partially matched'}. The journal was not changed.`);
      await loadLines();
      onChanged();
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const doUnmatch = async (): Promise<void> => {
    if (!selectedLine) return;
    if (unmatchReason.trim().length < 3) {
      setError('Enter an unmatch reason of at least 3 characters.');
      return;
    }
    if (
      !window.confirm(
        'Remove the reconciliation link(s) for this statement line?\n\nThe posted journal is not reversed. The line becomes partially or fully unmatched again.',
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await bankingApi.unmatch(companyId, selectedLine.id, unmatchReason.trim());
      setSelectedLine(response.line);
      setMatches(response.matches);
      setUnmatchReason('');
      setNotice('Reconciliation link removed. The original journal and its audit trail remain.');
      await loadLines();
      onChanged();
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const doExclude = async (): Promise<void> => {
    if (!selectedLine) return;
    if (excludeReason.trim().length < 3) {
      setError('Enter an exclusion reason of at least 3 characters.');
      return;
    }
    if (
      !window.confirm(
        'Exclude this statement line from the reconciliation?\n\nThe line remains in the retained statement evidence and will be counted as excluded, with your reason and audit event.',
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await bankingApi.exclude(companyId, selectedLine.id, excludeReason.trim());
      setSelectedLine(response.line);
      setExcludeReason('');
      setNotice('Statement line excluded with a reason and audit event.');
      await loadLines();
      onChanged();
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const doAssignToMe = async (): Promise<void> => {
    if (!selectedLine || !auth.user?.id) return;
    if (exceptionNote.trim().length < 3) {
      setError('Enter an exception note of at least 3 characters.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await bankingApi.assignException(companyId, selectedLine.id, auth.user.id, exceptionNote.trim());
      setSelectedLine(response.line);
      setNotice('Exception owner and note updated.');
      await loadDetail();
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const doCreateGl = async (): Promise<void> => {
    if (!selectedLine) return;
    if (!glPrimaryAccountId || glReason.trim().length < 3) {
      setError('Choose the primary account and enter a reason of at least 3 characters.');
      return;
    }
    if (glTaxEnabled && !glTaxAccountId) {
      setError('Choose the tax account when tax is included.');
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await bankingApi.createGl(
        companyId,
        selectedLine.id,
        {
          amount: glAmount,
          primaryAccountId: glPrimaryAccountId,
          ...(glTaxEnabled ? { taxPoisha: glTaxAmount, taxAccountId: glTaxAccountId } : {}),
          partyId: glPartyId || null,
          reason: glReason.trim(),
          evidenceReference: glEvidence.trim() || null,
        },
        newKey('bank-gl'),
      );
      setGlRequests((current) => [response.request, ...current.filter((request) => request.id !== response.request.id)]);
      setNotice(`Draft journal ${response.request.journalNumber ?? ''} created. It must be submitted and approved by a different user before posting.`);
      await loadDetail();
      await loadLines();
      onChanged();
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const doGlAction = async (request: BankGlRequest, action: 'submit' | 'approve' | 'cancel' | 'reject'): Promise<void> => {
    let reason = '';
    if (action === 'cancel' || action === 'reject') {
      reason =
        window.prompt(
          `Enter the ${action === 'cancel' ? 'cancellation' : 'rejection'} reason (at least 3 characters):`,
        )?.trim() ?? '';
      if (reason.length < 3) return;
    }
    if (
      action === 'approve' &&
      !window.confirm(
        `Approve and post journal ${request.journalNumber ?? ''}?\n\nThis posts the journal to the GL and matches it to the statement line. The action is audited.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (action === 'submit') await bankingApi.submitGl(companyId, request.id);
      if (action === 'approve') await bankingApi.approveGl(companyId, request.id);
      if (action === 'cancel') await bankingApi.cancelGl(companyId, request.id, reason);
      if (action === 'reject') await bankingApi.rejectGl(companyId, request.id, reason);
      setNotice(
        action === 'submit'
          ? 'Create-GL request submitted for a different controller to approve.'
          : action === 'approve'
            ? 'Journal approved, posted and matched to the statement line.'
            : action === 'cancel'
              ? 'Create-GL request cancelled; the draft journal was removed.'
              : 'Create-GL request rejected. The unposted journal remains in the audit trail and cannot be posted by the banking flow.',
      );
      await loadDetail();
      await loadLines();
      onChanged();
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const doPostFee = async (): Promise<void> => {
    if (!selectedLine) return;
    if (
      !window.confirm(
        'Post this fee journal once?\n\nA second fee posting for the same statement line is blocked. The fee is posted as Dr expense / Cr bank and is not automatically matched.',
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await bankingApi.postFee(
        companyId,
        selectedLine.id,
        {
          ...(feeOverrideAmount ? { overrideAmount: feeOverrideAmount } : {}),
          overrideReason: feeOverrideReason.trim() || null,
          evidenceReference: feeEvidence.trim() || null,
          feeAccountId: feeAccountId || null,
        },
        newKey('bank-fee'),
      );
      setFeePosting(response.posting);
      setNotice(`Fee ${response.posting.amountBdt} BDT posted as journal ${response.posting.journalNumber ?? ''}. A duplicate fee posting is blocked.`);
      await loadDetail();
      onChanged();
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  if (!canView) {
    return <Notice message="Your role cannot view bank statement lines." tone="warning" />;
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
      <section className="ql-card overflow-hidden">
        <div className="ql-card-header">
          <div>
            <p className="ql-kicker">Statement queue</p>
            <h2 className="mt-1 text-[20px] font-semibold text-ink-900">{bank.name}</h2>
            <p className="mt-1 text-[12px] text-ink-500">
              {bank.glAccountCode} · {bank.kind} · {bank.provider ?? '—'} · {bank.maskedNumber ?? '—'}
            </p>
          </div>
          <button type="button" onClick={() => void loadLines()} disabled={loading} className="ql-btn ql-btn-secondary min-h-11 text-[12px]">
            {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Refresh
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          <label className="text-[12px] font-semibold text-ink-600" htmlFor="bank-line-status">
            Status
          </label>
          <select
            id="bank-line-status"
            className="ql-select min-h-10 text-[13px]"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
          >
            <option value="ALL">All lines</option>
            <option value="UNMATCHED">Unmatched</option>
            <option value="PARTIALLY_MATCHED">Partially matched</option>
            <option value="MATCHED">Matched</option>
            <option value="CATEGORIZED">Categorised (GL request open)</option>
            <option value="EXCLUDED">Excluded</option>
          </select>
          <span className="ml-auto text-[12px] text-ink-400">{lines.length} line(s) in this view</span>
        </div>
        {error ? <div className="p-4"><ErrorBanner message={error} /></div> : null}
        {notice ? <div className="p-4 pb-0"><Notice message={notice} tone="success" /></div> : null}
        <div className="max-h-[700px] overflow-auto">
          <table className="ql-table min-w-[760px]">
            <caption className="sr-only">Imported bank statement lines</caption>
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Description / reference</th>
                <th scope="col" className="text-right">Amount</th>
                <th scope="col">Status</th>
                <th scope="col">Owner</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => {
                const activeLine = selectedLineId === line.id;
                const isDebit = BigInt(line.debitPoisha) > 0n;
                return (
                  <tr
                    key={line.id}
                    onClick={() => setSelectedLineId(line.id)}
                    className={`cursor-pointer ${activeLine ? 'bg-brand/5 ring-1 ring-inset ring-brand/20' : ''}`}
                  >
                    <td className="whitespace-nowrap">{formatDate(line.valueDate)}</td>
                    <td>
                      <p className="max-w-[280px] truncate font-medium text-ink-800">{line.description}</p>
                      <p className="font-mono text-[12px] text-ink-400">{line.reference ?? 'no reference'}</p>
                    </td>
                    <td className={`font-money whitespace-nowrap text-right font-semibold ${isDebit ? 'text-emerald-700' : 'text-rose-700'}`}>
                      {isDebit ? '+' : '−'}
                      {money(BigInt(isDebit ? line.debitPoisha : line.creditPoisha), { symbol: false })}
                    </td>
                    <td>{statusChip(line.status)}</td>
                    <td className="text-[12px] text-ink-500">{line.exceptionOwnerName ?? 'Unassigned'}</td>
                  </tr>
                );
              })}
              {lines.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-10 text-center text-[13px] text-ink-400">
                    No statement lines in this view. Import a statement or change the status filter.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="ql-card overflow-hidden xl:sticky xl:top-24 xl:self-start">
        <div className="border-b border-line bg-gradient-to-r from-ink-900 via-vault-950 to-vault-900 px-4 py-3 text-white">
          <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-vault-200">Exception workbench</p>
          <h2 className="mt-1 text-[16px] font-semibold">Statement line → journal / GL</h2>
        </div>
        {!selectedLine ? (
          <div className="px-4 py-12 text-center text-[13px] text-ink-400">
            Select a statement line to review candidates, match it, create an approved GL journal or resolve a fee.
          </div>
        ) : (
          <div className="space-y-4 p-4">
            <div className="rounded-xl border border-line bg-surface-2/50 p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-semibold text-ink-900">{selectedLine.description}</p>
                  <p className="font-mono text-[12px] text-ink-500">
                    {selectedLine.reference ?? 'no reference'} · {formatDate(selectedLine.valueDate)}
                  </p>
                </div>
                {statusChip(selectedLine.status)}
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg bg-white px-2 py-2 ring-1 ring-line">
                  <p className="text-[12px] uppercase tracking-[0.08em] text-ink-400">Statement</p>
                  <p className="font-money text-[14px] font-semibold text-ink-900">{money(totalPoisha)}</p>
                </div>
                <div className="rounded-lg bg-white px-2 py-2 ring-1 ring-line">
                  <p className="text-[12px] uppercase tracking-[0.08em] text-ink-400">Matched</p>
                  <p className="font-money text-[14px] font-semibold text-emerald-700">{money(matchedPoisha)}</p>
                </div>
                <div className="rounded-lg bg-white px-2 py-2 ring-1 ring-line">
                  <p className="text-[12px] uppercase tracking-[0.08em] text-ink-400">Remaining</p>
                  <p className="font-money text-[14px] font-semibold text-amber-700">{money(remainingPoisha)}</p>
                </div>
              </div>
              {selectedLine.exceptionOwnerName || selectedLine.exceptionNote ? (
                <p className="mt-2 text-[12px] leading-relaxed text-ink-500">
                  Exception owner: <strong className="text-ink-800">{selectedLine.exceptionOwnerName ?? 'Unassigned'}</strong>
                  {selectedLine.exceptionNote ? ` · ${selectedLine.exceptionNote}` : ''}
                </p>
              ) : null}
            </div>

            {openGlRequest ? (
              <Notice
                message={`Create-GL request ${openGlRequest.status.toLowerCase()} for ${openGlRequest.amountBdt} BDT. Manual matching is blocked until it is approved or cancelled.`}
                tone="warning"
              />
            ) : null}

            <div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="ql-kicker">Journal candidates</p>
                <label className="flex items-center gap-2 text-[12px] text-ink-500">
                  Date window
                  <select
                    className="ql-select min-h-9 text-[12px]"
                    value={windowDays}
                    onChange={(event) => setWindowDays(Number(event.target.value))}
                  >
                    {[0, 3, 7, 14, 31].map((days) => (
                      <option key={days} value={days}>{days} day(s)</option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="mt-2 space-y-2">
                {candidates.map((candidate) => (
                  <label
                    key={candidate.journalLineId}
                    className={`block cursor-pointer rounded-xl border p-3 ${candidateId === candidate.journalLineId ? 'border-brand/40 bg-brand/5' : 'border-line bg-white'}`}
                  >
                    <span className="flex items-start justify-between gap-2">
                      <span className="flex min-w-0 items-start gap-2">
                        <input
                          type="radio"
                          name="bank-candidate"
                          className="mt-1"
                          checked={candidateId === candidate.journalLineId}
                          onChange={() => setCandidateId(candidate.journalLineId)}
                        />
                        <span className="min-w-0">
                          <span className="block font-mono text-[13px] font-semibold text-ink-900">
                            {candidate.journalNumber ?? candidate.journalId.slice(0, 8)} · {candidate.sourceModule}
                          </span>
                          <span className="mt-0.5 block truncate text-[12px] text-ink-500">{candidate.narration}</span>
                          <span className="mt-1 block text-[12px] leading-relaxed text-ink-500">{candidate.reason}</span>
                        </span>
                      </span>
                      <span className={`ql-badge ${candidate.score >= 80 ? 'ql-badge-success' : candidate.score >= 50 ? 'ql-badge-warn' : 'ql-badge-neutral'}`}>
                        score {candidate.score}
                      </span>
                    </span>
                    <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-500">
                      <span>{formatDate(candidate.postingDate)}</span>
                      <span>Available {money(BigInt(candidate.availablePoisha))}</span>
                      <span>{candidate.sourceDocRef ?? 'no source document'}</span>
                      {candidate.usesOtherStatementLines ? (
                        <span className="ql-badge ql-badge-warn"><Split size={11} /> split required</span>
                      ) : null}
                    </span>
                  </label>
                ))}
                {candidates.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-line px-3 py-4 text-[13px] text-ink-500">
                    No posted journal line has an available amount on this bank GL account in the selected date window. Create a
                    GL journal with a reason, or widen the window.
                  </p>
                ) : null}
              </div>
            </div>

            {candidates.length > 0 && !openGlRequest && selectedLine.status !== 'MATCHED' && selectedLine.status !== 'EXCLUDED' ? (
              <div className="rounded-xl border border-line bg-surface-2/40 p-3">
                <div className="grid gap-3 sm:grid-cols-[minmax(0,0.4fr)_minmax(0,1fr)]">
                  <Field label="Match amount (BDT)" required>
                    <input
                      className={INPUT_CLASS}
                      value={matchAmount}
                      onChange={(event) => setMatchAmount(event.target.value)}
                      inputMode="decimal"
                    />
                  </Field>
                  <Field label="Matching reason" required>
                    <input
                      className={INPUT_CLASS}
                      value={matchReason}
                      onChange={(event) => setMatchReason(event.target.value)}
                      maxLength={500}
                    />
                  </Field>
                </div>
                <button type="button" onClick={() => void doMatch()} disabled={busy || !canPost} className="ql-btn ql-btn-primary mt-3 min-h-11 w-full text-[13px]">
                  {busy ? <Loader2 size={15} className="animate-spin" /> : <ArrowRightLeft size={15} />}
                  Match {effectiveMatchType().toLowerCase()}
                </button>
                {!canPost ? <p className="mt-2 text-[12px] text-ink-400">Your role is read-only for matching.</p> : null}
              </div>
            ) : null}

            {matches.length > 0 ? (
              <div>
                <p className="ql-kicker">Reconciliation links</p>
                <div className="mt-2 space-y-2">
                  {matches.map((match) => (
                    <div key={match.id} className="rounded-xl border border-line bg-white p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-mono text-[13px] font-semibold text-ink-900">{match.journalNumber ?? match.journalId}</span>
                        <span className="flex items-center gap-2">
                          <span className="ql-badge ql-badge-neutral">{match.matchType}</span>
                          {statusChip(match.status)}
                        </span>
                      </div>
                      <p className="mt-1 text-[12px] text-ink-500">
                        {match.amountBdt} BDT · score {match.matchScore} · {match.journalSourceModule}
                        {match.journalSourceDocRef ? ` · ${match.journalSourceDocRef}` : ''} · {match.matchedByName} · {formatDate(match.matchedAt)}
                      </p>
                      <p className="mt-1 text-[12px] leading-relaxed text-ink-500">{match.reason}</p>
                      {match.status === 'REVERSED' ? (
                        <p className="mt-1 text-[12px] text-rose-700">Reversed: {match.reversalReason}</p>
                      ) : null}
                    </div>
                  ))}
                </div>
                {active.length > 0 && canPost ? (
                  <div className="mt-3 rounded-xl border border-line bg-surface-2/40 p-3">
                    <Field label="Unmatch reason" required>
                      <input className={INPUT_CLASS} value={unmatchReason} onChange={(event) => setUnmatchReason(event.target.value)} maxLength={500} />
                    </Field>
                    <button type="button" onClick={() => void doUnmatch()} disabled={busy} className="ql-btn ql-btn-secondary mt-2 min-h-11 w-full text-[13px]">
                      <Ban size={15} /> Remove reconciliation link (journal is not reversed)
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}

            {selectedLine.status !== 'MATCHED' && selectedLine.status !== 'EXCLUDED' && !openGlRequest ? (
              <div className="rounded-xl border border-line bg-surface-2/40 p-3">
                <p className="ql-kicker flex items-center gap-1.5"><FilePlus2 size={13} /> Create GL from this line</p>
                <p className="mt-1 text-[12px] leading-relaxed text-ink-500">
                  Choose a real asset, liability, revenue or expense account. Equity is rejected. The draft journal must be approved by
                  a different user before it posts and matches.
                </p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <Field label="Amount from statement (BDT)" required>
                    <input className={INPUT_CLASS} value={glAmount} onChange={(event) => setGlAmount(event.target.value)} inputMode="decimal" />
                  </Field>
                  <Field label="Primary account" required>
                    <select className={INPUT_CLASS} value={glPrimaryAccountId} onChange={(event) => setGlPrimaryAccountId(event.target.value)}>
                      <option value="">Choose account</option>
                      {primaryAccounts.map((account) => (
                        <option key={account.id} value={account.id}>{account.code} — {account.nameEn}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Party (optional)">
                    <select className={INPUT_CLASS} value={glPartyId} onChange={(event) => setGlPartyId(event.target.value)}>
                      <option value="">No party</option>
                      {parties.map((party) => (
                        <option key={party.id} value={party.id}>{party.code} — {party.nameEn}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Reason" required>
                    <input className={INPUT_CLASS} value={glReason} onChange={(event) => setGlReason(event.target.value)} maxLength={500} />
                  </Field>
                  <Field label="Evidence reference">
                    <input className={INPUT_CLASS} value={glEvidence} onChange={(event) => setGlEvidence(event.target.value)} maxLength={500} />
                  </Field>
                  <div className="flex items-end">
                    <label className="flex min-h-11 items-center gap-2 text-[13px] text-ink-700">
                      <input type="checkbox" checked={glTaxEnabled} onChange={(event) => setGlTaxEnabled(event.target.checked)} />
                      Tax included in the statement amount
                    </label>
                  </div>
                  {glTaxEnabled ? (
                    <>
                      <Field label="Tax amount (BDT)">
                        <input className={INPUT_CLASS} value={glTaxAmount} onChange={(event) => setGlTaxAmount(event.target.value)} inputMode="decimal" />
                      </Field>
                      <Field label="Tax account">
                        <select className={INPUT_CLASS} value={glTaxAccountId} onChange={(event) => setGlTaxAccountId(event.target.value)}>
                          <option value="">Choose tax account</option>
                          {taxAccounts.map((account) => (
                            <option key={account.id} value={account.id}>{account.code} — {account.nameEn}</option>
                          ))}
                        </select>
                      </Field>
                    </>
                  ) : null}
                </div>
                <button type="button" onClick={() => void doCreateGl()} disabled={busy || !canPost} className="ql-btn ql-btn-primary mt-3 min-h-11 w-full text-[13px]">
                  {busy ? <Loader2 size={15} className="animate-spin" /> : <FilePlus2 size={15} />} Create draft journal
                </button>
              </div>
            ) : null}

            {glRequests.length > 0 ? (
              <div>
                <p className="ql-kicker">Create-GL requests</p>
                <div className="mt-2 space-y-2">
                  {glRequests.map((request) => (
                    <div key={request.id} className="rounded-xl border border-line bg-white p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-mono text-[13px] font-semibold text-ink-900">{request.journalNumber ?? 'draft journal'}</span>
                        {statusChip(request.status)}
                      </div>
                      <p className="mt-1 text-[12px] text-ink-500">
                        {request.amountBdt} BDT · {request.primaryAccountCode} {request.primaryAccountName}
                        {request.taxPoisha !== '0' ? ` · tax ${request.taxBdt}` : ''}
                      </p>
                      <p className="mt-1 text-[12px] leading-relaxed text-ink-500">{request.reason}</p>
                      {request.status === 'REVERSED' ? (
                        <p className="mt-1 text-[12px] text-rose-700">
                          Reversed by journal {request.reversalJournalNumber ?? request.reversalJournalId}: {request.reversalReason}
                        </p>
                      ) : null}
                      <div className="mt-2 flex flex-wrap gap-2">
                        {request.status === 'DRAFT' && canPost ? (
                          <button type="button" onClick={() => void doGlAction(request, 'submit')} disabled={busy} className="ql-btn ql-btn-secondary min-h-9 text-[12px]">
                            Submit for approval
                          </button>
                        ) : null}
                        {request.status === 'SUBMITTED' && canApprove && request.createdBy !== auth.user?.id ? (
                          <>
                            <button type="button" onClick={() => void doGlAction(request, 'approve')} disabled={busy} className="ql-btn ql-btn-primary min-h-9 text-[12px]">
                              <ShieldCheck size={13} /> Approve & post
                            </button>
                            <button type="button" onClick={() => void doGlAction(request, 'reject')} disabled={busy} className="ql-btn ql-btn-secondary min-h-9 text-[12px]">
                              Reject
                            </button>
                          </>
                        ) : null}
                        {request.status === 'DRAFT' && request.createdBy === auth.user?.id ? (
                          <button type="button" onClick={() => void doGlAction(request, 'cancel')} disabled={busy} className="ql-btn ql-btn-secondary min-h-9 text-[12px]">
                            Cancel
                          </button>
                        ) : null}
                        {request.status === 'SUBMITTED' && request.createdBy !== auth.user?.id && !canApprove ? (
                          <span className="text-[12px] text-ink-400">Awaiting a controller or administrator.</span>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="rounded-xl border border-line bg-surface-2/40 p-3">
              <p className="ql-kicker flex items-center gap-1.5"><Wallet size={13} /> MFS / bank fee</p>
              {feePosting?.status === 'POSTED' ? (
                <div className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] text-emerald-800">
                  <p className="flex items-center gap-1.5 font-semibold"><CheckCircle2 size={13} /> Fee posted once</p>
                  <p className="mt-1">
                    {feePosting.amountBdt} BDT · {feePosting.feeAccountCode} {feePosting.feeAccountName} · journal{' '}
                    {feePosting.journalNumber ?? feePosting.journalId}
                  </p>
                  {feePosting.overrideReason ? <p className="mt-1">Override: {feePosting.overrideReason} · {feePosting.evidenceReference}</p> : null}
                </div>
              ) : selectedLine.status === 'MATCHED' || selectedLine.status === 'EXCLUDED' ? (
                <p className="mt-2 text-[12px] text-ink-500">Resolve the fee before fully matching or excluding a line.</p>
              ) : (
                <>
                  {feePosting?.status === 'REVERSED' ? (
                    <div className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-800">
                      <p className="font-semibold">Previous fee was reversed</p>
                      <p className="mt-1">
                        {feePosting.amountBdt} BDT · journal {feePosting.journalNumber ?? feePosting.journalId} · reversal{' '}
                        {feePosting.reversalJournalNumber ?? feePosting.reversalJournalId}
                      </p>
                      <p className="mt-1">{feePosting.reversalReason}</p>
                    </div>
                  ) : null}
                  <p className="mt-1 text-[12px] leading-relaxed text-ink-500">
                    Leave the override blank to use the active fee rule for this account. A manual override requires a reason and
                    evidence and is posted only once.
                  </p>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <Field label="Override amount (BDT)">
                      <input className={INPUT_CLASS} value={feeOverrideAmount} onChange={(event) => setFeeOverrideAmount(event.target.value)} inputMode="decimal" />
                    </Field>
                    <Field label="Fee expense account (required if no rule applies)">
                      <select className={INPUT_CLASS} value={feeAccountId} onChange={(event) => setFeeAccountId(event.target.value)}>
                        <option value="">Use rule account</option>
                        {expenseAccounts.map((account) => (
                          <option key={account.id} value={account.id}>{account.code} — {account.nameEn}</option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Override reason">
                      <input className={INPUT_CLASS} value={feeOverrideReason} onChange={(event) => setFeeOverrideReason(event.target.value)} maxLength={500} />
                    </Field>
                    <Field label="Override evidence">
                      <input className={INPUT_CLASS} value={feeEvidence} onChange={(event) => setFeeEvidence(event.target.value)} maxLength={500} />
                    </Field>
                  </div>
                  <button type="button" onClick={() => void doPostFee()} disabled={busy || !canPost} className="ql-btn ql-btn-secondary mt-3 min-h-11 w-full text-[13px]">
                    <Wallet size={15} /> Post fee journal once
                  </button>
                </>
              )}
            </div>

            {selectedLine.status !== 'MATCHED' && selectedLine.status !== 'EXCLUDED' ? (
              <div className="rounded-xl border border-line bg-surface-2/40 p-3">
                <p className="ql-kicker flex items-center gap-1.5"><UserCheck size={13} /> Exception ownership and exclusion</p>
                <div className="mt-2 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                  <Field label="Exception note">
                    <input className={INPUT_CLASS} value={exceptionNote} onChange={(event) => setExceptionNote(event.target.value)} maxLength={500} />
                  </Field>
                  <button type="button" onClick={() => void doAssignToMe()} disabled={busy || !canPost || !auth.user?.id} className="ql-btn ql-btn-secondary min-h-11 self-end text-[13px]">
                    Assign to me
                  </button>
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                  <Field label="Exclusion reason" required>
                    <input className={INPUT_CLASS} value={excludeReason} onChange={(event) => setExcludeReason(event.target.value)} maxLength={500} />
                  </Field>
                  <button type="button" onClick={() => void doExclude()} disabled={busy || !canPost} className="ql-btn ql-btn-secondary min-h-11 self-end text-[13px]">
                    Exclude line
                  </button>
                </div>
                <p className="mt-2 flex items-start gap-1.5 text-[12px] leading-relaxed text-ink-400">
                  <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                  Excluding is not deletion. The line stays in the retained statement, is counted as excluded and requires a reason.
                </p>
              </div>
            ) : null}
          </div>
        )}
      </section>
    </div>
  );
}
