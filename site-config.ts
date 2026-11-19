/**
 * Loads the settings for the site being checked. Nothing about a particular
 * site lives in the code: every run is given one JSON file through the
 * SITE_CONFIG environment variable (see sites/ and examples/).
 */
import fs from 'node:fs';
import path from 'node:path';

export type PageSpec = {
  /** Shown in the report. */
  name: string;
  /** Path relative to baseURL. */
  path: string;
  /** Whether the Klaviyo onsite script should load on this page. */
  klaviyo?: boolean;
};

/** One thing the monitor does on the page, like a visitor would. */
export type FlowStep = {
  action: 'fill' | 'type' | 'select' | 'check' | 'click';
  /** CSS selector of the element to act on. */
  selector: string;
  /** Text to enter, or the option to choose. Not used by check and click. */
  value?: string;
};

/** A form or other conversion point to walk through and verify. */
export type Conversion = {
  name: string;
  /** Page the conversion starts on, relative to baseURL. */
  path: string;
  steps: FlowStep[];
  /**
   * Requests to answer locally with a fake success instead of really sending
   * them, so the monitor never creates a real signup or order. Any other
   * outgoing write during the flow is stopped.
   */
  intercept?: { url: string; status?: number; body?: string }[];
  expect?: {
    /** Intercepted requests that must be sent exactly once. */
    requests?: { url: string; method?: string; bodyContains?: string[] }[];
    /** CSS selector of the confirmation that must appear. */
    visible?: string;
    /** GA4 events that must be sent exactly once, to the expected property. */
    ga4Events?: { name: string; params?: Record<string, string> }[];
  };
};

export type SiteConfig = {
  baseURL: string;
  /** The IDs every page is expected to use. Anything else is flagged. */
  expected: {
    gtmContainerId: string;
    ga4MeasurementId: string;
    klaviyoCompanyId?: string;
  };
  /**
   * Hosts a page may load from, besides the site itself and Google's tag
   * hosts. Each entry matches the host exactly or any subdomain of it.
   */
  allowedThirdPartyHosts?: string[];
  pages: PageSpec[];
  /** Forms and other conversion points to walk through. */
  conversions?: Conversion[];
  /**
   * Which browser profiles to check, by name from browser-profiles.json.
   * Leave it out to check all of them.
   */
  browsers?: string[];
  /** Demo only: serve ./fixtures locally before the run. */
  serveFixtures?: boolean;
};

/** Always allowed, since the monitor requires GTM and GA4 to be present. */
const GOOGLE_TAG_HOSTS = ['googletagmanager.com', 'google-analytics.com', 'analytics.google.com'];

const configPath = process.env.SITE_CONFIG;
if (!configPath) {
  throw new Error(
    'SITE_CONFIG is not set. Point it at a site config, e.g. SITE_CONFIG=sites/my-site.json',
  );
}

const resolvedPath = path.resolve(configPath);
if (!fs.existsSync(resolvedPath)) {
  throw new Error(`Site config not found: ${resolvedPath}`);
}

const config = JSON.parse(fs.readFileSync(resolvedPath, 'utf8')) as SiteConfig;

const missing = [
  !config.baseURL && 'baseURL',
  !config.expected?.gtmContainerId && 'expected.gtmContainerId',
  !config.expected?.ga4MeasurementId && 'expected.ga4MeasurementId',
  !(Array.isArray(config.pages) && config.pages.length > 0) && 'pages',
].filter(Boolean);
if (missing.length > 0) {
  throw new Error(`${configPath} is missing required settings: ${missing.join(', ')}`);
}

export type BrowserProfile = { label: string; device: string; engine: string };

const allProfiles = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'browser-profiles.json'), 'utf8'),
) as Record<string, BrowserProfile>;

const browserNames = config.browsers?.length ? config.browsers : Object.keys(allProfiles);
const unknown = browserNames.filter((name) => !allProfiles[name]);
if (unknown.length > 0) {
  throw new Error(
    `${configPath} lists unknown browsers: ${unknown.join(', ')}. ` +
      `Choose from: ${Object.keys(allProfiles).join(', ')}`,
  );
}

/** The browser profiles this run will check, in the order they are listed. */
export const browsers = browserNames.map((name) => ({ name, ...allProfiles[name] }));

/** The config's file name without .json, used to label reports. */
export const siteName = path.basename(resolvedPath, '.json');
export const site = config;
export const expected = config.expected;
export const allowedThirdPartyHosts = [
  ...GOOGLE_TAG_HOSTS,
  ...(config.allowedThirdPartyHosts || []),
];
