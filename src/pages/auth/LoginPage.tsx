import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, Loader2, ShieldCheck } from 'lucide-react';
import { ApiError } from '../../auth/api';
import { useAuth } from '../../auth/AuthContext';
import { AuthError, AuthLayout, Field, useAuthUi } from './AuthLayout';

function safeReturnTo(value: string | null): string {
  if (!value) return '/app';
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return '/app';
  return value;
}

export default function LoginPage() {
  const ui = useAuthUi();
  const auth = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const returnTo = safeReturnTo(params.get('returnTo'));
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(params.get('expired') === '1' ? ui.L('Your session expired. Sign in again to continue.', 'আপনার সেশন শেষ হয়েছে। চালিয়ে যেতে আবার সাইন ইন করুন।') : null);
  const [pending, setPending] = useState(false);

  if (auth.status === 'authenticated') {
    return <Navigate to={returnTo} replace />;
  }

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      await auth.login(email.trim(), password);
      navigate(returnTo, { replace: true });
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : ui.L('Sign-in could not be completed. Try again.', 'সাইন ইন সম্পন্ন হয়নি। আবার চেষ্টা করুন।'),
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <AuthLayout
      ui={ui}
      title={ui.L('Sign in to Fintuity Accounting Suite', 'ফিনটুইটি অ্যাকাউন্টিং স্যুটে সাইন ইন')}
      subtitle={ui.L(
        'Use the email address your organisation invited. Access is limited to the companies assigned to you.',
        'আপনার প্রতিষ্ঠানের আমন্ত্রিত ইমেইল ব্যবহার করুন। শুধুমাত্র আপনার নির্ধারিত কোম্পানিগুলোতে প্রবেশাধিকার থাকবে।',
      )}
      footer={
        <span>
          {ui.L('New to Fintuity Accounting Suite? Ask an organisation owner to invite you.', 'ফিনটুইটি অ্যাকাউন্টিং স্যুটে নতুন? প্রতিষ্ঠানের মালিককে আমন্ত্রণ পাঠাতে বলুন।')}
        </span>
      }
    >
      {auth.demoMode ? (
        <div className="ql-alert ql-alert-warning mb-5">
          {ui.L(
            'Demo mode is active. Synthetic data only; real sign-in is disabled.',
            'ডেমো মোড চালু। শুধুমাত্র কৃত্রিম ডেটা; বাস্তব সাইন ইন নিষ্ক্রিয়।',
          )}
        </div>
      ) : null}

      {error ? <AuthError message={error} /> : null}

      <form onSubmit={submit} className="space-y-4">
        <Field label={ui.L('Email address', 'ইমেইল ঠিকানা')}>
          <input
            className="ql-input min-h-11 w-full text-[14px]"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="name@company.com"
            disabled={pending || auth.demoMode}
          />
        </Field>
        <Field label={ui.L('Password', 'পাসওয়ার্ড')}>
          <input
            className="ql-input min-h-11 w-full text-[14px]"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="••••••••••••"
            disabled={pending || auth.demoMode}
          />
        </Field>

        <div className="flex items-center justify-between gap-3">
          <Link
            to="/forgot-password"
            className="text-[13px] font-semibold text-ql-brand underline-offset-2 hover:underline"
          >
            {ui.L('Forgot password?', 'পাসওয়ার্ড ভুলে গেছেন?')}
          </Link>
          <span className="flex items-center gap-1 text-[12px] text-ql-ink-subtle">
            <ShieldCheck size={13} /> {ui.L('Server-verified session', 'সার্ভার-যাচাইকৃত সেশন')}
          </span>
        </div>

        <button
          type="submit"
          disabled={pending || auth.demoMode}
          className="ql-btn ql-btn-primary min-h-11 w-full justify-center text-[14px]"
        >
          {pending ? <Loader2 size={16} className="animate-spin" /> : null}
          {ui.L('Sign in', 'সাইন ইন')}
          {!pending ? <ArrowRight size={16} /> : null}
        </button>
      </form>

      {auth.demoMode ? (
        <button
          type="button"
          onClick={() => navigate('/app', { replace: true })}
          className="ql-btn ql-btn-secondary mt-3 min-h-11 w-full justify-center text-[14px]"
        >
          {ui.L('Enter the synthetic demo', 'কৃত্রিম ডেমোতে প্রবেশ করুন')}
        </button>
      ) : null}
    </AuthLayout>
  );
}
