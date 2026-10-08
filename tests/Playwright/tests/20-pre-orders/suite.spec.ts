import { test, expect } from '../../fixtures/test';
import { switchCheckoutMode, configureGateway, getLogEntryCount, getLogs, getOrder, updateOrderMeta } from '../../helpers/wc-api';
import { addToCartAndCheckout } from '../../helpers/cart';
import { fillBilling, selectPaymentMethod } from '../../helpers/checkout';
import {
  checkoutHostedSession,
  assertOrderComplete,
  type CheckoutContext,
} from '../../helpers/flows';
import {
  assertCaptureLogTrail,
  assertAgreementLog,
  assertMerchantInitiatedPaymentLog,
  assertCaptureFormVisible,
  assertOrderStatus,
  assertOrderNoteContains,
  assertPaymentMethodMeta,
} from '../../helpers/assertions';
import { navigateToOrder } from '../../helpers/admin-orders';
import { selectGatewayOnAddPaymentMethod } from '../../helpers/my-account';
import { fillHostedSessionCC } from '../../helpers/hosted-session';
import { waitForUnblock } from '../../helpers/block-ui';
import {
  assertPreOrderProduct,
  releasePreOrder,
  cancelPreOrder,
  assertPreOrderStatus,
  assertPreOrderEmails,
} from '../../helpers/pre-orders';
import config from '../../plugin-config';
import { cards } from '../../fixtures/cards';
import { billing, uniqueEmail } from '../../fixtures/billing';

/**
 * Covers includes/GatewayAddons/PreOrders.php.
 *
 * The two charge modes are different flows, not variants. Charged-upfront takes
 * no addon branch at all (`maybe_add_pre_order_payment_data` returns early once
 * `order_requires_payment_tokenization` is false), so it is an ordinary capture
 * checkout.
 *
 * Charged-upon-release is a stored-credential flow. The checkout is a VERIFY
 * that stores the card and opens an UNSCHEDULED agreement, whatever the
 * transaction mode, and takes nothing. The release is a merchant-initiated PAY
 * under that agreement, on its own gateway order. It used to AUTHORIZE at
 * checkout and CAPTURE at release, which fails once the authorization expires
 * — releases are routinely months away.
 */

/** The gateway config the checkout cases share. */
const BASE_SETTINGS = {
  _3d_secure: 'no',
  saved_cards: 'yes',
  transaction_mode: 'PURCHASE',
  checkout_mode: 'hosted_session',
  // Pinned off: site-global, and the DCC suites can leave it on.
  currency_conversion: 'no',
} as const;

