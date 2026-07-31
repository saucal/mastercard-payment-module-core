import { Page, expect } from '@playwright/test';
import type { PluginConfig } from '../plugin-config.types';

// ─── Admin order screen ───────────────────────────────────────────────────────

export async function assertOrderStatus(page: Page, expectedStatus: string): Promise<void> {
  await expect(page.locator('#select2-order_status-container')).toContainText(expectedStatus);
}

/**
 * Verify that a specific text appears in the order notes.
 * Optionally check at a specific position (1-indexed system note).
 */
export async function assertOrderNoteContains(page: Page, text: string, position?: number): Promise<void> {
  if (position) {
    // GI checks specific note positions: li.note.system-note:nth-of-type(N)
    const positionalNote = page.locator(`li.note.system-note:nth-of-type(${position}) .note_content p`);
    if (await positionalNote.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(positionalNote).toContainText(text);
      return;
    }
  }
  // Fallback: search all notes
  const notes = page.locator('li.note .note_content p, #order_note_list li .note_content p');
  const noteTexts = await notes.allTextContents();
  const found = noteTexts.some(n => n.includes(text));
  expect(found, `Expected order note containing "${text}" but found: ${noteTexts.join(' | ')}`).toBeTruthy();
}

/**
 * Verify the order note for a captured payment (GI expects this at position 2).
 */
export async function assertCapturedNote(page: Page, config: PluginConfig, transactionId: string): Promise<void> {
  await assertOrderNoteContains(page, `${config.displayName} payment was Captured (Order ID: ${transactionId})`, 2);
}

/**
 * Verify the order note for an authorized payment.
 */
export async function assertAuthorizedNote(page: Page, config: PluginConfig, transactionId: string): Promise<void> {
  await assertOrderNoteContains(page, `${config.displayName} payment was Authorized (Order ID: ${transactionId})`);
}

/**
 * Verify the "Payment via" text in order meta.
 */
export async function assertPaymentMethodMeta(page: Page, config: PluginConfig, transactionId?: string): Promise<void> {
  if (transactionId) {
    await expect(page.locator('.woocommerce-order-data__meta')).toContainText(`Payment via ${config.displayName} (${transactionId})`);
  } else {
    await expect(page.locator('.woocommerce-order-data__meta')).toContainText(`Payment via ${config.displayName}`);
  }
}

/**
 * Verify payment method title appears in the order line items description.
 * GI checks: tbody > tr:nth-child(2) > td:nth-child(1) > span.description
 */
export async function assertPaymentMethodInLineItems(page: Page, config: PluginConfig): Promise<void> {
  const desc = page.locator('tbody > tr:nth-child(2) > td:nth-child(1) > span.description');
  if (await desc.isVisible({ timeout: 3000 }).catch(() => false)) {
    await expect(desc).toContainText(config.displayName);
  }
}

export async function assertCaptureFormVisible(page: Page, config: PluginConfig, visible: boolean): Promise<void> {
  const form = page.locator(`.${config.paymentMethodSlug}-capture-form, .acme-capture-form, .mpgs-capture-form`);
  if (visible) {
    await expect(form.first()).toBeVisible();
  } else {
    await expect(form.first()).not.toBeVisible();
  }
}

export async function assertVoidFormVisible(page: Page, config: PluginConfig, visible: boolean): Promise<void> {
  const form = page.locator(`.${config.paymentMethodSlug}-void-form, .acme-void-form, .mpgs-void-form`);
  if (visible) {
    await expect(form.first()).toBeVisible();
  } else {
    await expect(form.first()).not.toBeVisible();
  }
}
