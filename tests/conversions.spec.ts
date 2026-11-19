import { test, expect } from '@playwright/test';
import { expected, site } from '../site-config';
import { runConversion, type FlowResult } from './flow';

for (const conversion of site.conversions || []) {
  test.describe(`Conversion: ${conversion.name}`, () => {
    let result: FlowResult;

    test.beforeAll(async ({ browser }, testInfo) => {
      const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } = testInfo.project.use;
      result = await runConversion(browser, site.baseURL, conversion, {
        viewport,
        userAgent,
        deviceScaleFactor,
        hasTouch,
        ...(isMobile ? { isMobile } : {}),
      });
    });

    test('every step can be carried out', () => {
      expect(result.stepError, result.stepError || '').toBeNull();
    });

    for (const wanted of conversion.expect?.requests || []) {
      test(`submission is sent to ${wanted.url}`, () => {
        const matches = result.intercepted.filter(
          (request) =>
            request.url.includes(wanted.url) && (!wanted.method || request.method === wanted.method),
        );
        expect(
          matches.length,
          `expected 1 ${wanted.method || ''} request to ${wanted.url}, saw ${matches.length}`,
        ).toBe(1);

        const missing = (wanted.bodyContains || []).filter((text) => !matches[0].body.includes(text));
        expect(missing, `the request body is missing: ${missing.join(', ')}`).toEqual([]);
      });
    }

    if (conversion.expect?.visible) {
      test('confirmation is shown', () => {
        expect(
          result.confirmationVisible,
          `${conversion.expect?.visible} never became visible`,
        ).toBe(true);
      });
    }

    for (const wanted of conversion.expect?.ga4Events || []) {
      test(`GA4 receives exactly one ${wanted.name}`, () => {
        const events = result.ga4Events.filter((event) => event.name === wanted.name);
        expect(events.length, `expected 1 ${wanted.name} event, saw ${events.length}`).toBe(1);

        expect(
          events[0].measurementId,
          `${wanted.name} went to the wrong GA4 property`,
        ).toBe(expected.ga4MeasurementId);

        for (const [key, value] of Object.entries(wanted.params || {})) {
          expect(
            events[0].params[key],
            `${wanted.name} has the wrong value for parameter "${key}"`,
          ).toBe(value);
        }
      });
    }
  });
}
