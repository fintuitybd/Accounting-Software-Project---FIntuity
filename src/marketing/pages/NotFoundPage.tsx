import { Link } from 'react-router-dom';
import { useMarketingUi } from '../MarketingApp';
import { l } from '../content';
import { usePageMeta } from '../usePageMeta';

export default function NotFoundPage() {
  const { t } = useMarketingUi();
  usePageMeta({
    title: 'Page not found — Fintuity Accounting Suite',
    description: 'The page you requested could not be found.',
    path: '/404',
    robots: 'noindex,follow',
  });

  return (
    <div className="mkt-container mkt-section">
      <p className="ql-eyebrow">404</p>
      <h1 className="mkt-h1 mt-4 max-w-2xl text-ql-ink">
        {t(l('That page is not here.', 'পৃষ্ঠাটি এখানে নেই।'))}
      </h1>
      <p className="mkt-lead mt-4 max-w-xl">
        {t(
          l(
            'The link may be old, or the page may have moved. Return to the home page or sign in to the application.',
            'লিংকটি পুরোনো হতে পারে, বা পৃষ্ঠাটি সরানো হয়েছে। হোম পেজে ফিরে যান অথবা অ্যাপ্লিকেশনে সাইন ইন করুন।',
          ),
        )}
      </p>
      <div className="mt-7 flex flex-col gap-3 sm:flex-row">
        <Link to="/" className="ql-btn ql-btn-primary">
          {t(l('Back to the home page', 'হোম পেজে ফিরে যান'))}
        </Link>
        <a href="/login" className="ql-btn ql-btn-secondary">
          {t(l('Sign in', 'সাইন ইন'))}
        </a>
      </div>
    </div>
  );
}
