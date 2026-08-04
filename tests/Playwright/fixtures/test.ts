/**
 * Custom test fixtures.
 *
 * Import { test, expect } from this file instead of '@playwright/test' to get:
 * - Screenshot (PNG) on failure
 * - YAML aria snapshot on failure
 * - Console log on failure
 * - Network request log on failure
 * - `adminPage` / `emailPage`: extra admin-authenticated browser contexts that
 *   are torn down for you, so nothing leaks past the test that used them.
 *
 * The built-in `page` fixture needs no help — Playwright closes its context
 * after each test. `adminPage` and `emailPage` are the ones that used to leak:
 * suites created a context in `beforeAll`, closed only the *page* in
 * `afterAll`, and left the context open for the whole run.
 *
 * Both are eager rather than lazily proxied. A Proxy that defers context
 * creation until first use cannot serve *synchronous* Page methods, because
 * there is no page to bind them to yet — `page.url()` hands back a Promise and
 * the caller's `.includes(...)` explodes. `navigateToOrder()` calls
 * `detectHPOS()`, which does exactly that, so the whole admin flow tripped over
 * it. Eagerness costs nothing anyway: Playwright only builds a fixture that a
 * test actually destructures.
 */

import { test as base, expect, type Page, type BrowserContext } from '@playwright/test';
import { PageLog, dumpFailureArtifacts } from '../helpers/debug';
import { adminLogin } from '../helpers/wp-login';

export { expect };

/** Admin-authenticated context + page; closing the context closes the page. */
async function openAdminPage(
  browser: { newContext(options?: Record<string, unknown>): Promise<BrowserContext> }
): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  await adminLogin(page);
  return { ctx, page };
}

interface Fixtures {
  adminPage: Page;
  emailPage: Page;
  _debugOnFailure: void;
}

export const test = base.extend<Fixtures>({
  /** wp-admin context for order screens and settings. */
  adminPage: async ({ browser }, use) => {
    const { ctx, page } = await openAdminPage(browser);
    await use(page);
    await ctx.close();
  },

  /**
   * Separate admin-authenticated context for inspecting email in the browser.
   * Nothing uses it yet — email assertions currently go through the
   * `custom/v1/get-mail` endpoint in `wc-api.ts` — but a spec that asks for it
   * gets a context that is cleaned up on the way out.
   */
  emailPage: async ({ browser }, use) => {
    const { ctx, page } = await openAdminPage(browser);
    await use(page);
    await ctx.close();
  },

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
