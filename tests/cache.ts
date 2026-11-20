import fs from 'node:fs';
import path from 'node:path';
import type { TestInfo } from '@playwright/test';

const slug = (value: string) => value.replace(/[^a-z0-9]+/gi, '-').toLowerCase();

/**
 * Load a page once per run, not once per failure.
 *
 * Playwright starts a fresh worker after every failed test, which would
 * reload the page for each remaining check. The capture is saved in the
 * run's output folder (wiped at the start of every run) and reused. A retry
 * gets its own fresh capture, so retrying still re-tests the live site.
 */
export async function oncePerRun<T>(
  testInfo: TestInfo,
  key: string,
  produce: () => Promise<T>,
): Promise<T> {
  const dir = path.join(testInfo.project.outputDir, '.captures');
  const file = path.join(
    dir,
    `${slug(testInfo.project.name)}-${slug(key)}-attempt${testInfo.retry}.json`,
  );
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8')) as T;

  const value = await produce();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
  return value;
}
