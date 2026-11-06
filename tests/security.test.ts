import { describe, expect, it } from 'vitest';
import { buildCsp, extractInlineScripts, inlineScriptHashes, injectCsp } from '../src/security/csp';

describe('production content security policy', () => {
  it('extracts only inline scripts and ignores external modules', () => {
    const html = [
      '<script src="/src/main.tsx"></script>',
      '<script>window.theme = "dark";</script>',
      '<script type="application/ld+json">{"@type":"Organization"}</script>',
    ].join('');
    expect(extractInlineScripts(html)).toEqual(['window.theme = "dark";', '{"@type":"Organization"}']);
  });

  it('pins every inline script by SHA-256 and never permits unsafe inline scripts', async () => {
    const html = '<html><head><script>window.theme = "dark";</script></head><body></body></html>';
    const hashes = await inlineScriptHashes(html);
    expect(hashes).toHaveLength(1);
    expect(hashes[0]).toMatch(/^'sha256-[A-Za-z0-9+/=]+'$/);
    const policy = buildCsp(hashes, { siteUrl: 'https://app.example.test' });
    expect(policy).toContain(`script-src 'self' ${hashes[0]}`);
    expect(policy).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    expect(policy).toContain('upgrade-insecure-requests');
  });

  it('adds an absolute API origin to connect-src and keeps relative bases same-origin', () => {
    const absolute = buildCsp([], { apiBaseUrl: 'https://api.example.test/api/v1' });
    expect(absolute).toContain("connect-src 'self' https://api.example.test");
    const relative = buildCsp([], { apiBaseUrl: '/api/v1' });
    expect(relative).toContain("connect-src 'self'");
    expect(relative).not.toContain('http://localhost');
  });

  it('injects the policy once and reuses the production html shell', async () => {
    const html = '<html><head><script>window.theme = "dark";</script></head><body></body></html>';
    const once = await injectCsp(html, { apiBaseUrl: '/api/v1' });
    const twice = await injectCsp(once, { apiBaseUrl: '/api/v1' });
    expect(once.match(/Content-Security-Policy/g)).toHaveLength(1);
    expect(twice).toBe(once);
    expect(once).toContain("object-src 'none'");
    // frame-ancestors is ignored in a meta tag and must be enforced by the edge header.
    expect(once).not.toContain('frame-ancestors');
  });
});
