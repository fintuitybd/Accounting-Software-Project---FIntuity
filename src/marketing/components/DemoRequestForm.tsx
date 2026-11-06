import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowRight, CheckCircle2, CircleAlert, Loader2 } from '../icons';
import { ApiError } from '../../auth/api';
import { submitDemoRequest } from '../api';
import { useMarketingUi } from '../MarketingApp';

type Status = 'idle' | 'pending' | 'success' | 'error';

interface FieldErrors {
  name?: string;
  email?: string;
  company?: string;
  message?: string;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function DemoRequestForm({
  id = 'demo-request-form',
  source = 'landing',
}: {
  id?: string;
  source?: 'landing' | 'contact';
}) {
  const { t } = useMarketingUi();
  const fieldId = useId();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [company, setCompany] = useState('');
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [reference, setReference] = useState<string | null>(null);

  const validate = (): FieldErrors => {
    const next: FieldErrors = {};
    if (!name.trim()) next.name = t({ en: 'Enter your name.', bn: 'আপনার নাম লিখুন।' });
    if (!email.trim()) next.email = t({ en: 'Enter your work email.', bn: 'কর্মস্থলের ইমেইল লিখুন।' });
    else if (!EMAIL_PATTERN.test(email.trim())) {
      next.email = t({ en: 'Enter a valid email address.', bn: 'সঠিক ইমেইল ঠিকানা লিখুন।' });
    }
    if (!company.trim()) next.company = t({ en: 'Enter your company name.', bn: 'কোম্পানির নাম লিখুন।' });
    if (message.length > 2000) {
      next.message = t({
        en: 'Keep the message under 2,000 characters.',
        bn: 'বার্তা ২,০০০ অক্ষরের কম রাখুন।',
      });
    }
    return next;
  };

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setError(null);
    setFieldErrors({});
    const validation = validate();
    if (Object.keys(validation).length > 0) {
      setFieldErrors(validation);
      setStatus('idle');
      return;
    }

    setStatus('pending');
    try {
      const response = await submitDemoRequest({
        name: name.trim(),
        email: email.trim(),
        company: company.trim(),
        ...(message.trim() ? { message: message.trim() } : {}),
        source,
      });
      setReference(response.reference);
      setStatus('success');
    } catch (caught) {
      setStatus('error');
      if (caught instanceof ApiError) {
        if (caught.code === 'VALIDATION_FAILED' && caught.fieldErrors) {
          setFieldErrors({
            name: caught.fieldErrors.name?.[0],
            email: caught.fieldErrors.email?.[0],
            company: caught.fieldErrors.company?.[0],
            message: caught.fieldErrors.message?.[0],
          });
        }
        setError(
          caught.code === 'RATE_LIMITED'
            ? t({
                en: 'Too many requests from this connection. Wait a few minutes and try again.',
                bn: 'এই সংযোগ থেকে অনেক অনুরোধ হয়েছে। কয়েক মিনিট অপেক্ষা করে আবার চেষ্টা করুন।',
              })
            : caught.message,
        );
      } else {
        setError(
          t({
            en: 'The request could not be sent. Try again in a moment.',
            bn: 'অনুরোধ পাঠানো যায়নি। কিছুক্ষণ পরে আবার চেষ্টা করুন।',
          }),
        );
      }
    }
  };

