import { Page, FrameLocator, expect } from '@playwright/test';
import type { CardData, PluginConfig } from '../plugin-config.types';
import { waitForUnblock } from './block-ui';

/**
 * Find the MPGS iframe that contains a specific field.
 * MPGS hosted session renders one iframe per field (number, expiryMonth, expiryYear, securityCode).
 * Returns both the FrameLocator (for content access) and the iframe index (for outer element click).
 */
async function findFieldFrame(page: Page, config: PluginConfig, fieldId: string, timeout = 15000): Promise<FrameLocator> {
  const iframes = page.locator(config.mpgsIframePattern);
  const start = Date.now();

  while (Date.now() - start < timeout) {
    const count = await iframes.count();
    for (let i = 0; i < count; i++) {
      const frame = iframes.nth(i).contentFrame();
      const found = await frame.locator(`#${fieldId}`).count().catch(() => 0);
      if (found > 0) return frame;
    }
    await page.waitForTimeout(500);
  }

  throw new Error(`Could not find #${fieldId} in any MPGS iframe within ${timeout}ms`);
}

/**
 * Find the index of the MPGS iframe containing a specific field.
 */
async function findFieldIframeIndex(page: Page, config: PluginConfig, fieldId: string, timeout = 15000): Promise<number> {
  const iframes = page.locator(config.mpgsIframePattern);
  const start = Date.now();

  while (Date.now() - start < timeout) {
    const count = await iframes.count();
    for (let i = 0; i < count; i++) {
      const frame = iframes.nth(i).contentFrame();
      const found = await frame.locator(`#${fieldId}`).count().catch(() => 0);
      if (found > 0) return i;
    }
    await page.waitForTimeout(500);
  }

  throw new Error(`Could not find #${fieldId} in any MPGS iframe within ${timeout}ms`);
}

export async function assertSessionFieldsPresent(page: Page, config: PluginConfig): Promise<void> {
  const numberFrame = await findFieldFrame(page, config, 'number');
  await expect(numberFrame.locator('#number')).toBeVisible({ timeout: 15000 });

  const monthFrame = await findFieldFrame(page, config, 'expiryMonth');
  await expect(monthFrame.locator('#expiryMonth')).toBeVisible();

  const yearFrame = await findFieldFrame(page, config, 'expiryYear');
  await expect(yearFrame.locator('#expiryYear')).toBeVisible();

  const cvcFrame = await findFieldFrame(page, config, 'securityCode');
  await expect(cvcFrame.locator('#securityCode')).toBeVisible();
}

/**
 * Fill credit card fields inside the MPGS hosted session iframes.
 *
 * MPGS iframes are cross-origin — Playwright's fill() sets input values but
 * doesn't trigger MPGS's internal event listeners. Instead, we click the iframe
 * element to focus it, then use page.keyboard.type() to send real keyboard
 * events that MPGS captures. Tab navigates between iframe fields.
 */
/**
 * Type into an MPGS iframe field with retry logic.
 * Focuses the field, types the value, reads back the input value to verify,
 * and retries (clear + retype) if the value doesn't match.
 */
async function typeIntoMpgsField(
  page: Page,
  frame: FrameLocator,
  fieldId: string,
  value: string,
  maxAttempts = 3,
): Promise<void> {
  const input = frame.locator(`#${fieldId}`);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await input.focus();
    await page.waitForTimeout(200);
    await page.keyboard.type(value, { delay: 80 });
    await page.waitForTimeout(300);

    // Read back the value to verify it was typed correctly
    const actual = await input.inputValue().catch(() => '');
    // MPGS may format the value (e.g., card number with spaces)
    const actualDigits = actual.replace(/\D/g, '');
    if (actualDigits === value || actual === value) return;

    // Value mismatch — clear and retry
    console.log(`  MPGS field #${fieldId}: expected "${value}", got "${actual}" (attempt ${attempt})`);
    await input.focus();
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(300);
  }

  // Final check
  const final = await input.inputValue().catch(() => '');
  const finalDigits = final.replace(/\D/g, '');
  if (finalDigits !== value && final !== value) {
    throw new Error(`MPGS field #${fieldId}: failed to type "${value}" after ${maxAttempts} attempts, got "${final}"`);
  }
}

export async function fillHostedSessionCC(page: Page, card: CardData, config: PluginConfig): Promise<void> {
  await waitForUnblock(page);

  const iframes = page.locator(config.mpgsIframePattern);
  // Wait for iframes to load
  await iframes.first().waitFor({ state: 'attached', timeout: 15000 });
  const count = await iframes.count();
  if (count < 4) throw new Error(`Expected 4 MPGS iframes, found ${count}`);

  const fields: { id: string; value: string }[] = [
    { id: 'number', value: card.number },
    { id: 'expiryMonth', value: card.month },
    { id: 'expiryYear', value: card.year },
    { id: 'securityCode', value: card.cvv },
  ];

  for (const field of fields) {
    const idx = await findFieldIframeIndex(page, config, field.id);
    const frame = iframes.nth(idx).contentFrame();
    await typeIntoMpgsField(page, frame, field.id, field.value);
  }

  // Tab out of last field to trigger MPGS session update
  await page.keyboard.press('Tab');
  await page.waitForTimeout(1000);
}

/**
 * Fill only specific CC fields (for partial-fill validation tests).
 * Pass undefined for fields to leave empty.
 */
export async function fillHostedSessionCCPartial(
  page: Page,
  config: PluginConfig,
  fields: { number?: string; month?: string; year?: string; cvv?: string }
): Promise<void> {
  await waitForUnblock(page);

  const iframes = page.locator(config.mpgsIframePattern);
  await iframes.first().waitFor({ state: 'attached', timeout: 15000 });

  const fieldMap: { id: string; value: string | undefined }[] = [
    { id: 'number', value: fields.number },
    { id: 'expiryMonth', value: fields.month },
    { id: 'expiryYear', value: fields.year },
    { id: 'securityCode', value: fields.cvv },
  ];

  for (const field of fieldMap) {
    if (field.value === undefined) continue;
    const idx = await findFieldIframeIndex(page, config, field.id);
    const frame = iframes.nth(idx).contentFrame();
    await typeIntoMpgsField(page, frame, field.id, field.value);
  }

  // Tab out
  await page.keyboard.press('Tab');
  await page.waitForTimeout(500);
}
