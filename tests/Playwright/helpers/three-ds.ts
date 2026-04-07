import { Page } from '@playwright/test';

export async function handle3DSChallenge(page: Page): Promise<void> {
  await page.waitForSelector('text=ACS Emulator for 3DS V2', { timeout: 30000 });
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await page.waitForURL(/order-received|checkout/, { timeout: 60000 });
}

export async function waitFor3DSFrame(page: Page): Promise<void> {
  await page.waitForSelector('iframe#challengeFrame, .absolute', { timeout: 30000 });
}
