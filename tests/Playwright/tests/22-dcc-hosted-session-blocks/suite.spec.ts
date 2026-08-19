import { test, expect } from '../../fixtures/test';
import { switchCheckoutMode, configureGateway } from '../../helpers/wc-api';
import { addToCartAndCheckout } from '../../helpers/cart';
import {
  fillBilling,
  selectPaymentMethod,
  clickPlaceOrder,
  getCheckoutError,
} from '../../helpers/checkout';
import { fillHostedSessionCC } from '../../helpers/hosted-session';
import { requireDccOffer } from '../../helpers/dcc';
import { waitForUnblock } from '../../helpers/block-ui';
import { checkoutHostedSession, assertOrderComplete } from '../../helpers/flows';
import {
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
 * DCC through the block checkout — the same feature as suite 19, but almost none
 * of the same code runs.
 *
 * Classic renders the offer area from PHP: `display_dcc_info_area` on
 * `after_payment_fields_hosted_session`, plus `dcc_after_payment_method_fields`
 * inside templates/payment-fields-hosted-session.php. Neither fires here —
 * blocks renders a React tree instead, and the ids come from
 * `src/js/payment-methods/core-cc/_elements.js` (and `_saved-token-handler.js`
 * for the token path). They happen to match, which is why helpers/dcc.ts needs
 * no mode switch.
 *
 * The two ends of the flow genuinely differ, and are what this suite is for:
 *
 *   - **Validation.** Classic rejects an unanswered offer server-side in
 *     `validate_dcc_data`. Blocks never calls `validate_fields()` at all — the
 *     check is client-side, in `_hostedSessions.js#validateCurrencyConversionData`
 *     (:1525), surfaced through onCheckoutValidation.
 *   - **The posted field.** Blocks lowercases payment-method data, so the server
 *     reads `dccofferstate`, a separate branch in `maybe_add_dcc_payment_data`
 *     (DynamicCurrencyConversion.php:194-196). DCC-009 is the case that would
 *     catch that branch breaking.
 *
 * Everything after the POST — process_dcc_data, the meta, the receipt row, the
 * admin panel — is shared with suite 19 and asserted here only to prove the
 * blocks payload actually reached it.
 */

/** Quotes AND skips the 3DS challenge, so a DCC failure is never an ACS one. */
const dccCard = cards.visaFrictionless;
const PAYER_CURRENCY = 'GBP';

const DCC_ON = {
  _3d_secure: 'no',
  saved_cards: 'yes',
  transaction_mode: 'PURCHASE',
  checkout_mode: 'hosted_session',
  currency_conversion: 'yes',
} as const;

test.describe.serial('DCC - Hosted Session (blocks)', () => {
  const dccEmail = uniqueEmail();
  /** The account DCC-009 creates, whose saved card DCC-012 quotes against. */
  const returning = { email: dccEmail, password: billing.password };

  test.beforeAll(() => {
    expect(config.products.physical, 'PRODUCT_PHYSICAL must be set').toBeGreaterThan(0);
  });

  // === DCC-009: Accept, through the lowercased blocks field ===

  test('DCC-009 - Accept the conversion offer', async ({ page, adminPage, emailPage }) => {
    await switchCheckoutMode('blocks');
    await configureGateway(config, { ...DCC_ON });

    const ctx = await checkoutHostedSession(page, config, {
      productId: config.products.physical,
      card: dccCard,
      billing: { ...billing, email: dccEmail },
      createAccount: billing.password,
      saveCard: true,
      requireDccOffer: true,
      dccChoice: 'accept',
    });

    // The load-bearing assertion of this suite: uptake ACCEPTED can only be
    // logged if the server found the offer state, and in blocks that means it
    // read `dccofferstate` rather than `dccOfferState`.
    await assertDccUptakeLog({ ...ctx, uptake: 'ACCEPTED' });
    await assertDccOrderMeta(ctx.orderNumber, config, { payerCurrency: PAYER_CURRENCY });

    await page.goto(ctx.orderReceivedUrl);
    await assertDccReceiptRow(page, { payerCurrency: PAYER_CURRENCY });

    await navigateToOrder(adminPage, ctx.orderNumber);
    await assertDccAdminPanel(adminPage, { payerCurrency: PAYER_CURRENCY });

    await assertOrderComplete(ctx, config, { page, adminPage, emailPage }, {
      status: 'Processing',
      note: 'captured',
    });
  });

  // === DCC-010: Decline ===

  test('DCC-010 - Decline the conversion offer', async ({ page, adminPage, emailPage }) => {
    const ctx = await checkoutHostedSession(page, config, {
      productId: config.products.physical,
      card: dccCard,
      requireDccOffer: true,
      dccChoice: 'reject',
    });

    await assertDccUptakeLog({ ...ctx, uptake: 'DECLINED' });

    // process_dcc_data returns early unless uptake is exactly ACCEPTED. Worth
    // asserting on this path too: a blocks-side bug that posted the wrong value
    // would show up as meta written for a payer who declined.
    await assertDccOrderMeta(ctx.orderNumber, config, {
      payerCurrency: PAYER_CURRENCY,
      expectAbsent: true,
    });
    expect(ctx.order.currency, 'order currency should be unchanged').toBe('USD');

    await assertOrderComplete(ctx, config, { page, adminPage, emailPage }, {
      status: 'Processing',
      note: 'captured',
    });
  });

  // === DCC-011: An unanswered offer is rejected client-side ===

  test('DCC-011 - Unanswered offer blocks the order', async ({ page }) => {
    await addToCartAndCheckout(page, config.products.physical);
    await fillBilling(page, billing);
    await selectPaymentMethod(page, config);
    await fillHostedSessionCC(page, dccCard, config);

    // Prove a real offer arrived before refusing to answer it — otherwise this
    // case passes for the wrong reason on a card that never quoted.
    await requireDccOffer(page, config);

    // Deliberately answer nothing. Unlike classic, nothing server-side guards
    // this: validate_fields() is a classic-checkout method the Store API never
    // calls, so the only thing standing between an unanswered offer and a
    // half-specified payment is validateCurrencyConversionData in the browser.
    await clickPlaceOrder(page);
    await waitForUnblock(page);

    expect(await getCheckoutError(page)).toContain(
      'accept or reject the currency conversion offer',
    );
    await expect(page).toHaveURL(/checkout/);
  });

  // === DCC-012: Saved-token quote through the blocks token component ===

  test('DCC-012 - Quote against a saved token', async ({ page, adminPage, emailPage }) => {
    const ctx = await checkoutHostedSession(page, config, {
      productId: config.products.physical,
      // The card DCC-009 saved; the token stands in for it.
      card: dccCard,
      loginAs: returning,
      savedTokenIndex: 1,
      requireDccOffer: true,
      dccChoice: 'accept',
    });

    // A saved token has no PAN in the DOM to quote from, so the quote is fetched
    // server-side through ajax_dcc_quote → payment_options_inquiry, which is the
    // only way the inquiry reaches our log. In blocks the offer area comes from
    // SavedTokenHandler rather than CardElements, so this also proves that
    // component mounts and wires up.
    await assertDccQuoteInquiryLog({ payDate: ctx.payDate, logOffset: ctx.logOffset });

    await assertDccUptakeLog({ ...ctx, uptake: 'ACCEPTED' });
    await assertDccOrderMeta(ctx.orderNumber, config, { payerCurrency: PAYER_CURRENCY });

    await navigateToOrder(adminPage, ctx.orderNumber);
    await assertDccAdminPanel(adminPage, { payerCurrency: PAYER_CURRENCY });

    await assertOrderComplete(ctx, config, { page, adminPage, emailPage }, {
      status: 'Processing',
      note: 'captured',
      // Still the one card DCC-009 saved — paying with a token does not add another.
      myAccount: { ...returning, expectedCards: 1 },
    });
  });
});
