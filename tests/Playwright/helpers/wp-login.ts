import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Page, expect } from '@playwright/test';
import { siteKey, siteEnv } from './site';

/**
 * Login credentials for the site this worker owns. `globalSetup` prepares every
 * site in one process, so it passes the slot explicitly instead.
 */
function adminCredentials(slot?: number): { username: string; password: string } {
  return {
    username: siteEnv('WP_USERNAME', slot) || 'admin',
    password: siteEnv('WP_ADMIN_PASS', slot) || siteEnv('WP_PASSWORD', slot) || 'admin',
  };
}

/**
 * Saved wp-admin session, reused across tests and runs so admin contexts skip
 * the login round-trip. Gitignored — it holds live session cookies.
 *
 * One file per site: session cookies are host-scoped, so a single file cannot
 * authenticate three installs — replaying site A's cookies on site B just
 * bounces to wp-login.
 *
 * Derived from `import.meta.url` because this package is `"type": "module"`
 * (no `__dirname`) and because the working directory differs between a
 * repo-root run and a run from tests/Playwright.
 */
export function adminStatePath(siteUrl?: string): string {
  return path.join(
    path.dirname(fileURLToPath(import.meta.url)), '..', 'auth',
    `admin-${siteUrl ? siteKey(siteUrl) : siteKey()}.json`,
  );
}

/** True when the given site's state file exists and holds at least one cookie. */
export function hasSavedAdminState(siteUrl?: string): boolean {
  try {
    const parsed = JSON.parse(fs.readFileSync(adminStatePath(siteUrl), 'utf8'));
    return Array.isArray(parsed?.cookies) && parsed.cookies.length > 0;
  } catch {
    // Missing, empty, or malformed — treat all three as "log in again".
    return false;
  }
}

/**
 * Make sure this page has a usable wp-admin session, logging in only if needed.
 *
 * Called at the start of every admin navigation instead of during fixture
 * setup, so a test that never opens an admin screen never logs in.
 *
 * Landing on wp-admin is also a precondition for `detectHPOS()`, which decides
 * HPOS vs legacy by looking for a link in the admin menu of the *current* page.
 * Skip this and every order URL quietly takes the legacy branch.
 */
export async function ensureAdminSession(page: Page): Promise<void> {
  if (!page.url().includes('/wp-admin')) {
    await page.goto('/wp-admin/');
  }
  // Saved cookies can be expired or revoked; that only shows as a redirect.
  if (page.url().includes('wp-login.php')) {
    await adminLogin(page);
    await page.context().storageState({ path: adminStatePath() });
  }
}

/**
 * Log into WordPress admin dashboard.
 */
export async function adminLogin(page: Page, slot?: number): Promise<void> {
  const { username, password } = adminCredentials(slot);
  await page.goto('/wp-login.php');
  await page.locator('#user_login').fill(username);
  await page.locator('#user_pass').fill(password);
  await page.locator('#wp-submit').click();
  await page.waitForURL(/wp-admin/);
  const confirmBtn = page.locator('#correct-admin-email');
  if (await confirmBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await confirmBtn.click();
  }
}

/**
 * Log into WordPress frontend via My Account page.
 */
export async function frontendLogin(page: Page, email: string, password: string): Promise<void> {
  // Clear any prior session on this context so the login form renders deterministically.
  await page.context().clearCookies();
  await page.goto('/my-account');
  await page.locator('#username').waitFor({ state: 'visible', timeout: 10000 });
  await page.locator('#username').fill(email);
  await page.locator('#password').fill(password);
  await page.locator('button[name="login"]').first().click();
  await expect(page.locator('.woocommerce-MyAccount-content')).toBeVisible();
  await expect(page.locator('#username')).not.toBeVisible();
  await expect(page.locator('.woocommerce-MyAccount-content')).toContainText('Hello');
}

/**
 * Register a new user via My Account page.
 */
export async function registerUser(page: Page, email: string, password: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/my-account');
  await page.locator('#reg_email').waitFor({ state: 'visible', timeout: 10000 });
  await page.locator('#reg_email').fill(email);
  await page.locator('#reg_password').fill(password);
  // WC's password-strength-meter listens for `keyup change` on #reg_password
  // and toggles the submit button's `disabled` attribute based on zxcvbn score
  // vs `min_password_strength`. Playwright's `.fill()` doesn't dispatch keyup,
  // so trigger one explicitly and wait for the meter to enable the button.
  await page.locator('#reg_password').dispatchEvent('keyup');
  await page.locator('#reg_password').dispatchEvent('change');
  await expect(page.locator('button[name="register"]'), 'register button stayed disabled — password rated below min strength').toBeEnabled({ timeout: 5000 });
  await page.locator('button[name="register"]').first().click();
  await expect(page.locator('.woocommerce-MyAccount-content'), 'registerUser failed: dashboard did not render').toBeVisible({ timeout: 10000 });
  await expect(page.locator('#reg_email'), 'registerUser failed: register form still visible').not.toBeVisible();
}
