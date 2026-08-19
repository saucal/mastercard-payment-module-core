import { test, expect } from '../../fixtures/test';
import { switchCheckoutMode, configureGateway } from '../../helpers/wc-api';
import { addToCartAndCheckout } from '../../helpers/cart';
import { fillBilling, selectPaymentMethod } from '../../helpers/checkout';
import {
  checkoutHostedSession,
  assertOrderComplete,
  type CheckoutContext,
} from '../../helpers/flows';
import {
  assertCaptureLogTrail,
  assertAuthorizeLogTrail,
  assertCaptureOperationLog,
  assertCaptureFormVisible,
  assertOrderStatus,
  assertOrderNoteContains,
} from '../../helpers/assertions';
import { navigateToOrder } from '../../helpers/admin-orders';
import {
  assertPreOrderProduct,
  releasePreOrder,
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
 * checkout. Charged-upon-release forces AUTHORIZE and forces tokenization
 * regardless of the gateway settings, and the money moves later, when the
 * merchant releases the pre-order.
 */

/** The gateway config the checkout cases share. */
const BASE_SETTINGS = {
  _3d_secure: 'no',
  saved_cards: 'yes',
  transaction_mode: 'PURCHASE',
  checkout_mode: 'hosted_session',
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

  test('PO-002 - Pre-order charged upon release authorizes and tokenizes', async ({ page, adminPage, emailPage }) => {
    // Deliberately PURCHASE: maybe_add_pre_order_payment_data must override it
    // with AUTHORIZE. Asserting the authorize trail against a PURCHASE setting
    // is the assertion that catches the addon regressing.
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

    await assertAuthorizeLogTrail({
      ...ctx, expectSessionPost: true, expectToken: true, expectCardDetailsFetch: true,
      expect3DS: false,
    });

    await assertPreOrderEmails(ctx.orderNumber, config, emailPage);
    await assertOrderComplete(ctx, config, { page, adminPage, emailPage }, {
      // mark_order_as_pre_ordered sets the Pre-Orders plugin's own status and
      // maybe_bypass_change_status stops the gateway moving it to On hold.
      status: 'Pre-ordered',
      note: 'authorized',
      emails: 'none',
    });
  });

  // === PO-003: Releasing captures the authorization ===

  test('PO-003 - Releasing the pre-order captures the authorization', async ({ adminPage }) => {
    expect(releaseCtx, 'PO-002 must have run first').toBeTruthy();
    const ctx = releaseCtx!;

    await releasePreOrder(adminPage, ctx.orderNumber);
    await assertPreOrderStatus(adminPage, ctx.orderNumber, 'Completed');

    await navigateToOrder(adminPage, ctx.orderNumber);
    await assertOrderStatus(adminPage, 'Processing');
    // process_pre_order_release_payment adds its own note on top of the
    // gateway's capture note.
    await assertOrderNoteContains(adminPage, 'pre-order payment captured');

    // The capture fires inside PO-002's log window, so reusing payDate/logOffset
    // finds it. If this suite ever straddles midnight, getLogs would read the
    // next day's file — capture a fresh window right before releasePreOrder then.
    await assertCaptureOperationLog({
      payDate: ctx.payDate,
      logOffset: ctx.logOffset,
      amount: ctx.total,
      transactionId: ctx.transactionId,
      orderNumber: ctx.orderNumber,
      card: ctx.card,
    });
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
     * KNOWN GATEWAY BUG — asserted as an expected failure so this flips to red
     * the day it is fixed.
     *
     * `init_addon_pre_orders` runs from `build()`
     * (WC_Abstract_Payment_Gateway_CC.php:166), i.e. while WooCommerce is
     * constructing its gateways — before the cart is loaded from the session. So
     * `cart_contains_pre_order_tokenization()` sees no cart, returns false, the
     * hosted-checkout guard (PreOrders.php:42) never trips, and `'pre-orders'`
     * is added to `$supports` unconditionally.
     *
     * Observed 2026-08-19: with product 4789 in the cart and hosted checkout on,
     * WooCommerce offers exactly two gateways — `pre_orders_pay_later` and ours.
     * The pre-orders plugin IS filtering on `supports('pre-orders')`; ours
     * wrongly claims it.
     *
     * The addon's own DCC sibling shows the fix: `init_addon_dcc` defers its
     * cart-dependent half to `woocommerce_cart_loaded_from_session`
     * (DynamicCurrencyConversion.php:72).
     */
    test.fail();

    await configureGateway(config, {
      ...BASE_SETTINGS, checkout_mode: 'hosted_checkout', hosted_checkout_mode: 'embedded',
    });

    try {
      // init_addon_pre_orders returns before adding 'pre-orders' to $supports
      // (PreOrders.php:42), so WooCommerce filters the gateway out of the
      // available list for this cart.
      await addToCartAndCheckout(page, config.products.preOrderRelease);
      await fillBilling(page, billing);
      await expect(
        page.locator(`li.payment_method_${config.paymentMethodSlug}`),
        'gateway must not be offered for a tokenizing pre-order in hosted-checkout mode',
      ).toHaveCount(0);
    } finally {
      // checkout_mode is site-global; leaving hosted checkout on breaks every
      // later suite.
      await configureGateway(config, { ...BASE_SETTINGS });
    }
  });
});
