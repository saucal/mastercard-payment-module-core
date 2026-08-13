import { test, expect } from '../../fixtures/test';
import { switchCheckoutMode, configureGateway, getFailedOrders, getLogEntryCount, getLogs } from '../../helpers/wc-api';
import { addToCartAndCheckout } from '../../helpers/cart';
import {
  fillBilling,
  selectPaymentMethod,
  clickPlaceOrder,
  getCheckoutError,
} from '../../helpers/checkout';
import { fillHostedSessionCC } from '../../helpers/hosted-session';
import { waitForUnblock } from '../../helpers/block-ui';
import { navigateToOrder } from '../../helpers/admin-orders';
import { assertOrderStatus, assertOrderNoteContains, assertPaymentMethodMeta } from '../../helpers/assertions';

import config from '../../plugin-config';
import { cards } from '../../fixtures/cards';
import { billing } from '../../fixtures/billing';

test.describe.serial('Hosted Session - Declined Transactions', () => {
  // Pick the most-recently-created failed order created on/after `since` (ISO timestamp).
  async function pickFailedOrderSince(since: string): Promise<any> {
    const orders = await getFailedOrders();
    expect(orders.length, 'no failed orders returned').toBeGreaterThan(0);
    const candidate = orders.find(
      (o: any) => o.payment_method === config.paymentMethodSlug && o.date_created_gmt >= since,
    );
    expect(candidate, `no failed order created since ${since}`).toBeTruthy();
    return candidate;
  }

  // === MC-014: Declined transaction ===

  test('MC-014 - Declined transaction', async ({ page, adminPage }) => {
    await switchCheckoutMode('classic');
    await configureGateway(config, {
      _3d_secure: 'yes',
      saved_cards: 'yes',
      transaction_mode: 'PURCHASE',
      checkout_mode: 'hosted_session',
      // Pinned off: site-global, and an unanswered DCC offer blocks place-order
      // (see suite 01 for the full explanation). DCC's own coverage is suite 19.
      currency_conversion: 'no',
    });

    const logOffset = await getLogEntryCount(new Date().toISOString().slice(0, 19));
    const since = new Date().toISOString().slice(0, 19);
    const payDate = await addToCartAndCheckout(page, config.products.physical);
    await fillBilling(page, billing);
    await selectPaymentMethod(page, config);
    await fillHostedSessionCC(page, cards.declined, config);

    await clickPlaceOrder(page);
    await waitForUnblock(page);

    const error = await getCheckoutError(page);
    expect(error).toContain('Do not honour');

    const failedOrder = await pickFailedOrderSince(since);
    const orderNumber = String(failedOrder.id);

    const allLogs = await getLogs(payDate, '', logOffset);
    const logContent = allLogs.logs[0]?.content ?? [];
    const payLog = logContent.find(
      (l: any) => l.request?.body?.apiOperation === 'PAY'
        && l.response?.body?.result === 'FAILURE',
    );
    expect(payLog, 'PAY log with FAILURE result not found').toBeTruthy();
    expect(payLog!.response?.body?.response?.gatewayCode).toBe('DECLINED');

    await navigateToOrder(adminPage, orderNumber);
    await assertOrderStatus(adminPage, 'Failed');
    await assertPaymentMethodMeta(adminPage, config);
    await assertOrderNoteContains(adminPage, 'Error processing payment.');
  });

  // === MC-015: Expired CC ===
  // AUDIT 2026-04-29 vs GI: JUSTIFIED FIX — GI asserts ".woocommerce-error"
  // = "Do not honour" (one shared selector across all decline tests). PW
  // asserts "Expired card" + gatewayCode=EXPIRED_CARD. The MPGS test env
  // returns the more specific message for this card; tightening to it is
  // a regression-safer assertion than GI's pooled string.

  test('MC-015 - Expired CC', async ({ page, adminPage }) => {
    const logOffset = await getLogEntryCount(new Date().toISOString().slice(0, 19));
    const since = new Date().toISOString().slice(0, 19);
    const payDate = await addToCartAndCheckout(page, config.products.physical);
    await fillBilling(page, billing);
    await selectPaymentMethod(page, config);
    await fillHostedSessionCC(page, cards.expired, config);

    await clickPlaceOrder(page);
    await waitForUnblock(page);

    const error = await getCheckoutError(page);
    expect(error).toMatch(/Expired card/i);

    const failedOrder = await pickFailedOrderSince(since);
    const orderNumber = String(failedOrder.id);

    const allLogs = await getLogs(payDate, '', logOffset);
    const logContent = allLogs.logs[0]?.content ?? [];
    const payLog = logContent.find(
      (l: any) => l.request?.body?.apiOperation === 'PAY'
        && l.response?.body?.result === 'FAILURE',
    );
    expect(payLog, 'PAY log with FAILURE result not found').toBeTruthy();
    expect(payLog!.response?.body?.response?.gatewayCode).toBe('EXPIRED_CARD');

    await navigateToOrder(adminPage, orderNumber);
    await assertOrderStatus(adminPage, 'Failed');
    await assertPaymentMethodMeta(adminPage, config);
    await assertOrderNoteContains(adminPage, 'Error processing payment.');
  });

  // === MC-016: Timed out ===
  // GI uses card 4440000042200014 with expiry 08/28, cvv 100 — the combination
  // makes MPGS test env reject the transaction (the only `pass=True` assertions
  // in the GI run check the order ends as Failed). The "Timed out" name reflects
  // the suite's broader theme; the actual failure mode is a non-success PAY
  // response.
  //
  // AUDIT 2026-04-29 vs GI: JUSTIFIED FIX (status-only) — failure mode is
  // unspecified, so MC-014/015's PAY-log gatewayCode probe is intentionally
  // omitted. MISSING (acknowledged) — no PAY-log assertion at all; if the
  // gateway begins returning a stable code, add it.

  test('MC-016 - Timed out', async ({ page, adminPage }) => {
    const since = new Date().toISOString().slice(0, 19);
    await addToCartAndCheckout(page, config.products.physical);
    await fillBilling(page, billing);
    await selectPaymentMethod(page, config);
    await fillHostedSessionCC(
      page,
      { ...cards.visaFrictionless, month: '08', year: '28' },
      config,
    );

    await clickPlaceOrder(page);
    await waitForUnblock(page);

    const failedOrder = await pickFailedOrderSince(since);
    const orderNumber = String(failedOrder.id);

    await navigateToOrder(adminPage, orderNumber);
    await assertOrderStatus(adminPage, 'Failed');
    await assertPaymentMethodMeta(adminPage, config);
  });
});
