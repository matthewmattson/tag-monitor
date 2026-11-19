# Tag monitor

[![Tag monitor](https://github.com/matthewmattson/tag-monitor/actions/workflows/tag-monitor.yml/badge.svg)](https://github.com/matthewmattson/tag-monitor/actions/workflows/tag-monitor.yml)

A scheduled check that loads every page of a website in a real browser and verifies that its analytics tags fire correctly. If something breaks, it opens a GitHub issue that says which page and which check.

Analytics tags usually fail silently. A template gets rebuilt and the snippet is dropped, a second install double counts page views, a container ID is pasted from the wrong site. Nothing errors, and the first sign is a report that looks wrong weeks later. This monitor turns those into a failing check on its next run.

This copy is set up for [bananabagel.app](https://bananabagel.app). To use it on your own site, see [Pointing it at another site](#pointing-it-at-another-site).

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

The schedule and triggers are set in the `on:` block at the top of [`.github/workflows/tag-monitor.yml`](.github/workflows/tag-monitor.yml). As shipped, it runs **every Monday at 14:00 UTC** and on demand.

### On a schedule

The cadence is the `cron` line. Times are in UTC.

| Cadence | `cron` value |
| --- | --- |
| Weekly, Mondays at 14:00 (default) | `"0 14 * * 1"` |
| Daily at 14:00 | `"0 14 * * *"` |
| Hourly, on the hour | `"0 * * * *"` |
| Weekdays at 14:00 | `"0 14 * * 1-5"` |
| Monthly, on the 1st at 14:00 | `"0 14 1 * *"` |

GitHub can start scheduled runs a few minutes late, and it pauses schedules in repositories with no activity for 60 days.

### On every push

Add a `push` trigger to run the checks whenever code lands on `main`. This is most useful when the monitor lives in the same repository as the site, so a deploy that breaks a tag is caught right away.

```yaml
on:
  push:
    branches: [main]
  schedule:
    - cron: "0 14 * * 1"
  workflow_dispatch:
```

If the site takes time to deploy after a push, the checks may run against the previous version. Trigger the workflow from your deploy step instead, or keep the schedule as a backstop.

### On demand

`workflow_dispatch` adds a **Run workflow** button in the Actions tab. Remove that line to turn it off.

### Other settings

| Setting | Where | What it controls |
| --- | --- | --- |
| Site URL and page list | `targets.live` in [`monitor.config.ts`](monitor.config.ts) | Which pages are checked |
| Expected tag IDs | `expected` in [`monitor.config.ts`](monitor.config.ts) | The GTM container, GA4 property and Klaviyo account every page must use |
| Allowed third parties | `allowedThirdPartyHosts` in [`monitor.config.ts`](monitor.config.ts) | Hosts a page may load from without failing |
| Retries | `retries` in [`playwright.config.ts`](playwright.config.ts) | How many times a failed check is retried before it counts |
| Report retention | `retention-days` in the workflow | How long the HTML report is kept |

### What a run produces

- **A summary table** on the run page, one row per page.
- **The full Playwright HTML report** as a downloadable artifact.
- **A GitHub issue** when a check fails on the live site. A failure that persists adds a comment to the open issue instead of opening another, and the issue closes itself on the next passing run.

## Seeing it catch something

The repo includes five small pages in [`fixtures/`](fixtures), four of them broken on purpose. Run the separate [**Demo: broken tags**](.github/workflows/demo-broken-tags.yml) workflow from the Actions tab and it fails, with a report showing what each mistake looks like:

| Demo page | Mistake | Check that fails |
| --- | --- | --- |
| Healthy page | None (control) | Nothing |
| Tag removed | No GTM snippet | Container, `page_view`, `dataLayer` |
| Wrong container ID | Snippet points at another container | Container, tag IDs, `page_view` |
| Page view sent twice | GA4 installed through GTM and again by hand | Exactly one `page_view`, and sometimes the container check, depending on which install loads first |
| Unapproved third-party script | Script from a host not on the allowlist | No unexpected third parties |

The demo is its own workflow, so it never opens an issue and never affects the status badge above.

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
