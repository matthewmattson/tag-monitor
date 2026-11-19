import fs from 'node:fs';
import type { FullConfig, Reporter, Suite, TestCase } from '@playwright/test/reporter';
import { browsers, site, siteName } from '../site-config';

const ANSI = /\u001b\[[0-9;]*m/g;

/**
 * Writes a short Markdown report: a table with one row per page and one
 * column per browser, then the reason for each failed check. It goes to
 * monitor-report.md (used as the body of the GitHub issue) and to the Actions
 * run summary when running in CI.
 */
export default class SummaryReporter implements Reporter {
  private root!: Suite;

  onBegin(_config: FullConfig, suite: Suite) {
    this.root = suite;
  }

  onEnd() {
    const failed = (testCase: TestCase) => testCase.outcome() === 'unexpected';
    const browserOf = (testCase: TestCase) => testCase.parent.project()?.name || '';
    const pageOf = (testCase: TestCase) => testCase.parent.title;

    const allTests = this.root.allTests();
    const failures = allTests.filter(failed);
    const pageNames = [...new Set(allTests.map(pageOf))];
    const browserLabels = browsers.map((browser) => browser.label);

    const lines: string[] = [];
    lines.push(
      `## Tag monitor, ${siteName}: ${
        failures.length === 0 ? 'all checks passed' : `${failures.length} check(s) failed`
      }`,
    );
    lines.push('');
    lines.push(
      `Site: \`${siteName}\` (${site.baseURL}). ${allTests.length} checks across ` +
        `${pageNames.length} pages and ${browserLabels.length} browsers.`,
    );
    lines.push('');
    lines.push(`| Page | ${browserLabels.join(' | ')} |`);
    lines.push(`| --- | ${browserLabels.map(() => ':---:').join(' | ')} |`);
    for (const pageName of pageNames) {
      const cells = browserLabels.map((label) => {
        const tests = allTests.filter(
          (testCase) => pageOf(testCase) === pageName && browserOf(testCase) === label,
        );
        if (tests.length === 0) return '–';
        const failedCount = tests.filter(failed).length;
        return failedCount === 0 ? '✅' : `❌ ${failedCount}`;
      });
      lines.push(`| ${pageName} | ${cells.join(' | ')} |`);
    }

    if (failures.length > 0) {
      lines.push('');
      lines.push('### What went wrong');
      lines.push('');
      for (const testCase of failures) {
        const lastResult = testCase.results[testCase.results.length - 1];
        const message = (lastResult?.errors[0]?.message || 'no error message')
          .replace(ANSI, '')
          .split('\n')[0]
          .replace(/^Error: /, '');
        lines.push(
          `- **${pageOf(testCase)}, ${browserOf(testCase)}: ${testCase.title}.** ${message}`,
        );
      }
    }

    const report = lines.join('\n') + '\n';
    fs.writeFileSync('monitor-report.md', report);
    if (process.env.GITHUB_STEP_SUMMARY) {
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
    }
  }
}
