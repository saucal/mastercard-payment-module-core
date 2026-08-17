import { test } from '../../fixtures/test';
import {
  switchCheckoutMode, configureGateway, findCustomerIdByEmail, createPendingOrder,
} from '../../helpers/wc-api';
import { checkoutHostedCheckout, assertOrderComplete } from '../../helpers/flows';
import { assertHostedCheckoutLogTrail, expectedOrderStatus } from '../../helpers/assertions';
import { registerUser } from '../../helpers/wp-login';
import config from '../../plugin-config';
import { cards } from '../../fixtures/cards';
import { billing, uniqueEmail } from '../../fixtures/billing';

// Hosted-checkout flow — MPGS drives the full UI inside an iframe: the
// merchant server only creates the INITIATE_CHECKOUT session, then fetches
// the transaction result via GET /order/<id> after the webhook arrives.
// There are no server-side INITIATE_AUTHENTICATION / AUTHENTICATE_PAYER /
// PAY PUT requests to log (unlike the hosted-session flow in suites 01-02);
// MPGS runs those inside its own UI. So log verification here is limited to
// the INITIATE_CHECKOUT session POST plus token emptiness — which is exactly
// what assertHostedCheckoutLogTrail asserts.
test.describe('Hosted Checkout - Embedded - Capture', () => {
  const mc005Email = uniqueEmail();
  // MC-008 reuses the account created in MC-005 — that user already has a
  // saved billing address from the previous checkout, so the hosted-checkout
  // flow can proceed without a separate fillBilling step.
  const mc008Email = mc005Email;

  const mc011Email = uniqueEmail();

  // Digital product: WooCommerce auto-completes it, so GI expects Completed.
  const downloadStatus = expectedOrderStatus({ product: 'download', transaction: 'capture' });

  // === MC-004: Guest checkout ===

  test('MC-004 - Guest checkout', async ({ page, adminPage, emailPage }) => {
    await switchCheckoutMode('classic');
    await configureGateway(config, {
      _3d_secure: 'yes',
      transaction_mode: 'PURCHASE',
      checkout_mode: 'hosted_checkout',
      hosted_checkout_mode: 'embedded',
    });

    const ctx = await checkoutHostedCheckout(page, config, {
      hostedMode: 'embedded',
      productId: config.products.physical,
      card: cards.mastercard,
    });

    await assertHostedCheckoutLogTrail(ctx);

    await assertOrderComplete(ctx, config, { page, adminPage, emailPage }, {
      status: 'Processing',
      note: 'captured',
    });
  });

  // === MC-005: New user ===

  // Only these two depend on each other: MC-008 signs in with the account
  // MC-005 registers. `.serial` scopes that dependency — it keeps them in
  // order and, more importantly, skips MC-008 when MC-005 fails instead of
  // letting it fail again on an account that was never created. The other
  // tests in this suite are independent and stay outside it.
  test.describe.serial('shared account', () => {
    test('MC-005 - New user', async ({ page, adminPage, emailPage }) => {
      const ctx = await checkoutHostedCheckout(page, config, {
        hostedMode: 'embedded',
        productId: config.products.digital,
        card: cards.mastercard,
        billing: { ...billing, email: mc005Email },
        createAccount: billing.password,
      });

      await assertHostedCheckoutLogTrail(ctx);

      await assertOrderComplete(ctx, config, { page, adminPage, emailPage }, {
        status: downloadStatus,
        note: 'captured',
        // Order only — hosted checkout never tokenizes, so these suites have
        // never asserted a saved-cards count.
        myAccount: { email: mc005Email, password: billing.password },
      });
    });

    // === MC-008: Logged user ===
    // AUDIT 2026-04-29 vs GI: DRIFT — GI stores expiry 04/27 for this card
    // (5555555555000018), PW uses cards.mastercard2 with 01/39. Number matches
    // but expiry differs. If 04/27 is part of the source-of-truth (e.g. GI was
    // exercising a "near-expiry valid card" semantic), switch to cards.expired
    // or add a `mastercard2Expired` fixture. If the expiry was incidental in
    // GI, leave as-is and document.

    test('MC-008 - Logged user', async ({ page, adminPage, emailPage }) => {
      const ctx = await checkoutHostedCheckout(page, config, {
        hostedMode: 'embedded',
        productId: config.products.physical,
        card: cards.mastercard2,
        loginAs: { email: mc008Email, password: billing.password },
      });

      await assertHostedCheckoutLogTrail(ctx);

      await assertOrderComplete(ctx, config, { page, adminPage, emailPage }, {
        status: 'Processing',
        note: 'captured',
        myAccount: { email: mc008Email, password: billing.password },
      });
    });
  });

  // === MC-011: Pay for order ===

  test('MC-011 - Pay for order', async ({ page, adminPage, emailPage }) => {
    // Create the order via WC REST and use its total directly; the pay-for-
    // order page does not always render an .order-total row that matches
    // extractOrderTotal's selector, so reading the amount from the REST
    // response is more reliable.
    await registerUser(page, mc011Email, billing.password);
    const customerId = await findCustomerIdByEmail(mc011Email);
    const { orderId, orderKey, total, paymentUrl } = await createPendingOrder({
      productId: config.products.physical, customerId, email: mc011Email, billing,
    });

    const ctx = await checkoutHostedCheckout(page, config, {
      hostedMode: 'embedded',
      card: cards.mastercard,
      // Prefer the pay URL WooCommerce generated: it points at whatever page the
      // site actually uses for checkout. The hand-built path assumes /checkout/.
      payForOrder: {
        url: paymentUrl || `/checkout/order-pay/${orderId}/?pay_for_order=true&key=${orderKey}`,
        total,
      },
    });

    await assertHostedCheckoutLogTrail(ctx);

    await assertOrderComplete(ctx, config, { page, adminPage, emailPage }, {
      status: 'Processing',
      note: 'captured',
      // No email check: the pending order created via REST has no customer
      // email set, so WC only fires the admin "new order" mail; the customer
      // "processing" mail never sends.
      emails: 'none',
    });
  });
});
