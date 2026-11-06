// Verify the production shell's security metadata without trusting the build output blindly.
// Run after `npm run build`.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const indexPath = path.join(root, 'dist', 'index.html');
const failures = [];
const checks = [];

function check(name, condition, detail) {
  if (condition) {
    checks.push(`PASS ${name}`);
  } else {
    failures.push(`FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

let html;
try {
  html = readFileSync(indexPath, 'utf8');
} catch {
  console.error('FAIL dist/index.html is missing. Run `npm run build` first.');
  process.exit(1);
}

const cspMatch = /<meta\s+http-equiv=["']Content-Security-Policy["']\s+content="([^"]+)"/i.exec(html);
check('production CSP meta tag is present', Boolean(cspMatch));
const csp = cspMatch?.[1] ?? '';

if (csp) {
  const scriptDirective = /(?:^|;\s*)script-src\s+([^;]+)/i.exec(csp)?.[1] ?? '';
  check("script-src does not allow 'unsafe-inline'", !scriptDirective.includes("'unsafe-inline'"));
  check("script-src allows same-origin scripts", scriptDirective.includes("'self'"));

  const inlineScripts = Array.from(html.matchAll(/<script\b(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi));
  check('at least one inline script is pinned by hash', inlineScripts.length > 0 && scriptDirective.includes("'sha256-"));
  for (const [index, match] of inlineScripts.entries()) {
    const body = match[1] ?? '';
    const hash = `'sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}'`;
    check(`inline script ${index + 1} hash matches the policy`, scriptDirective.includes(hash), hash);
  }

  check("object-src is disabled", /(?:^|;\s*)object-src\s+'none'/i.test(csp));
  check("base-uri is restricted", /(?:^|;\s*)base-uri\s+'self'/i.test(csp));
  check(
    "frame-ancestors is left to the edge header rather than a non-enforcing meta tag",
    !/(?:^|;\s*)frame-ancestors\s/i.test(csp),
  );
  check("connect-src allows same-origin API calls", /(?:^|;\s*)connect-src\s+[^;]*'self'/i.test(csp));
}

check(
  'referrer policy is no-referrer',
  /<meta\s+name=["']referrer["']\s+content=["']no-referrer["']/i.test(html),
);
check('no Google Fonts stylesheet is requested', !/fonts\.(googleapis|gstatic)\.com/i.test(html));
check('no external script origin is referenced', !/<script[^>]+src=["']https?:\/\//i.test(html));

for (const line of checks) console.log(line);
for (const line of failures) console.error(line);
if (failures.length > 0) process.exit(1);
console.log(`Built security metadata verified (${checks.length} checks).`);
