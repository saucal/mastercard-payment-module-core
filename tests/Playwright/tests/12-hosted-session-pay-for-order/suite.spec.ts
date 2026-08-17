import { test } from '../../fixtures/test';
import {
  switchCheckoutMode, configureGateway, findCustomerIdByEmail, createPendingOrder,
} from '../../helpers/wc-api';
import { checkoutHostedSession, assertOrderComplete } from '../../helpers/flows';
import { assertCaptureLogTrail } from '../../helpers/assertions';
import { registerUser } from '../../helpers/wp-login';
import config from '../../plugin-config';
import { cards, fourDigits } from '../../fixtures/cards';
import { billing, uniqueEmail } from '../../fixtures/billing';

test.describe.serial('Hosted Session - Pay For Order', () => {
  const mcEmail = uniqueEmail();
  const returning = { email: mcEmail, password: billing.password };
  let mcCustomerId: number;

  /** A fresh pending order for this customer, and the URL that pays it. */
  async function pendingOrderUrl(): Promise<string> {
    const { orderId, orderKey, paymentUrl } = await createPendingOrder({
      productId: config.products.physical, customerId: mcCustomerId, email: mcEmail, billing,
    });
    // WooCommerce's own pay URL points at whatever page this install uses for
    // checkout; a hand-built /checkout/… path lands on the cart when the
    // checkout page lives elsewhere (e.g. /checkout-blocks/).
    return paymentUrl || `/checkout/order-pay/${orderId}/?pay_for_order=true&key=${orderKey}`;
  }

  // Pay-for-order never POSTs a new session — the order already exists, so the
  // gateway only PUTs UPDATE_SESSION. Every case therefore passes
  // expectSessionPost: false, and every case checks the admin mail only (the
  // REST-created order carries no customer email).

  // === MC-011: Pay for order, not saving CC ===
  // AUDIT 2026-04-29 vs GI (applies to MC-011/012/013): DRIFT — GI uses
  // `prodType=virtual`, PW uses `config.products.physical`. Functionally
  // harmless (pay-for-order works the same with either) but violates
  // source-of-truth fidelity. Either switch to `config.products.digital`
  // / a `virtual` config slot, or document why physical is preferred.

  test('MC-011 - Pay for order not saving CC', async ({ page, adminPage, emailPage }) => {
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

    // registerUser leaves the buyer signed in, which is what the pay page needs.
    await registerUser(page, mcEmail, billing.password);
    mcCustomerId = await findCustomerIdByEmail(mcEmail);

    const ctx = await checkoutHostedSession(page, config, {
      payForOrder: { url: await pendingOrderUrl() },
      card: cards.mastercard,
    });

    await assertCaptureLogTrail({
      ...ctx,
      expectSessionPost: false, expectToken: false, expectCardDetailsFetch: true,
      authStatus: 'AUTHENTICATION_SUCCESSFUL',
    });

    await assertOrderComplete(ctx, config, { page, adminPage, emailPage }, {
      status: 'Processing',
      note: 'captured',
      emails: 'admin',
    });
  });

  // === MC-012: Pay for order, saving CC (challenge card) ===
  // AUDIT 2026-04-29 vs GI: JUSTIFIED FIX — `useNewToken: true` mirrors GI
  // step 31 (clicks the new-token radio before filling the CC iframe).
  // Without it, WC tokenization-form.js keeps the .saveNew row hidden and
  // clickSaveCardCheckbox would fail.

  test('MC-012 - Pay for order saving CC', async ({ page, adminPage, emailPage }) => {
    const ctx = await checkoutHostedSession(page, config, {
      payForOrder: { url: await pendingOrderUrl() },
      card: cards.visaChallenge,
      // Explicit login: registerUser's session in MC-011 does not survive across
      // tests reliably on /checkout/order-pay/, and without a logged-in session
      // WC's tokenization-form.js reads is_logged_in="" and force-hides the
      // save-card row.
      loginAs: returning,
      useNewToken: true,
      saveCard: true,
      threeDS: 'always',
    });

    await assertCaptureLogTrail({
      ...ctx,
      // No card-details GET on this path — the original asserted the
      // UPDATE_SESSION PUT only.
      expectSessionPost: false, expectToken: true, expectCardDetailsFetch: false,
      authStatus: 'AUTHENTICATION_SUCCESSFUL',
    });

    await assertOrderComplete(ctx, config, { page, adminPage, emailPage }, {
      status: 'Processing',
      note: 'captured',
      emails: 'admin',
      myAccount: {
        ...returning,
        expectedCards: 1,
        cardName: cards.visaChallenge.name,
        fourDigits: fourDigits(cards.visaChallenge),
        expiryMonth: cards.visaChallenge.month,
        expiryYear: cards.visaChallenge.year,
      },
    });
  });

  // === MC-013: Pay for order with saved CC ===
  // AUDIT 2026-04-29 vs GI: JUSTIFIED FIX — conditional 3DS handler. Saved
  // visaChallenge token MAY re-challenge depending on issuer behavior;
  // threeDS: 'maybe' gates the handler on URL-pattern detection.
  //
  // The suite used to thread MC-012's token id into this case's
  // verifySessionGet call. That argument was never read — verifySessionGet
  // ignores `token`, only verifySessionGetCardDetails uses it — so the
  // threading was dead weight and is gone. If proving *which* token paid is
  // worth asserting, it needs a real assertion, not that parameter.

  test('MC-013 - Pay for order with saved CC', async ({ page, adminPage, emailPage }) => {
    const ctx = await checkoutHostedSession(page, config, {
      payForOrder: { url: await pendingOrderUrl() },
      // The card MC-012's token stands for.
      card: cards.visaChallenge,
      loginAs: returning,
      savedTokenIndex: 1,
      threeDS: 'maybe',
    });

    await assertCaptureLogTrail({
      ...ctx,
      expectSessionPost: false, expectToken: false, expectCardDetailsFetch: false,
    });

    await assertOrderComplete(ctx, config, { page, adminPage, emailPage }, {
      status: 'Processing',
      note: 'captured',
      emails: 'admin',
    });
  });
});
