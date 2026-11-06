import { Link, useSearchParams } from 'react-router-dom';
import { Clock3, LogIn } from 'lucide-react';
import { AuthLayout, useAuthUi } from './AuthLayout';

function safeReturnTo(value: string | null): string {
  if (!value) return '/app';
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return '/app';
  return value;
}

export default function SessionExpiredPage() {
  const ui = useAuthUi();
  const [params] = useSearchParams();
  const returnTo = safeReturnTo(params.get('returnTo'));
  const loginUrl = `/login?expired=1&returnTo=${encodeURIComponent(returnTo)}`;

  return (
    <AuthLayout
      ui={ui}
      title={ui.L('Your session has ended', 'আপনার সেশন শেষ হয়েছে')}
      subtitle={ui.L(
        'For financial data, sessions expire after a period of inactivity or at the absolute session limit. Sign in again to continue.',
        'আর্থিক তথ্যের নিরাপত্তায় নির্দিষ্ট সময় নিষ্ক্রিয় থাকলে বা সর্বোচ্চ সেশন সীমায় পৌঁছালে সেশন শেষ হয়। চালিয়ে যেতে আবার সাইন ইন করুন।',
      )}
      footer={<Link to="/login" className="font-semibold text-ql-brand hover:underline">{ui.L('Return to sign in', 'সাইন ইনে ফিরে যান')}</Link>}
    >
      <div className="space-y-4">
        <div className="flex items-start gap-3 rounded-ql border border-ql-border bg-ql-surface-muted p-4 text-[13px] leading-relaxed text-ql-ink-muted">
          <Clock3 size={18} className="mt-0.5 shrink-0 text-ql-brand" />
          <p>
            {ui.L(
              'Nothing was posted while the session was expired. Any unsaved form data may be lost; reload the page after signing in.',
              'সেশন শেষ থাকাকালীন কিছুই পোস্ট হয়নি। অসংরক্ষিত ফর্মের তথ্য হারাতে পারে; সাইন ইন করে পেজটি রিলোড করুন।',
            )}
          </p>
        </div>
        <Link to={loginUrl} className="ql-btn ql-btn-primary min-h-11 w-full justify-center text-[14px]">
          <LogIn size={16} /> {ui.L('Sign in again', 'আবার সাইন ইন করুন')}
        </Link>
      </div>
    </AuthLayout>
  );
}
