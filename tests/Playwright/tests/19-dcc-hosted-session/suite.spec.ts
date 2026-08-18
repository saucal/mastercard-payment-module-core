import { test, expect } from '../../fixtures/test';
import { switchCheckoutMode, configureGateway } from '../../helpers/wc-api';
import { addToCartAndCheckout } from '../../helpers/cart';
import {
  fillBilling,
  selectPaymentMethod,
  clickPlaceOrder,
  getCheckoutError,
  extractOrderTotal,
} from '../../helpers/checkout';
import { fillHostedSessionCC } from '../../helpers/hosted-session';
import { requireDccOffer, assertNoDccQuote } from '../../helpers/dcc';
import { waitForUnblock } from '../../helpers/block-ui';
import {
  checkoutHostedSession,
  assertOrderComplete,
  collectOrderReceivedData,
} from '../../helpers/flows';
import {
  assertOrderReceived,
  assertDccOrderMeta,
  assertDccReceiptRow,
  assertDccAdminPanel,
  assertDccUptakeLog,
  assertDccQuoteInquiryLog,
} from '../../helpers/assertions';
import { navigateToOrder } from '../../helpers/admin-orders';
import config from '../../plugin-config';
import { cards } from '../../fixtures/cards';
import { billing, uniqueEmail } from '../../fixtures/billing';

/**
 * The card that draws a real conversion offer, and the currency MPGS quotes it
 * in. Both from docs/superpowers/notes/2026-08-13-dcc-preorder-discovery.md,
 * which probed all six fixture PANs: four return Accept/Reject radios and two
 * return the hidden `Unavailable` shape.
 *
 * visaFrictionless specifically — it quotes AND skips the 3DS challenge, so a DCC
 * failure is never confused with an ACS one. Do NOT swap in `mastercard`: it
 * returns Unavailable, and requireDccOffer would fail with nothing wrong.
 */
const dccCard = cards.visaFrictionless;
const PAYER_CURRENCY = 'GBP';

/** The gateway config every case here shares, DCC on. */
const DCC_ON = {
  _3d_secure: 'no',
  saved_cards: 'yes',
  transaction_mode: 'PURCHASE',
  checkout_mode: 'hosted_session',
  currency_conversion: 'yes',
} as const;

