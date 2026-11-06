-- Phase 17: Bangladesh Statutory Compliance Calendar Engine & Gazetted Holidays.
--
-- Manages holiday-aware and Friday-Saturday weekend advancement rules for Bangladesh
-- statutory obligations (NBR VAT Mushak 9.1, VDS Deposits, ITA 2023 Monthly TDS & Section 177,
-- Quarterly AIT Section 154, and RJSC Annual Filings).

CREATE TABLE bd_gazetted_holidays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES companies (id) ON DELETE CASCADE,
  holiday_date date NOT NULL,
  name_en text NOT NULL,
  name_bn text NOT NULL,
  holiday_type text NOT NULL,
  is_confirmed boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bd_holidays_holiday_type_check CHECK (
    holiday_type IN ('NATIONAL', 'EID', 'RELIGIOUS', 'BANK_HOLIDAY', 'EXECUTIVE_ORDER')
  )
);

CREATE INDEX bd_holidays_date_idx ON bd_gazetted_holidays (holiday_date);
CREATE INDEX bd_holidays_company_date_idx ON bd_gazetted_holidays (company_id, holiday_date);

CREATE TABLE compliance_calendar_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  branch_id uuid,
  period_id uuid,
  fiscal_year_id uuid NOT NULL,
  title_en text NOT NULL,
  title_bn text NOT NULL,
  statutory_body text NOT NULL,
  category text NOT NULL,
  statutory_deadline date NOT NULL,
  adjusted_deadline date NOT NULL,
  estimated_liability_poisha bigint NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'PENDING',
  auto_lock_period_on_expiry boolean NOT NULL DEFAULT false,
  filed_at timestamptz,
  filing_reference text,
  challan_id uuid,
  assigned_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT comp_cal_company_unique UNIQUE (company_id, id),
  CONSTRAINT comp_cal_company_fk FOREIGN KEY (company_id) REFERENCES companies (id) ON DELETE RESTRICT,
  CONSTRAINT comp_cal_fiscal_year_fk FOREIGN KEY (company_id, fiscal_year_id)
    REFERENCES fiscal_years (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT comp_cal_period_fk FOREIGN KEY (company_id, period_id)
    REFERENCES periods (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT comp_cal_branch_fk FOREIGN KEY (company_id, branch_id)
    REFERENCES branches (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT comp_cal_challan_fk FOREIGN KEY (company_id, challan_id)
    REFERENCES treasury_challans (company_id, id) ON DELETE SET NULL,
  CONSTRAINT comp_cal_company_period_cat_uniq UNIQUE (company_id, period_id, category),
  CONSTRAINT comp_cal_statutory_body_check CHECK (
    statutory_body IN ('NBR_VAT', 'NBR_TAX', 'RJSC', 'MOLE')
  ),
  CONSTRAINT comp_cal_category_check CHECK (
    category IN ('VAT_91', 'VDS_DEPOSIT', 'TDS_MONTHLY', 'TDS_177', 'AIT_Q', 'ANNUAL_TAX', 'RJSC_ANNUAL')
  ),
  CONSTRAINT comp_cal_status_check CHECK (
    status IN ('PENDING', 'PREPARED', 'FILED', 'OVERDUE')
  )
);

CREATE INDEX comp_cal_company_deadline_idx ON compliance_calendar_events (company_id, adjusted_deadline);
CREATE INDEX comp_cal_company_status_idx ON compliance_calendar_events (company_id, status);

CREATE TRIGGER compliance_calendar_events_set_updated_at
  BEFORE UPDATE ON compliance_calendar_events
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Seed official 2026-2027 Bangladesh Gazetted Holidays (National scope: company_id is NULL)
INSERT INTO bd_gazetted_holidays (company_id, holiday_date, name_en, name_bn, holiday_type, is_confirmed) VALUES
  -- 2026 National & Religious Holidays
  (NULL, '2026-02-21', 'Shaheed Day & International Mother Language Day', 'শহীদ দিবস ও আন্তর্জাতিক মাতৃভাষা দিবস', 'NATIONAL', true),
  (NULL, '2026-03-17', 'Historic 17 March Public Holiday', '১৭ই মার্চ সরকারি ছুটি', 'NATIONAL', true),
  (NULL, '2026-03-20', 'Shab-e-Qadr', 'পবিত্র শবে কদর', 'RELIGIOUS', true),
  (NULL, '2026-03-21', 'Eid-ul-Fitr (Holiday)', 'পবিত্র ঈদুল ফিতর (ছুটি)', 'EID', true),
  (NULL, '2026-03-22', 'Eid-ul-Fitr Day', 'পবিত্র ঈদুল ফিতর', 'EID', true),
  (NULL, '2026-03-23', 'Eid-ul-Fitr (Holiday)', 'পবিত্র ঈদুল ফিতর (ছুটি)', 'EID', true),
  (NULL, '2026-03-26', 'Independence & National Day', 'স্বাধীনতা ও জাতীয় দিবস', 'NATIONAL', true),
  (NULL, '2026-04-14', 'Pahela Baishakh (Bengali New Year)', 'পহেলা বৈশাখ (বাংলা নববর্ষ)', 'NATIONAL', true),
  (NULL, '2026-05-01', 'May Day', 'মে দিবস', 'NATIONAL', true),
  (NULL, '2026-05-03', 'Buddha Purnima (Vaisakhi)', 'শুভ বুদ্ধ পূর্ণিমা', 'RELIGIOUS', true),
  (NULL, '2026-05-28', 'Eid-ul-Adha (Holiday)', 'পবিত্র ঈদুল আজহা (ছুটি)', 'EID', true),
  (NULL, '2026-05-29', 'Eid-ul-Adha Day', 'পবিত্র ঈদুল আজহা', 'EID', true),
  (NULL, '2026-05-30', 'Eid-ul-Adha (Holiday)', 'পবিত্র ঈদুল আজহা (ছুটি)', 'EID', true),
  (NULL, '2026-06-27', 'Holy Ashura', 'পবিত্র আশুরা', 'RELIGIOUS', true),
  (NULL, '2026-07-01', 'Bank Holiday', 'ব্যাংক ছুটি', 'BANK_HOLIDAY', true),
  (NULL, '2026-08-15', 'National Mourning Day', 'জাতীয় শোক দিবস', 'NATIONAL', true),
  (NULL, '2026-08-27', 'Eid-e-Miladunnabi (PBUH)', 'পবিত্র ঈদে মিলাদুন্নবী (সা.)', 'RELIGIOUS', true),
  (NULL, '2026-09-04', 'Janmashtami', 'শুভ জন্মাষ্টমী', 'RELIGIOUS', true),
  (NULL, '2026-10-20', 'Durga Puja (Bijoya Dashami)', 'দুর্গাপূজা (বিজয়া দশমী)', 'RELIGIOUS', true),
  (NULL, '2026-12-16', 'Victory Day', 'বিজয় দিবস', 'NATIONAL', true),
  (NULL, '2026-12-25', 'Christmas Day', 'যিশু খ্রিস্টের জন্মদিন (বড় দিন)', 'RELIGIOUS', true),
  (NULL, '2026-12-31', 'Bank Holiday', 'ব্যাংক ছুটি', 'BANK_HOLIDAY', true),

  -- 2027 National & Religious Holidays
  (NULL, '2027-02-21', 'Shaheed Day & International Mother Language Day', 'শহীদ দিবস ও আন্তর্জাতিক মাতৃভাষা দিবস', 'NATIONAL', true),
  (NULL, '2027-03-10', 'Eid-ul-Fitr (Holiday)', 'পবিত্র ঈদুল ফিতর (ছুটি)', 'EID', true),
  (NULL, '2027-03-11', 'Eid-ul-Fitr Day', 'পবিত্র ঈদুল ফিতর', 'EID', true),
  (NULL, '2027-03-12', 'Eid-ul-Fitr (Holiday)', 'পবিত্র ঈদুল ফিতর (ছুটি)', 'EID', true),
  (NULL, '2027-03-26', 'Independence & National Day', 'স্বাধীনতা ও জাতীয় দিবস', 'NATIONAL', true),
  (NULL, '2027-04-14', 'Pahela Baishakh', 'পহেলা বৈশাখ', 'NATIONAL', true),
  (NULL, '2027-05-01', 'May Day', 'মে দিবস', 'NATIONAL', true),
  (NULL, '2027-05-18', 'Eid-ul-Adha Day', 'পবিত্র ঈদুল আজহা', 'EID', true),
  (NULL, '2027-05-19', 'Eid-ul-Adha (Holiday)', 'পবিত্র ঈদুল আজহা (ছুটি)', 'EID', true),
  (NULL, '2027-05-20', 'Eid-ul-Adha (Holiday)', 'পবিত্র ঈদুল আজহা (ছুটি)', 'EID', true),
  (NULL, '2027-07-01', 'Bank Holiday', 'ব্যাংক ছুটি', 'BANK_HOLIDAY', true),
  (NULL, '2027-10-10', 'Durga Puja (Bijoya Dashami)', 'দুর্গাপূজা (বিজয়া দশমী)', 'RELIGIOUS', true),
  (NULL, '2027-12-16', 'Victory Day', 'বিজয় দিবস', 'NATIONAL', true),
  (NULL, '2027-12-25', 'Christmas Day', 'বড় দিন', 'RELIGIOUS', true),
  (NULL, '2027-12-31', 'Bank Holiday', 'ব্যাংক ছুটি', 'BANK_HOLIDAY', true);

COMMENT ON TABLE bd_gazetted_holidays IS
  'Bangladesh official gazetted holidays and company-specific executive declarations.';
COMMENT ON TABLE compliance_calendar_events IS
  'Statutory compliance filing deadlines, weekend/holiday adjustments, and tracking.';
