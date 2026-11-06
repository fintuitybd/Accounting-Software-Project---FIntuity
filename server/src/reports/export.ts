import type {
  AgeingReportDto,
  BalanceSheetDto,
  CashFlowDto,
  ChangesInEquityDto,
  GeneralLedgerReportDto,
  JournalListingDto,
  ProfitAndLossDto,
  StockValuationDto,
  TrialBalanceReportDto,
  VatRegisterReportDto,
  VatReturnDraftDto,
  WithholdingRegisterDto,
} from './types.ts';
import { formatPoishaAsBdt } from '../company/money.ts';

function cell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function row(values: readonly unknown[]): string {
  return values.map(cell).join(',');
}

function metadata(
  reportKey: string,
  scope: { companyName: string; branchName: string | null; labelEn: string },
  templateVersion: string,
  reviewStatus: string,
  generatedAt: string,
): string[] {
  return [
    `# report_key,${cell(reportKey)}`,
    `# company,${cell(scope.companyName)}`,
    `# branch,${cell(scope.branchName ?? 'All branches / unassigned as applicable')}`,
    `# period,${cell(scope.labelEn)}`,
    `# template_version,${cell(templateVersion)}`,
    `# review_status,${cell(reviewStatus)}`,
    `# generated_at,${cell(generatedAt)}`,
    '',
  ];
}

function amountCells(poisha: string): [string, string] {
  return [poisha, formatPoishaAsBdt(poisha)];
}

function statementCsv(report: ProfitAndLossDto | BalanceSheetDto | CashFlowDto, includeComparatives: boolean): string {
  const lines = metadata(
    report.reportKey,
    report.scope,
    report.template.version,
    report.reviewStatus,
    report.generatedAt,
  );
  lines.push(
    includeComparatives
      ? row([
          'section',
          'account_code',
          'account_name_en',
          'account_name_bn',
          'amount_poisha',
          'amount_bdt',
          'comparative_poisha',
          'comparative_bdt',
          'kind',
        ])
      : row(['section', 'account_code', 'account_name_en', 'account_name_bn', 'amount_poisha', 'amount_bdt', 'kind']),
  );
  for (const section of report.sections) {
    for (const line of section.lines) {
      const [amount, amountBdt] = amountCells(line.amountPoisha);
      if (includeComparatives) {
        const [comp, compBdt] = amountCells(line.comparativePoisha);
        lines.push(
          row([
            section.titleEn,
            line.accountCode ?? '',
            line.accountNameEn,
            line.accountNameBn ?? '',
            amount,
            amountBdt,
            comp,
            compBdt,
            line.kind,
          ]),
        );
      } else {
        lines.push(
          row([
            section.titleEn,
            line.accountCode ?? '',
            line.accountNameEn,
            line.accountNameBn ?? '',
            amount,
            amountBdt,
            line.kind,
          ]),
        );
      }
    }
    const [total, totalBdt] = amountCells(section.totalPoisha);
    if (includeComparatives) {
      const [comp, compBdt] = amountCells(section.comparativeTotalPoisha);
      lines.push(row([`${section.titleEn} — total`, '', '', '', total, totalBdt, comp, compBdt, 'SECTION_TOTAL']));
    } else {
      lines.push(row([`${section.titleEn} — total`, '', '', '', total, totalBdt, 'SECTION_TOTAL']));
    }
  }

  const summaryRows: Array<[string, string, string]> = [];
  if (report.reportKey === 'PROFIT_AND_LOSS') {
    const value = report as ProfitAndLossDto;
    summaryRows.push(
      ['Revenue', value.totals.revenuePoisha, value.totals.revenueComparativePoisha],
      ['Gross profit', value.totals.grossProfitPoisha, value.totals.grossProfitComparativePoisha],
      ['Operating profit', value.totals.operatingProfitPoisha, value.totals.operatingProfitComparativePoisha],
      ['Profit before tax', value.totals.profitBeforeTaxPoisha, value.totals.profitBeforeTaxComparativePoisha],
      ['Income tax expense', value.totals.taxExpensePoisha, value.totals.taxExpenseComparativePoisha],
      ['Profit for the period', value.totals.profitForPeriodPoisha, value.totals.profitForPeriodComparativePoisha],
    );
  } else if (report.reportKey === 'BALANCE_SHEET') {
    const value = report as BalanceSheetDto;
    const liabilities = (
      BigInt(value.totals.liabilitiesNonCurrentPoisha) + BigInt(value.totals.liabilitiesCurrentPoisha)
    ).toString();
    const liabilitiesComparative = (
      BigInt(value.totals.liabilitiesNonCurrentComparativePoisha) +
      BigInt(value.totals.liabilitiesCurrentComparativePoisha)
    ).toString();
    summaryRows.push(
      ['Total assets', value.totals.totalAssetsPoisha, value.totals.totalAssetsComparativePoisha],
      ['Total equity', value.totals.equityPoisha, value.totals.equityComparativePoisha],
      ['Total liabilities', liabilities, liabilitiesComparative],
      [
        'Total equity and liabilities',
        value.totals.totalEquityAndLiabilitiesPoisha,
        value.totals.totalEquityAndLiabilitiesComparativePoisha,
      ],
      ['Imbalance (must be zero)', value.totals.imbalancePoisha, '0'],
    );
  } else {
    const value = report as CashFlowDto;
    summaryRows.push(
      ['Opening cash', value.openingCashPoisha, value.openingCashComparativePoisha],
      ['Net movement in cash', value.netChangePoisha, value.netChangeComparativePoisha],
      ['Closing cash', value.closingCashPoisha, value.closingCashComparativePoisha],
    );
  }

  for (const [label, value, comparative] of summaryRows) {
    const [amount, amountBdt] = amountCells(value);
    if (includeComparatives) {
      const [comp, compBdt] = amountCells(comparative);
      lines.push(row(['SUMMARY', '', label, '', amount, amountBdt, comp, compBdt, 'SUMMARY']));
    } else {
      lines.push(row(['SUMMARY', '', label, '', amount, amountBdt, 'SUMMARY']));
    }
  }
  return `${lines.join('\r\n')}\r\n`;
}

