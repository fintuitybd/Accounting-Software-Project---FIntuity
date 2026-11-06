import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { BadgeCheck, Loader2 } from 'lucide-react';
import { ApiError, authApi } from '../../auth/api';
import { AuthError, AuthLayout, AuthSuccess, useAuthUi } from './AuthLayout';

export default function VerifyEmailPage() {
  const ui = useAuthUi();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const verify = async (): Promise<void> => {
    if (!token) {
      setError(ui.L('This verification link is missing its token.', 'এই যাচাই লিংকে টোকেন নেই।'));
      return;
    }
    setPending(true);
    setError(null);
    try {
      const response = await authApi.verifyEmail(token);
      setMessage(response.message);
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : ui.L('The email could not be verified.', 'ইমেইল যাচাই করা যায়নি।'),
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <AuthLayout
      ui={ui}
      title={ui.L('Verify your email', 'আপনার ইমেইল যাচাই করুন')}
      subtitle={ui.L('Confirm that this address belongs to you. The link can be used once.', 'নিশ্চিত করুন এই ঠিকানাটি আপনার। লিংকটি একবারই ব্যবহার করা যাবে।')}
      footer={<Link to="/app" className="font-semibold text-ql-brand hover:underline">{ui.L('Continue to Fintuity Accounting Suite', 'ফিনটুইটি অ্যাকাউন্টিং স্যুটে এগিয়ে যান')}</Link>}
    >
      {message ? <AuthSuccess message={message} /> : null}
      {error ? <AuthError message={error} /> : null}
      {!message ? (
        <button
          type="button"
          onClick={() => void verify()}
          disabled={pending}
          className="ql-btn ql-btn-primary min-h-11 w-full justify-center text-[14px]"
        >
          {pending ? <Loader2 size={16} className="animate-spin" /> : <BadgeCheck size={16} />}
          {ui.L('Verify this email', 'এই ইমেইল যাচাই করুন')}
        </button>
      ) : null}
    </AuthLayout>
  );
}
