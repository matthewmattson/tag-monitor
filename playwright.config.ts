import { defineConfig, devices } from '@playwright/test';
import { browsers, site } from './site-config';

const isDemo = Boolean(site.serveFixtures);

export default defineConfig({
  testDir: './tests',
  timeout: 45_000,
  // One retry against the live site so a network blip doesn't raise an alarm.
  retries: isDemo ? 0 : 1,
  // Each browser profile is its own project. Pages within a profile run in
  // order; three run side by side. Four was measured to be no faster and
  // puts more simultaneous connections on the site being checked.
  workers: 3,
  projects: browsers.map((browser) => ({
    name: browser.label,
    use: { ...devices[browser.device] },
  })),
  reporter: [
    ['list'],
    ['html', { open: 'never' }],
    ['./reporters/summary-reporter.ts'],
  ],
  // The demo config checks deliberately broken pages served from ./fixtures.
  webServer: isDemo
    ? {
        command: 'node scripts/serve-fixtures.mjs',
        url: 'http://localhost:4173/healthy.html',
        reuseExistingServer: !process.env.CI,
      }
    : undefined,
});