  if (status === 'success') {
    return (
      <div className="ql-alert ql-alert-success" role="status" aria-live="polite">
        <CheckCircle2 size={20} className="mt-0.5 shrink-0 text-ql-success" aria-hidden="true" />
        <div>
          <p className="font-semibold text-ql-ink">
            {t({ en: 'Request received', bn: 'অনুরোধ পাওয়া গেছে' })}
          </p>
          <p className="mt-1 text-[14px] leading-6 text-ql-ink-muted">
            {t({
              en: 'We will contact you at the work email you provided.',
              bn: 'আপনার দেওয়া কর্মস্থলের ইমেইলে আমরা যোগাযোগ করব।',
            })}
          </p>
          {reference ? (
            <p className="mt-2 font-ql-mono text-[13px] text-ql-ink-subtle">
              {t({ en: 'Reference', bn: 'রেফারেন্স' })}: {reference}
            </p>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <form id={id} onSubmit={submit} className="space-y-4" noValidate>
      {error ? (
        <div className="ql-alert ql-alert-danger" role="alert">
          <CircleAlert size={18} className="mt-0.5 shrink-0 text-ql-danger" aria-hidden="true" />
          <span>{error}</span>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id={`${fieldId}-name`}
          label={t({ en: 'Your name', bn: 'আপনার নাম' })}
          error={fieldErrors.name}
          required
        >
          <input
            className="ql-input"
            id={`${fieldId}-name`}
            name="name"
            autoComplete="name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            aria-invalid={fieldErrors.name ? 'true' : undefined}
            aria-describedby={fieldErrors.name ? `${fieldId}-name-error` : undefined}
            disabled={status === 'pending'}
            required
          />
        </Field>
        <Field
          id={`${fieldId}-email`}
          label={t({ en: 'Work email', bn: 'কর্মস্থলের ইমেইল' })}
          error={fieldErrors.email}
          required
        >
          <input
            className="ql-input"
            id={`${fieldId}-email`}
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            aria-invalid={fieldErrors.email ? 'true' : undefined}
            aria-describedby={fieldErrors.email ? `${fieldId}-email-error` : undefined}
            disabled={status === 'pending'}
            required
          />
        </Field>
      </div>

      <Field
        id={`${fieldId}-company`}
        label={t({ en: 'Company', bn: 'কোম্পানি' })}
        error={fieldErrors.company}
        required
      >
        <input
          className="ql-input"
          id={`${fieldId}-company`}
          name="company"
          autoComplete="organization"
          value={company}
          onChange={(event) => setCompany(event.target.value)}
          aria-invalid={fieldErrors.company ? 'true' : undefined}
          aria-describedby={fieldErrors.company ? `${fieldId}-company-error` : undefined}
          disabled={status === 'pending'}
          required
        />
      </Field>

      <Field
        id={`${fieldId}-message`}
        label={t({ en: 'What would you like to cover? (optional)', bn: 'কী নিয়ে আলোচনা করতে চান? (ঐচ্ছিক)' })}
        error={fieldErrors.message}
        hint={t({
          en: 'Do not include financial records, passwords or sensitive personal data.',
          bn: 'আর্থিক রেকর্ড, পাসওয়ার্ড বা সংবেদনশীল ব্যক্তিগত তথ্য দেবেন না।',
        })}
      >
        <textarea
          className="ql-textarea min-h-[104px] resize-y"
          id={`${fieldId}-message`}
          name="message"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          maxLength={2000}
          aria-invalid={fieldErrors.message ? 'true' : undefined}
          aria-describedby={`${fieldId}-message-hint${fieldErrors.message ? ` ${fieldId}-message-error` : ''}`}
          disabled={status === 'pending'}
        />
      </Field>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="mkt-small max-w-sm">
          {t({
            en: 'We use these details only to respond to your request.',
            bn: 'আমরা এই তথ্য শুধু আপনার অনুরোধের উত্তর দিতে ব্যবহার করি।',
          })}{' '}
          <a href="/legal" className="ql-link">
            {t({ en: 'Legal and privacy', bn: 'আইন ও গোপনীয়তা' })}
          </a>
        </p>
        <button type="submit" className="ql-btn ql-btn-primary shrink-0" disabled={status === 'pending'}>
          {status === 'pending' ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : null}
          {status === 'pending'
            ? t({ en: 'Sending request…', bn: 'অনুরোধ পাঠানো হচ্ছে…' })
            : t({ en: 'Request a walkthrough', bn: 'ওয়াকথ্রু চান' })}
          {status !== 'pending' ? <ArrowRight size={16} aria-hidden="true" /> : null}
        </button>
      </div>
    </form>
  );
}

function Field({
  id,
  label,
  error,
  hint,
  required,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  required?: boolean;
  children: ReactNode;
}) {
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  return (
    <div>
      <label className="ql-label" htmlFor={id}>
        {label}
        {required ? <span className="ml-1 text-ql-danger">*</span> : null}
      </label>
      {children}
      {hint ? (
        <span className="ql-hint" id={hintId}>
          {hint}
        </span>
      ) : null}
      {error ? (
        <span className="ql-field-error" id={errorId}>
          <CircleAlert size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
          {error}
        </span>
      ) : null}
    </div>
  );
}

export default DemoRequestForm;
