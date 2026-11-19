import { test, expect } from '@playwright/test';
import { allowedThirdPartyHosts, expected, site } from '../site-config';
import { capturePage, type Capture } from './capture';

const siteHost = new URL(site.baseURL).hostname;

function hostIsAllowed(host: string): boolean {
  if (host === siteHost) return true;
  return allowedThirdPartyHosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

/** IDs requested from Google's tag loader, e.g. gtm.js?id=GTM-XXXX or gtag/js?id=G-XXXX. */
function googleTagRequests(capture: Capture) {
  return capture.requests
    .map((request) => ({ ...request, parsed: new URL(request.url) }))
    .filter(
      ({ parsed }) =>
        parsed.hostname.endsWith('googletagmanager.com') &&
        (parsed.pathname === '/gtm.js' || parsed.pathname === '/gtag/js'),
    )
    .map(({ parsed, status }) => ({
      id: parsed.searchParams.get('id'),
      script: parsed.pathname,
      status,
    }));
}

for (const spec of site.pages) {
  test.describe(spec.name, () => {
    let capture: Capture;

    test.beforeAll(async ({ browser }, testInfo) => {
      // Apply this project's device profile (viewport, user agent, touch).
      const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } = testInfo.project.use;
      capture = await capturePage(browser, new URL(spec.path, site.baseURL).href, {
        viewport,
        userAgent,
        deviceScaleFactor,
        hasTouch,
        ...(isMobile ? { isMobile } : {}),
      });
    });

    test('page loads', () => {
      expect(capture.status, `${capture.url} did not return 200`).toBe(200);
    });

    test('GTM container loads exactly once', () => {
      const containers = googleTagRequests(capture).filter(
        (request) => request.script === '/gtm.js' && request.id === expected.gtmContainerId,
      );
      expect(
        containers.length,
        `expected 1 request for container ${expected.gtmContainerId}, saw ${containers.length}`,
      ).toBe(1);
      expect(containers[0].status, 'the container script did not return 200').toBe(200);
      expect(
        capture.loadedContainers,
        'the container script was requested but never initialised',
      ).toContain(expected.gtmContainerId);
    });

    test('only the expected Google tag IDs are present', () => {
      const allowedIds = [expected.gtmContainerId, expected.ga4MeasurementId];
      const unexpected = googleTagRequests(capture)
        .map((request) => request.id)
        .filter((id) => !allowedIds.includes(id || ''));
      expect(unexpected, `unexpected Google tag IDs on the page: ${unexpected.join(', ')}`).toEqual(
        [],
      );
    });

    test('GA4 receives exactly one page_view', () => {
      const pageViews = capture.ga4Events.filter((event) => event.name === 'page_view');
      expect(pageViews.length, `expected 1 page_view, saw ${pageViews.length}`).toBe(1);
    });

    test('GA4 hits go to the right property with the right page URL', () => {
      expect(capture.ga4Events.length, 'no GA4 hits were sent at all').toBeGreaterThan(0);

      const wrongProperty = capture.ga4Events.filter(
        (event) => event.measurementId !== expected.ga4MeasurementId,
      );
      expect(
        wrongProperty.map((event) => `${event.name} -> ${event.measurementId}`),
        `hits sent to a property other than ${expected.ga4MeasurementId}`,
      ).toEqual([]);

      const pageView = capture.ga4Events.find((event) => event.name === 'page_view');
      // Compare host and path only: GA4 drops the port from the URL it reports.
      const hostAndPath = (value: string) => {
        const url = new URL(value);
        return url.hostname + url.pathname;
      };
      expect(
        pageView?.documentLocation ? hostAndPath(pageView.documentLocation) : null,
        'page_view did not report the URL of this page',
      ).toBe(hostAndPath(capture.url));
    });

    test('dataLayer exists and GTM lifecycle events fire', () => {
      expect(capture.dataLayerEvents, 'window.dataLayer is missing').not.toBeNull();
      expect(capture.dataLayerEvents).toEqual(expect.arrayContaining(['gtm.dom', 'gtm.load']));
    });

    test('tag scripts raise no errors', () => {
      expect(capture.tagErrors, capture.tagErrors.join('\n')).toEqual([]);
    });

    test('no unexpected third parties', () => {
      const unexpectedHosts = [
        ...new Set(
          capture.requests
            .map((request) => new URL(request.url))
            .filter((url) => url.protocol.startsWith('http') && !hostIsAllowed(url.hostname))
            .map((url) => url.hostname),
        ),
      ];
      expect(
        unexpectedHosts,
        `requests went to hosts that are not on the allowlist: ${unexpectedHosts.join(', ')}`,
      ).toEqual([]);
    });

    if (spec.klaviyo && expected.klaviyoCompanyId) {
      test('Klaviyo onsite script loads for the right account', () => {
        const klaviyo = capture.requests.filter((request) => {
          const url = new URL(request.url);
          return url.hostname === 'static.klaviyo.com' && url.pathname.endsWith('/klaviyo.js');
        });
        expect(klaviyo.length, 'the Klaviyo script was never requested').toBeGreaterThan(0);

        const companyIds = [
          ...new Set(klaviyo.map((request) => new URL(request.url).searchParams.get('company_id'))),
        ];
        expect(companyIds, 'Klaviyo loaded for an unexpected account').toEqual([
          expected.klaviyoCompanyId,
        ]);
        expect(
          klaviyo.some((request) => request.status === 200),
          'the Klaviyo script did not return 200',
        ).toBe(true);
      });
    }
  });
}