export function exportReportCsv(reportKey: string, report: unknown): string {
  switch (reportKey) {
    case 'PROFIT_AND_LOSS':
      return statementCsv(report as ProfitAndLossDto, true);
    case 'BALANCE_SHEET':
      return statementCsv(report as BalanceSheetDto, true);
    case 'CASH_FLOW':
      return statementCsv(report as CashFlowDto, true);
    case 'CHANGES_IN_EQUITY': {
      const value = report as ChangesInEquityDto;
      const lines = metadata(
        value.reportKey,
        value.scope,
        value.template.version,
        value.reviewStatus,
        value.generatedAt,
      );
      lines.push(
        row([
          'key',
          'label_en',
          'label_bn',
          'share_capital_poisha',
          'retained_earnings_poisha',
          'reserves_poisha',
          'total_poisha',
          'comparative_total_poisha',
          'kind',
          'account_id',
        ]),
      );
      for (const entry of value.rows) {
        lines.push(
          row([
            entry.key,
            entry.labelEn,
            entry.labelBn,
            entry.shareCapitalPoisha,
            entry.retainedEarningsPoisha,
            entry.reservesPoisha,
            entry.totalPoisha,
            entry.comparativeTotalPoisha,
            entry.kind,
            entry.accountId ?? '',
          ]),
        );
      }
      return `${lines.join('\r\n')}\r\n`;
    }
    case 'TRIAL_BALANCE': {
      const value = report as TrialBalanceReportDto;
      const lines = metadata(
        value.reportKey,
        value.scope,
        value.template.version,
        value.reviewStatus,
        value.generatedAt,
      );
      lines.push(
        row([
          'account_code',
          'account_name_en',
          'account_name_bn',
          'account_type',
          'sub_category',
          'opening_debit_poisha',
          'opening_credit_poisha',
          'period_debit_poisha',
          'period_credit_poisha',
          'closing_debit_poisha',
          'closing_credit_poisha',
        ]),
      );
      for (const entry of value.trialBalance.rows) {
        lines.push(
          row([
            entry.accountCode,
            entry.accountNameEn,
            entry.accountNameBn ?? '',
            entry.accountType,
            entry.subCategory,
            entry.openingDebitPoisha,
            entry.openingCreditPoisha,
            entry.periodDebitPoisha,
            entry.periodCreditPoisha,
            entry.closingDebitPoisha,
            entry.closingCreditPoisha,
          ]),
        );
      }
      lines.push(
        row([
          'TOTAL',
          '',
          '',
          '',
          '',
          value.trialBalance.totals.openingDebitPoisha,
          value.trialBalance.totals.openingCreditPoisha,
          value.trialBalance.totals.periodDebitPoisha,
          value.trialBalance.totals.periodCreditPoisha,
          value.trialBalance.totals.closingDebitPoisha,
          value.trialBalance.totals.closingCreditPoisha,
        ]),
      );
      return `${lines.join('\r\n')}\r\n`;
    }
    case 'GENERAL_LEDGER': {
      const value = report as GeneralLedgerReportDto;
      const lines = metadata(
        value.reportKey,
        value.scope,
        value.template.version,
        value.reviewStatus,
        value.generatedAt,
      );
      lines.push(
        row([
          'posting_date',
          'journal_number',
          'status',
          'source_module',
          'narration',
          'line_no',
          'debit_poisha',
          'credit_poisha',
          'running_net_poisha',
          'reversal_journal_number',
          'memo',
        ]),
      );
      for (const entry of value.lines) {
        lines.push(
          row([
            entry.postingDate,
            entry.journalNumber ?? '',
            entry.status,
            entry.sourceModule,
            entry.narration,
            entry.lineNo,
            entry.debitPoisha,
            entry.creditPoisha,
            entry.runningNetPoisha,
            entry.reversalJournalNumber ?? '',
            entry.memo ?? '',
          ]),
        );
      }
      return `${lines.join('\r\n')}\r\n`;
    }
    case 'AR_AGEING':
    case 'AP_AGEING': {
      const value = report as AgeingReportDto;
      const ageing = value.ageing as {
        rows: Array<Record<string, unknown>>;
        totals: Record<string, string>;
        proof: { differencePoisha: string; agrees: boolean };
      };
      const lines = metadata(
        value.reportKey,
        value.scope,
        value.template.version,
        value.reviewStatus,
        value.generatedAt,
      );
      const headers = Object.keys(
        ageing.rows[0] ?? {
          documentId: '',
          documentNo: '',
          partyNameEn: '',
          dueDate: '',
          outstandingPoisha: '',
          bucket: '',
        },
      );
      lines.push(row(headers));
      for (const entry of ageing.rows) lines.push(row(headers.map((header) => entry[header])));
      lines.push(row(['TOTAL', '', '', '', ageing.totals.NET ?? '', '']));
      lines.push(
        row(['CONTROL_DIFFERENCE', ageing.proof.differencePoisha, ageing.proof.agrees ? 'AGREES' : 'DIFFERS']),
      );
      return `${lines.join('\r\n')}\r\n`;
    }
    case 'STOCK_VALUATION': {
      const value = report as StockValuationDto;
      const lines = metadata(
        value.reportKey,
        value.scope,
        value.template.version,
        value.reviewStatus,
        value.generatedAt,
      );
      lines.push(
        row([
          'sku',
          'item_name_en',
          'item_name_bn',
          'unit',
          'warehouse_code',
          'warehouse_name_en',
          'quantity',
          'value_poisha',
          'weighted_unit_cost_poisha',
        ]),
      );
      for (const entry of value.rows) {
        lines.push(
          row([
            entry.sku,
            entry.itemNameEn,
            entry.itemNameBn ?? '',
            entry.unit,
            entry.warehouseCode,
            entry.warehouseNameEn,
            entry.quantity,
            entry.valuePoisha,
            entry.weightedUnitCostPoisha,
          ]),
        );
      }
      lines.push(row(['TOTAL', '', '', '', '', '', '', value.totalValuePoisha, '']));
      lines.push(row(['GL_DIFFERENCE', value.glProof.differencePoisha]));
      return `${lines.join('\r\n')}\r\n`;
    }
    case 'VAT_SALES_REGISTER':
    case 'VAT_PURCHASE_REGISTER': {
      const value = report as VatRegisterReportDto;
      const lines = metadata(
        value.reportKey,
        value.scope,
        value.template.version,
        value.reviewStatus,
        value.generatedAt,
      );
      lines.push(
        row([
          'document_date',
          'document_type',
          'document_no',
          'statutory_serial',
          'party_name_en',
          'party_bin',
          'description',
          'line_no',
          'tax_category',
          'rate_bps',
          'base_poisha',
          'vat_poisha',
          'claimable_poisha',
          'disallowed_poisha',
        ]),
      );
      for (const entry of value.rows) {
        lines.push(
          row([
            entry.documentDate,
            entry.documentType,
            entry.documentNo ?? '',
            entry.statutorySerial ?? '',
            entry.partyNameEn,
            entry.partyBin ?? '',
            entry.description,
            entry.lineNo,
            entry.taxCategory,
            entry.rateBps,
            entry.basePoisha,
            entry.vatPoisha,
            entry.claimablePoisha,
            entry.disallowedPoisha,
          ]),
        );
      }
      lines.push(
        row([
          'TOTAL',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          value.totals.basePoisha,
          value.totals.vatPoisha,
          value.totals.claimablePoisha,
          value.totals.disallowedPoisha,
        ]),
      );
      return `${lines.join('\r\n')}\r\n`;
    }
    case 'VAT_RETURN_DRAFT': {
      const value = report as VatReturnDraftDto;
      const lines = metadata(
        value.reportKey,
        value.scope,
        value.template.version,
        value.reviewStatus,
        value.generatedAt,
      );
      lines.push(`# status,${value.filing.watermark}`);
      lines.push(row(['part', 'title_en', 'label_en', 'label_bn', 'amount_poisha', 'amount_bdt', 'note']));
      for (const part of value.parts) {
        for (const entry of part.rows) {
          const [amount, amountBdt] = amountCells(entry.amountPoisha);
          lines.push(row([part.part, part.titleEn, entry.labelEn, entry.labelBn, amount, amountBdt, entry.note ?? '']));
        }
        const [partTotal, partTotalBdt] = amountCells(part.totalPoisha);
        lines.push(row([part.part, part.titleEn, 'Part total', '', partTotal, partTotalBdt, 'PART_TOTAL']));
      }
      lines.push(
        row([
          'GL_PROOF',
          'Output VAT difference',
          '',
          '',
          value.glProof.outputVatDifferencePoisha,
          formatPoishaAsBdt(value.glProof.outputVatDifferencePoisha),
          value.zeroVariance ? 'ZERO_VARIANCE' : 'VARIANCE',
        ]),
      );
      lines.push(
        row([
          'GL_PROOF',
          'Input VAT difference',
          '',
          '',
          value.glProof.inputVatDifferencePoisha,
          formatPoishaAsBdt(value.glProof.inputVatDifferencePoisha),
          value.zeroVariance ? 'ZERO_VARIANCE' : 'VARIANCE',
        ]),
      );
      return `${lines.join('\r\n')}\r\n`;
    }
    case 'WITHHOLDING_REGISTER': {
      const value = report as WithholdingRegisterDto;
      const lines = metadata(
        value.reportKey,
        value.scope,
        value.template.version,
        value.reviewStatus,
        value.generatedAt,
      );
      lines.push(
        row([
          'tax_type',
          'status',
          'tax_period',
          'party_code',
          'party_name_en',
          'bill_no',
          'payment_number',
          'base_poisha',
          'rate_bps',
          'amount_poisha',
          'challan_number',
          'deposit_date',
        ]),
      );
      for (const entry of value.rows) {
        lines.push(
          row([
            entry.taxType,
            entry.status,
            entry.taxPeriod,
            entry.partyCode,
            entry.partyNameEn,
            entry.billNo ?? '',
            entry.paymentNumber ?? '',
            entry.basePoisha,
            entry.rateBps,
            entry.amountPoisha,
            entry.challanNumber ?? '',
            entry.depositDate ?? '',
          ]),
        );
      }
      for (const total of value.totals) {
        lines.push(row(['TOTAL', total.taxType, total.status, '', '', '', '', '', '', total.amountPoisha, '', '']));
      }
      return `${lines.join('\r\n')}\r\n`;
    }
    case 'JOURNAL_LISTING': {
      const value = report as JournalListingDto;
      const lines = metadata(
        value.reportKey,
        value.scope,
        value.template.version,
        value.reviewStatus,
        value.generatedAt,
      );
      lines.push(
        row([
          'journal_number',
          'posting_date',
          'period',
          'branch',
          'source_module',
          'source_ref',
          'narration',
          'status',
          'total_debit_poisha',
          'total_credit_poisha',
          'reversal_journal_number',
          'original_journal_number',
          'created_by',
        ]),
      );
      for (const entry of value.entries) {
        lines.push(
          row([
            entry.journalNumber ?? '',
            entry.postingDate,
            entry.periodCode,
            entry.branchCode ?? 'Unassigned',
            entry.sourceModule,
            entry.sourceDocRef ?? '',
            entry.narrationEn,
            entry.status,
            entry.totalDebitPoisha,
            entry.totalCreditPoisha,
            entry.reversalJournalNumber ?? '',
            entry.originalJournalNumber ?? '',
            entry.createdByName,
          ]),
        );
      }
      return `${lines.join('\r\n')}\r\n`;
    }
    default:
      throw new Error(`No CSV serialiser exists for report ${reportKey}.`);
  }
}
