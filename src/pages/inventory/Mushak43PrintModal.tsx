import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Printer, X } from 'lucide-react';
import { usePreferences } from '../../preferences/AppPreferences';
import { useAuth } from '../../auth/AuthContext';
import type { Mushak43Declaration } from '../../inventory/api';

const PRINT_CSS = `
@media print {
  @page { size: A4 portrait; margin: 10mm; }
  html, body { background: #ffffff !important; }
  #root { display: none !important; }
  .ql-print-overlay {
    position: static !important; inset: auto !important; display: block !important;
    background: #ffffff !important; padding: 0 !important; backdrop-filter: none !important;
  }
  .ql-print-shell { width: auto !important; max-width: none !important; display: block !important; }
  .ql-print-chrome { display: none !important; }
  .ql-print-scroll {
    overflow: visible !important; padding: 0 !important; margin: 0 !important;
    background: #ffffff !important;
  }
  .ql-print-sheet {
    width: auto !important; min-height: 0 !important; margin: 0 !important;
    padding: 0 !important; border: 0 !important; border-radius: 0 !important;
    box-shadow: none !important; page-break-after: always; break-after: page;
  }
  .ql-print-sheet:last-child { page-break-after: auto; break-after: auto; }
  .ql-print-sheet * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .ql-print-sheet table { page-break-inside: auto; }
  .ql-print-sheet tr { page-break-inside: avoid; }
}
`;

export interface Mushak43PrintModalProps {
  open: boolean;
  onClose: () => void;
  mushak43: Mushak43Declaration;
}

