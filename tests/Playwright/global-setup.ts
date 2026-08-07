/**
 * Sign in to every configured install once, before any test runs, and save each
 * session to `auth/admin-<host>.json`.
 *
 * Without this the first admin navigation on each site pays for a login, and
 * with three sites in play that is three logins competing with the first three
 * suites. Sessions are also reused across runs, so on a warm checkout this whole
 * step is three cheap validation requests.
 *
 * A site whose saved session still works is left alone; one that is missing,
 * malformed or expired is re-created. Never fatal: a site that cannot be
 * prepared here just logs in lazily later via `ensureAdminSession()`.
 */

import { chromium } from '@playwright/test';
import { siteUrls, siteKey } from './helpers/site';
import { adminLogin, adminStatePath, hasSavedAdminState } from './helpers/wp-login';

export default async function globalSetup(): Promise<void> {
  const sites = siteUrls();
  if (!sites.length) {
    console.log('  ── auth ── no sites configured (WP_BASE_URLS / WP_BASE_*_URL), skipping');
    return;
  }

  const browser = await chromium.launch();
  try {
    for (const [slot, site] of sites.entries()) {
      const statePath = adminStatePath(site);
      const label = siteKey(site);

      if (hasSavedAdminState(site)) {
        // Present is not the same as valid: cookies expire and can be revoked
        // server-side, which only shows up as a redirect to wp-login.
        const ctx = await browser.newContext({
          baseURL: site,
          ignoreHTTPSErrors: true,
          storageState: statePath,
        });
        const page = await ctx.newPage();
        let valid = false;
        try {
          await page.goto('/wp-admin/');
          valid = !page.url().includes('wp-login.php');
        } catch {
          valid = false;
        }
        await ctx.close();
        if (valid) {
          console.log(`  ── auth ── ${label}: reused existing session`);
          continue;
        }
        console.log(`  ── auth ── ${label}: saved session stale, signing in again`);
      }

      const ctx = await browser.newContext({ baseURL: site, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        // Pass the slot: this process prepares every site, so the credentials
        // must be resolved per site rather than for "the current worker".
        await adminLogin(page, slot);
        await ctx.storageState({ path: statePath });
        console.log(`  ── auth ── ${label}: signed in, saved ${statePath}`);
      } catch (err) {
        // Don't fail the whole run for one unreachable install — the suites that
        // land on it will report the real problem in context.
        console.log(`  ── auth ── ${label}: could not sign in (${(err as Error).message.split('\n')[0]})`);
      } finally {
        await ctx.close();
      }
    }
  } finally {
    await browser.close();
  }
}
