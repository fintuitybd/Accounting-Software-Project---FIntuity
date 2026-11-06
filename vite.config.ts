import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { injectCsp } from './src/security/csp';

/**
 * Replace the public-site placeholder in index.html. A production build must set
 * VITE_PUBLIC_SITE_URL to the canonical HTTPS origin; the localhost fallback keeps `vite dev`
 * deterministic without pretending to know a production domain.
 */
function publicSiteUrlPlugin(siteUrl: string, isProduction: boolean): Plugin {
  return {
    name: 'ledgervault-public-site-url',
    transformIndexHtml(html) {
      return html.replaceAll('__SITE_URL__', siteUrl);
    },
    buildStart() {
      if (isProduction && siteUrl.startsWith('http://localhost')) {
        this.warn(
          'VITE_PUBLIC_SITE_URL is not set. Canonical, Open Graph and structured-data URLs will point at localhost in this build.',
        );
      }
    },
  };
}

/**
 * Pin the intentional inline scripts (theme bootstrap and JSON-LD) by hash in a production CSP.
 * The development server is left alone so Vite's HMR client is not broken by the policy.
 */
function contentSecurityPolicyPlugin(siteUrl: string, apiBaseUrl: string, isProduction: boolean): Plugin {
  return {
    name: 'ledgervault-content-security-policy',
    apply: 'build',
    enforce: 'post',
    async transformIndexHtml(html) {
      if (!isProduction) return html;
      return injectCsp(html, { siteUrl, apiBaseUrl });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const siteUrl = (env.VITE_PUBLIC_SITE_URL || 'http://localhost:5173').replace(/\/+$/, '');
  const apiBaseUrl = env.VITE_API_BASE_URL || '/api/v1';

  return {
    plugins: [
      react(),
      publicSiteUrlPlugin(siteUrl, mode === 'production'),
      contentSecurityPolicyPlugin(siteUrl, apiBaseUrl, mode === 'production'),
    ],
    server: {
      port: 5173,
      open: true,
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:3000',
          changeOrigin: false,
        },
      },
    },
    build: {
      target: 'es2022',
      chunkSizeWarningLimit: 1600,
    },
  };
});
