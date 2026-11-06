import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, KeyRound, Loader2 } from 'lucide-react';
import { ApiError, authApi } from '../../auth/api';
import { AuthError, AuthLayout, AuthSuccess, Field, useAuthUi } from './AuthLayout';

export default function ResetPasswordPage() {
  const ui = useAuthUi();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setError(null);
    if (!token) {
      setError(ui.L('This reset link is missing its token. Request a new link.', 'এই রিসেট লিংকে টোকেন নেই। নতুন লিংক নিন।'));
      return;
    }
    if (password !== confirm) {
      setError(ui.L('The two passwords do not match.', 'দুইটি পাসওয়ার্ড মিলছে না।'));
      return;
    }
    setPending(true);
    try {
      await authApi.resetPassword(token, password);
      setDone(true);
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : ui.L('The password could not be reset. Request a new link.', 'পাসওয়ার্ড রিসেট হয়নি। নতুন লিংক নিন।'),
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <AuthLayout
      ui={ui}
      title={ui.L('Choose a new password', 'নতুন পাসওয়ার্ড দিন')}
      subtitle={ui.L(
        'A successful reset signs out every existing session for this account.',
        'সফলভাবে রিসেট হলে এই অ্যাকাউন্টের সব চলমান সেশন সাইন আউট হবে।',
      )}
      footer={
        <Link to="/login" className="inline-flex items-center gap-1.5 font-semibold text-ql-brand hover:underline">
          <ArrowLeft size={14} /> {ui.L('Back to sign in', 'সাইন ইনে ফিরে যান')}
        </Link>
      }
    >
      {done ? (
        <div className="space-y-4">
          <AuthSuccess message={ui.L('Password updated. Sign in with the new password.', 'পাসওয়ার্ড আপডেট হয়েছে। নতুন পাসওয়ার্ড দিয়ে সাইন ইন করুন।')} />
          <Link to="/login" className="ql-btn ql-btn-primary min-h-11 w-full justify-center text-[14px]">
            {ui.L('Continue to sign in', 'সাইন ইনে যান')}
          </Link>
        </div>
      ) : (
        <>
          {error ? <AuthError message={error} /> : null}
          <form onSubmit={submit} className="space-y-4">
            <Field
              label={ui.L('New password', 'নতুন পাসওয়ার্ড')}
              hint={ui.L('At least 12 characters. Avoid common phrases and your email address.', 'কমপক্ষে ১২ অক্ষর। সাধারণ বাক্যাংশ ও আপনার ইমেইল এড়িয়ে চলুন।')}
            >
              <input
                className="ql-input min-h-11 w-full text-[14px]"
                type="password"
                autoComplete="new-password"
                required
                minLength={12}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={pending}
              />
            </Field>
            <Field label={ui.L('Confirm new password', 'নতুন পাসওয়ার্ড নিশ্চিত করুন')}>
              <input
                className="ql-input min-h-11 w-full text-[14px]"
                type="password"
                autoComplete="new-password"
                required
                minLength={12}
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
                disabled={pending}
              />
            </Field>
            <button
              type="submit"
              disabled={pending}
              className="ql-btn ql-btn-primary min-h-11 w-full justify-center text-[14px]"
            >
              {pending ? <Loader2 size={16} className="animate-spin" /> : <KeyRound size={16} />}
              {ui.L('Update password', 'পাসওয়ার্ড আপডেট করুন')}
            </button>
          </form>
        </>
      )}
    </AuthLayout>
  );
}
