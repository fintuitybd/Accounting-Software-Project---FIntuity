import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';

export interface PageBreadcrumb {
  label: string;
  href?: string;
}

export function PageHeader({
  title,
  description,
  eyebrow,
  breadcrumbs,
  meta,
  actions,
}: {
  title: string;
  description?: string;
  eyebrow?: string;
  breadcrumbs?: PageBreadcrumb[];
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-6 border-b border-ql-border pb-5">
      {breadcrumbs && breadcrumbs.length > 0 ? (
        <nav aria-label="Breadcrumb" className="mb-2">
          <ol className="flex flex-wrap items-center gap-1 text-[13px] text-ql-ink-muted">
            {breadcrumbs.map((crumb, index) => {
              const last = index === breadcrumbs.length - 1;
              return (
                <li key={`${crumb.label}-${index}`} className="flex items-center gap-1">
                  {crumb.href && !last ? (
                    crumb.href.startsWith('/') ? (
                      <Link
                        to={crumb.href}
                        className="rounded-ql-control px-1 py-0.5 hover:bg-ql-surface-muted hover:text-ql-ink"
                      >
                        {crumb.label}
                      </Link>
                    ) : (
                      <a href={crumb.href} className="rounded-ql-control px-1 py-0.5 hover:bg-ql-surface-muted hover:text-ql-ink">
                        {crumb.label}
                      </a>
                    )
                  ) : (
                    <span className={last ? 'font-medium text-ql-ink' : undefined} aria-current={last ? 'page' : undefined}>
                      {crumb.label}
                    </span>
                  )}
                  {last ? null : <ChevronRight size={14} aria-hidden className="text-ql-ink-subtle" />}
                </li>
              );
            })}
          </ol>
        </nav>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          {eyebrow ? <p className="mb-1 text-[13px] font-medium text-ql-brand">{eyebrow}</p> : null}
          <h1 className="text-balance text-[26px] font-semibold leading-tight tracking-[-0.02em] text-ql-ink sm:text-[30px]">
            {title}
          </h1>
          {description ? (
            <p className="mt-2 max-w-3xl text-[14px] leading-6 text-ql-ink-muted">{description}</p>
          ) : null}
          {meta ? <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px] text-ql-ink-muted">{meta}</div> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}

export default PageHeader;
