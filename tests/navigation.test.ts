import { describe, expect, it } from 'vitest';
import { permissionsForRole, ROLES, type Role } from '../server/src/auth/permissions';
import {
  NAVIGATION_SECTIONS,
  canAccessSection,
  resolveNavigationPath,
  visibleNavigationSections,
  type NavigationAccess,
} from '../src/shell/navigation';

function accessFor(role: Role, organisationPermission = false): NavigationAccess {
  const permissions = new Set(permissionsForRole(role));
  return {
    hasCompany: true,
    hasCompanyPermission: (permission) => permissions.has(permission as never),
    hasOrganisationPermission: () => organisationPermission,
  };
}

describe('role-aware navigation', () => {
  it('gives every role a Home and Account entry', () => {
    for (const role of ROLES) {
      const keys = visibleNavigationSections(accessFor(role)).map((section) => section.key);
      expect(keys).toContain('HOME');
      expect(keys).toContain('ACCOUNT');
    }
  });

  it('does not show setup or team administration to an accountant', () => {
    const keys = visibleNavigationSections(accessFor('ACCOUNTANT')).map((section) => section.key);
    expect(keys).not.toContain('SETUP');
    expect(keys).not.toContain('TEAM');
    expect(keys).toContain('LEDGER');
    expect(keys).toContain('REPORTS');
  });

  it('keeps an operator to drafts, limited reports and stock movement', () => {
    const keys = visibleNavigationSections(accessFor('OPERATOR')).map((section) => section.key);
    expect(keys).toEqual(['HOME', 'SALES', 'PURCHASES', 'INVENTORY', 'ACCOUNT']);
    expect(keys).not.toContain('REPORTS');
    expect(keys).not.toContain('LEDGER');
    expect(keys).not.toContain('SETUP');
  });

  it('gives an auditor read-only evidence screens but no configuration', () => {
    const keys = visibleNavigationSections(accessFor('AUDITOR')).map((section) => section.key);
    expect(keys).toContain('REPORTS');
    expect(keys).toContain('CLOSE');
    expect(keys).toContain('AUDIT');
    expect(keys).toContain('LEDGER');
    expect(keys).not.toContain('MASTERS');
    expect(keys).not.toContain('SETUP');
    expect(keys).not.toContain('TEAM');
  });

  it('shows team administration only to a user with the organisation permission', () => {
    const without = visibleNavigationSections(accessFor('OWNER', false)).map((section) => section.key);
    const withPermission = visibleNavigationSections(accessFor('OWNER', true)).map((section) => section.key);
    expect(without).not.toContain('TEAM');
    expect(withPermission).toContain('TEAM');
  });

  it('rejects unknown deep links instead of pretending they are a section', () => {
    expect(resolveNavigationPath('/app/sales')?.section.key).toBe('SALES');
    expect(resolveNavigationPath('/app/sales/')?.section.key).toBe('SALES');
    expect(resolveNavigationPath('/app/sales/unknown')).toBeNull();
    expect(resolveNavigationPath('/app/not-a-screen')).toBeNull();
  });

  it('normalises explicit deep-link aliases without accepting arbitrary subpaths', () => {
    expect(resolveNavigationPath('/app/sales/new')).toMatchObject({
      canonical: false,
      redirectTo: '/app/sales?new=1',
    });
    expect(resolveNavigationPath('/app/sales/new')?.section.key).toBe('SALES');
    expect(resolveNavigationPath('/app/sales/invoices/abc-123')).toMatchObject({
      canonical: false,
      redirectTo: '/app/sales?document=abc-123',
    });
    expect(resolveNavigationPath('/app/sales/unknown')).toBeNull();
    expect(resolveNavigationPath('/app/not-a-screen')).toBeNull();
  });

  it('has an English and Bangla label for every exposed navigation item', () => {
    for (const section of NAVIGATION_SECTIONS) {
      expect(section.labelEn.trim().length).toBeGreaterThan(0);
      expect(section.labelBn.trim().length).toBeGreaterThan(0);
      expect(section.descriptionEn.trim().length).toBeGreaterThan(0);
      expect(section.descriptionBn.trim().length).toBeGreaterThan(0);
    }
  });

  it('never exposes a demo-only module in the production navigation', () => {
    const labels = NAVIGATION_SECTIONS.map((section) => `${section.labelEn} ${section.path}`).join(' ');
    expect(labels).not.toMatch(/secretarial|practice|firm cockpit/i);
  });

  it('requires every permission in a companyAll rule', () => {
    const reports = NAVIGATION_SECTIONS.find((section) => section.key === 'REPORTS')!;
    const access: NavigationAccess = {
      hasCompany: true,
      hasCompanyPermission: (permission) => permission === 'VIEW_REPORTS',
      hasOrganisationPermission: () => false,
    };
    expect(canAccessSection(reports, access)).toBe(true);
    expect(
      canAccessSection(reports, {
        hasCompany: true,
        hasCompanyPermission: () => false,
        hasOrganisationPermission: () => false,
      }),
    ).toBe(false);
  });

  it('lets an organisation owner reach first-company setup before a company exists', () => {
    const setup = NAVIGATION_SECTIONS.find((section) => section.key === 'SETUP')!;
    const noCompanyOwner: NavigationAccess = {
      hasCompany: false,
      hasCompanyPermission: () => false,
      hasOrganisationPermission: (permission) => permission === 'MANAGE_USERS_AND_ORG',
    };
    expect(canAccessSection(setup, noCompanyOwner)).toBe(true);
    expect(
      canAccessSection(setup, {
        hasCompany: false,
        hasCompanyPermission: () => false,
        hasOrganisationPermission: () => false,
      }),
    ).toBe(false);
    expect(canAccessSection(setup, accessFor('OWNER'))).toBe(true);
  });
});
