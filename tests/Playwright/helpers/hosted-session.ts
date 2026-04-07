import { Page, expect } from '@playwright/test';
import type { CardData, PluginConfig } from '../plugin-config.types';
import { waitForUnblock } from './block-ui';

export async function assertSessionFieldsPresent(page: Page, config: PluginConfig): Promise<void> {
  const frame = page.frameLocator(config.mpgsIframePattern);
  await expect(frame.locator('#number')).toBeVisible({ timeout: 15000 });
  await expect(frame.locator('#expiryMonth')).toBeVisible();
  await expect(frame.locator('#expiryYear')).toBeVisible();
  await expect(frame.locator('#securityCode')).toBeVisible();
}

export async function fillHostedSessionCC(page: Page, card: CardData, config: PluginConfig): Promise<void> {
  await waitForUnblock(page);
  const frame = page.frameLocator(config.mpgsIframePattern);

  await frame.locator('#number').click();
  await waitForUnblock(page);
  await frame.locator('#number').fill(card.number);

  await frame.locator('#expiryMonth').click();
  await frame.locator('#expiryMonth').fill(card.month);

  await frame.locator('#expiryYear').click();
  await frame.locator('#expiryYear').fill(card.year);

  await frame.locator('#securityCode').click();
  await frame.locator('#securityCode').fill(card.cvv);
  await frame.locator('#securityCode').press('Tab');
}

export async function fillHostedSessionCCPartial(
  page: Page,
  config: PluginConfig,
  fields: { number?: string; month?: string; year?: string; cvv?: string }
): Promise<void> {
  await waitForUnblock(page);
  const frame = page.frameLocator(config.mpgsIframePattern);

  if (fields.number !== undefined) {
    await frame.locator('#number').click();
    await frame.locator('#number').fill(fields.number);
  }
  if (fields.month !== undefined) {
    await frame.locator('#expiryMonth').click();
    await frame.locator('#expiryMonth').fill(fields.month);
  }
  if (fields.year !== undefined) {
    await frame.locator('#expiryYear').click();
    await frame.locator('#expiryYear').fill(fields.year);
  }
  if (fields.cvv !== undefined) {
    await frame.locator('#securityCode').click();
    await frame.locator('#securityCode').fill(fields.cvv);
    await frame.locator('#securityCode').press('Tab');
  }
}
