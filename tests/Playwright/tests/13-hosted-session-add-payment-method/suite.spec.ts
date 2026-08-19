import { test, expect } from '../../fixtures/test';
import { Page } from '@playwright/test';
import { switchCheckoutMode, configureGateway, getLogEntryCount, getLogs } from '../../helpers/wc-api';
import {
  fillHostedSessionCC,
  fillHostedSessionCCPartial,
  assertSessionFieldsPresent,
} from '../../helpers/hosted-session';
import { handle3DSChallenge } from '../../helpers/three-ds';
import { checkoutHostedSession, assertOrderComplete } from '../../helpers/flows';
import { selectGatewayOnAddPaymentMethod, deletePaymentMethod } from '../../helpers/my-account';
import { frontendLogin, registerUser } from '../../helpers/wp-login';
import { waitForUnblock } from '../../helpers/block-ui';
import {
  assertCaptureLogTrail,
  verifyTokenLog,
  verifyPaymentMethods,
} from '../../helpers/assertions';
import config from '../../plugin-config';
import { cards, fourDigits } from '../../fixtures/cards';
import { billing, uniqueEmail } from '../../fixtures/billing';
import { logOrderContext } from '../../helpers/debug';

async function submitAddPaymentMethod(page: Page, opts: { handle3ds: boolean }): Promise<void> {
  await page.locator('#place_order').first().click();
  if (opts.handle3ds) {
    await handle3DSChallenge(page, { urlPattern: /payment-methods|add-payment-method/ });
  }
  await page.waitForURL(/payment-methods/, { timeout: 30000 });
  await waitForUnblock(page);
  await expect(page.locator('.woocommerce-message, .wc-block-components-notice-banner.is-success'))
    .toContainText('Payment method successfully added.');
}

