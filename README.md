# Tag monitor

[![Tag monitor](https://github.com/matthewmattson/tag-monitor/actions/workflows/tag-monitor.yml/badge.svg)](https://github.com/matthewmattson/tag-monitor/actions/workflows/tag-monitor.yml)

A scheduled check that loads every page of [bananabagel.app](https://bananabagel.app) in a real browser and verifies that its analytics tags fire correctly. If something breaks, it opens a GitHub issue that says which page and which check.

Analytics tags usually fail silently. A template gets rebuilt and the snippet is dropped, a second install double counts page views, a container ID is pasted from the wrong site. Nothing errors, and the first sign is a report that looks wrong weeks later. This monitor turns those into a failing check within a week.

## What it checks

For each page, [Playwright](https://playwright.dev) opens the page in headless Chromium, records every network request, and asserts:

| Check | Catches |
| --- | --- |
| Page loads | The page itself is down or moved |
| GTM container loads exactly once | Snippet removed, installed twice, or blocked |
| Only the expected Google tag IDs are present | A container or measurement ID from another site |
| GA4 receives exactly one `page_view` | Missing page views and double counting |
| GA4 hits go to the right property with the right page URL | Data flowing into the wrong property |
| `dataLayer` exists and GTM lifecycle events fire | A broken or overwritten `dataLayer` |
| Tag scripts raise no errors | JavaScript errors inside tag code |
| No unexpected third parties | A script added outside the approved list |
| Klaviyo onsite script loads for the right account | Home page only: the waitlist form's script |

The expected IDs, the page list and the third-party allowlist all live in [`monitor.config.ts`](monitor.config.ts).

## How it runs

[`.github/workflows/tag-monitor.yml`](.github/workflows/tag-monitor.yml) runs the checks **every Monday at 14:00 UTC** and on demand from the **Run workflow** button in the Actions tab. The cadence is one `cron` line at the top of that file.

Each run produces:

- **A summary table** on the run page, one row per page.
- **The full Playwright HTML report** as a downloadable artifact.
- **A GitHub issue** when a check fails on the live site. A failure that persists adds a comment to the open issue instead of opening another, and the issue closes itself on the next passing run.

## Seeing it catch something

The repo includes five small pages in [`fixtures/`](fixtures), four of them broken on purpose. Run the workflow with the target set to `demo` and the run fails, with a report showing what each mistake looks like:

| Demo page | Mistake | Check that fails |
| --- | --- | --- |
| Healthy page | None (control) | Nothing |
| Tag removed | No GTM snippet | Container, `page_view`, `dataLayer` |
| Wrong container ID | Snippet points at another container | Container, tag IDs, `page_view` |
| Page view sent twice | GA4 installed through GTM and again by hand | Exactly one `page_view` |
| Unapproved third-party script | Script from a host not on the allowlist | No unexpected third parties |

Demo runs never open an issue.

## Design notes

- **Monitor runs don't pollute the analytics.** GA4 hits are intercepted, inspected and answered locally instead of being forwarded to Google, so the weekly runs never appear as traffic.
- **It tests the deployed site, not the source.** The site lives in a separate repository. The monitor only needs its URL, which is also how it would work against a site you don't control the code for.
- **One retry on the live site.** A single network blip shouldn't open an issue. A check has to fail twice in a row to count.
- **Each page is loaded once.** One browser session per page captures everything, and the individual checks read from that capture. That keeps the report granular without loading every page nine times.

## Running it locally

Requires Node 20 or later.

```bash
npm install
```

```bash
npx playwright install chromium
```

```bash
npm run monitor
```

`npm run monitor:demo` runs the broken demo pages, and `npm run report` opens the HTML report from the last run.

## Pointing it at another site

Edit [`monitor.config.ts`](monitor.config.ts): set the `live` target's `baseURL` and `pages`, replace the IDs in `expected`, and list the third-party hosts the site is allowed to load.
