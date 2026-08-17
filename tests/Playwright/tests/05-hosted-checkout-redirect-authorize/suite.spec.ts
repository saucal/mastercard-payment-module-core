import { test, expect } from '../../fixtures/test';
import {
  switchCheckoutMode, configureGateway, findCustomerIdByEmail, createPendingOrder,
} from '../../helpers/wc-api';
import { checkoutHostedCheckout, assertOrderComplete } from '../../helpers/flows';
import { assertHostedCheckoutLogTrail } from '../../helpers/assertions';
import { registerUser } from '../../helpers/wp-login';
import config from '../../plugin-config';
import { cards } from '../../fixtures/cards';
import { billing, uniqueEmail } from '../../fixtures/billing';

// Hosted-checkout REDIRECT + AUTHORIZE — same log shape as the capture
// variant (only INITIATE_CHECKOUT is server-side). Order ends in `on-hold`
// instead of `processing`; only the admin "new order" email fires (the
// customer "processing" email is gated on capture). Capture is performed
// later from the admin meta box (covered by suite 14).
//
// AUDIT 2026-04-29 vs GI:
// - JUSTIFIED FIX (all tests): `verifyAdminEmail` only — customer email
//   gated on capture in AUTHORIZE mode.
// - JUSTIFIED FIX (MC-011): skips admin email verification entirely (REST
//   pending order has no billing.email).
// - MISSING (suites 04 + 05): GI buyer-side subscription assertions
//   relocated to suite 16-subscription-renewal as `test.describe.skip(...)`
//   per the move-not-delete rule. Activate when suite 16 is canonically
//   ported.
test.describe.serial('Hosted Checkout - Redirect - Authorize', () => {
  const mc005Email = uniqueEmail();
  const mc011Email = uniqueEmail();
  const mc008Email = mc005Email;

  // === MC-004: Guest checkout ===

  test('MC-004 - Guest checkout', async ({ page, adminPage, emailPage }) => {
    await switchCheckoutMode('classic');
    await configureGateway(config, {
      _3d_secure: 'yes',
      transaction_mode: 'AUTHORIZE',
      checkout_mode: 'hosted_checkout',
      hosted_checkout_mode: 'redirect',
    });

    const ctx = await checkoutHostedCheckout(page, config, {
      hostedMode: 'redirect',
      productId: config.products.physical,
      card: cards.mastercard,
    });

    expect(ctx.order.status).toBe('on-hold');

    await assertHostedCheckoutLogTrail(ctx);

    await assertOrderComplete(ctx, config, { page, adminPage, emailPage }, {
      status: 'On hold',
      note: 'authorized',
      // Customer "processing" mail is gated on capture, so only the admin
      // "new order" mail fires in AUTHORIZE mode.
      emails: 'admin',
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

    expect(ctx.order.status).toBe('on-hold');

    await assertHostedCheckoutLogTrail(ctx);

    // On hold, not Completed: AUTHORIZE holds even a digital order until capture.
    await assertOrderComplete(ctx, config, { page, adminPage, emailPage }, {
      status: 'On hold',
      note: 'authorized',
      emails: 'admin',
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

    expect(ctx.order.status).toBe('on-hold');

    await assertHostedCheckoutLogTrail(ctx);

    await assertOrderComplete(ctx, config, { page, adminPage, emailPage }, {
      status: 'On hold',
      note: 'authorized',
      emails: 'admin',
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
      payForOrder: {
        url: paymentUrl || `/checkout/order-pay/${orderId}/?pay_for_order=true&key=${orderKey}`,
        total,
      },
    });

    expect(ctx.order.status).toBe('on-hold');

    await assertHostedCheckoutLogTrail(ctx);

    await assertOrderComplete(ctx, config, { page, adminPage, emailPage }, {
      status: 'On hold',
      note: 'authorized',
      // Not even the admin mail here — the REST pending order has no billing.email.
      emails: 'none',
    });
  });
});
