import type { Browser, BrowserContextOptions, Page } from '@playwright/test';
import type { Conversion, FlowStep } from '../site-config';
import { interceptGa4, isGa4Collect, type Ga4Event } from './capture';

export type InterceptedRequest = {
  url: string;
  method: string;
  body: string;
};

/** What happened when the monitor walked through one conversion. */
export type FlowResult = {
  /** Why a step could not be carried out, or null if every step ran. */
  stepError: string | null;
  /** Requests the config asked to intercept, which were answered locally. */
  intercepted: InterceptedRequest[];
  /** Other outgoing writes, which were stopped so nothing real was submitted. */
  blocked: string[];
  ga4Events: Ga4Event[];
  /** Whether the confirmation element appeared, or null if none was expected. */
  confirmationVisible: boolean | null;
};

const READ_ONLY_METHODS = ['GET', 'HEAD', 'OPTIONS'];

async function runStep(page: Page, step: FlowStep) {
  const target = page.locator(step.selector);
  switch (step.action) {
    case 'fill':
      return target.fill(step.value || '');
    case 'type':
      return target.pressSequentially(step.value || '');
    case 'select':
      return target.selectOption(step.value || '');
    case 'check':
      return target.check();
    case 'click':
      return target.click();
    default:
      throw new Error(`Unknown step action "${(step as FlowStep).action}"`);
  }
}

function describeStep(step: FlowStep) {
  return `${step.action} ${step.selector}`;
}

/**
 * Walk through one conversion (fill in a form, click a button) in a clean
 * browser context and record which requests and GA4 events it produced.
 *
 * Nothing is really submitted. Requests listed under "intercept" are answered
 * locally with a fake success, and any other outgoing write is stopped.
 */
export async function runConversion(
  browser: Browser,
  baseURL: string,
  conversion: Conversion,
  contextOptions: BrowserContextOptions = {},
): Promise<FlowResult> {
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();

  const result: FlowResult = {
    stepError: null,
    intercepted: [],
    blocked: [],
    ga4Events: [],
    confirmationVisible: null,
  };

  // Routes registered later take priority, so this safety net goes first:
  // stop every write the config didn't explicitly ask to intercept.
  await context.route('**/*', async (route) => {
    const request = route.request();
    if (READ_ONLY_METHODS.includes(request.method()) || isGa4Collect(new URL(request.url()))) {
      return route.fallback();
    }
    result.blocked.push(`${request.method()} ${request.url()}`);
    return route.abort();
  });

  for (const mock of conversion.intercept || []) {
    await context.route(
      (url) => url.href.includes(mock.url),
      async (route) => {
        const request = route.request();
        const origin = (await request.headerValue('origin')) || '*';
        const corsHeaders = {
          'access-control-allow-origin': origin,
          'access-control-allow-credentials': 'true',
          'access-control-allow-headers': '*',
          'access-control-allow-methods': '*',
        };
        if (request.method() === 'OPTIONS') {
          return route.fulfill({ status: 204, headers: corsHeaders });
        }
        result.intercepted.push({
          url: request.url(),
          method: request.method(),
          body: request.postData() || '',
        });
        return route.fulfill({
          status: mock.status ?? 200,
          headers: { ...corsHeaders, 'content-type': 'application/json' },
          body: mock.body ?? '{}',
        });
      },
    );
  }

  await interceptGa4(context, result.ga4Events);

  try {
    await page.goto(new URL(conversion.path, baseURL).href, { waitUntil: 'load' });

    for (const step of conversion.steps) {
      try {
        await runStep(page, step);
      } catch (error) {
        result.stepError = `could not ${describeStep(step)}: ${(error as Error).message.split('\n')[0]}`;
        break;
      }
    }

    // Give the page time to react: wait until everything expected has been
    // seen, or give up after ten seconds and report what is missing.
    const expectation = conversion.expect || {};
    const confirmation = expectation.visible ? page.locator(expectation.visible) : null;
    const allSeen = async () => {
      const eventsSeen = (expectation.ga4Events || []).every((wanted) =>
        result.ga4Events.some((event) => event.name === wanted.name),
      );
      const requestsSeen = (expectation.requests || []).every((wanted) =>
        result.intercepted.some((request) => request.url.includes(wanted.url)),
      );
      const confirmationSeen = confirmation ? await confirmation.isVisible() : true;
      return eventsSeen && requestsSeen && confirmationSeen;
    };

    const deadline = Date.now() + 10_000;
    while (!result.stepError && Date.now() < deadline && !(await allSeen())) {
      await page.waitForTimeout(250);
    }

    if (confirmation) result.confirmationVisible = await confirmation.isVisible();
    return result;
  } finally {
    await context.close();
  }
}
