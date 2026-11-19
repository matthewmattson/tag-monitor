import type { Browser, BrowserContextOptions, Request } from '@playwright/test';

/** One event inside a GA4 /g/collect hit. */
export type Ga4Event = {
  name: string;
  measurementId: string | null;
  documentLocation: string | null;
};

export type CapturedRequest = {
  url: string;
  /** HTTP status, or null if the request never got a response. */
  status: number | null;
};

/** Everything the monitor observed while one page loaded. */
export type Capture = {
  url: string;
  status: number | null;
  requests: CapturedRequest[];
  ga4Events: Ga4Event[];
  /** Console errors and uncaught exceptions that came from a tag script. */
  tagErrors: string[];
  /** `event` names pushed to window.dataLayer, or null if there is no dataLayer. */
  dataLayerEvents: string[] | null;
  /** GTM container IDs that finished initialising on the page. */
  loadedContainers: string[];
};

const TAG_SCRIPT_PATTERN = /googletagmanager\.com|google-analytics\.com|klaviyo\.com/;

export function isGa4Collect(url: URL): boolean {
  const isAnalyticsHost =
    url.hostname.endsWith('google-analytics.com') || url.hostname === 'analytics.google.com';
  return isAnalyticsHost && url.pathname.endsWith('/g/collect');
}

/**
 * A GA4 hit carries shared fields (measurement ID, page URL) in the query
 * string. A single event is in the query string too; batched events arrive
 * one per line in the POST body.
 */
function parseGa4Hit(request: Request): Ga4Event[] {
  const url = new URL(request.url());
  const shared = {
    measurementId: url.searchParams.get('tid'),
    documentLocation: url.searchParams.get('dl'),
  };

  const names: string[] = [];
  const single = url.searchParams.get('en');
  if (single) names.push(single);

  for (const line of (request.postData() || '').split('\n')) {
    const batched = new URLSearchParams(line).get('en');
    if (batched) names.push(batched);
  }

  return names.map((name) => ({ name, ...shared }));
}

/**
 * Load one page in a clean browser context and record what its tags did.
 *
 * GA4 hits are recorded and then answered locally instead of being forwarded
 * to Google, so monitor runs never show up as traffic in the real reports.
 */
export async function capturePage(
  browser: Browser,
  url: string,
  contextOptions: BrowserContextOptions = {},
): Promise<Capture> {
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();

  const requests: CapturedRequest[] = [];
  const ga4Events: Ga4Event[] = [];
  const tagErrors: string[] = [];

  await context.route(
    (routeUrl) => isGa4Collect(routeUrl),
    async (route) => {
      const request = route.request();
      ga4Events.push(...parseGa4Hit(request));
      const origin = (await request.headerValue('origin')) || '*';
      await route.fulfill({
        status: 204,
        headers: {
          'access-control-allow-origin': origin,
          'access-control-allow-credentials': 'true',
        },
      });
    },
  );

  page.on('request', (request) => {
    const entry: CapturedRequest = { url: request.url(), status: null };
    requests.push(entry);
    request
      .response()
      .then((response) => {
        if (response) entry.status = response.status();
      })
      .catch(() => {});
  });

  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const source = message.location().url || '';
    if (TAG_SCRIPT_PATTERN.test(source) || TAG_SCRIPT_PATTERN.test(message.text())) {
      tagErrors.push(`console error: ${message.text()} (${source})`);
    }
  });

  page.on('pageerror', (error) => {
    if (TAG_SCRIPT_PATTERN.test(error.stack || '')) {
      tagErrors.push(`uncaught exception: ${error.message}`);
    }
  });

  try {
    const response = await page.goto(url, { waitUntil: 'load' });

    // Tags fire after load. Wait for the page view (or give up), then keep
    // listening briefly so a duplicate hit has time to show itself.
    const deadline = Date.now() + 8_000;
    while (Date.now() < deadline && !ga4Events.some((event) => event.name === 'page_view')) {
      await page.waitForTimeout(250);
    }
    await page.waitForTimeout(2_500);

    const state = await page.evaluate(() => {
      const dataLayer = (window as any).dataLayer;
      const gtm = (window as any).google_tag_manager;
      return {
        dataLayerEvents: Array.isArray(dataLayer)
          ? dataLayer.map((entry: any) => entry && entry.event).filter(Boolean)
          : null,
        loadedContainers: gtm ? Object.keys(gtm).filter((key) => key.startsWith('GTM-')) : [],
      };
    });

    return {
      url,
      status: response ? response.status() : null,
      requests,
      ga4Events,
      tagErrors,
      ...state,
    };
  } finally {
    await context.close();
  }
}
