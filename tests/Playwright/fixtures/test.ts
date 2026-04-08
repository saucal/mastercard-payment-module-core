/**
 * Custom test fixture that auto-captures debug artifacts on test failure.
 *
 * Import { test, expect } from this file instead of '@playwright/test' to get:
 * - Screenshot (PNG) on failure
 * - YAML aria snapshot on failure
 * - Console log on failure
 * - Network request log on failure
 */

import { test as base, expect } from '@playwright/test';
import { PageLog, dumpFailureArtifacts } from '../helpers/debug';
import { RequestTracer } from '../helpers/request-tracer';

export { expect };

export const test = base.extend<{ _debugOnFailure: void }>({
  _debugOnFailure: [async ({ page }, use, testInfo) => {
    const pageLog = new PageLog();
    pageLog.install(page);

    await use();

    if (testInfo.status !== testInfo.expectedStatus) {
      await dumpFailureArtifacts(page, testInfo, pageLog);
    }
    pageLog.clear();
  }, { auto: true }],
});
