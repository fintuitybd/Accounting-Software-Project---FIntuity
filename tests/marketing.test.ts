import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { MarketingUiContext, type MarketingUi } from '../src/marketing/MarketingApp';
import { text, type LocalizedText } from '../src/marketing/content';
import LandingPage from '../src/marketing/pages/LandingPage';
import LegalPage from '../src/marketing/pages/LegalPage';
import SecurityPage from '../src/marketing/pages/SecurityPage';

const englishUi: MarketingUi = {
  locale: 'en-BD',
  setLocale: () => undefined,
  t: (value: LocalizedText) => text(value, 'en-BD'),
};

function renderPage(page: ReturnType<typeof createElement>): string {
  return renderToString(
    createElement(MarketingUiContext.Provider, { value: englishUi }, createElement(MemoryRouter, null, page)),
  );
}

describe('public marketing pages', () => {
  it('renders the landing page with the honest product story and working routes', () => {
    const html = renderPage(createElement(LandingPage));

    expect(html).toContain('Close the month without rebuilding it.');
    expect(html).toContain('id="contact"');
    expect(html).toContain('href="/login"');
    expect(html).toContain('href="#workflows"');
    expect(html).toContain('/marketing/screens/sales-lines.jpg');
    expect(html).toContain('Illustrative management accounts layout');
    expect(html).toContain('Synthetic test data');
    expect(html).toContain('Unaudited');
    expect(html).toContain('does not file returns, issue audit opinions');
  });

  it('does not make unverified audit, certification or security claims', () => {
    const landing = renderPage(createElement(LandingPage));
    const security = renderPage(createElement(SecurityPage));
    const legal = renderPage(createElement(LegalPage));

    expect(landing).not.toMatch(/Independent Auditor/i);
    expect(landing).not.toMatch(/bank-grade/i);
    expect(landing).not.toMatch(/NBR-approved/i);
    expect(landing).not.toMatch(/Big-4/i);
    expect(landing).not.toMatch(/100% compliant/i);
    expect(security).toContain('No independent audit');
    expect(security).toContain('No guarantee that a VAT return');
    expect(legal).toContain('does not file a return');
    expect(legal).toContain('issue an audit opinion');
  });

  it('provides a labelled path to request a walkthrough', () => {
    const html = renderPage(createElement(LandingPage));
    expect(html).toContain('Request a walkthrough');
    expect(html).toContain('Work email');
    expect(html).toContain('Company');
    expect(html).toContain('Do not include financial records');
    expect(html).toContain('href="/legal"');
  });
});
