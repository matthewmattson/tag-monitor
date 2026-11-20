# Tag monitor

[![Tag monitor](https://github.com/matthewmattson/tag-monitor/actions/workflows/tag-monitor.yml/badge.svg)](https://github.com/matthewmattson/tag-monitor/actions/workflows/tag-monitor.yml)

A scheduled check that loads every page of a website in real desktop and mobile browsers and verifies that its analytics tags fire correctly. If something breaks, it opens a GitHub issue that says which page and which check.

Analytics tags usually fail silently. A template gets rebuilt and the snippet is dropped, a second install double counts page views, a container ID is pasted from the wrong site. Nothing errors, and the first sign is a report that looks wrong weeks later. This monitor turns those into a failing check on its next run.

Nothing about a particular site is in the code. Each site is one JSON file, and this repository ships with one for [bananabagel.app](https://bananabagel.app) as a working example. To monitor your own, see [Using it for your site](#using-it-for-your-site).

## What it checks

For each page, in each browser, [Playwright](https://playwright.dev) opens the page, records every network request, and asserts:

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

It also walks through forms and other conversion points. For each one listed in the site's config, it carries out the steps a visitor would (fill in fields, tick a box, click submit) and asserts:

| Check | Catches |
| --- | --- |
| Every step can be carried out | A field or button that was renamed, removed or hidden |
| Submission is sent to the right endpoint | A form that silently stopped posting, or posts the wrong data |
| Confirmation is shown | A success state that never appears |
| GA4 receives exactly one conversion event | A conversion that works for visitors but is no longer measured, or is counted twice |

**Nothing is really submitted.** The form's outgoing request is intercepted and answered with a fake success, and any other outgoing write during the flow is stopped. The monitor never creates a signup, lead or order. See [Checking forms and conversions](#checking-forms-and-conversions).

## Using it for your site

A site is described by one JSON file:

```json
{
  "baseURL": "https://www.example.com",
  "expected": {
    "gtmContainerId": "GTM-XXXXXXX",
    "ga4MeasurementId": "G-XXXXXXXXXX"
  },
  "browsers": ["desktop-chrome", "mobile-safari"],
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
| `browsers` | Optional. Which [browser profiles](#browsers-and-devices) to check. Leave it out to check all five |
| `allowedThirdPartyHosts` | Hosts a page may load from. The site itself and Google's tag hosts are always allowed |
| `pages` | The pages to check, each with a display `name` and a `path` |
| `conversions` | Optional. Forms and other conversion points to walk through. See [Checking forms and conversions](#checking-forms-and-conversions) |

None of these values are secret: the IDs are already in the HTML of any page that uses them. A starting point is in [`examples/site.json`](examples/site.json).

### Browsers and devices

| Name | What it runs |
| --- | --- |
| `desktop-chrome` | Chromium at a desktop size. Also stands in for Edge, Brave and Opera, which use the same engine |
| `desktop-firefox` | Firefox at a desktop size |
| `desktop-safari` | WebKit, Safari's engine, at a desktop size |
| `mobile-chrome` | Chromium emulating a Pixel 7: phone viewport, touch and Android user agent |
| `mobile-safari` | WebKit emulating an iPhone 15: phone viewport, touch and iOS user agent |

Every check runs for every page in every profile listed, so each profile adds to the run time. A site that serves the same markup to all devices can list fewer. The profiles are defined in [`browser-profiles.json`](browser-profiles.json); add an entry there, using any of [Playwright's device names](https://github.com/microsoft/playwright/blob/main/packages/playwright-core/src/server/deviceDescriptorsSource.json), to check a tablet or another phone.

The mobile profiles are emulation, not physical devices, and none of the profiles apply Safari's or Firefox's tracking protection or an ad blocker. The monitor tells you whether your tags are installed and firing correctly, not how much data real visitors' privacy settings remove.

### Checking forms and conversions

Each entry in `conversions` describes one flow:

```json
"conversions": [
  {
    "name": "Newsletter signup",
    "path": "/",
    "steps": [
      { "action": "fill", "selector": "#email", "value": "tag-monitor@example.com" },
      { "action": "check", "selector": "#consent" },
      { "action": "click", "selector": "#signup button[type=submit]" }
    ],
    "intercept": [{ "url": "/api/subscribe", "status": 200 }],
    "expect": {
      "requests": [{ "url": "/api/subscribe", "method": "POST", "bodyContains": ["tag-monitor@example.com"] }],
      "visible": "#thank-you",
      "ga4Events": [{ "name": "generate_lead", "params": { "method": "newsletter" } }]
    }
  }
]
```

| Setting | What it does |
| --- | --- |
| `steps` | What to do on the page, in order. Actions: `fill`, `type` (key by key), `select`, `check`, `click`. Each takes a CSS `selector` |
| `intercept` | Requests to answer locally instead of sending. Matched when the request URL contains `url`. Set `status` and `body` to whatever the page treats as success |
| `expect.requests` | Intercepted requests that must be sent exactly once, optionally with a `method` and text the body must contain |
| `expect.visible` | CSS selector of the confirmation that must appear |
| `expect.ga4Events` | GA4 events that must be sent exactly once to the expected property, optionally with parameter values |

The GA4 check looks at what reaches GA4, not at how the site sends it. An event sent by a direct `gtag()` call and one sent by a Tag Manager tag listening for a `dataLayer` push both pass, and a site that accidentally does both fails with two events.

List the form's submit endpoint under `intercept`. If you leave it out, the monitor still stops the request, so nothing is submitted, but the page will see a failure instead of a success. Requests that read data (`GET`) are not stopped, so a conversion that is recorded by a `GET` request should be listed under `intercept` too.

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
| Parallelism | `workers` in [`playwright.config.ts`](playwright.config.ts) | How many browser profiles are checked at once. Three by default; four was measured to be no faster and puts more simultaneous connections on the site |
| Time limit | `timeout-minutes` in [`monitor.yml`](.github/workflows/monitor.yml) | When a hung run is stopped. Ten minutes by default |
| Report retention | `retention-days` in [`monitor.yml`](.github/workflows/monitor.yml) | How long the HTML report is kept |

### Where it runs

The checks run inside Playwright's official Docker image, which already contains every browser and its system libraries. Nothing is installed per run, so a run takes about two minutes and doesn't depend on package mirrors. The image version follows the `@playwright/test` version pinned in [`package.json`](package.json).

Each site is handled by three small jobs in [`monitor.yml`](.github/workflows/monitor.yml):

| Job | What it does | Permissions |
| --- | --- | --- |
| `prepare` | Reads the pinned Playwright version and the site's name | Read the repository |
| `monitor` | Loads the pages and runs the checks inside the Playwright image | Read the repository |
| `issue` | Opens, updates or closes the GitHub issue from the result | Write issues |

A healthy run spends about 25 seconds starting the image and 50 seconds on the checks. The rest is GitHub starting the jobs.

### What a run produces

- **A summary table** on the run page for each site, one row per page and one column per browser.
- **The full Playwright HTML report** as a downloadable artifact.
- **A GitHub issue** per site when a check fails. A failure that persists adds a comment to the open issue instead of opening another, and the issue closes itself on the next passing run.

## Seeing it catch something

The repo includes seven small pages in [`fixtures/`](fixtures), five of them broken on purpose. Run the separate [**Demo: broken tags**](.github/workflows/demo-broken-tags.yml) workflow from the Actions tab and it fails, with a report showing what each mistake looks like:

| Demo page | Mistake | Check that fails |
| --- | --- | --- |
| Healthy page | None (control) | Nothing |
| Tag removed | No GTM snippet | Container, `page_view`, `dataLayer` |
| Wrong container ID | Snippet points at another container | Container, tag IDs, `page_view` |
| Page view sent twice | GA4 installed through GTM and again by hand | Exactly one `page_view`, and sometimes the container check, depending on which install loads first |
| Unapproved third-party script | Script from a host not on the allowlist | No unexpected third parties |
| Signup form | None (control) | Nothing |
| Signup form, conversion event removed | The form works, but the line that reports the conversion is gone | GA4 receives exactly one `generate_lead` |

The demo is its own workflow with its own config, [`examples/demo.json`](examples/demo.json), so it never opens an issue and never affects the status badge above. It checks two browser profiles, desktop Chrome and mobile Safari, and takes under a minute.

## Found in practice

Two problems the monitor has caught on real pages so far:

- **A conversion nobody was measuring.** The first run of the form check on bananabagel.app showed the waitlist form working for visitors while sending no event to GA4. The monitor opened [issue #1](https://github.com/matthewmattson/tag-monitor/issues/1), a `generate_lead` event was added to the site, and the issue closed itself on the next passing run.
- **A conversion counted twice.** After a GA4 event tag was added in Tag Manager, a page that still called `gtag('event', ...)` directly sent `generate_lead` twice. The check for exactly one event failed on it until the direct call was replaced with a `dataLayer` push.

## Design notes

- **Monitor runs don't pollute the analytics or the CRM.** GA4 hits are intercepted, inspected and answered locally instead of being forwarded to Google, and form submissions are intercepted the same way. The weekly runs never appear as traffic or as signups.
- **It tests the deployed site, not the source.** The monitor only needs a URL, so it works the same for a site whose code you don't control.
- **Site settings are data, not code.** Adding a site means adding a JSON file. The tests never change.
- **One retry on the live site.** A single network blip shouldn't open an issue. A check has to fail twice in a row to count.
- **Least privilege.** The job that loads web pages can only read the repository. Writing issues happens in a separate job that never opens a browser.
- **Each page is loaded once per browser.** One session captures everything, and the individual checks read from that capture. That keeps the report granular without loading every page nine times. The capture is reused even when a check fails, so a run with failures takes no longer than a clean one.

## Running it locally

Requires Node 20 or later.

```bash
npm install
```

```bash
npx playwright install
```

```bash
SITE_CONFIG=sites/bananabagel.json npm run monitor
```

`npx playwright install` downloads all three browser engines. To download fewer, name them (for example `npx playwright install chromium`) and list only the matching profiles under `browsers` in the config.

`SITE_CONFIG` is the config to check. `npm run monitor:demo` runs the broken demo pages, and `npm run report` opens the HTML report from the last run.

## What's in the repository

| Path | What it is |
| --- | --- |
| [`sites/`](sites) | One JSON file per site to monitor |
| [`examples/`](examples) | A starter config, and the config for the demo |
| [`fixtures/`](fixtures) | The demo pages, most of them broken on purpose |
| [`tests/`](tests) | The checks: page-level in `tags.spec.ts`, form flows in `conversions.spec.ts` |
| [`reporters/`](reporters) | Builds the summary table used on the run page and in issues |
| [`browser-profiles.json`](browser-profiles.json) | The browser and device profiles a config can choose from |
| [`site-config.ts`](site-config.ts) | Loads and validates the site config |
| [`.github/workflows/`](.github/workflows) | The schedule, the reusable workflow, and the demo |
