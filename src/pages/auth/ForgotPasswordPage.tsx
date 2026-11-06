import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Loader2, Send } from 'lucide-react';
import { ApiError, authApi } from '../../auth/api';
import { AuthError, AuthLayout, AuthSuccess, Field, useAuthUi } from './AuthLayout';

export default function ForgotPasswordPage() {
  const ui = useAuthUi();
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      const response = await authApi.forgotPassword(email.trim());
      setMessage(response.message);
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : ui.L('The request could not be sent. Try again.', 'অনুরোধ পাঠানো যায়নি। আবার চেষ্টা করুন।'),
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <AuthLayout
      ui={ui}
      title={ui.L('Reset your password', 'পাসওয়ার্ড রিসেট করুন')}
      subtitle={ui.L(
        'Enter your account email. If it exists, we will send a single-use reset link. The response is the same whether or not an account exists.',
        'আপনার অ্যাকাউন্টের ইমেইল দিন। অ্যাকাউন্ট থাকলে একক-ব্যবহারের রিসেট লিংক পাঠানো হবে। অ্যাকাউন্ট থাকুক বা না থাকুক একই উত্তর দেখানো হবে।',
      )}
      footer={
        <Link to="/login" className="inline-flex items-center gap-1.5 font-semibold text-ql-brand hover:underline">
          <ArrowLeft size={14} /> {ui.L('Back to sign in', 'সাইন ইনে ফিরে যান')}
        </Link>
      }
    >
      {message ? <AuthSuccess message={ui.L(message, 'অ্যাকাউন্ট থাকলে রিসেট লিংক পাঠানো হয়েছে।')} /> : null}
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
            disabled={pending}
          />
        </Field>
        <button
          type="submit"
          disabled={pending}
          className="ql-btn ql-btn-primary min-h-11 w-full justify-center text-[14px]"
        >
          {pending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
          {ui.L('Send reset link', 'রিসেট লিংক পাঠান')}
        </button>
      </form>
    </AuthLayout>
  );
}
