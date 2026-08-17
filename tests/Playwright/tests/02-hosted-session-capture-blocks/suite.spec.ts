import { test } from '../../fixtures/test';
import { switchCheckoutMode, configureGateway } from '../../helpers/wc-api';
import { checkoutHostedSession, assertOrderComplete } from '../../helpers/flows';
import { assertCaptureLogTrail, expectedOrderStatus } from '../../helpers/assertions';
import config from '../../plugin-config';
import { cards, fourDigits } from '../../fixtures/cards';
import { billing, uniqueEmail } from '../../fixtures/billing';

// Five cases, not suite 01's seven: blocks has no MC-006 and no MC-007, and its
// MC-010 is "pay with the saved CC" (one card) where 01's MC-010 is "pay with the
// SECOND saved CC" (two cards). Deliberately not merged into 01's shape — the
// coverage differs, and a shared factory would silently level it.
test.describe.serial('Hosted Session - Capture - Blocks', () => {
  const mc005Email = uniqueEmail();

  /** The account MC-005 creates and MC-008..MC-010 keep shopping with. */
  const returning = { email: mc005Email, password: billing.password };

  /** The card MC-009 saves — still the only card for MC-010. */
  const oneCard = {
    expectedCards: 1,
    cardName: cards.visaChallenge.name,
    fourDigits: fourDigits(cards.visaChallenge),
    expiryMonth: cards.visaChallenge.month,
    expiryYear: cards.visaChallenge.year,
  };

  // Digital product: WooCommerce auto-completes it, so GI expects Completed.
  const downloadStatus = expectedOrderStatus({ product: 'download', transaction: 'capture' });

  // === MC-004: Guest checkout ===

  test('MC-004 - Guest checkout', async ({ page, adminPage, emailPage }) => {
    await switchCheckoutMode('blocks');
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
      card: cards.mastercard,
      // Guest should NOT see the save-card checkbox.
      expectNoSaveCardCheckbox: true,
    });

    await assertCaptureLogTrail({
      ...ctx,
      expectSessionPost: true, expectToken: false, expectCardDetailsFetch: true,
    });

    await assertOrderComplete(ctx, config, { page, adminPage, emailPage }, {
      status: 'Processing',
      note: 'captured',
    });
  });

  // === MC-005: New user, NOT saving CC ===

  test('MC-005 - New user not saving CC', async ({ page, adminPage, emailPage }) => {
    const ctx = await checkoutHostedSession(page, config, {
      productId: config.products.digital,
      card: cards.mastercard,
      billing: { ...billing, email: mc005Email },
      createAccount: billing.password,
    });

    await assertCaptureLogTrail({
      ...ctx,
      expectSessionPost: true, expectToken: false, expectCardDetailsFetch: true,
    });

    await assertOrderComplete(ctx, config, { page, adminPage, emailPage }, {
      status: downloadStatus,
      note: 'captured',
      // Did not save the card, so My Account shows none.
      myAccount: { ...returning, expectedCards: 0 },
    });
  });

  // === MC-008: Logged user, pay with new CC (not saving) ===

  test('MC-008 - Logged user pay with new CC', async ({ page, adminPage, emailPage }) => {
    const ctx = await checkoutHostedSession(page, config, {
      productId: config.products.physical,
      card: cards.mastercard2,
      loginAs: returning,
      useNewToken: true,
    });

    await assertCaptureLogTrail({
      ...ctx,
      expectSessionPost: true, expectToken: false, expectCardDetailsFetch: true,
    });

    await assertOrderComplete(ctx, config, { page, adminPage, emailPage }, {
      status: 'Processing',
      note: 'captured',
      // Still 0 cards — the new one was not saved.
      myAccount: { ...returning, expectedCards: 0 },
    });
  });

  // === MC-009: Logged user, pay with new CC and save it ===
  // AUDIT 2026-04-29 vs GI: card differs from suite-01 MC-009 BY DESIGN —
  // GI uses `4440000009900010` (visaChallenge) here while suite-01 uses
  // `5123450000000008` (mastercard3 challenge). PW correctly reflects
  // this. JUSTIFIED FIX — challenge handling + AUTHENTICATION_SUCCESSFUL
  // log probe identical to suite 01 MC-009.

  test('MC-009 - Logged user pay with new CC and save it', async ({ page, adminPage, emailPage }) => {
    const ctx = await checkoutHostedSession(page, config, {
      productId: config.products.physical,
      card: cards.visaChallenge,
      loginAs: returning,
      useNewToken: true,
      saveCard: true,
      threeDS: 'always',
    });

    await assertCaptureLogTrail({
      ...ctx,
      expectSessionPost: true, expectToken: true, expectCardDetailsFetch: true,
    });

    await assertOrderComplete(ctx, config, { page, adminPage, emailPage }, {
      status: 'Processing',
      note: 'captured',
      myAccount: { ...returning, ...oneCard },
    });
  });

  // === MC-010: Logged user, pay with saved CC (from MC-009) ===
  // AUDIT 2026-04-29 vs GI: JUSTIFIED FIX — blocks-mode disabled-button +
  // URL-race fallback for saved-token Place Order. Both now live in
  // clickPlaceOrder({ force }), which checkoutHostedSession turns on for any
  // saved-token checkout.

  test('MC-010 - Logged user pay with saved CC', async ({ page, adminPage, emailPage }) => {
    const ctx = await checkoutHostedSession(page, config, {
      productId: config.products.physical,
      // The card the token stands for — nothing is typed in, but the log
      // assertions still match against it.
      card: cards.visaChallenge,
      loginAs: returning,
      savedTokenIndex: 1,
      // A saved challenge token MAY re-challenge, per issuer.
      threeDS: 'maybe',
    });

    // Saved-token path: no new session POST, no card-details GET; the session
    // may be empty in the DOM, so the composite derives it from the PUT log.
    await assertCaptureLogTrail({
      ...ctx,
      expectSessionPost: false, expectToken: false, expectCardDetailsFetch: false,
    });

    await assertOrderComplete(ctx, config, { page, adminPage, emailPage }, {
      status: 'Processing',
      note: 'captured',
      myAccount: { ...returning, ...oneCard },
    });
  });
});
