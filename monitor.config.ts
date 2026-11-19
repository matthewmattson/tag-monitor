/**
 * What the monitor expects to find. Edit this file when the site's tagging
 * changes; the tests read everything from here.
 */

export type PageSpec = {
  /** Shown in the report. */
  name: string;
  /** Path relative to the target's baseURL. */
  path: string;
  /** Whether the Klaviyo onsite script should load on this page. */
  klaviyo?: boolean;
};

export type Target = {
  baseURL: string;
  pages: PageSpec[];
};

/** The IDs every page is expected to use. Anything else is flagged. */
export const expected = {
  gtmContainerId: 'GTM-PJ4VGDKV',
  ga4MeasurementId: 'G-BXK45KNNB1',
  klaviyoCompanyId: 'UDhRu7',
};

/**
 * Hosts a page is allowed to talk to, besides the site itself. A request to
 * any other host fails the "no unexpected third parties" check, which is how
 * a tag added outside the normal process gets noticed.
 * Entries match the host exactly or any subdomain of it.
 */
export const allowedThirdPartyHosts = [
  'googletagmanager.com',
  'google-analytics.com',
  'analytics.google.com',
  'klaviyo.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
];

export const targets: Record<string, Target> = {
  /** The production site. This is what the weekly schedule checks. */
  live: {
    baseURL: 'https://bananabagel.app',
    pages: [
      { name: 'Home', path: '/', klaviyo: true },
      { name: 'Research', path: '/research.html' },
      { name: 'Contact', path: '/contact.html' },
      { name: 'Privacy', path: '/privacy.html' },
      { name: 'Terms', path: '/terms.html' },
      { name: 'Mobile terms', path: '/mobile-terms.html' },
    ],
  },

  /**
   * Deliberately broken pages in ./fixtures, served locally. Running the
   * monitor against this target is expected to FAIL: it shows what each kind
   * of tagging mistake looks like in the report.
   */
  demo: {
    baseURL: 'http://localhost:4173',
    pages: [
      { name: 'Healthy page', path: '/healthy.html' },
      { name: 'Tag removed', path: '/missing-tag.html' },
      { name: 'Wrong container ID', path: '/wrong-container.html' },
      { name: 'Page view sent twice', path: '/duplicate-page-view.html' },
      { name: 'Unapproved third-party script', path: '/rogue-script.html' },
    ],
  },
};

export const targetName = process.env.TARGET || 'live';

if (!targets[targetName]) {
  throw new Error(
    `Unknown TARGET "${targetName}". Use one of: ${Object.keys(targets).join(', ')}`,
  );
}

export const target = targets[targetName];
