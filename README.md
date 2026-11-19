# Tag monitor

[![Tag monitor](https://github.com/matthewmattson/tag-monitor/actions/workflows/tag-monitor.yml/badge.svg)](https://github.com/matthewmattson/tag-monitor/actions/workflows/tag-monitor.yml)

A scheduled check that loads every page of a website in a real browser and verifies that its analytics tags fire correctly. If something breaks, it opens a GitHub issue that says which page and which check.

Analytics tags usually fail silently. A template gets rebuilt and the snippet is dropped, a second install double counts page views, a container ID is pasted from the wrong site. Nothing errors, and the first sign is a report that looks wrong weeks later. This monitor turns those into a failing check on its next run.

Nothing about a particular site is in the code. Each site is one JSON file, and this repository ships with one for [bananabagel.app](https://bananabagel.app) as a working example. To monitor your own, see [Using it for your site](#using-it-for-your-site).

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
| Klaviyo onsite script loads for the right account | Optional, for pages marked `"klaviyo": true` |

## Using it for your site

A site is described by one JSON file:

```json
{
  "baseURL": "https://www.example.com",
  "expected": {
    "gtmContainerId": "GTM-XXXXXXX",
    "ga4MeasurementId": "G-XXXXXXXXXX"
  },
  "allowedThirdPartyHosts": ["fonts.googleapis.com", "fonts.gstatic.com"],
  "pages": [
    { "name": "Home", "path": "/" },
    { "name": "Pricing", "path": "/pricing" }
  ]
}
```

| Setting | What it controls |
| --- | --- |
| `baseURL` | The site to check |
| `expected.gtmContainerId` | The GTM container every page must load |
| `expected.ga4MeasurementId` | The GA4 property every hit must go to |
| `expected.klaviyoCompanyId` | Optional. The Klaviyo account, checked on pages with `"klaviyo": true` |
| `allowedThirdPartyHosts` | Hosts a page may load from. The site itself and Google's tag hosts are always allowed |
| `pages` | The pages to check, each with a display `name` and a `path` |

None of these values are secret: the IDs are already in the HTML of any page that uses them. A starting point is in [`examples/site.json`](examples/site.json).

There are two ways to run it.

### Option 1: copy this repository

1. Fork this repository.
2. Delete [`sites/bananabagel.json`](sites/bananabagel.json) and add `sites/your-site.json`.

Every file in `sites/` is checked as its own job, so one copy can monitor several sites.

### Option 2: call it from your own repository

Keep the config in your site's repository and call this one as a [reusable workflow](https://docs.github.com/en/actions/sharing-automations/reusing-workflows). Add the config file anywhere in your repository, then add `.github/workflows/tag-monitor.yml`:

```yaml
name: Tag monitor

on:
  schedule:
    - cron: "0 14 * * 1"
  workflow_dispatch:

jobs:
  tags:
    permissions:
      contents: read
      issues: write
    uses: matthewmattson/tag-monitor/.github/workflows/monitor.yml@main
    with:
      config: tag-monitor.json
```

| Input | Default | What it does |
| --- | --- | --- |
| `config` | (required) | Path to the site config in your repository |
| `open-issue` | `true` | Open an issue in your repository when checks fail |
| `tool-ref` | `main` | Branch, tag or commit of tag-monitor to run |

Issues are opened in your repository, and you pick up improvements to the checks without copying anything.

## How it runs

The schedule and triggers are set in the `on:` block at the top of [`.github/workflows/tag-monitor.yml`](.github/workflows/tag-monitor.yml), or of your own workflow file if you call this one from another repository. As shipped, it runs **every Monday at 14:00 UTC** and on demand.

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
| Retries | `retries` in [`playwright.config.ts`](playwright.config.ts) | How many times a failed check is retried before it counts |
| Report retention | `retention-days` in [`monitor.yml`](.github/workflows/monitor.yml) | How long the HTML report is kept |

### What a run produces

- **A summary table** on the run page for each site, one row per page.
- **The full Playwright HTML report** as a downloadable artifact.
- **A GitHub issue** per site when a check fails. A failure that persists adds a comment to the open issue instead of opening another, and the issue closes itself on the next passing run.

## Seeing it catch something

The repo includes five small pages in [`fixtures/`](fixtures), four of them broken on purpose. Run the separate [**Demo: broken tags**](.github/workflows/demo-broken-tags.yml) workflow from the Actions tab and it fails, with a report showing what each mistake looks like:

| Demo page | Mistake | Check that fails |
| --- | --- | --- |
| Healthy page | None (control) | Nothing |
| Tag removed | No GTM snippet | Container, `page_view`, `dataLayer` |
| Wrong container ID | Snippet points at another container | Container, tag IDs, `page_view` |
| Page view sent twice | GA4 installed through GTM and again by hand | Exactly one `page_view`, and sometimes the container check, depending on which install loads first |
| Unapproved third-party script | Script from a host not on the allowlist | No unexpected third parties |

The demo is its own workflow with its own config, [`examples/demo.json`](examples/demo.json), so it never opens an issue and never affects the status badge above.

## Design notes

- **Monitor runs don't pollute the analytics.** GA4 hits are intercepted, inspected and answered locally instead of being forwarded to Google, so the weekly runs never appear as traffic.
- **It tests the deployed site, not the source.** The monitor only needs a URL, so it works the same for a site whose code you don't control.
- **Site settings are data, not code.** Adding a site means adding a JSON file. The tests never change.
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
SITE_CONFIG=sites/bananabagel.json npm run monitor
```

`SITE_CONFIG` is the config to check. `npm run monitor:demo` runs the broken demo pages, and `npm run report` opens the HTML report from the last run.
