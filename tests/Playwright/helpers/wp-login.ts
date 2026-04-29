import { Page, expect } from '@playwright/test';

const WP_USERNAME = process.env.WP_USERNAME || 'admin';
const WP_ADMIN_PASS = process.env.WP_ADMIN_PASS || process.env.WP_PASSWORD || 'admin';

/**
 * Log into WordPress admin dashboard.
 */
export async function adminLogin(page: Page): Promise<void> {
  await page.goto('/wp-login.php');
  await page.locator('#user_login').fill(WP_USERNAME);
  await page.locator('#user_pass').fill(WP_ADMIN_PASS);
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