test.describe.serial('Pre-orders', () => {
  const preOrderEmail = uniqueEmail();
  /** PO-002's order, released and asserted on by PO-003. */
  let releaseCtx: CheckoutContext | undefined;

  test.beforeAll(async () => {
    await assertPreOrderProduct(config.products.preOrderUpfront, 'upfront');
    await assertPreOrderProduct(config.products.preOrderRelease, 'upon_release');
  });

  // === PO-001: Charged upfront ===

  test('PO-001 - Pre-order charged upfront', async ({ page, adminPage, emailPage }) => {
    await switchCheckoutMode('classic');
    await configureGateway(config, { ...BASE_SETTINGS });

    const ctx = await checkoutHostedSession(page, config, {
      productId: config.products.preOrderUpfront,
      card: cards.mastercard,
    });

    // Ordinary PURCHASE: the addon does not touch this path.
    await assertCaptureLogTrail({
      ...ctx, expectSessionPost: true, expectToken: false, expectCardDetailsFetch: true,
      expect3DS: false,
    });
    // WooCommerce Pre-Orders replaces both order emails with its own, so the
    // generic pair verifyOrderEmails looks for is never sent.
    await assertPreOrderEmails(ctx.orderNumber, config, emailPage);
    await assertOrderComplete(ctx, config, { page, adminPage, emailPage }, {
      // NOT 'Processing', which the plan assumed. WooCommerce Pre-Orders holds
      // every pre-order at its own status until release — the charge mode only
      // decides whether the money moved, not the status. Verified live on order
      // 6277, 2026-08-19.
      status: 'Pre-ordered',
      note: 'captured',
      emails: 'none',
    });

    // maybe_hide_capture_meta_box_pre_order hides the gateway capture box for
    // every pre-order, upfront included — the one addon behaviour this path has.
    await assertCaptureFormVisible(adminPage, config, false);
  });

  // === PO-002: Charged upon release — the checkout half ===

  test('PO-002 - Pre-order charged upon release verifies and tokenizes', async ({ page, adminPage, emailPage }) => {
    // Deliberately PURCHASE: maybe_add_pre_order_payment_data must override it
    // with VERIFY. Asserting a VERIFY trail against a PURCHASE setting is the
    // assertion that catches the addon regressing.
    await configureGateway(config, { ...BASE_SETTINGS });

    const ctx = await checkoutHostedSession(page, config, {
      productId: config.products.preOrderRelease,
      card: cards.mastercard,
      billing: { ...billing, email: preOrderEmail },
      createAccount: billing.password,
      // No saveCard: maybe_force_save_method_pre_order forces tokenization and
      // maybe_display_save_checkbox_pre_orders hides the checkbox (see PO-004).
    });
    releaseCtx = ctx;

    await assertCaptureLogTrail({
      ...ctx, apiOperation: 'VERIFY',
      expectSessionPost: true, expectToken: true, expectCardDetailsFetch: true,
      expect3DS: false,
    });
    await assertAgreementLog({
      payDate: ctx.payDate,
      logOffset: ctx.logOffset,
      transactionId: ctx.transactionId,
      apiOperation: 'VERIFY',
      agreementId: `${config.paymentMethodSlug}_pre-order-${ctx.orderNumber}`,
      agreementType: 'UNSCHEDULED',
    });

    // Verified, not paid: maybe_defer_pre_order_payment keeps process_wc_order
    // from calling payment_complete(), which would record a payment nobody made.
    expect(ctx.order.date_paid, 'a verified pre-order must not be marked paid').toBeFalsy();

    await assertPreOrderEmails(ctx.orderNumber, config, emailPage);
    // Not assertOrderComplete: that asserts "Payment via <gateway> (<id>)", and
    // with no payment_complete() the order carries no transaction id yet.
    await navigateToOrder(adminPage, ctx.orderNumber);
    // mark_order_as_pre_ordered sets the Pre-Orders plugin's own status and
    // maybe_bypass_change_status stops the gateway moving it.
    await assertOrderStatus(adminPage, 'Pre-ordered');
    await assertPaymentMethodMeta(adminPage, config);
    await assertOrderNoteContains(adminPage, `${config.displayName} payment was Verified`);
  });

  // === PO-003: Releasing charges the stored card ===

  test('PO-003 - Releasing the pre-order charges the stored card', async ({ adminPage }) => {
    expect(releaseCtx, 'PO-002 must have run first').toBeTruthy();
    const ctx = releaseCtx!;

    // A fresh window: the charge happens now, not during PO-002's checkout.
    const payDate = new Date().toISOString().slice(0, 19);
    const logOffset = await getLogEntryCount(payDate);

    await releasePreOrder(adminPage, ctx.orderNumber);
    await assertPreOrderStatus(adminPage, ctx.orderNumber, 'Completed');

    // ctx.transactionId is the checkout's gateway order. The release charges a
    // new one of its own and must point back to this.
    await assertMerchantInitiatedPaymentLog({
      payDate,
      logOffset,
      orderNumber: ctx.orderNumber,
      amount: ctx.total,
      agreementId: `${config.paymentMethodSlug}_pre-order-${ctx.orderNumber}`,
      agreementType: 'UNSCHEDULED',
      referenceOrderId: ctx.transactionId,
    });

    const order = await getOrder(ctx.orderNumber);
    expect(order.date_paid, 'the release must mark the pre-order paid').toBeTruthy();

    await navigateToOrder(adminPage, ctx.orderNumber);
    await assertOrderStatus(adminPage, 'Processing');
    await assertOrderNoteContains(adminPage, `${config.displayName} payment was Captured`);
  });

  // === PO-006: The release charge fails ===

  test('PO-006 - A release the gateway declines fails the order', async ({ page, adminPage }) => {
    /**
     * Proves the release failure path: the order goes to Failed with a note,
     * rather than staying Pre-ordered as if nothing happened.
     *
     * The test gateway decides outcomes by card and expiry, so no card verifies
     * at checkout and then declines later (the "declined" card fails the VERIFY
     * too). The stored card is instead swapped for a token the gateway refuses,
     * which takes the same path as a card cancelled before release.
     */
    await switchCheckoutMode('classic');
    await configureGateway(config, { ...BASE_SETTINGS });

    const ctx = await checkoutHostedSession(page, config, {
      productId: config.products.preOrderRelease,
      card: cards.mastercard,
      billing: { ...billing, email: uniqueEmail() },
      createAccount: billing.password,
    });
    await updateOrderMeta(ctx.orderNumber, config.paymentTokenMetaKey, '9999999999999999');

    await releasePreOrder(adminPage, ctx.orderNumber);

    await navigateToOrder(adminPage, ctx.orderNumber);
    await assertOrderStatus(adminPage, 'Failed');
    await assertOrderNoteContains(adminPage, 'Pre-order release payment failed');

    const order = await getOrder(ctx.orderNumber);
    expect(order.date_paid, 'a failed release must not mark the pre-order paid').toBeFalsy();
  });

  // === PO-007: Cancelling before release charges nothing ===

  test('PO-007 - Cancelling a pre-order charges nothing', async ({ page, adminPage }) => {
    // With VERIFY at checkout there is no held authorization to release, so
    // cancelling must not touch the gateway at all.
    await switchCheckoutMode('classic');
    await configureGateway(config, { ...BASE_SETTINGS });

    const ctx = await checkoutHostedSession(page, config, {
      productId: config.products.preOrderRelease,
      card: cards.mastercard,
      billing: { ...billing, email: uniqueEmail() },
      createAccount: billing.password,
    });

    const payDate = new Date().toISOString().slice(0, 19);
    const logOffset = await getLogEntryCount(payDate);

    await cancelPreOrder(adminPage, ctx.orderNumber);
    await assertPreOrderStatus(adminPage, ctx.orderNumber, 'Cancelled');

    await navigateToOrder(adminPage, ctx.orderNumber);
    await assertOrderStatus(adminPage, 'Cancelled');

    const entries = (await getLogs(payDate, '', logOffset)).logs[0]?.content ?? [];
    expect(
      entries.filter((l) => ['PAY', 'AUTHORIZE', 'CAPTURE', 'VOID'].includes(l.request?.body?.apiOperation)),
      'cancelling a pre-order must not call the gateway',
    ).toHaveLength(0);
  });

  // === PO-010: A guest's pre-order is charged on release ===

  test('PO-010 - A guest pre-order is charged on release', async ({ page, adminPage }) => {
    /**
     * WooCommerce Pre-Orders lets guests pre-order, so the gateway has to be
     * able to charge a guest at release. A WooCommerce saved card needs a user,
     * so a guest's card was never stored and the release could only fail. The
     * gateway token is kept on the order instead.
     */
    await switchCheckoutMode('classic');
    await configureGateway(config, { ...BASE_SETTINGS });

    const ctx = await checkoutHostedSession(page, config, {
      productId: config.products.preOrderRelease,
      card: cards.mastercard,
      // No createAccount: a guest.
      billing: { ...billing, email: uniqueEmail() },
    });
    expect(ctx.order.customer_id, 'this must be a guest order').toBe(0);

    const payDate = new Date().toISOString().slice(0, 19);
    const logOffset = await getLogEntryCount(payDate);

    await releasePreOrder(adminPage, ctx.orderNumber);

    await assertMerchantInitiatedPaymentLog({
      payDate,
      logOffset,
      orderNumber: ctx.orderNumber,
      amount: ctx.total,
      agreementId: `${config.paymentMethodSlug}_pre-order-${ctx.orderNumber}`,
      agreementType: 'UNSCHEDULED',
      referenceOrderId: ctx.transactionId,
    });
    const order = await getOrder(ctx.orderNumber);
    expect(order.date_paid, 'the release must mark the guest pre-order paid').toBeTruthy();

    await navigateToOrder(adminPage, ctx.orderNumber);
    await assertOrderStatus(adminPage, 'Processing');
  });

  // === PO-011: Currency conversion on, pre-order charged on release ===

  test('PO-011 - A pre-order charged on release checks out with currency conversion on', async ({ page }) => {
    /**
     * Nothing is charged at checkout (a VERIFY), so there is nothing to convert,
     * and the gateway rejects currencyConversion on a VERIFY ("Unexpected
     * parameter 'currencyConversion.uptake'"). With currency conversion on, every
     * such pre-order used to fail at checkout. The card is one that does draw
     * an offer on an ordinary cart.
     */
    await switchCheckoutMode('classic');
    await configureGateway(config, { ...BASE_SETTINGS, currency_conversion: 'yes' });
    try {
      const ctx = await checkoutHostedSession(page, config, {
        productId: config.products.preOrderRelease,
        card: cards.mastercardEurFrictionless,
        billing: { ...billing, email: uniqueEmail() },
        createAccount: billing.password,
      });
      await expect(
        page.locator('input[name="dccOfferState"][type="radio"]'),
        'no conversion offer for a payment made at release',
      ).toHaveCount(0);
      await assertAgreementLog({
        payDate: ctx.payDate,
        logOffset: ctx.logOffset,
        transactionId: ctx.transactionId,
        apiOperation: 'VERIFY',
        agreementId: `${config.paymentMethodSlug}_pre-order-${ctx.orderNumber}`,
        agreementType: 'UNSCHEDULED',
      });
    } finally {
      await configureGateway(config, { ...BASE_SETTINGS });
    }
  });

  // === PO-012: The only card a pre-order needs cannot be removed ===

  test('PO-012 - The card a pending pre-order needs cannot be removed', async ({ page }) => {
    // Like WooCommerce Subscriptions does for subscriptions: with no other card
    // to move the pre-order to, the card has no Delete action, and a notice
    // says why.
    await switchCheckoutMode('classic');
    await configureGateway(config, { ...BASE_SETTINGS });

    const ctx = await checkoutHostedSession(page, config, {
      productId: config.products.preOrderRelease,
      card: cards.mastercard,
      billing: { ...billing, email: uniqueEmail() },
      createAccount: billing.password,
    });

    // The account created at checkout is logged in on `page`.
    await page.goto('/my-account/payment-methods/');
    const row = page.locator('tr.payment-method').filter({ hasText: cards.mastercard.number.slice(-4) });
    await expect(row, 'the card saved for the pre-order').toHaveCount(1);
    await expect(row.locator('a.delete'), 'no Delete action while a pre-order depends on it').toHaveCount(0);
    await expect(page.locator('.woocommerce-info, .woocommerce-notice, .wc-block-components-notice-banner'))
      .toContainText(`#${ctx.orderNumber}`);
  });

  // === PO-013: Another saved card does not unlock it ===

  test('PO-013 - The pre-order card stays locked with another card saved', async ({ page }) => {
    /**
     * The pre-order cannot move to another card: the gateway refuses a
     * merchant-initiated charge on any card but the one of the agreement's last
     * cardholder-initiated payment ("The card number provided for this
     * merchant-initiated transaction does not match ..."). So a second card does
     * not make the first removable, while the second card itself is.
     */
    await switchCheckoutMode('classic');
    await configureGateway(config, { ...BASE_SETTINGS });

    await checkoutHostedSession(page, config, {
      productId: config.products.preOrderRelease,
      card: cards.mastercard,
      billing: { ...billing, email: uniqueEmail() },
      createAccount: billing.password,
    });

    // Add a second card from My Account (3DS is off in BASE_SETTINGS).
    await selectGatewayOnAddPaymentMethod(page, config);
    await fillHostedSessionCC(page, cards.visaFrictionless, config);
    await page.locator('#place_order').first().click();
    await page.waitForURL(/payment-methods/, { timeout: 30000 });
    await waitForUnblock(page);

    const preOrderCard = page.locator('tr.payment-method').filter({ hasText: cards.mastercard.number.slice(-4) });
    const otherCard = page.locator('tr.payment-method').filter({ hasText: cards.visaFrictionless.number.slice(-4) });
    await expect(preOrderCard.locator('a.delete'), 'the pre-order card stays locked').toHaveCount(0);
    await expect(otherCard.locator('a.delete'), 'a card no pre-order needs can be removed').toHaveCount(1);
  });

  // === PO-014: The customer recovers a failed release ===

  test('PO-014 - The customer pays a pre-order whose release failed', async ({ page, adminPage, emailPage }) => {
    /**
     * When the release charge fails the order is Failed, and the customer can
     * pay it from My Account. That is the way out when the stored card stops
     * working: a cardholder-initiated payment of the full amount, after which
     * the order is paid like any other.
     */
    await switchCheckoutMode('classic');
    await configureGateway(config, { ...BASE_SETTINGS });

    const email = uniqueEmail();
    const ctx = await checkoutHostedSession(page, config, {
      productId: config.products.preOrderRelease,
      card: cards.mastercard,
      billing: { ...billing, email },
      createAccount: billing.password,
    });
    // Make the release fail at the gateway, as in PO-006.
    await updateOrderMeta(ctx.orderNumber, config.paymentTokenMetaKey, '9999999999999999');
    await releasePreOrder(adminPage, ctx.orderNumber);
    await navigateToOrder(adminPage, ctx.orderNumber);
    await assertOrderStatus(adminPage, 'Failed');

    // The customer pays it from the order's pay link, with their saved card.
    const failed = await getOrder(ctx.orderNumber);
    expect(failed.payment_url, 'a failed order can be paid by the customer').toBeTruthy();
    const paid = await checkoutHostedSession(page, config, {
      payForOrder: { url: failed.payment_url },
      card: cards.mastercard,
      loginAs: { email, password: billing.password },
      savedTokenIndex: 1,
    });

    const order = await getOrder(paid.orderNumber);
    expect(paid.orderNumber).toBe(ctx.orderNumber);
    expect(order.date_paid, 'the recovered pre-order is paid').toBeTruthy();
    expect(Number(order.total), 'for the full amount').toBeGreaterThan(0);
    const logs = (await getLogs(paid.payDate, '', paid.logOffset)).logs[0]?.content ?? [];
    const pay = logs.find((l) => ['PAY', 'AUTHORIZE'].includes(l.request?.body?.apiOperation)
      && l.response?.body?.result === 'SUCCESS');
    expect(pay, 'charged now, not verified for later').toBeTruthy();
    expect(pay!.request.body.transaction?.source, 'paid by the customer').toBe('INTERNET');

    await navigateToOrder(adminPage, ctx.orderNumber);
    await assertOrderStatus(adminPage, 'Processing');
  });

  // === PO-004: The forced-save UI ===

  test('PO-004 - Save-card checkbox hidden and notice reworded', async ({ page }) => {
    await addToCartAndCheckout(page, config.products.preOrderRelease);
    await fillBilling(page, billing);
    await selectPaymentMethod(page, config);

    // maybe_display_save_checkbox_pre_orders returns false for these carts.
    await expect(
      page.locator(`label[for="wc-${config.paymentMethodSlug}-new-payment-method"]`),
      'save-card checkbox must be hidden when tokenization is forced',
    ).toHaveCount(0);

    // change_save_card_notice_pre_order swaps the notice text.
    await expect(
      page.locator(`li.payment_method_${config.paymentMethodSlug} .payment_box`),
    ).toContainText('allowing to charge your card for future payments');
  });

  // === PO-005: Hosted checkout declines the tokenization path ===

  test('PO-005 - Hosted checkout does not support tokenized pre-orders', async ({ page }) => {
    /**
     * Hosted checkout cannot store the card a release charge needs, so the
     * gateway must not be offered for a pre-order charged on release — but must
     * still be offered for one charged upfront, which is an ordinary payment.
     *
     * This was an expected failure: init_addon_pre_orders checked the cart from
     * build(), before WooCommerce loads it, so 'pre-orders' was always claimed.
     */
    await configureGateway(config, {
      ...BASE_SETTINGS, checkout_mode: 'hosted_checkout', hosted_checkout_mode: 'embedded',
    });

    try {
      await addToCartAndCheckout(page, config.products.preOrderRelease);
      await fillBilling(page, billing);
      await expect(
        page.locator(`li.payment_method_${config.paymentMethodSlug}`),
        'gateway must not be offered for a tokenizing pre-order in hosted-checkout mode',
      ).toHaveCount(0);

      // Pre-Orders empties the cart when a pre-order is added, so this replaces
      // the release product rather than joining it.
      await addToCartAndCheckout(page, config.products.preOrderUpfront);
      await fillBilling(page, billing);
      await expect(
        page.locator(`li.payment_method_${config.paymentMethodSlug}`),
        'an upfront pre-order is an ordinary payment and must keep the gateway',
      ).toHaveCount(1);
    } finally {
      // checkout_mode is site-global; leaving hosted checkout on breaks every
      // later suite.
      await configureGateway(config, { ...BASE_SETTINGS });
    }
  });
});
