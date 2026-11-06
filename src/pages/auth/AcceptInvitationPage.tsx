import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Building2, Loader2, UserPlus } from 'lucide-react';
import { ApiError, authApi } from '../../auth/api';
import { useAuth } from '../../auth/AuthContext';
import { ROLE_LABELS } from '../../auth/roles';
import type { InvitationDetails } from '../../auth/types';
import { AuthError, AuthLayout, AuthSuccess, Field, useAuthUi } from './AuthLayout';

export default function AcceptInvitationPage() {
  const ui = useAuthUi();
  const auth = useAuth();
  const navigate = useNavigate();
  const { token = '' } = useParams();
  const [details, setDetails] = useState<InvitationDetails | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    authApi
      .invitationDetails(token)
      .then((response) => {
        if (!cancelled) setDetails(response);
      })
      .catch((caught) => {
        if (!cancelled) {
          setLoadError(
            caught instanceof ApiError
              ? caught.message
              : ui.L('The invitation could not be loaded.', 'আমন্ত্রণ লোড করা যায়নি।'),
          );
        }
      });
    return () => {
      cancelled = true;
    };
    // The localized error text is intentionally read once for this token.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const accept = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    setPending(true);
    try {
      await authApi.acceptInvitation(token, {
        ...(name.trim() ? { name: name.trim() } : {}),
        ...(auth.status !== 'authenticated' ? { password } : {}),
      });
      await auth.refresh();
      setSuccess(ui.L('Invitation accepted. Opening your workspace…', 'আমন্ত্রণ গৃহীত হয়েছে। ওয়ার্কস্পেস খোলা হচ্ছে…'));
      navigate('/app', { replace: true });
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'ACCOUNT_EXISTS') {
        setError(
          ui.L(
            'An account with this email already exists. Sign in first, then open this invitation link again.',
            'এই ইমেইলে একটি অ্যাকাউন্ট আছে। আগে সাইন ইন করুন, তারপর এই আমন্ত্রণ লিংকটি আবার খুলুন।',
          ),
        );
      } else if (caught instanceof ApiError && caught.code === 'ACCOUNT_MISMATCH') {
        setError(
          ui.L(
            'You are signed in with a different email. Sign out, then accept the invitation with the invited address.',
            'আপনি ভিন্ন ইমেইলে সাইন ইন করেছেন। সাইন আউট করে আমন্ত্রিত ঠিকানা দিয়ে আমন্ত্রণ গ্রহণ করুন।',
          ),
        );
      } else {
        setError(
          caught instanceof ApiError
            ? caught.message
            : ui.L('The invitation could not be accepted.', 'আমন্ত্রণ গ্রহণ করা যায়নি।'),
        );
      }
    } finally {
      setPending(false);
    }
  };

  const loginLink = `/login?returnTo=${encodeURIComponent(`/accept-invitation/${token}`)}`;

  if (loadError) {
    return (
      <AuthLayout
        ui={ui}
        title={ui.L('Invitation unavailable', 'আমন্ত্রণ পাওয়া যাচ্ছে না')}
        subtitle={ui.L('Ask an organisation administrator to send a fresh invitation.', 'প্রতিষ্ঠানের প্রশাসককে নতুন আমন্ত্রণ পাঠাতে বলুন।')}
        footer={<Link to="/login" className="font-semibold text-ql-brand hover:underline">{ui.L('Go to sign in', 'সাইন ইনে যান')}</Link>}
      >
        <AuthError message={loadError} />
      </AuthLayout>
    );
  }

  if (!details) {
    return (
      <AuthLayout ui={ui} title={ui.L('Loading invitation', 'আমন্ত্রণ লোড হচ্ছে')} subtitle={ui.L('Checking the single-use link.', 'একক-ব্যবহারের লিংক যাচাই করা হচ্ছে।')}>
        <div className="flex items-center gap-2 text-[14px] text-ql-ink-muted">
          <Loader2 size={18} className="animate-spin" /> {ui.L('Please wait…', 'অপেক্ষা করুন…')}
        </div>
      </AuthLayout>
    );
  }

  if (details.status !== 'PENDING') {
    const message =
      details.status === 'EXPIRED'
        ? ui.L('This invitation has expired. Ask an administrator to resend it.', 'এই আমন্ত্রণের মেয়াদ শেষ। প্রশাসককে আবার পাঠাতে বলুন।')
        : details.status === 'ACCEPTED'
          ? ui.L('This invitation has already been accepted. Sign in instead.', 'এই আমন্ত্রণ আগেই গৃহীত হয়েছে। পরিবর্তে সাইন ইন করুন।')
          : ui.L('This invitation has been revoked.', 'এই আমন্ত্রণ প্রত্যাহার করা হয়েছে।');
    return (
      <AuthLayout
        ui={ui}
        title={ui.L('Invitation no longer active', 'আমন্ত্রণ আর সক্রিয় নয়')}
        subtitle={details.organisationName}
        footer={<Link to="/login" className="font-semibold text-ql-brand hover:underline">{ui.L('Go to sign in', 'সাইন ইনে যান')}</Link>}
      >
        <AuthError message={message} />
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      ui={ui}
      title={ui.L('Accept your invitation', 'আপনার আমন্ত্রণ গ্রহণ করুন')}
      subtitle={ui.L('Review the organisation and role before joining.', 'যোগ দেওয়ার আগে প্রতিষ্ঠান ও ভূমিকা যাচাই করুন।')}
      footer={<Link to="/login" className="inline-flex items-center gap-1.5 font-semibold text-ql-brand hover:underline"><ArrowLeft size={14} /> {ui.L('Back to sign in', 'সাইন ইনে ফিরে যান')}</Link>}
    >
      <div className="mb-5 rounded-ql border border-ql-border bg-ql-surface-muted p-4">
        <p className="flex items-center gap-2 text-[14px] font-semibold text-ql-ink">
          <Building2 size={16} className="text-ql-brand" /> {details.organisationName}
        </p>
        <dl className="mt-3 grid gap-2 text-[13px] sm:grid-cols-2">
          <div>
            <dt className="text-ql-ink-subtle">{ui.L('Invited email', 'আমন্ত্রিত ইমেইল')}</dt>
            <dd className="font-medium text-ql-ink">{details.emailMasked}</dd>
          </div>
          <div>
            <dt className="text-ql-ink-subtle">{ui.L('Role', 'ভূমিকা')}</dt>
            <dd className="font-medium text-ql-ink">{ui.L(ROLE_LABELS[details.role].label_en, ROLE_LABELS[details.role].label_bn)}</dd>
          </div>
          <div>
            <dt className="text-ql-ink-subtle">{ui.L('Expires', 'মেয়াদ শেষ')}</dt>
            <dd className="font-medium text-ql-ink">{new Date(details.expiresAt).toLocaleString(ui.locale)}</dd>
          </div>
        </dl>
      </div>

      {error ? <AuthError message={error} /> : null}
      {success ? <AuthSuccess message={success} /> : null}

      {auth.status === 'authenticated' ? (
        <div className="space-y-4">
          <p className="rounded-ql-control border border-ql-border bg-ql-surface-muted px-3 py-2.5 text-[13px] text-ql-ink-muted">
            {ui.L(
              `Signed in as ${auth.user?.name ?? ''}. The invitation will only be accepted if it matches this account.`,
              `${auth.user?.name ?? ''} হিসেবে সাইন ইন করা আছে। এই অ্যাকাউন্টের সাথে মিললেই আমন্ত্রণ গৃহীত হবে।`,
            )}
          </p>
          <form onSubmit={accept} className="space-y-3">
            <button type="submit" disabled={pending} className="ql-btn ql-btn-primary min-h-11 w-full justify-center text-[14px]">
              {pending ? <Loader2 size={16} className="animate-spin" /> : <UserPlus size={16} />}
              {ui.L('Accept invitation', 'আমন্ত্রণ গ্রহণ করুন')}
            </button>
          </form>
          <p className="text-center text-[13px] text-ql-ink-muted">
            <button
              type="button"
              onClick={async () => {
                await auth.logout().catch(() => undefined);
                setError(null);
              }}
              className="font-semibold text-ql-brand hover:underline"
            >
              {ui.L('Sign out and use a different account', 'সাইন আউট করে অন্য অ্যাকাউন্ট ব্যবহার করুন')}
            </button>
          </p>
        </div>
      ) : (
        <form onSubmit={accept} className="space-y-4">
          <Field label={ui.L('Your full name', 'আপনার পুরো নাম')}>
            <input
              className="ql-input min-h-11 w-full text-[14px]"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              autoComplete="name"
              disabled={pending}
            />
          </Field>
          <Field
            label={ui.L('Create a password', 'একটি পাসওয়ার্ড তৈরি করুন')}
            hint={ui.L('At least 12 characters. You will use this to sign in.', 'কমপক্ষে ১২ অক্ষর। এটি দিয়ে সাইন ইন করবেন।')}
          >
            <input
              className="ql-input min-h-11 w-full text-[14px]"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              minLength={12}
              autoComplete="new-password"
              disabled={pending}
            />
          </Field>
          <button type="submit" disabled={pending} className="ql-btn ql-btn-primary min-h-11 w-full justify-center text-[14px]">
            {pending ? <Loader2 size={16} className="animate-spin" /> : <UserPlus size={16} />}
            {ui.L('Accept invitation', 'আমন্ত্রণ গ্রহণ করুন')}
          </button>
          <p className="text-center text-[13px] text-ql-ink-muted">
            {ui.L('Already have an account?', 'আগে থেকেই অ্যাকাউন্ট আছে?')}{' '}
            <Link to={loginLink} className="font-semibold text-ql-brand hover:underline">
              {ui.L('Sign in first', 'আগে সাইন ইন করুন')}
            </Link>
          </p>
        </form>
      )}
    </AuthLayout>
  );
}