export function Mushak43PrintModal({ open, onClose, mushak43 }: Mushak43PrintModalProps) {
  const { locale } = usePreferences();
  const auth = useAuth();
  const company = auth.activeCompany;
  const isBn = locale === 'bn-BD';
  const label = (en: string, bn: string): string => (isBn ? bn : en);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;

  const content = (
    <div
      className="ql-print-overlay fixed inset-0 z-50 flex flex-col bg-ink-900/60 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={label('Mushak 4.3 Declaration', 'মূসক ৪.৩ ঘোষণা')}
    >
      <style>{PRINT_CSS}</style>

      {/* Toolbar (never printed) */}
      <div className="ql-print-chrome flex flex-wrap items-center justify-between gap-2 border-b border-ink-800 bg-vault-950 px-4 py-2.5 text-white">
        <div className="flex min-w-0 items-center gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-white/10 p-1.5 text-vault-100 ring-1 ring-white/15 transition hover:bg-white/20"
            aria-label={label('Back', 'ফিরে যান')}
          >
            <ArrowLeft size={15} />
          </button>
          <div className="min-w-0">
            <p className="truncate text-[12px] font-semibold">
              {label('Mushak 4.3 Coefficient Declaration', 'মূসক ৪.৩ উপকরণ-উৎপাদ সহগ ঘোষণা')}
            </p>
            <p className="text-[10px] text-vault-300">
              {label('210 × 297 mm · statutory print format', '২১০ × ২৯৭ মিমি · সংবিধিবদ্ধ প্রিন্ট ফরম্যাট')}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => window.print()}
            title="window.print()"
            className="inline-flex items-center gap-1.5 rounded-xl bg-gold-400 px-3 py-1.5 text-[12px] font-semibold text-vault-950 transition hover:bg-gold-300"
          >
            <Printer size={13} />
            <span>{label('Print / Save PDF', 'প্রিন্ট / পিডিএফ')}</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-vault-300 transition hover:bg-white/10 hover:text-white"
            aria-label={label('Close', 'বন্ধ করুন')}
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Sheet scroll container */}
      <div className="ql-print-scroll min-h-0 flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
        <div className="ql-print-sheet relative mx-auto min-h-[297mm] w-full max-w-[210mm] border border-black/15 bg-white p-8 text-black shadow-2xl">
          <div className="border-b-[3px] border-double border-black pb-2 text-center">
            <p className="font-bangla text-[10pt] font-bold leading-tight">অভ্যন্তরীণ হিসাবরক্ষণ নথি</p>
            <p className="text-[8pt] font-semibold leading-tight">Internal accounting document</p>
            <p className="text-[6.5pt] uppercase tracking-[0.22em] leading-tight">
              Not a government form · Not a filing acknowledgement
            </p>
            <p className="mt-1 border-t border-black/30 pt-1 font-bangla text-[7pt] uppercase tracking-[0.1em] text-black/70">
              মূল্য সংযোজন কর ও সম্পূরক শুল্ক বিধিমালা, ২০১৬ (বিধি ২১) · Value Added Tax Rules, 2016 (Rule 21)
            </p>
          </div>

          <div className="mt-3 flex items-start justify-between gap-4">
            <div className="flex items-center gap-2.5">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full border-2 border-black font-bangla text-[11pt] font-bold leading-none">
                মূসক-৪.৩
              </span>
              <div>
                <p className="text-[8pt] font-bold uppercase tracking-[0.12em]">Mushak-4.3</p>
                <p className="text-[6.5pt] text-black/55">Internal format · not a prescribed government form</p>
              </div>
            </div>
            <div className="text-right text-[8pt]">
              <p className="font-semibold text-black/80">
                {label('Rule 21, Sub-rule (1)', 'বিধি ২১ এর উপ-বিধি (১)')}
              </p>
              <p className="font-mono text-[7.5pt] text-black/60">
                {mushak43.declarationNumber}
              </p>
              <p className="text-[7pt] text-black/60">
                {label('Status: ', 'অবস্থা: ')}
                <span className="font-semibold">{mushak43.status}</span>
              </p>
            </div>
          </div>

          <div className="mt-2 text-center">
            <h2 className="font-bangla text-[12pt] font-bold text-black">
              উপকরণ-উৎপাদ সহগ (ইনপুট-আউটপুট কো-এফিশিয়েন্ট) ঘোষণা
            </h2>
            <p className="text-[8pt] font-semibold text-black/75">
              Input-Output Coefficient Declaration (Mushak 4.3)
            </p>
          </div>

          {/* Entity & Product Header Block */}
          <div className="mt-3 rounded border border-black/40 p-2.5 text-[8pt]">
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              <div>
                <span className="font-semibold text-black/70">{label('Entity Name: ', 'প্রতিষ্ঠানের নাম: ')}</span>
                <span className="font-bold">{company?.legalName || 'Fintuity Enterprise'}</span>
              </div>
              <div>
                <span className="font-semibold text-black/70">{label('BIN: ', 'বিআইএন: ')}</span>
                <span className="font-mono font-bold">{company?.bin || '—'}</span>
              </div>
              <div>
                <span className="font-semibold text-black/70">{label('Finished Item: ', 'উৎপাদিত পণ্য: ')}</span>
                <span className="font-bold">{mushak43.finishedItemName} ({mushak43.finishedItemSku})</span>
              </div>
              <div>
                <span className="font-semibold text-black/70">{label('HS Code: ', 'এইচএস কোড: ')}</span>
                <span className="font-mono">{mushak43.finishedItemHsCode || '—'}</span>
              </div>
              <div>
                <span className="font-semibold text-black/70">{label('Output Unit: ', 'সরবরাহের একক: ')}</span>
                <span>{mushak43.outputQuantity} {mushak43.outputUnit}</span>
              </div>
              <div>
                <span className="font-semibold text-black/70">{label('Effective From: ', 'কার্যকর তারিখ: ')}</span>
                <span className="font-mono">{mushak43.effectiveFrom}</span>
              </div>
              {mushak43.nbrDivisionOffice ? (
                <div className="col-span-2">
                  <span className="font-semibold text-black/70">{label('NBR Division/Office: ', 'এনবিআর সার্কেল/দপ্তর: ')}</span>
                  <span>{mushak43.nbrDivisionOffice}</span>
                </div>
              ) : null}
            </div>
          </div>

          {/* Section 46(3) Abnormal Wastage Notice if applicable */}
          {mushak43.hasAbnormalWastage ? (
            <div className="mt-2.5 rounded border border-amber-600 bg-amber-50 p-2 text-[7.5pt] text-amber-950">
              <p className="font-bold">
                {label(
                  '⚠️ Statutory Notice (Section 46(3) Wastage Guardrail):',
                  '⚠️ সংবিধিবদ্ধ সতর্কতা (ধারা ৪৬(৩) অপচয় গার্ডরেল):',
                )}
              </p>
              <p>
                {label(
                  'This declaration contains raw materials with wastage exceeding 10.00% (abnormal wastage). Any abnormal wastage incurred during batch execution will trigger an Input VAT rebate clawback in Mushak 9.1 Part 5 Note 27.',
                  'এই ঘোষণায় ১০.০০% এর অধিক অপচয় (অস্বাভাবিক অপচয়) অন্তর্ভুক্ত কাঁচামাল রয়েছে। ব্যাচ উৎপাদনের সময় এই অস্বাভাবিক অপচয়ের উপর ইনপুট ভ্যাট রিবেট বাতিল (Clawback) মূসক ৯.১ এর অংশ-৫ নোট ২৭ এ প্রযোজ্য হবে।',
                )}
              </p>
            </div>
          ) : null}

          {/* Ingredients BOM Table */}
          <div className="mt-3 overflow-hidden rounded border border-black/40">
            <div className="bg-black/5 px-2 py-1 text-[7.5pt] font-bold uppercase tracking-wider text-black/80">
              {label('Raw Material Ingredients & BOM (Rule 21)', 'কাঁচামাল ও উপকরণের বিবরণ (বিধি ২১)')}
            </div>
            <table className="w-full text-left text-[7pt]">
              <thead className="border-b border-black/30 bg-black/[0.02] font-semibold text-black/90">
                <tr>
                  <th className="px-2 py-1.5 text-center">{label('Sl', 'ক্র')}</th>
                  <th className="px-2 py-1.5">{label('Raw Material Description', 'কাঁচামাল ও বিবরণ')}</th>
                  <th className="px-2 py-1.5">{label('HS Code', 'এইচএস')}</th>
                  <th className="px-2 py-1.5 text-right">{label('Net Qty', 'নিট পরিমাণ')}</th>
                  <th className="px-2 py-1.5 text-right">{label('Wastage %', 'অপচয় %')}</th>
                  <th className="px-2 py-1.5 text-right">{label('Gross Qty', 'মোট পরিমাণ')}</th>
                  <th className="px-2 py-1.5 text-right">{label('Rate (BDT)', 'দর (টাকা)')}</th>
                  <th className="px-2 py-1.5 text-right">{label('Total Cost (BDT)', 'মোট খরচ (টাকা)')}</th>
                  <th className="px-2 py-1.5 text-center">{label('Rebate', 'রিবেট')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/10">
                {mushak43.ingredients.map((ing, idx) => (
                  <tr key={ing.id} className={ing.isAbnormalWastage ? 'bg-amber-50/50' : ''}>
                    <td className="px-2 py-1 text-center font-mono">{idx + 1}</td>
                    <td className="px-2 py-1 font-medium">
                      {ing.rawItemName} ({ing.rawItemSku})
                      {ing.isAbnormalWastage ? (
                        <span className="ml-1 rounded bg-amber-200 px-1 text-[6pt] font-bold text-amber-900">
                          {label('Abnormal', 'অস্বাভাবিক')}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-2 py-1 font-mono text-black/70">{ing.rawItemHsCode || '—'}</td>
                    <td className="px-2 py-1 text-right font-mono">{ing.netQuantity} {ing.unit}</td>
                    <td className="px-2 py-1 text-right font-mono">
                      {(ing.wastageBps / 100).toFixed(2)}%
                    </td>
                    <td className="px-2 py-1 text-right font-mono">{ing.grossQuantity} {ing.unit}</td>
                    <td className="px-2 py-1 text-right font-mono">{ing.ratePerUnitBdt}</td>
                    <td className="px-2 py-1 text-right font-mono font-semibold">{ing.totalCostBdt}</td>
                    <td className="px-2 py-1 text-center font-semibold">
                      {ing.rebatableInputVat ? (
                        <span className="text-emerald-700">{label('Yes', 'হ্যাঁ')}</span>
                      ) : (
                        <span className="text-black/50">{label('No', 'না')}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t border-black/30 bg-black/[0.03] font-semibold">
                <tr>
                  <td colSpan={7} className="px-2 py-1.5 text-right">
                    {label('Total Raw Material Cost (BDT):', 'মোট কাঁচামাল উপকরণ ব্যয় (টাকা):')}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono text-[8pt] font-bold">
                    {mushak43.totalRawMaterialCostBdt}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Value Addition & IAS 2 Cost Breakdown */}
          <div className="mt-3 grid grid-cols-2 gap-3 text-[7.5pt]">
            <div className="rounded border border-black/40 p-2">
              <p className="border-b border-black/20 pb-1 font-bold text-black/80">
                {label('Value Addition & Cost Elements', 'মূল্য সংযোজন ও উপাদানসমূহের বিবরণ')}
              </p>
              <div className="mt-1.5 space-y-1">
                <div className="flex justify-between">
                  <span className="text-black/70">{label('Direct Labor Cost:', 'প্রত্যক্ষ শ্রম ব্যয়:')}</span>
                  <span className="font-mono">{mushak43.directLaborCostBdt} BDT</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-black/70">{label('Manufacturing Overhead:', 'কারখানা উপরি ব্যয়:')}</span>
                  <span className="font-mono">{mushak43.manufacturingOverheadBdt} BDT</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-black/70">{label('Packaging & Packing Material:', 'প্যাকিং ও মোড়কীকরণ খরচ:')}</span>
                  <span className="font-mono">{mushak43.packagingCostBdt} BDT</span>
                </div>
                <div className="flex justify-between border-t border-black/20 pt-1 font-bold">
                  <span>{label('Total Cost of Production (IAS 2):', 'মোট উৎপাদন ব্যয় (আইএএস ২):')}</span>
                  <span className="font-mono">{mushak43.totalCostOfProductionBdt} BDT</span>
                </div>
              </div>
            </div>

            <div className="rounded border border-black/40 p-2">
              <p className="border-b border-black/20 pb-1 font-bold text-black/80">
                {label('Declared Pricing & Profit Summary', 'ঘোষিত মূল্য ও মুনাফার সারসংক্ষেপ')}
              </p>
              <div className="mt-1.5 space-y-1">
                <div className="flex justify-between">
                  <span className="text-black/70">{label('Target Profit Margin:', 'প্রত্যাশিত মুনাফার হার:')}</span>
                  <span className="font-mono font-semibold">{(mushak43.targetProfitMarginBps / 100).toFixed(2)}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-black/70">{label('Output Quantity Unit:', 'উৎপাদন ও সরবরাহের একক:')}</span>
                  <span>{mushak43.outputQuantity} {mushak43.outputUnit}</span>
                </div>
                <div className="flex justify-between border-t border-black/20 pt-1 text-[8pt] font-bold text-black">
                  <span>{label('Declared Retail/Supply Price:', 'ঘোষিত সরবরাহ / খুচরা মূল্য:')}</span>
                  <span className="font-mono">{mushak43.declaredRetailPriceBdt} BDT</span>
                </div>
              </div>
            </div>
          </div>

          {/* Statutory Attestation & Signatures */}
          <div className="mt-8 grid grid-cols-3 gap-6 pt-6 text-center text-[7pt]">
            <div>
              <div className="mx-auto w-3/4 border-b border-black/60 pb-1" />
              <p className="mt-1 font-semibold">{label('Prepared By / Factory In-Charge', 'প্রস্তুতকারীর স্বাক্ষর ও তারিখ')}</p>
              <p className="text-black/60">{label('Production Management', 'উৎপাদন ব্যবস্থাপনা')}</p>
            </div>
            <div>
              <div className="mx-auto w-3/4 border-b border-black/60 pb-1" />
              <p className="mt-1 font-semibold">{label('Authorized Representative', 'ক্ষমতাপ্রাপ্ত কর্মকর্তার স্বাক্ষর')}</p>
              <p className="text-black/60">{label('Name, Designation & Seal', 'নাম, পদবি ও প্রতিষ্ঠানের সিল')}</p>
            </div>
            <div>
              <div className="mx-auto w-3/4 border-b border-black/60 pb-1" />
              <p className="mt-1 font-semibold">{label('NBR Revenue Officer', 'রাজস্ব কর্মকর্তা কর্তৃক প্রাপ্তি স্বীকার')}</p>
              <p className="text-black/60">{label('Customs, Excise & VAT Commissionerate', 'কাস্টমস, এক্সাইজ ও ভ্যাট দপ্তর')}</p>
            </div>
          </div>

          <div className="mt-3 flex items-end justify-between border-t border-black/30 pt-1 text-[6.5pt] text-black/50">
            <span>
              {label('Declaration', 'ঘোষণা')} {mushak43.declarationNumber} · {mushak43.status}
            </span>
            <span className="font-mono">{isBn ? 'মূসক ৪.৩' : 'Mushak 4.3'}</span>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(content, document.body);
}

export default Mushak43PrintModal;
