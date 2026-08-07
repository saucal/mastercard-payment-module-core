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
import { adminStatePath, hasSavedAdminState } from '../helpers/wp-login';
import { siteUrl, siteUrls } from '../helpers/site';

export { expect };

type BrowserLike = { newContext(options?: Record<string, unknown>): Promise<BrowserContext> };

/**
 * Contexts this file created and is therefore responsible for tracing and
 * closing.
 *
 * With browser reuse on — which the VS Code extension does by default —
 * `browser.newContext()` hands back the *same* context every call. Both
 * `adminPage` and `emailPage` then share one context, and treating it as ours
 * twice means `tracing.start()` throws "Tracing has been already started" and
 * the first teardown closes the context the other fixture is still using.
 */
const OWNED_CONTEXTS = new WeakSet<BrowserContext>();

interface AdminPageHandle {
  ctx: BrowserContext;
  page: Page;
  /** False when `browser.newContext()` returned a reused context. */
  owned: boolean;
}

const REUSE_CONFLICT = [
  'adminPage/emailPage cannot share a context with the shopper page.',
  '',
  'browser.newContext() returned the context the `page` fixture is already using,',
  'which means Playwright context reuse is on. Under reuse there is one context and',
  'one page, so admin navigation would move the shopper page out from under the',
  'test — that is how a checkout test ends up asserting against wp-admin.',
  '',
  'Turn off "Show browser" in the VS Code Playwright panel (that setting enables',
  'reuse), or run from the CLI: npx playwright test',
].join('\n');

/**
 * Open a fresh context + blank page. Nothing is navigated and nobody logs in
 * here: the wp-admin session is established on first use by
 * `ensureAdminSession()`, which every admin navigation calls. A test that never
 * opens an admin screen therefore never logs in, and the shopper's page can
 * never be hijacked by a fixture doing setup navigation.
 *
 * `storageState` is loaded when a saved session exists, so the deferred login is
 * usually a no-op.
 */
async function openContext(
  browser: BrowserLike,
  opts: { withAdminState: boolean },
  shopperPage?: Page,
): Promise<AdminPageHandle> {
  const ctx = await browser.newContext({
    ignoreHTTPSErrors: true,
    ...(opts.withAdminState && hasSavedAdminState() ? { storageState: adminStatePath() } : {}),
  });
  // Check identity before touching anything: under context reuse this would be
  // the shopper's own context.
  if (shopperPage && ctx === shopperPage.context()) throw new Error(REUSE_CONFLICT);

  const owned = !OWNED_CONTEXTS.has(ctx);
  if (owned) OWNED_CONTEXTS.add(ctx);
  return { ctx, page: await ctx.newPage(), owned };
}

interface Fixtures {
  adminPage: Page;
  emailPage: Page;
  _debugOnFailure: void;
}

interface WorkerFixtures {
  _announceSite: void;
}

/**
 * Playwright only traces the context behind the built-in `page` fixture, so
 * contexts we create ourselves produce no trace, video or screenshots no matter
 * what `use.trace` says — an admin- or email-side failure had nothing to look at.
 * Trace these explicitly and attach on failure only, mirroring
 * `trace: 'retain-on-failure'`.
 *
 * Tracing deliberately starts *after* `adminLogin()`: `fill()` arguments are
 * recorded in the trace, so including the login would write the admin password
 * into a zip attached to the HTML report.
 */
async function traceUntilTeardown(
  ctx: BrowserContext,
  testInfo: { status?: string; expectedStatus?: string; outputPath(name: string): string;
              attach(name: string, opts: Record<string, unknown>): Promise<void> },
  label: string,
): Promise<() => Promise<void>> {
  try {
    await ctx.tracing.start({ screenshots: true, snapshots: true, sources: true });
  } catch {
    // Someone else is already tracing this context (browser reuse, or
    // Playwright itself). Leave their trace alone and do nothing on teardown —
    // stopping it here would truncate a recording we do not own.
    return async () => {};
  }

  return async () => {
    if (testInfo.status !== testInfo.expectedStatus) {
      const zip = testInfo.outputPath(`trace-${label}.zip`);
      await ctx.tracing.stop({ path: zip }).catch(() => {});
      // Named 'trace' so the HTML reporter renders it with the trace viewer
      // rather than as an opaque download.
      await testInfo.attach('trace', { path: zip, contentType: 'application/zip' }).catch(() => {});
    } else {
      await ctx.tracing.stop().catch(() => {});
    }
  };
}

export const test = base.extend<Fixtures, WorkerFixtures>({
  /**
   * Announce, once per worker, which install this slot owns. With several sites
   * in play the first question about any console line or failure is "which
   * site?", and TEST_PARALLEL_INDEX alone does not answer it.
   */
  _announceSite: [async ({}, use, workerInfo) => {
    const all = siteUrls();
    console.log(
      `\n  ── worker ${workerInfo.parallelIndex} ──\n`
      + `  site  : ${siteUrl()}\n`
      + `  of    : ${all.length} configured\n`,
    );
    await use();
  }, { scope: 'worker', auto: true }],

  /** wp-admin context for order screens and settings. */
  adminPage: async ({ browser, page: shopperPage }, use, testInfo) => {
    const { ctx, page, owned } = await openContext(browser, { withAdminState: true }, shopperPage);
    // Only trace/close a context we created. Under browser reuse this context is
    // shared with the other fixture, and closing it would pull the page out from
    // under whoever else holds it.
    const finishTrace = owned
      ? await traceUntilTeardown(ctx, testInfo, 'adminPage')
      : async () => {};
    await use(page);
    await finishTrace();
    if (owned) await ctx.close();
    else await page.close().catch(() => {});
  },

  /**
   * Separate context for inspecting email in the browser.
   * `verifyOrderEmails()` and friends render the mail they fetched from
   * `custom/v1/get-mail` into this page via `showEmails()`, so a failing email
   * assertion leaves the actual message visible in this context's trace.
   */
  emailPage: async ({ browser, page: shopperPage }, use, testInfo) => {
    // No admin state: this page only ever receives setContent() from
    // showEmails(), so it needs no session and no navigation.
    const { ctx, page, owned } = await openContext(browser, { withAdminState: false }, shopperPage);
    const finishTrace = owned
      ? await traceUntilTeardown(ctx, testInfo, 'emailPage')
      : async () => {};
    await use(page);
    await finishTrace();
    if (owned) await ctx.close();
    else await page.close().catch(() => {});
  },


  _debugOnFailure: [async ({ page }, use, testInfo) => {
    const pageLog = new PageLog();
    pageLog.install(page);

    await use();

    if (testInfo.status !== testInfo.expectedStatus) {
      await dumpFailureArtifacts(page, testInfo, pageLog);
    }
    pageLog.clear();

    // Deliberately NOT closing page.context() here. Playwright owns the shopper
    // context: it stops tracing, finalises the video and attaches both during
    // its own teardown. Closing it first threw those artifacts away, so
    // `trace: 'retain-on-failure'` produced nothing. It also fights the VS Code
    // extension, which keeps contexts alive to reuse between runs.
  }, { auto: true }],
});
