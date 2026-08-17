import { test } from '../../fixtures/test';
import { switchCheckoutMode, configureGateway } from '../../helpers/wc-api';
import { checkoutHostedSession, assertOrderComplete } from '../../helpers/flows';
import { assertCaptureLogTrail } from '../../helpers/assertions';
import config from '../../plugin-config';
import { cards } from '../../fixtures/cards';

// AUDIT 2026-04-29 vs GI: JUSTIFIED FIX (cross-cutting all three MCs) —
// PW asserts the PAY log via `verifyAuthorizeCaptureLog` with full session/
// total/currency/transactionId/orderNumber/card validation. GI runs many
// per-field eval steps; PW consolidates into one helper that is
// parser-stable. Treated as additive structural improvement.
test.describe.serial('Hosted Session - 3DS', () => {
  // Every case here is a guest checkout of the physical product, with 3DS
  // active. What varies is the card and the authentication outcome it forces,
  // which is the whole point of the suite — hence authStatus per case.

  // === MC-050: 3DS Visa with Challenge ===

  test('MC-050 - 3DS Visa with Challenge', async ({ page, adminPage, emailPage }) => {
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

    const ctx = await checkoutHostedSession(page, config, {
      productId: config.products.physical,
      card: cards.visaChallenge,
      threeDS: 'always',
    });

    await assertCaptureLogTrail({
      ...ctx,
      expectSessionPost: true, expectToken: false, expectCardDetailsFetch: true,
      authStatus: 'AUTHENTICATION_SUCCESSFUL',
    });

    await assertOrderComplete(ctx, config, { page, adminPage, emailPage }, {
      status: 'Processing',
      note: 'captured',
    });
  });

  // === MC-051: 3DS Visa Frictionless ===

  test('MC-051 - 3DS Visa Frictionless', async ({ page, adminPage, emailPage }) => {
    const ctx = await checkoutHostedSession(page, config, {
      productId: config.products.physical,
      card: cards.visaFrictionless,
      // Frictionless: authenticated without an ACS prompt, so there is nothing
      // to answer — but the authentication still succeeds and is asserted below.
      threeDS: 'never',
    });

    await assertCaptureLogTrail({
      ...ctx,
      expectSessionPost: true, expectToken: false, expectCardDetailsFetch: true,
      authStatus: 'AUTHENTICATION_SUCCESSFUL',
    });

    await assertOrderComplete(ctx, config, { page, adminPage, emailPage }, {
      status: 'Processing',
      note: 'captured',
    });
  });

  // === MC-052: 3DS Visa Frictionless Authentication Attempted ===

  test('MC-052 - 3DS Visa Frictionless Authentication Attempted', async ({ page, adminPage, emailPage }) => {
    const ctx = await checkoutHostedSession(page, config, {
      productId: config.products.physical,
      card: cards.visaFrictionlessAttempted,
      threeDS: 'never',
    });

    await assertCaptureLogTrail({
      ...ctx,
      expectSessionPost: true, expectToken: false, expectCardDetailsFetch: true,
      // ATTEMPTED, not SUCCESSFUL: the issuer did not authenticate, it only
      // acknowledged the attempt. This is the one assertion that distinguishes
      // MC-052 from MC-051.
      authStatus: 'AUTHENTICATION_ATTEMPTED',
    });

    await assertOrderComplete(ctx, config, { page, adminPage, emailPage }, {
      status: 'Processing',
      note: 'captured',
    });
  });
});
