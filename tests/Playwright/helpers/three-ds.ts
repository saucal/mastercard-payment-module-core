import { Page, expect } from '@playwright/test';

export async function handle3DSChallenge(page: Page): Promise<void> {
  // Verify ACS Emulator page loaded with correct heading
  await expect(page.locator('center > h1')).toContainText('ACS Emulator for 3DS V2', { timeout: 30000 });
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await page.waitForURL(/order-received|checkout/, { timeout: 60000 });
}

export async function waitFor3DSFrame(page: Page): Promise<void> {
  // Verify the 3DS challenge overlay and frame structure
  await page.waitForSelector('.absolute', { timeout: 30000 });
  await page.waitForSelector('iframe#challengeFrame', { timeout: 10000 });
}
