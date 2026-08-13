import { test } from '../../fixtures/test';
import { switchCheckoutMode, configureGateway } from '../../helpers/wc-api';
import { checkoutHostedSession, assertOrderComplete } from '../../helpers/flows';
import { assertCaptureLogTrail, expectedOrderStatus } from '../../helpers/assertions';
import config from '../../plugin-config';
import { cards, fourDigits } from '../../fixtures/cards';
import { billing, uniqueEmail } from '../../fixtures/billing';

test.describe.serial('Hosted Session - Capture - Classic', () => {
  const mc005Email = uniqueEmail();
  const mc006Email = uniqueEmail();

  /** The account MC-006 creates and MC-007..MC-010 keep shopping with. */
  const returning = { email: mc006Email, password: billing.password };

  /** MC-006's saved card, still the only card for MC-007 and MC-008. */
  const oneCard = {
    expectedCards: 1,
    cardName: cards.mastercard.name,
    fourDigits: fourDigits(cards.mastercard),
    expiryMonth: cards.mastercard.month,
    expiryYear: cards.mastercard.year,
  };

  /** After MC-009 saves a second card, MC-009 and MC-010 expect both. */
  const twoCards = {
    expectedCards: 2,
    cards: [
      { cardName: cards.mastercard.name, fourDigits: fourDigits(cards.mastercard), expiryMonth: cards.mastercard.month, expiryYear: cards.mastercard.year },
      { cardName: cards.mastercard3.name, fourDigits: fourDigits(cards.mastercard3), expiryMonth: cards.mastercard3.month, expiryYear: cards.mastercard3.year },
    ],
  };

  // Digital product: WooCommerce auto-completes it, so GI expects Completed.
  const downloadStatus = expectedOrderStatus({ product: 'download', transaction: 'capture' });

  // === MC-004: Guest checkout ===

  test('MC-004 - Guest checkout', async ({ page, adminPage, emailPage }) => {
    await switchCheckoutMode('classic');
    await configureGateway(config, {
      _3d_secure: 'yes',
      saved_cards: 'yes',
      transaction_mode: 'PURCHASE',
      checkout_mode: 'hosted_session',
      // Pin DCC off. It is a site-global setting, so leaving it unset means the
      // suite inherits whatever the install has — and with it on, any card MPGS
      // returns an offer for renders Accept/Reject radios that must be answered
      // before place-order will submit. Unanswered, checkout silently never
      // leaves /checkout/ (validate_dcc_data in DynamicCurrencyConversion.php).
      // That made this suite intermittently red depending on which cards drew an
      // offer. DCC has its own coverage in suite 19, including the disabled case.
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
      myAccount: { email: mc005Email, password: billing.password, expectedCards: 0 },
    });
  });

  // === MC-006: New user, saving CC ===

  test('MC-006 - New user saving CC', async ({ page, adminPage, emailPage }) => {
    const ctx = await checkoutHostedSession(page, config, {
      productId: config.products.digital,
      card: cards.mastercard,
      billing: { ...billing, email: mc006Email },
      createAccount: billing.password,
      saveCard: true,
    });

    await assertCaptureLogTrail({
      ...ctx,
      expectSessionPost: true, expectToken: true, expectCardDetailsFetch: true,
    });

    await assertOrderComplete(ctx, config, { page, adminPage, emailPage }, {
      status: downloadStatus,
      note: 'captured',
      myAccount: { ...returning, ...oneCard },
    });
  });

  // === MC-007: Logged user, pay with saved CC ===
  // AUDIT 2026-04-29 vs GI: JUSTIFIED FIX — saved-token path skips
  // `verifySessionGetCardDetails` (saved-token flow doesn't fetch card
  // details from MPGS — token references the card, no GET /session/{id}
  // for fresh card data).

  test('MC-007 - Logged user pay with saved CC', async ({ page, adminPage, emailPage }) => {
    const ctx = await checkoutHostedSession(page, config, {
      productId: config.products.physical,
      // The card the token stands for — nothing is typed in, but the log
      // assertions still match against it.
      card: cards.mastercard,
      loginAs: returning,
      savedTokenIndex: 1,
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
      // Still 1 card — the new one was not saved.
      myAccount: { ...returning, ...oneCard },
    });
  });

  // === MC-009: Logged user, pay with new CC and save it ===

  // AUDIT 2026-04-29 vs GI: JUSTIFIED FIX — challenge card adds
  // `handle3DSChallenge` + `AUTHENTICATION_SUCCESSFUL` log probe (GI's
  // shared-step library handles this conditionally; PW makes it explicit).
  test('MC-009 - Logged user pay with new CC and save it', async ({ page, adminPage, emailPage }) => {
    const ctx = await checkoutHostedSession(page, config, {
      productId: config.products.physical,
      card: cards.mastercard3,
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
      // 2 cards: MC-006's saved + MC-009's saved.
      myAccount: { ...returning, ...twoCards },
    });
  });

  // === MC-010: Logged user, pay with second saved CC ===

  // AUDIT 2026-04-29 vs GI: JUSTIFIED FIX — saved-token of a challenge card
  // skips `verifySessionGetCardDetails` (saved-token path) and adds
  // conditional 3DS handling (challenge token MAY re-challenge per issuer).
  test('MC-010 - Logged user pay with second saved CC', async ({ page, adminPage, emailPage }) => {
    const ctx = await checkoutHostedSession(page, config, {
      productId: config.products.physical,
      card: cards.mastercard3,
      loginAs: returning,
      savedTokenIndex: 2,
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
      myAccount: { ...returning, ...twoCards },
    });
  });
});
