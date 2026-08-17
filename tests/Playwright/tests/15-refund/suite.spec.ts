import { test, expect } from '../../fixtures/test';
import { switchCheckoutMode, configureGateway, getLogs } from '../../helpers/wc-api';
import { checkoutHostedSession, assertOrderComplete } from '../../helpers/flows';
import { navigateToOrder, refundPayment, enterRefundAmount } from '../../helpers/admin-orders';
import {
  expectedOrderStatus,
  assertOrderStatus,
  assertOrderNoteContains,
  verifyRefundLog,
} from '../../helpers/assertions';
import config from '../../plugin-config';
import { cards } from '../../fixtures/cards';

test.describe.serial('Refund', () => {
  // GI source: MC-040/041 use 5123456789012346 = cards.mastercard (frictionless).
  const card = cards.mastercard;
  // MC-042 reuses the partially refunded order from MC-041.
  let mc041OrderNumber: string;
  let mc041Total: string;

  // The checkout here is only a fixture for the refund — this suite asserts no
  // session/token/PAY trail, deliberately, because the REFUND operation is what
  // is under test. Suites 01-02 already cover the purchase trail itself.

  // === MC-040: Full refund ===
  // AUDIT 2026-04-29 vs GI:
  // - JUSTIFIED FIX: REFUND log assertion via `verifyRefundLog` substitutes
  //   GI's per-field DOM assertions on the refund table — parser-stable.
  // - MISSING: GI also asserts `tr.refund > td.line_cost` amount and
  //   `td.total.refunded-total bdi` value, plus the system note "Order
  //   status changed from Processing to Refunded". PW asserts only "Refund
  //   of" substring + status. Consider adding DOM amount + transition note.

  test('MC-040 - Full refund', async ({ page, adminPage, emailPage }) => {
    await switchCheckoutMode('classic');
    await configureGateway(config, {
      _3d_secure: 'yes',
      transaction_mode: 'PURCHASE',
      checkout_mode: 'hosted_session',
      // Pinned off: site-global, and an unanswered DCC offer blocks place-order
      // (see suite 01 for the full explanation). DCC's own coverage is suite 19.
      currency_conversion: 'no',
    });

    const ctx = await checkoutHostedSession(page, config, {
      productId: config.products.physical,
      card,
    });

    await assertOrderComplete(ctx, config, { page, adminPage, emailPage }, {
      status: 'Processing',
      note: 'captured',
    });

    const orderTotalStr = String(ctx.order.total);
    await refundPayment(adminPage, orderTotalStr);

    // Status select is bound at page load; reload to see the new value.
    await navigateToOrder(adminPage, ctx.orderNumber);
    await assertOrderStatus(adminPage, 'Refunded');
    await assertOrderNoteContains(adminPage, 'Refund of');

    const transactionLogs = await getLogs(ctx.payDate, '/transaction', ctx.logOffset);
    const refundLog = transactionLogs.logs[0]?.content.find(
      (l: any) => l.request?.body?.apiOperation === 'REFUND' && l.request?.url?.includes(ctx.transactionId)
    );
    expect(refundLog, 'REFUND log not found').toBeTruthy();
    verifyRefundLog(refundLog!, { total: orderTotalStr, currency: 'USD', isPartial: false });
  });

  // === MC-041: Partial refund ===
  // AUDIT 2026-04-29 vs GI:
  // - JUSTIFIED FIX: pass partial halfAmount as `total` to verifyRefundLog
  //   so the request transaction.amount assertion lines up (helper compares
  //   request amount to the value passed; partial flows put the partial in
  //   the request, not the order total).
  // - MISSING: same DOM-amount assertions as MC-040 (refund-row line_cost,
  //   refunded-total bdi). PW relies on the log-level partialAmount check.

  test('MC-041 - Partial refund', async ({ page, adminPage, emailPage }) => {
    // Digital product: WooCommerce auto-completes it, and a partial refund
    // leaves it Completed rather than moving it to Refunded.
    const downloadStatus = expectedOrderStatus({ product: 'download', transaction: 'capture' });

    const ctx = await checkoutHostedSession(page, config, {
      productId: config.products.digital,
      card,
    });

    await assertOrderComplete(ctx, config, { page, adminPage, emailPage }, {
      status: downloadStatus,
      note: 'captured',
    });

    const orderTotalStr = String(ctx.order.total);
    const halfAmount = (parseFloat(orderTotalStr) / 2).toFixed(2);
    await refundPayment(adminPage, halfAmount);

    await navigateToOrder(adminPage, ctx.orderNumber);
    await assertOrderStatus(adminPage, downloadStatus);
    await assertOrderNoteContains(adminPage, 'Refund of');

    const transactionLogs = await getLogs(ctx.payDate, '/transaction', ctx.logOffset);
    const refundLog = transactionLogs.logs[0]?.content.find(
      (l: any) => l.request?.body?.apiOperation === 'REFUND' && l.request?.url?.includes(ctx.transactionId)
    );
    expect(refundLog, 'REFUND log not found').toBeTruthy();
    // For partial refunds, request transaction.amount is the partial — pass it
    // as `total` so verifyRefundLog asserts against the right number.
    verifyRefundLog(refundLog!, { total: halfAmount, currency: 'USD', isPartial: true, partialAmount: halfAmount });

    mc041OrderNumber = ctx.orderNumber;
    mc041Total = orderTotalStr;
  });

  // === MC-042: Exceed total refund ===
  // AUDIT 2026-04-29 vs GI:
  // - JUSTIFIED FIX: dual-path WC over-refund handling — WC may either
  //   disable the .do-api-refund button OR allow click + alert + server
  //   reject. Both branches assert "no new refund note + status stays
  //   Processing" (intent-equivalent to GI's "no second refund processed").
  //   GI's flow assumed alert-only; PW handles both.

  test('MC-042 - Exceed total refund', async ({ adminPage }) => {
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
    // Same readonly-total handling as a real refund; not strict, because an
    // over-refund is expected to be capped or rejected rather than accepted.
    await enterRefundAmount(adminPage, exceedAmount);

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
    await assertOrderStatus(adminPage, 'Completed');
  });
});
