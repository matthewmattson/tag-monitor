import fs from 'node:fs';
import type { FullConfig, Reporter, Suite, TestCase } from '@playwright/test/reporter';
import { target, targetName } from '../monitor.config';

const ANSI = /\u001b\[[0-9;]*m/g;

/**
 * Writes a short Markdown report: one table row per page, then the reason for
 * each failed check. It goes to monitor-report.md (used as the body of the
 * GitHub issue) and to the Actions run summary when running in CI.
 */
export default class SummaryReporter implements Reporter {
  private root!: Suite;

  onBegin(_config: FullConfig, suite: Suite) {
    this.root = suite;
  }

  onEnd() {
    const byPage = new Map<string, TestCase[]>();
    for (const testCase of this.root.allTests()) {
      const pageName = testCase.parent.title;
      byPage.set(pageName, [...(byPage.get(pageName) || []), testCase]);
    }

    const failed = (testCase: TestCase) => testCase.outcome() === 'unexpected';
    const allTests = [...byPage.values()].flat();
    const failures = allTests.filter(failed);

    const lines: string[] = [];
    lines.push(`## Tag monitor: ${failures.length === 0 ? 'all checks passed' : `${failures.length} check(s) failed`}`);
    lines.push('');
    lines.push(`Target: \`${targetName}\` (${target.baseURL}), ${allTests.length} checks across ${byPage.size} pages.`);
    lines.push('');
    lines.push('| Page | Result | Failed checks |');
    lines.push('| --- | --- | --- |');
    for (const [pageName, tests] of byPage) {
      const pageFailures = tests.filter(failed);
      lines.push(
        `| ${pageName} | ${pageFailures.length === 0 ? '✅ pass' : '❌ fail'} | ${
          pageFailures.map((testCase) => testCase.title).join('<br>') || ''
        } |`,
      );
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
        lines.push(`- **${testCase.parent.title}: ${testCase.title}.** ${message}`);
      }
    }

    const report = lines.join('\n') + '\n';
    fs.writeFileSync('monitor-report.md', report);
    if (process.env.GITHUB_STEP_SUMMARY) {
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
    }
  }
}