test.describe.serial('Hosted Session - Add Payment Method', () => {
  const mcEmail = uniqueEmail();
  // MC-050 saves a Visa challenge card; MC-051 charges via that token; MC-052 adds a Visa frictionless.
  const card1 = cards.visaChallenge;
  const card2 = cards.visaFrictionless;
  // Kept as MC-050's own assertion — that MPGS actually minted a token, not just
  // that WooCommerce said so. It used to be threaded into MC-051's
  // verifySessionGet as `token:`, which that function never reads.
  let mc050Token: string;



  // === MC-050: Add Payment Method ===
  // AUDIT 2026-04-29 vs GI: GI asserts h1 "My account" / "Payment methods"
  // page-title gates between navigations. PW skips them (low value navigation
  // gates — `verifyPaymentMethods` already lands on /my-account/payment-methods/).

  test('MC-050 - Add Payment Method', async ({ page }) => {
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

    await registerUser(page, mcEmail, billing.password);

    const logOffset = await getLogEntryCount(new Date().toISOString().slice(0, 19));
    const payDate = new Date().toISOString().slice(0, 19);

    await selectGatewayOnAddPaymentMethod(page, config);
    await fillHostedSessionCC(page, card1, config);

    await submitAddPaymentMethod(page, { handle3ds: !!card1.challenge });

    await verifyPaymentMethods(page, {
      expectedCards: 1,
      cardName: card1.name,
      fourDigits: fourDigits(card1),
      expiryMonth: card1.month,
      expiryYear: card1.year,
    });

    const tokenLogs = await getLogs(payDate, '/token', logOffset);
    expect(tokenLogs.logs[0]?.content?.length, 'token logs should not be empty').toBeGreaterThan(0);
    const tokenLog = tokenLogs.logs[0].content[0];
    const session = tokenLog.request?.body?.session?.id || '';
    verifyTokenLog(tokenLog, { session, card: card1 });
    mc050Token = tokenLog.response?.body?.token || '';
    expect(mc050Token, 'token id should be captured').toBeTruthy();
  });

  // === MC-051: Logged user pay with saved CC ===
  // AUDIT 2026-04-29 vs GI:
  // - JUSTIFIED FIX: status check tightened from GI's loose
  //   "Processing|Completed|On hold|Failed" OR to strict 'Processing'.
  //   PURCHASE + frictionless saved-token guarantees Processing; the GI OR
  //   was brittle.
  // - JUSTIFIED FIX (cross-cutting): conditional 3DS handler — saved
  //   visaChallenge token still re-challenges depending on issuer behavior.

  // The one checkout in this suite, so the only case the flows layer applies to.
  // Everything else here drives /my-account/add-payment-method, which never
  // places an order.
  test('MC-051 - Logged user pay with saved CC', async ({ page, adminPage, emailPage }) => {
    const ctx = await checkoutHostedSession(page, config, {
      productId: config.products.physical,
      // The card MC-050's token stands for.
      card: card1,
      loginAs: { email: mcEmail, password: billing.password },
      // Required, despite being logged in: MC-050 created this account with
      // registerUser, which saves no billing address, so the checkout fields
      // come up empty and WooCommerce rejects the order. Accounts created at
      // checkout (suites 01, 02) do have billing and must not be re-filled.
      billing,
      savedTokenIndex: 1,
      // 'maybe', not 'always': a saved challenge token re-challenges only if the
      // issuer decides to. The pre-port code read
      // `if (card1.challenge) await handle3DSChallenge(page)`, which is
      // unconditional for this card and so passed only on runs where the ACS
      // prompt happened to appear — it timed out waiting for the emulator on a
      // run where MPGS took the frictionless path. Its own AUDIT note called for
      // a conditional handler; this is it, and it matches how suites 01, 02 and
      // 12 treat the same saved-challenge-token case.
      threeDS: 'maybe',
    });

    // Saved-token path: no new session POST and no card-details GET; the
    // composite derives the session from the UPDATE_SESSION PUT.
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

  // === MC-052: Add second payment method ===

  test('MC-052 - Add second payment method', async ({ page }) => {
    await frontendLogin(page, mcEmail, billing.password);

    const logOffset = await getLogEntryCount(new Date().toISOString().slice(0, 19));
    const payDate = new Date().toISOString().slice(0, 19);

    await selectGatewayOnAddPaymentMethod(page, config);
    await fillHostedSessionCC(page, card2, config);

    await submitAddPaymentMethod(page, { handle3ds: !!card2.challenge });

    // Check the gateway before the account page. WooCommerce having said
    // "Payment method successfully added." does not prove MPGS minted a token,
    // and these two assertions fail for opposite reasons: no token here means
    // the gateway never stored the card, whereas a token here plus a missing
    // row means WordPress did not attach it to the customer.
    const tokenLogs = await getLogs(payDate, '/token', logOffset);
    await logOrderContext('second card tokenisation', {
      card: `${card2.name} ****${fourDigits(card2)}`,
      tokenLogEntries: tokenLogs.logs[0]?.content?.length ?? 0,
      firstTokenStatus: tokenLogs.logs[0]?.content?.[0]?.response?.body?.result,
    });
    expect(tokenLogs.logs[0]?.content?.length, 'token log for second card not found').toBeGreaterThan(0);
    const tokenLog = tokenLogs.logs[0].content[0];
    const session = tokenLog.request?.body?.session?.id || '';
    verifyTokenLog(tokenLog, { session, card: card2 });

    await verifyPaymentMethods(page, {
      expectedCards: 2,
      cards: [
        { cardName: card1.name, fourDigits: fourDigits(card1), expiryMonth: card1.month, expiryYear: card1.year },
        { cardName: card2.name, fourDigits: fourDigits(card2), expiryMonth: card2.month, expiryYear: card2.year },
      ],
    });
  });

  // === MC-053: Session loading ===

  test('MC-053 - Session loading', async ({ page }) => {
    await frontendLogin(page, mcEmail, billing.password);
    await selectGatewayOnAddPaymentMethod(page, config);
    await assertSessionFieldsPresent(page, config);
  });

  // === MC-054: Not filling CC info ===
  // AUDIT 2026-04-29 vs GI: GI asserts the exact concatenated error text
  // "Card number invalid or missingExpiry month invalid or missingExpiry year
  // invalid or missing"; PW only checks any error visible. Tighten to match.

  test('MC-054 - Not filling CC info', async ({ page }) => {
    await frontendLogin(page, mcEmail, billing.password);
    await selectGatewayOnAddPaymentMethod(page, config);

    await page.locator('#place_order').first().click();
    await waitForUnblock(page);

    const error = page.locator('.woocommerce-error, .woocommerce-notices-wrapper .woocommerce-error, .wc-block-components-notice-banner.is-error');
    await expect(error.first()).toBeVisible({ timeout: 10000 });
  });

  // === MC-055: Invalid missing CC number ===
  // AUDIT 2026-04-29 vs GI: GI asserts ".woocommerce-error contains
  // 'Card number invalid or missing'"; PW asserts only generic error visible.

  test('MC-055 - Invalid missing CC number', async ({ page }) => {
    await frontendLogin(page, mcEmail, billing.password);
    await selectGatewayOnAddPaymentMethod(page, config);

    await fillHostedSessionCCPartial(page, config, {
      month: card1.month,
      year: card1.year,
      cvv: card1.cvv,
    });

    await page.locator('#place_order').first().click();
    await waitForUnblock(page);

    const error = page.locator('.woocommerce-error, .woocommerce-notices-wrapper .woocommerce-error, .wc-block-components-notice-banner.is-error');
    await expect(error.first()).toBeVisible({ timeout: 10000 });
  });

  // === MC-056: Invalid missing CVC ===
  // AUDIT 2026-04-29 vs GI: GI asserts "CVV invalid or missing"; PW asserts
  // only generic error visible. WC label may have changed to "Security code"
  // — confirm against current MPGS tokenizer output before tightening.

  test('MC-056 - Invalid missing CVC', async ({ page }) => {
    await frontendLogin(page, mcEmail, billing.password);
    await selectGatewayOnAddPaymentMethod(page, config);

    await fillHostedSessionCCPartial(page, config, {
      number: card1.number,
      month: card1.month,
      year: card1.year,
    });

    await page.locator('#place_order').first().click();
    await waitForUnblock(page);

    const error = page.locator('.woocommerce-error, .woocommerce-notices-wrapper .woocommerce-error, .wc-block-components-notice-banner.is-error');
    await expect(error.first()).toBeVisible({ timeout: 10000 });
  });

  // === MC-057: Invalid missing expiry month ===
  // AUDIT 2026-04-29 vs GI: GI asserts "Expiry month invalid or missing";
  // PW asserts only generic error visible. Tighten to match.

  test('MC-057 - Invalid missing expiry month', async ({ page }) => {
    await frontendLogin(page, mcEmail, billing.password);
    await selectGatewayOnAddPaymentMethod(page, config);

    await fillHostedSessionCCPartial(page, config, {
      number: card1.number,
      year: card1.year,
      cvv: card1.cvv,
    });

    await page.locator('#place_order').first().click();
    await waitForUnblock(page);

    const error = page.locator('.woocommerce-error, .woocommerce-notices-wrapper .woocommerce-error, .wc-block-components-notice-banner.is-error');
    await expect(error.first()).toBeVisible({ timeout: 10000 });
  });

  // === MC-058: Invalid missing expiry year ===
  // AUDIT 2026-04-29 vs GI: GI asserts "Expiry year invalid or missing";
  // PW asserts only generic error visible. Tighten to match.

  test('MC-058 - Invalid missing expiry year', async ({ page }) => {
    await frontendLogin(page, mcEmail, billing.password);
    await selectGatewayOnAddPaymentMethod(page, config);

    await fillHostedSessionCCPartial(page, config, {
      number: card1.number,
      month: card1.month,
      cvv: card1.cvv,
    });

    await page.locator('#place_order').first().click();
    await waitForUnblock(page);

    const error = page.locator('.woocommerce-error, .woocommerce-notices-wrapper .woocommerce-error, .wc-block-components-notice-banner.is-error');
    await expect(error.first()).toBeVisible({ timeout: 10000 });
  });

  // === MC-059: Delete payment method ===

  test('MC-059 - Delete payment method', async ({ page }) => {
    await frontendLogin(page, mcEmail, billing.password);

    await deletePaymentMethod(page, 1);
    await expect(page.locator('.woocommerce-message')).toContainText('Payment method deleted.');
    await verifyPaymentMethods(page, { expectedCards: 1 });

    await deletePaymentMethod(page, 1);
    await expect(page.locator('.woocommerce-message')).toContainText('Payment method deleted.');
    await verifyPaymentMethods(page, { expectedCards: 0 });
  });
});
