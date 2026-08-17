import { test } from '../../fixtures/test';
import { switchCheckoutMode, configureGateway } from '../../helpers/wc-api';
import { checkoutHostedSession, assertOrderComplete } from '../../helpers/flows';
import { assertCaptureLogTrail, expectedOrderStatus } from '../../helpers/assertions';
import config from '../../plugin-config';
import { cards } from '../../fixtures/cards';
import { billing, uniqueEmail } from '../../fixtures/billing';

test.describe.serial('Hosted Session - Save CC Deactivated', () => {
  const mc031Email = uniqueEmail();

  /** The account MC-031 creates and MC-032 keeps shopping with. */
  const returning = { email: mc031Email, password: billing.password };

  // Every case runs with saved_cards: 'no', so every case asserts the same two
  // things beyond an ordinary purchase: the save-card UI never renders
  // (expectNoSaveCardCheckbox) and no token is ever written (expectToken:
  // false). The suite-local runSuccessFlow that used to carry this is gone —
  // checkoutHostedSession does the driving now.

  // === MC-030: Guest checkout, save CC deactivated ===
  // AUDIT 2026-04-29 vs GI: JUSTIFIED FIX — guest path skips the
  // /my-account/payment-methods/ assertion (no logged-in account exists).

  test('MC-030 - Guest checkout', async ({ page, adminPage, emailPage }) => {
    await switchCheckoutMode('classic');
    await configureGateway(config, {
      _3d_secure: 'yes',
      saved_cards: 'no',
      transaction_mode: 'PURCHASE',
      checkout_mode: 'hosted_session',
      // Pinned off: site-global, and an unanswered DCC offer blocks place-order
      // (see suite 01 for the full explanation). DCC's own coverage is suite 19.
      currency_conversion: 'no',
    });

    const ctx = await checkoutHostedSession(page, config, {
      productId: config.products.physical,
      card: cards.mastercard,
      expectNoSaveCardCheckbox: true,
    });

    await assertCaptureLogTrail({
      ...ctx,
      expectSessionPost: true, expectToken: false, expectCardDetailsFetch: true,
    });

    await assertOrderComplete(ctx, config, { page, adminPage, emailPage }, {
      status: 'Processing',
      note: 'captured',
      // Guest has no My Account to check.
    });
  });

  // === MC-031: New user, save CC deactivated ===
  // AUDIT 2026-04-29 vs GI: DRIFT RESOLVED — this case used to assert less
  // than MC-030 in the same suite (PAY log + empty tokens only, no session
  // POST/GET verification) with no documented reason. Ported onto the shared
  // trail, which aligns it upward as that AUDIT note asked; MC-030 already
  // proved those assertions hold under this exact gateway config.

  test('MC-031 - New user', async ({ page, adminPage, emailPage }) => {
    const ctx = await checkoutHostedSession(page, config, {
      productId: config.products.digital,
      card: cards.mastercard,
      billing: { ...billing, email: mc031Email },
      createAccount: billing.password,
      expectNoSaveCardCheckbox: true,
    });

    await assertCaptureLogTrail({
      ...ctx,
      expectSessionPost: true, expectToken: false, expectCardDetailsFetch: true,
    });

    await assertOrderComplete(ctx, config, { page, adminPage, emailPage }, {
      status: expectedOrderStatus({ product: 'download', transaction: 'capture' }),
      note: 'captured',
      // Saving is off, so the account must end up with no cards.
      myAccount: { ...returning, expectedCards: 0 },
    });
  });

  // === MC-032: Logged user pays with new CC, save CC deactivated ===

  test('MC-032 - Logged user pay with new CC', async ({ page, adminPage, emailPage }) => {
    const ctx = await checkoutHostedSession(page, config, {
      productId: config.products.physical,
      card: cards.mastercard2,
      loginAs: returning,
      // Logged in, but saved_cards is off — so still no save-card UI.
      expectNoSaveCardCheckbox: true,
    });

    await assertCaptureLogTrail({
      ...ctx,
      expectSessionPost: true, expectToken: false, expectCardDetailsFetch: true,
    });

    await assertOrderComplete(ctx, config, { page, adminPage, emailPage }, {
      status: 'Processing',
      note: 'captured',
      myAccount: { ...returning, expectedCards: 0 },
    });
  });

  // MC-060 (subscription with challenge, saved_cards: 'no') not ported here.
  // Subscriptions require a saved payment method to renew; with saved_cards
  // disabled the gateway is filtered out by the subscription addon. Any port
  // of this scenario belongs in suites 16-18.
});
