import { test, expect } from '../../fixtures/test';
import { switchCheckoutMode, configureGateway, getOrder, getOrderMeta } from '../../helpers/wc-api';
import { checkoutHostedCheckout, assertOrderComplete } from '../../helpers/flows';
import {
  assertHostedCheckoutLogTrail,
  assertDccAdminPanel,
  assertDccOrderMeta,
} from '../../helpers/assertions';
import { navigateToOrder } from '../../helpers/admin-orders';
import config from '../../plugin-config';
import { cards } from '../../fixtures/cards';

/**
 * DCC through MPGS hosted checkout — a different feature from suite 19's, despite
 * the name.
 *
 * init_addon_dcc returns at the is_hosted_checkout() guard
 * (DynamicCurrencyConversion.php:47) *after* registering process_dcc_data and
 * render_dcc_data but *before* everything else. So in this mode:
 *
 *   - the `currency_conversion` setting is inert — the offer comes from the MPGS
 *     merchant profile and renders on MPGS's own page. DCC-007 proves this by
 *     leaving the setting OFF and still getting an offer.
 *   - there is no quote call of ours, no offer validation, and no
 *     "Paid Amount:" receipt row — render_dcc_data_receipt is registered inside
 *     init_dcc_hooks, which this path never reaches.
 *   - the admin panel hook does survive the guard.
 *
 * Payer currency is MPGS's choice and differs from the hosted-session path — GBP
 * there, BRL observed here for the same card — so nothing pins it. See
 * docs/superpowers/notes/2026-08-13-dcc-preorder-discovery.md.
 */
const dccCard = cards.visaFrictionless;

test.describe.serial('DCC - Hosted Checkout', () => {
  // === DCC-007: MPGS offers a conversion even with our setting off ===

  test('DCC-007 - Accept the MPGS conversion offer', async ({ page, adminPage, emailPage }) => {
    await switchCheckoutMode('classic');
    await configureGateway(config, {
      _3d_secure: 'no',
      transaction_mode: 'PURCHASE',
      checkout_mode: 'hosted_checkout',
      hosted_checkout_mode: 'redirect',
      // Deliberately OFF. If an offer still arrives, the setting demonstrably does
      // not gate DCC in this mode — which is the whole point of this case.
      currency_conversion: 'no',
    });

    const ctx = await checkoutHostedCheckout(page, config, {
      hostedMode: 'redirect',
      productId: config.products.physical,
      card: dccCard,
      requireDccOffer: true,
      dccChoice: 'accept',
    });

    await assertHostedCheckoutLogTrail(ctx);

    // WooCommerce's own record stays in the store currency; a conversion changes
    // what the payer is charged, not what the shop booked.
    expect(ctx.order.currency, 'order currency should stay the store currency').toBe('USD');

    // No receipt row in this mode, however the offer was answered.
    await page.goto(ctx.orderReceivedUrl);
    await expect(
      page.locator('tr:has-text("Paid Amount"), li:has-text("Paid Amount")'),
      'hosted checkout never registers render_dcc_data_receipt, so no converted-amount row',
    ).toHaveCount(0);

    // The meta IS written on this path, which the source alone could not settle:
    // process_dcc_data is registered before the is_hosted_checkout() guard, but it
    // only writes when the response carries uptake ACCEPTED plus a complete quote.
    // A live run (order 6268) returned rate 0.609999, GBP, 35.11 against a USD
    // 57.56 order, so MPGS does return it on the post-payment retrieve.
    //
    // Currency deliberately unpinned — MPGS chooses it, and it has been seen to
    // differ from the hosted-session path for the same card.
    await assertDccOrderMeta(ctx.orderNumber, config, {});

    // The converted amount must actually follow from the rate. Catches a meta
    // mix-up (an amount written from the wrong field) that presence checks miss.
    const order = await getOrder(ctx.orderNumber);
    const rate = Number(getOrderMeta(order, config.dccMetaKeys.exchangeRate));
    const converted = Number(getOrderMeta(order, config.dccMetaKeys.amount));
    const expectedConverted = Number(order.total) * rate;
    expect(
      Math.abs(converted - expectedConverted) / expectedConverted,
      `converted ${converted} should be about ${order.total} x ${rate} = ${expectedConverted.toFixed(2)}`,
    ).toBeLessThan(0.01);

    // The admin panel hook is registered before the guard, so unlike the receipt
    // row it does render here.
    await navigateToOrder(adminPage, ctx.orderNumber);
    await assertDccAdminPanel(adminPage, {});

    await assertOrderComplete(ctx, config, { page, adminPage, emailPage }, {
      status: 'Processing',
      note: 'captured',
    });
  });

  // === DCC-008: Reject MPGS's offer and pay in the order currency ===

  test('DCC-008 - Reject the MPGS conversion offer', async ({ page, adminPage, emailPage }) => {
    const ctx = await checkoutHostedCheckout(page, config, {
      hostedMode: 'redirect',
      productId: config.products.physical,
      card: dccCard,
      requireDccOffer: true,
      dccChoice: 'reject',
    });

    await assertHostedCheckoutLogTrail(ctx);

    expect(ctx.order.currency, 'order currency should stay the store currency').toBe('USD');

    // Rejecting means uptake is not ACCEPTED, so process_dcc_data returns early
    // and writes nothing — same contract as suite 19's DCC-002, reached through a
    // different UI.
    await assertDccOrderMeta(ctx.orderNumber, config, { expectAbsent: true });

    await navigateToOrder(adminPage, ctx.orderNumber);
    await expect(
      adminPage.locator('h4:has-text("Dynamic Currency Conversion")'),
      'no meta means render_dcc_data prints nothing',
    ).toHaveCount(0);

    await assertOrderComplete(ctx, config, { page, adminPage, emailPage }, {
      status: 'Processing',
      note: 'captured',
    });
  });
});