test.describe.serial('DCC - Hosted Session', () => {
  const dccEmail = uniqueEmail();
  /** The account DCC-001 creates, whose saved card DCC-004 quotes against. */
  const returning = { email: dccEmail, password: billing.password };

  test.beforeAll(() => {
    expect(config.products.physical, 'PRODUCT_PHYSICAL must be set').toBeGreaterThan(0);
  });

  // === DCC-001: Accept the conversion offer ===

  test('DCC-001 - Accept the conversion offer', async ({ page, adminPage, emailPage }) => {
    await switchCheckoutMode('classic');
    await configureGateway(config, { ...DCC_ON });

    // requireDccOffer makes the offer mandatory rather than incidental: the flow
    // fails if no radios arrive, instead of quietly checking out without a
    // conversion and leaving every assertion below to pass vacuously.
    // Saves the card too, so DCC-004 has a token to quote against.
    const ctx = await checkoutHostedSession(page, config, {
      productId: config.products.physical,
      card: dccCard,
      billing: { ...billing, email: dccEmail },
      createAccount: billing.password,
      saveCard: true,
      requireDccOffer: true,
      dccChoice: 'accept',
    });

    await assertDccUptakeLog({ ...ctx, uptake: 'ACCEPTED' });
    await assertDccOrderMeta(ctx.orderNumber, config, { payerCurrency: PAYER_CURRENCY });

    // Back to the receipt: the flow ends on the cart, having checked it is empty.
    await page.goto(ctx.orderReceivedUrl);
    await assertDccReceiptRow(page, { payerCurrency: PAYER_CURRENCY });

    await navigateToOrder(adminPage, ctx.orderNumber);
    await assertDccAdminPanel(adminPage, { payerCurrency: PAYER_CURRENCY });

    // An accepted conversion changes what the payer is charged, not the order:
    // WooCommerce still records the store-currency total and the ordinary
    // capture trail still applies.
    await assertOrderComplete(ctx, config, { page, adminPage, emailPage }, {
      status: 'Processing',
      note: 'captured',
    });
  });

  // === DCC-002: Decline the conversion offer ===

  test('DCC-002 - Decline the conversion offer', async ({ page, adminPage, emailPage }) => {
    const ctx = await checkoutHostedSession(page, config, {
      productId: config.products.physical,
      card: dccCard,
      requireDccOffer: true,
      dccChoice: 'reject',
    });

    await assertDccUptakeLog({ ...ctx, uptake: 'DECLINED' });

    // process_dcc_data returns early unless uptake is exactly ACCEPTED, so a
    // declined offer must leave no dcc_* meta at all.
    await assertDccOrderMeta(ctx.orderNumber, config, {
      payerCurrency: PAYER_CURRENCY,
      expectAbsent: true,
    });

    // No meta means get_dcc_data_from_order returns null, so neither the receipt
    // row nor the admin panel renders.
    await page.goto(ctx.orderReceivedUrl);
    await expect(
      page.locator('tr:has-text("Paid Amount"), li:has-text("Paid Amount")'),
      'a declined offer must not add the converted-amount row',
    ).toHaveCount(0);

    await navigateToOrder(adminPage, ctx.orderNumber);
    await expect(
      adminPage.locator('h4:has-text("Dynamic Currency Conversion")'),
      'a declined offer must not render the admin DCC panel',
    ).toHaveCount(0);

    // The payer declined, so the charge stays in the store currency.
    expect(ctx.order.currency, 'order currency should be unchanged').toBe('USD');

    await assertOrderComplete(ctx, config, { page, adminPage, emailPage }, {
      status: 'Processing',
      note: 'captured',
    });
  });

  // === DCC-003: An unanswered offer is rejected at validation ===

  test('DCC-003 - Unanswered offer blocks the order', async ({ page }) => {
    await addToCartAndCheckout(page, config.products.physical);
    await fillBilling(page, billing);
    await selectPaymentMethod(page, config);
    await fillHostedSessionCC(page, dccCard, config);

    // Prove a real offer arrived before refusing to answer it — otherwise this
    // case passes for the wrong reason on a card that never quoted.
    await requireDccOffer(page, config);

    // Deliberately answer nothing. Unchecked radios submit no dccOfferState,
    // which is the condition validate_dcc_data guards
    // (DynamicCurrencyConversion.php:153-160).
    await clickPlaceOrder(page);
    await waitForUnblock(page);

    expect(await getCheckoutError(page)).toContain(
      'accept or reject the currency conversion offer',
    );
    // Validation ran server-side, so the buyer is still on checkout with no order.
    await expect(page).toHaveURL(/checkout/);
  });

  // === DCC-004: Saved-token quote ===

  test('DCC-004 - Quote against a saved token', async ({ page, adminPage, emailPage }) => {
    const ctx = await checkoutHostedSession(page, config, {
      productId: config.products.physical,
      // The card DCC-001 saved; the token stands in for it.
      card: dccCard,
      loginAs: returning,
      savedTokenIndex: 1,
      requireDccOffer: true,
      dccChoice: 'accept',
    });

    // The distinguishing assertion for this case. A saved token has no card
    // number in the DOM to quote from, so the browser cannot ask MPGS directly —
    // ajax_dcc_quote fetches the quote server-side through
    // api()->payment_options_inquiry(), which is the only way the inquiry reaches
    // our log at all. On the entered-card path (DCC-001/002) it never appears.
    await assertDccQuoteInquiryLog({ payDate: ctx.payDate, logOffset: ctx.logOffset });

    await assertDccUptakeLog({ ...ctx, uptake: 'ACCEPTED' });
    await assertDccOrderMeta(ctx.orderNumber, config, { payerCurrency: PAYER_CURRENCY });

    await page.goto(ctx.orderReceivedUrl);
    await assertDccReceiptRow(page, { payerCurrency: PAYER_CURRENCY });

    await navigateToOrder(adminPage, ctx.orderNumber);
    await assertDccAdminPanel(adminPage, { payerCurrency: PAYER_CURRENCY });

    await assertOrderComplete(ctx, config, { page, adminPage, emailPage }, {
      status: 'Processing',
      note: 'captured',
      // Still the one card DCC-001 saved — paying with a token does not add another.
      myAccount: { ...returning, expectedCards: 1 },
    });
  });

  // === DCC-005: Setting off ⇒ no quote at all ===

  test('DCC-005 - No quote when the setting is off', async ({ page, adminPage, emailPage }) => {
    await configureGateway(config, { ...DCC_ON, currency_conversion: 'no' });

    try {
      await addToCartAndCheckout(page, config.products.physical);
      await fillBilling(page, billing);
      await selectPaymentMethod(page, config);
      await fillHostedSessionCC(page, dccCard, config);

      // display_dcc_info_area / dcc_after_payment_method_fields only render when
      // the addon is enabled, so with the setting off the container is absent
      // entirely — not merely empty.
      await expect(
        page.locator(`#${config.paymentMethodSlug}_currency_conversion`),
        'DCC info area should not render when the setting is off',
      ).toHaveCount(0);
      await assertNoDccQuote(page, config);

      // And the checkout still completes — turning DCC off must not break paying.
      const total = await extractOrderTotal(page);
      await clickPlaceOrder(page);
      const received = await collectOrderReceivedData(page);
      await assertOrderReceived(
        page,
        { displayName: config.displayName, expectedTotal: total },
        received,
      );

      await assertDccOrderMeta(received.orderNumber, config, {
        payerCurrency: PAYER_CURRENCY,
        expectAbsent: true,
      });
    } finally {
      // currency_conversion is site-global. Leaking 'no' would silently gut every
      // DCC case above on the next run, and they would pass by asserting nothing.
      await configureGateway(config, { ...DCC_ON });
    }
  });

  // === DCC-006: Subscription cart ⇒ no quote ===

  test('DCC-006 - No quote for a subscription cart', async ({ page }) => {
    test.skip(!config.products.subscription, 'PRODUCT_SUBSCRIPTION not configured');

    await configureGateway(config, { ...DCC_ON, subscription: 'yes' });

    /**
     * Whether the DCC addon wired itself into this page.
     *
     * `dccEnabled` is added only by add_dcc_script_data, and that filter is
     * registered inside init_dcc_hooks — the method that returns early for a
     * subscription cart (DynamicCurrencyConversion.php:109). So its presence is
     * exactly "init_dcc_hooks ran", which is the thing this case is about.
     */
    const dccWired = () =>
      page.evaluate(() => (window as any).core_gateway_params?.dccEnabled);

    // Positive control first, on an ordinary cart. Without it, the assertion
    // below would also pass if the global were renamed, DCC were off site-wide,
    // or the script simply never loaded — i.e. it would prove nothing.
    await addToCartAndCheckout(page, config.products.physical);
    await fillBilling(page, billing);
    await selectPaymentMethod(page, config);
    // Truthy, not `=== true`: wp_localize_script serialises PHP booleans, so this
    // arrives as the string "1" (and would be "" if DCC were wired but disabled).
    expect(await dccWired(), 'DCC should be wired up on an ordinary cart').toBeTruthy();

    // Now the subscription. Deliberately no card entry: a subscription cart does
    // not reliably mount the MPGS iframes (the same problem suite 14 documents
    // for MC-061), and entering a card is not needed to prove the addon never
    // engaged. The setting is still ON here, unlike DCC-005 — same silence, a
    // different reason for it.
    await addToCartAndCheckout(page, config.products.subscription);
    await selectPaymentMethod(page, config);
    // Undefined, i.e. the key is absent entirely, which means the filter was never
    // registered. A merely *disabled* addon would still add the key with an empty
    // value, so this distinguishes "init_dcc_hooks bailed" from "DCC is off".
    expect(
      await dccWired(),
      'a subscription cart must not wire up DCC — init_dcc_hooks bails on it',
    ).toBeUndefined();

    await assertNoDccQuote(page, config);
  });
});
