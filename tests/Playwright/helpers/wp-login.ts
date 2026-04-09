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
  // Logout any existing session first (admin or other user)
  await page.goto('/my-account');
  const loginForm = page.locator('#username');
  if (!(await loginForm.isVisible({ timeout: 2000 }).catch(() => false))) {
    // Already logged in — find and use logout link
    const logoutLink = page.locator('.woocommerce-MyAccount-navigation a[href*="logout"], a[href*="customer-logout"]').first();
    if (await logoutLink.isVisible({ timeout: 2000 }).catch(() => false)) {
      await logoutLink.click();
      await page.waitForURL(/my-account/, { timeout: 10000 }).catch(() => {});
      await page.goto('/my-account');
    }
  }
  await page.locator('#username').fill(email);
  await page.locator('#password').fill(password);
  await page.locator('button[name="login"]').first().click();
  await expect(page.locator('.woocommerce-MyAccount-content')).toBeVisible();
}

/**
 * Register a new user via My Account page.
 */
export async function registerUser(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/my-account');
  await page.locator('#reg_email').fill(email);
  await page.locator('#reg_password').fill(password);
  await page.locator('button[name="register"]').first().click();
  await expect(page.locator('h1.entry-title')).toContainText('My account');
}
