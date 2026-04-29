import { test, expect } from '../../fixtures/test';
import { Page } from '@playwright/test';
import {
  switchCheckoutMode,
  configureGateway,
  verifyOrderViaAPI,
  getLogEntryCount,
} from '../../helpers/api';
import { addToCartAndCheckout } from '../../helpers/cart';
import {
  fillBilling,
  selectPaymentMethod,
  clickPlaceOrder,
  extractOrderTotal,
} from '../../helpers/checkout';
import { fillHostedSessionCC } from '../../helpers/hosted-session';
import { verifyOrderReceived } from '../../helpers/order-received';
import { adminLogin } from '../../helpers/wp-login';
import {
  navigateToOrder,
  assertOrderStatus,
  refundPayment,
  assertOrderNoteContains,
} from '../../helpers/admin-orders';
import {
  extractTransactionPutLogs,
  verifyRefundLog,
} from '../../helpers/log-verification';
import { verifyOrderEmails } from '../../helpers/email-verification';
import config from '../../plugin-config';
import { cards } from '../../fixtures/cards';
import { billing } from '../../fixtures/billing';

test.describe.serial('Refund', () => {
  let adminPage: Page;
  // GI source: MC-040/041 use 5123456789012346 = cards.mastercard (frictionless).
  const card = cards.mastercard;
  // MC-042 reuses the partially refunded order from MC-041.
  let mc041OrderNumber: string;
  let mc041Total: string;

  test.beforeAll(async ({ browser }) => {
    const adminContext = await browser.newContext({ ignoreHTTPSErrors: true });
    adminPage = await adminContext.newPage();
    await adminLogin(adminPage);
  });

  test.afterAll(async () => {
    await adminPage.close();
  });

  // === MC-040: Full refund ===

  test('MC-040 - Full refund', async ({ page }) => {
    await switchCheckoutMode('classic');
    await configureGateway(config, {
      _3d_secure: 'yes',
      transaction_mode: 'PURCHASE',
      checkout_mode: 'hosted_session',
    });

    const logOffset = await getLogEntryCount(new Date().toISOString().slice(0, 19));
    const payDate = await addToCartAndCheckout(page, config.products.physical);

    await fillBilling(page, billing);
    const total = await extractOrderTotal(page);
    await selectPaymentMethod(page, config);
    await fillHostedSessionCC(page, card, config);

    await clickPlaceOrder(page);
    await page.waitForURL(/order-received/, { timeout: 60000 });
    const result = await verifyOrderReceived(page, { displayName: config.displayName, expectedTotal: total });
    const orderNumber = result.orderNumber;
    expect(orderNumber).toBeTruthy();

    const { order, transactionId } = await verifyOrderViaAPI(orderNumber, config);
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(order.payment_method_title).toBe(config.displayName);
    expect(transactionId).toBeTruthy();

    await verifyOrderEmails(orderNumber, { paymentMethodTitle: config.displayName });

    await navigateToOrder(adminPage, orderNumber);
    const orderTotalStr = String(order.total);
    await refundPayment(adminPage, orderTotalStr);

    // Status select is bound at page load; reload to see the new value.
    await navigateToOrder(adminPage, orderNumber);
    await assertOrderStatus(adminPage, 'Refunded');
    await assertOrderNoteContains(adminPage, 'Refund of');

    const transactionLogs = await extractTransactionPutLogs(payDate, logOffset);
    const refundLog = transactionLogs.logs[0]?.content.find(
      (l: any) => l.request?.body?.apiOperation === 'REFUND' && l.request?.url?.includes(transactionId!)
    );
    expect(refundLog, 'REFUND log not found').toBeTruthy();
    verifyRefundLog(refundLog!, { total: orderTotalStr, currency: 'USD', isPartial: false });
  });

  // === MC-041: Partial refund ===

  test('MC-041 - Partial refund', async ({ page }) => {
    const logOffset = await getLogEntryCount(new Date().toISOString().slice(0, 19));
    const payDate = await addToCartAndCheckout(page, config.products.digital);

    await fillBilling(page, billing);
    const total = await extractOrderTotal(page);
    await selectPaymentMethod(page, config);
    await fillHostedSessionCC(page, card, config);

    await clickPlaceOrder(page);
    await page.waitForURL(/order-received/, { timeout: 60000 });
    const result = await verifyOrderReceived(page, { displayName: config.displayName, expectedTotal: total });
    const orderNumber = result.orderNumber;
    expect(orderNumber).toBeTruthy();

    const { order, transactionId } = await verifyOrderViaAPI(orderNumber, config);
    expect(transactionId).toBeTruthy();

    await verifyOrderEmails(orderNumber, { paymentMethodTitle: config.displayName });

    await navigateToOrder(adminPage, orderNumber);

    const orderTotalStr = String(order.total);
    const halfAmount = (parseFloat(orderTotalStr) / 2).toFixed(2);
    await refundPayment(adminPage, halfAmount);

    await navigateToOrder(adminPage, orderNumber);
    await assertOrderStatus(adminPage, 'Processing');
    await assertOrderNoteContains(adminPage, 'Refund of');

    const transactionLogs = await extractTransactionPutLogs(payDate, logOffset);
    const refundLog = transactionLogs.logs[0]?.content.find(
      (l: any) => l.request?.body?.apiOperation === 'REFUND' && l.request?.url?.includes(transactionId!)
    );
    expect(refundLog, 'REFUND log not found').toBeTruthy();
    // For partial refunds, request transaction.amount is the partial — pass it
    // as `total` so verifyRefundLog asserts against the right number.
    verifyRefundLog(refundLog!, { total: halfAmount, currency: 'USD', isPartial: true, partialAmount: halfAmount });

    mc041OrderNumber = orderNumber;
    mc041Total = orderTotalStr;
  });

  // === MC-042: Exceed total refund ===

  test('MC-042 - Exceed total refund', async () => {
    expect(mc041OrderNumber, 'MC-041 must run first to provide the partially refunded order').toBeTruthy();

    await navigateToOrder(adminPage, mc041OrderNumber);

    // Capture pre-attempt refund-note count so we can assert no NEW refund
    // was processed.
    const refundNotesBefore = await adminPage
      .locator('li.note .note_content p, #order_note_list li .note_content p')
      .filter({ hasText: 'Refund of' })
      .count();

    const exceedAmount = mc041Total;
    await adminPage.locator('.refund-items').click();
    await adminPage.locator('#refund_amount').fill(exceedAmount);

    const refundBtn = adminPage.locator('.do-api-refund');
    const isDisabled = await refundBtn.isDisabled({ timeout: 3000 }).catch(() => false);

    if (isDisabled) {
      expect(isDisabled, 'refund button correctly disabled when exceeding remaining').toBeTruthy();
      return;
    }

    adminPage.once('dialog', dialog => dialog.accept());
    await refundBtn.click().catch(() => undefined);

    // WC blocks the over-refund either via a JS alert or a server-side
    // notice. Either way no second "Refund of ..." order note may be
    // written and the order must stay in Processing.
    await adminPage.waitForTimeout(2000);
    const refundNotesAfter = await adminPage
      .locator('li.note .note_content p, #order_note_list li .note_content p')
      .filter({ hasText: 'Refund of' })
      .count();
    expect(refundNotesAfter, 'over-refund must not produce a new refund note').toBe(refundNotesBefore);

    await navigateToOrder(adminPage, mc041OrderNumber);
    await assertOrderStatus(adminPage, 'Processing');
  });
});
