// Production Content-Security-Policy construction for the static application shell.
//
// The public/application HTML contains two intentional inline scripts: the pre-paint theme
// bootstrap and the JSON-LD metadata block. A static host cannot mint a per-request nonce, so the
// build computes SHA-256 hashes for those exact blocks and pins them in the policy. Inline
// JavaScript is never allowed by `'unsafe-inline'`, and external script origins are not allowed.

const INLINE_SCRIPT = /<script\b(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi;

export function extractInlineScripts(html: string): string[] {
  const scripts: string[] = [];
  for (const match of html.matchAll(INLINE_SCRIPT)) {
    const body = match[1];
    if (body !== undefined) scripts.push(body);
  }
  return scripts;
}

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export async function inlineScriptHashes(html: string): Promise<string[]> {
  const encoder = new TextEncoder();
  const hashes = await Promise.all(
    extractInlineScripts(html).map(async (script) => {
      const digest = await crypto.subtle.digest('SHA-256', encoder.encode(script));
      return `'sha256-${base64(new Uint8Array(digest))}'`;
    }),
  );
  return Array.from(new Set(hashes));
}

export interface CspOptions {
  /** Relative API base (`/api/v1`) or an absolute HTTPS origin. */
  apiBaseUrl?: string;
  /** Canonical site origin; only HTTPS origins enable upgrade-insecure-requests. */
  siteUrl?: string;
}

export function buildCsp(hashes: readonly string[], options: CspOptions = {}): string {
  const scriptSources = ["'self'", ...hashes];
  const connectSources = ["'self'"];
  const apiBase = options.apiBaseUrl?.trim();
  if (apiBase && /^https?:\/\//i.test(apiBase)) {
    try {
      const origin = new URL(apiBase).origin;
      if (origin !== 'null') connectSources.push(origin);
    } catch {
      // An invalid absolute URL is left out; the default same-origin rule still applies.
    }
  }
  const directives = [
    "default-src 'self'",
    `script-src ${scriptSources.join(' ')}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src ${connectSources.join(' ')}`,
    "media-src 'self'",
    "object-src 'none'",
    "frame-src 'none'",
    "worker-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ];
  if (options.siteUrl && /^https:\/\//i.test(options.siteUrl)) {
    directives.push('upgrade-insecure-requests');
  }
  return directives.join('; ');
}

export async function injectCsp(html: string, options: CspOptions = {}): Promise<string> {
  if (/http-equiv=["']Content-Security-Policy["']/i.test(html)) return html;
  const hashes = await inlineScriptHashes(html);
  const policy = buildCsp(hashes, options);
  const meta = `<meta http-equiv="Content-Security-Policy" content="${policy}" />`;
  if (!html.includes('</head>')) return html;
  return html.replace('</head>', `    ${meta}\n  </head>`);
}
