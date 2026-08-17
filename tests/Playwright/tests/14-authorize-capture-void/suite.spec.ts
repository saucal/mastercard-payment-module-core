import { test, expect } from '../../fixtures/test';
import { switchCheckoutMode, configureGateway, getLogs } from '../../helpers/wc-api';
import { checkoutHostedSession, assertOrderComplete } from '../../helpers/flows';
import { navigateToOrder, capturePayment, voidPayment } from '../../helpers/admin-orders';
import {
  assertOrderStatus,
  assertCaptureFormVisible,
  assertVoidFormVisible,
  assertOrderNoteContains,
  assertAuthorizeLogTrail,
  assertCaptureOperationLog,
  verifyVoidLog,
} from '../../helpers/assertions';
import config from '../../plugin-config';
import { cards } from '../../fixtures/cards';

test.describe.serial('Authorize / Capture / Void', () => {
  // GI source: all four MCs use 5123456789012346 = cards.mastercard (frictionless).
  const card = cards.mastercard;

  // Every case here authorizes at checkout and then acts from the admin order
  // screen. The checkout half is an ordinary hosted-session purchase in AUTHORIZE
  // mode — assertAuthorizeLogTrail covers it — and only the admin half differs.

  // === MC-020: Partial capture ===
  // AUDIT 2026-04-29 vs GI:
  // - JUSTIFIED FIX (cross-cutting in this suite): log-based CAPTURE
  //   assertion via the shared transaction-log helper replaces GI's brittle
  //   positional `nth-of-type` log indexes — parser-stability requirement of
  //   the white-label migration.
  // - MISSING: GI also asserts the post-partial-capture rest-amount label
  //   (`${{restTotal}}` shown in the capture form). PW only checks the
  //   "Partially Captured" note + log amount; consider re-adding the form
  //   label assert for UI-coverage parity.

  test('MC-020 - Partial capture', async ({ page, adminPage, emailPage }) => {
    await switchCheckoutMode('classic');
    await configureGateway(config, {
      _3d_secure: 'yes',
      transaction_mode: 'AUTHORIZE',
      checkout_mode: 'hosted_session',
      // Pinned off: site-global, and an unanswered DCC offer blocks place-order
      // (see suite 01 for the full explanation). DCC's own coverage is suite 19.
      currency_conversion: 'no',
    });

    const ctx = await checkoutHostedSession(page, config, {
      productId: config.products.physical,
      card,
    });

    await assertAuthorizeLogTrail({
      ...ctx,
      expectSessionPost: true, expectToken: false, expectCardDetailsFetch: true,
    });

    await assertOrderComplete(ctx, config, { page, adminPage, emailPage }, {
      status: 'On hold',
      note: 'authorized',
      // AUTHORIZE mode gates the customer mail on capture.
      emails: 'admin',
    });

    // Both forms are still on offer while the authorization is untouched.
    await assertCaptureFormVisible(adminPage, config, true);
    await assertVoidFormVisible(adminPage, config, true);

    const partialAmount = (parseFloat(String(ctx.order.total)) / 4).toFixed(2);
    await capturePayment(adminPage, config, partialAmount);
    await assertOrderStatus(adminPage, 'On hold');
    // Partial capture emits a "Partially Captured. Captured Amount: ..." note
    // (locale-formatted amount, not the structured "Captured (Order ID: ...)"
    // note that full capture uses).
    await assertOrderNoteContains(
      adminPage,
      `${config.displayName} payment was Partially Captured`,
    );

    await assertCaptureOperationLog({
      payDate: ctx.payDate,
      logOffset: ctx.logOffset,
      amount: partialAmount,
      transactionId: ctx.transactionId,
      orderNumber: ctx.orderNumber,
      card,
    });
  });

  // === MC-021: Full capture ===
  // AUDIT 2026-04-29 vs GI:
  // - JUSTIFIED FIX: page reload before status assertion — select2 status
  //   widget rebinds on load, not via WC's AJAX update notice.
  // - MISSING: GI asserts `assertElementNotPresent .acme-capture-form` /
  //   `.acme-void-form` after full capture. PW relies on the captured-note
  //   substring + Processing/Completed status; consider adding form-removal
  //   assertions for parity.

  test('MC-021 - Full capture', async ({ page, adminPage, emailPage }) => {
    const ctx = await checkoutHostedSession(page, config, {
      productId: config.products.digital,
      card,
    });

    await assertAuthorizeLogTrail({
      ...ctx,
      expectSessionPost: true, expectToken: false, expectCardDetailsFetch: true,
    });

    await assertOrderComplete(ctx, config, { page, adminPage, emailPage }, {
      status: 'On hold',
      note: 'authorized',
      emails: 'admin',
    });

    const orderTotalStr = String(ctx.order.total);
    // GI step 314 always fills the capture amount field; without it the
    // gateway's CAPTURE button submits 0 and the order stays On hold.
    await capturePayment(adminPage, config, orderTotalStr);

    // Reload to refresh select2 status widget — capturePayment posts via WP
    // admin "Order updated" notice but the status dropdown only re-renders
    // on the next page load.
    await navigateToOrder(adminPage, ctx.orderNumber);
    const status = await adminPage.locator('#select2-order_status-container').textContent() || '';
    expect(
      ['Processing', 'Completed'].some(s => status.includes(s)),
      `expected Processing or Completed after full capture, got "${status}"`,
    ).toBeTruthy();
    await assertOrderNoteContains(
      adminPage,
      `${config.displayName} payment was Captured (Order ID: ${ctx.transactionId})`,
    );

    await assertCaptureOperationLog({
      payDate: ctx.payDate,
      logOffset: ctx.logOffset,
      amount: orderTotalStr,
      transactionId: ctx.transactionId,
      orderNumber: ctx.orderNumber,
      card,
    });
  });

  // === MC-022: Void payment ===

  test('MC-022 - Void payment', async ({ page, adminPage, emailPage }) => {
    const ctx = await checkoutHostedSession(page, config, {
      productId: config.products.physical,
      card,
    });

    await assertAuthorizeLogTrail({
      ...ctx,
      expectSessionPost: true, expectToken: false, expectCardDetailsFetch: true,
    });

    await assertOrderComplete(ctx, config, { page, adminPage, emailPage }, {
      status: 'On hold',
      note: 'authorized',
      // This case asserted no mail at all.
      emails: 'none',
    });

    await voidPayment(adminPage, config);

    // Status select is bound at page load; reload to see the new value.
    await navigateToOrder(adminPage, ctx.orderNumber);
    await assertOrderStatus(adminPage, 'Cancelled');
    await assertCaptureFormVisible(adminPage, config, false);
    await assertVoidFormVisible(adminPage, config, false);
    await assertOrderNoteContains(adminPage, 'Authorization was cancelled');

    // VOID has no composite on purpose: it is one case in one suite and needs
    // verifyVoidLog, a different assertion with a different shape.
    const transactionLogs = await getLogs(ctx.payDate, '/transaction', ctx.logOffset);
    const voidLog = transactionLogs.logs[0]?.content.find(
      (l: any) => l.request?.body?.apiOperation === 'VOID' && l.request?.url?.includes(ctx.transactionId)
    );
    expect(voidLog, 'VOID log not found').toBeTruthy();
    verifyVoidLog(voidLog!, {
      transactionId: ctx.transactionId, orderNumber: ctx.orderNumber, currency: 'USD', card,
    });
  });

  // MC-061 (subscription order with authorize mode + renewal) was here.
  // Moved to suite 16 (subscription suite) — subscription products need
  // their own bundle, and registerUser-from-checkout into a hosted-session
  // iframe didn't reliably mount the iframe under suite 14's serial flow.
});
