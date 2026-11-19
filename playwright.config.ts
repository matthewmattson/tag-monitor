import { defineConfig } from '@playwright/test';
import { targetName } from './monitor.config';

const isDemo = targetName === 'demo';

export default defineConfig({
  testDir: './tests',
  timeout: 45_000,
  // One retry against the live site so a network blip doesn't raise an alarm.
  retries: isDemo ? 0 : 1,
  workers: 1,
  reporter: [
    ['list'],
    ['html', { open: 'never' }],
    ['./reporters/summary-reporter.ts'],
  ],
  // The demo target is a set of deliberately broken pages served locally.
  webServer: isDemo
    ? {
        command: 'node scripts/serve-fixtures.mjs',
        url: 'http://localhost:4173/healthy.html',
        reuseExistingServer: !process.env.CI,
      }
    : undefined,
});
