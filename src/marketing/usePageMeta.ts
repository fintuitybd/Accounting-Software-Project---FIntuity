import { useEffect } from 'react';

const SITE_URL = (import.meta.env.VITE_PUBLIC_SITE_URL || '').replace(/\/+$/, '');

function absoluteUrl(path: string): string {
  const origin =
    SITE_URL || (typeof window === 'undefined' ? 'http://localhost:5173' : window.location.origin);
  return `${origin}${path.startsWith('/') ? path : `/${path}`}`;
}

function setMeta(selector: string, attribute: 'name' | 'property', key: string, content: string): void {
  if (typeof document === 'undefined') return;
  let element = document.head.querySelector<HTMLMetaElement>(selector);
  if (!element) {
    element = document.createElement('meta');
    element.setAttribute(attribute, key);
    document.head.appendChild(element);
  }
  element.setAttribute('content', content);
}

export interface PageMeta {
  title: string;
  description: string;
  path: string;
  robots?: string;
}

/**
 * Keep public-page metadata deterministic across client navigation. The initial document carries
 * the landing metadata for crawlers; this hook updates the same tags when a visitor moves between
 * public pages without a full reload.
 */
export function usePageMeta({ title, description, path, robots = 'index,follow' }: PageMeta): void {
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const url = absoluteUrl(path);
    document.title = title;

    setMeta('meta[name="description"]', 'name', 'description', description);
    setMeta('meta[name="robots"]', 'name', 'robots', robots);
    setMeta('meta[property="og:title"]', 'property', 'og:title', title);
    setMeta('meta[property="og:description"]', 'property', 'og:description', description);
    setMeta('meta[property="og:url"]', 'property', 'og:url', url);
    setMeta('meta[name="twitter:title"]', 'name', 'twitter:title', title);
    setMeta('meta[name="twitter:description"]', 'name', 'twitter:description', description);

    let canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement('link');
      canonical.rel = 'canonical';
      document.head.appendChild(canonical);
    }
    canonical.href = url;
  }, [title, description, path, robots]);
}
