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

// Hosted-checkout REDIRECT mode — same server-side log shape as embedded
// (only INITIATE_CHECKOUT is logged on the merchant side; INIT_AUTH /
// AUTHENTICATE_PAYER / PAY all happen inside MPGS). The difference is that
// redirect navigates the buyer's browser to test-gateway.mastercard.com
// instead of embedding an iframe — helpers branch on the `redirect` mode.
//
// AUDIT 2026-04-29 vs GI:
// - JUSTIFIED FIX (MC-011): skips email + expectedTotal (REST-created
//   pending order has no billing.email).
// - MISSING: GI buyer-side subscription assertions relocated to suite
//   16-subscription-renewal as `test.describe.skip(...)` per the
//   move-not-delete rule. Activate when suite 16 is canonically ported.
test.describe.serial('Hosted Checkout - Redirect - Capture', () => {
  const mc005Email = uniqueEmail();
  // Pay-for-order needs an account that owns the order, as in suite 03.
  const mc011Email = uniqueEmail();
  // MC-008 reuses the MC-005 account so the buyer already has a saved
  // billing address (newly registered users have no billing and the
  // checkout stalls).
  const mc008Email = mc005Email;

  // Digital product: WooCommerce auto-completes it, so GI expects Completed.
  const downloadStatus = expectedOrderStatus({ product: 'download', transaction: 'capture' });

  // === MC-004: Guest checkout ===

  test('MC-004 - Guest checkout', async ({ page, adminPage, emailPage }) => {
    await switchCheckoutMode('classic');
    await configureGateway(config, {
      _3d_secure: 'yes',
      transaction_mode: 'PURCHASE',
      checkout_mode: 'hosted_checkout',
      hosted_checkout_mode: 'redirect',
    });

    const ctx = await checkoutHostedCheckout(page, config, {
      hostedMode: 'redirect',
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

  test('MC-005 - New user', async ({ page, adminPage, emailPage }) => {
    const ctx = await checkoutHostedCheckout(page, config, {
      hostedMode: 'redirect',
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

  test('MC-008 - Logged user', async ({ page, adminPage, emailPage }) => {
    const ctx = await checkoutHostedCheckout(page, config, {
      hostedMode: 'redirect',
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

  // === MC-011: Pay for order ===

  test('MC-011 - Pay for order', async ({ page, adminPage, emailPage }) => {
    await registerUser(page, mc011Email, billing.password);
    const customerId = await findCustomerIdByEmail(mc011Email);
    const { orderId, orderKey, total, paymentUrl } = await createPendingOrder({
      productId: config.products.physical, customerId, email: mc011Email, billing,
    });

    const ctx = await checkoutHostedCheckout(page, config, {
      hostedMode: 'redirect',
      card: cards.mastercard,
      // WooCommerce's own pay URL points at whatever page this install uses for
      // checkout; a hand-built /checkout/… path lands on the cart when the
      // checkout page lives elsewhere (e.g. /checkout-blocks/).
      payForOrder: {
        url: paymentUrl || `/checkout/order-pay/${orderId}/?pay_for_order=true&key=${orderKey}`,
        total,
      },
    });

    await assertHostedCheckoutLogTrail(ctx);

    await assertOrderComplete(ctx, config, { page, adminPage, emailPage }, {
      status: 'Processing',
      note: 'captured',
      // Skip email verification — REST-created pending order has no billing.email.
      emails: 'none',
    });
  });
});
