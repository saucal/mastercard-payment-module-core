import { test } from '../../fixtures/test';
import { switchCheckoutMode, configureGateway } from '../../helpers/wc-api';
import { checkoutHostedSession, assertOrderComplete } from '../../helpers/flows';
import { assertCaptureLogTrail } from '../../helpers/assertions';
import config from '../../plugin-config';
import { cards } from '../../fixtures/cards';

test.describe.serial('Hosted Session - 3DS Inactive', () => {
  // The mirror of suite 06: same three cards, same guest physical checkout, but
  // `_3d_secure: 'no'`. Every case therefore passes expect3DS: false, which
  // inverts the trail's 3DS section — INITIATE_AUTHENTICATION and
  // AUTHENTICATE_PAYER must be absent. That absence IS this suite's assertion.

  // === MC-050: 3DS Visa with Challenge (3DS inactive — no auth flow) ===
  // AUDIT 2026-04-29 vs GI (applies to all three MCs in this suite):
  // JUSTIFIED FIX — GI's shared step library asserts the ACS challenge
  // (`mc-sonic` / `challengeFrame` selectors). With `_3d_secure=no` those
  // branches are dead code in the GI run. PW asserts log-level absence
  // instead: no INITIATE_AUTHENTICATION / AUTHENTICATE_PAYER entries —
  // intent equivalent and parser-stable.

  test('MC-050 - 3DS Visa with Challenge', async ({ page, adminPage, emailPage }) => {
    await switchCheckoutMode('classic');
    await configureGateway(config, {
      _3d_secure: 'no',
      saved_cards: 'yes',
      transaction_mode: 'PURCHASE',
      checkout_mode: 'hosted_session',
      // Pinned off: site-global, and an unanswered DCC offer blocks place-order
      // (see suite 01 for the full explanation). DCC's own coverage is suite 19.
      currency_conversion: 'no',
    });

    const ctx = await checkoutHostedSession(page, config, {
      productId: config.products.physical,
      // A challenge card that never gets challenged, because 3DS is off — so
      // threeDS: 'never' despite `visaChallenge.challenge` being true.
      card: cards.visaChallenge,
      threeDS: 'never',
    });

    await assertCaptureLogTrail({
      ...ctx,
      expectSessionPost: true, expectToken: false, expectCardDetailsFetch: true,
      expect3DS: false,
    });

    await assertOrderComplete(ctx, config, { page, adminPage, emailPage }, {
      status: 'Processing',
      note: 'captured',
    });
  });

  // === MC-051: 3DS Visa Frictionless (3DS inactive) ===

  test('MC-051 - 3DS Visa Frictionless', async ({ page, adminPage, emailPage }) => {
    const ctx = await checkoutHostedSession(page, config, {
      productId: config.products.physical,
      card: cards.visaFrictionless,
      threeDS: 'never',
    });

    await assertCaptureLogTrail({
      ...ctx,
      expectSessionPost: true, expectToken: false, expectCardDetailsFetch: true,
      expect3DS: false,
    });

    await assertOrderComplete(ctx, config, { page, adminPage, emailPage }, {
      status: 'Processing',
      note: 'captured',
    });
  });

  // === MC-052: 3DS Visa Frictionless Authentication Attempted (3DS inactive) ===
  // AUDIT 2026-04-29 vs GI: MISSING — GI logs in as an existing customer
  // before checkout (`assertTextPresent h1.entry-title|My account`); PW
  // runs as guest. Add a `frontendLogin(page, ...)` step to mirror GI.

  test('MC-052 - 3DS Visa Frictionless Authentication Attempted', async ({ page, adminPage, emailPage }) => {
    const ctx = await checkoutHostedSession(page, config, {
      productId: config.products.physical,
      card: cards.visaFrictionlessAttempted,
      threeDS: 'never',
    });

    await assertCaptureLogTrail({
      ...ctx,
      expectSessionPost: true, expectToken: false, expectCardDetailsFetch: true,
      expect3DS: false,
    });

    await assertOrderComplete(ctx, config, { page, adminPage, emailPage }, {
      status: 'Processing',
      note: 'captured',
    });
  });
});
