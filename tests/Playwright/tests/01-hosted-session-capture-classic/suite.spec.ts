import { test, expect } from '../../fixtures/test';
import { Page } from '@playwright/test';
import { switchCheckoutMode, configureGateway, verifyOrderViaAPI, getLogEntryCount } from '../../helpers/wc-api';
import { addToCartAndCheckout } from '../../helpers/cart';
import {
  fillBilling,
  selectPaymentMethod,
  clickPlaceOrder,
  extractOrderTotal,
  extractSessionId,
  createAccountAtCheckout,
  clickSaveCardCheckbox,
  selectSavedToken,
} from '../../helpers/checkout';
import { fillHostedSessionCC } from '../../helpers/hosted-session';
import { collectOrderReceivedData } from '../../helpers/flows';
import { handle3DSChallenge } from '../../helpers/three-ds';
import {
  assertCaptureLogTrail,
  expectedOrderStatus,
  verifyOrderEmails,
  assertOrderStatus,
  assertPaymentMethodMeta,
  assertCapturedNote,
  assertOrderReceived,
  verifyPaymentMethods,
  verifyOrderInMyAccount,
  verifyCartEmpty,
} from '../../helpers/assertions';
import { adminLogin, frontendLogin } from '../../helpers/wp-login';
import { navigateToOrder } from '../../helpers/admin-orders';
import config from '../../plugin-config';
import { cards, fourDigits } from '../../fixtures/cards';
import { billing, uniqueEmail } from '../../fixtures/billing';

test.describe.serial('Hosted Session - Capture - Classic', () => {
  let orderNumber: string;
  const mc005Email = uniqueEmail();
  const mc006Email = uniqueEmail();

  // Shared state per checkout test
  let payDate: string;
  let session: string;
  let total: string;
  let logOffset: number;

  // Shared admin browser context
  let adminPage: Page;

  test.beforeAll(async ({ browser }) => {
    const adminContext = await browser.newContext({ ignoreHTTPSErrors: true });
    adminPage = await adminContext.newPage();
    await adminLogin(adminPage);
  });

  test.afterAll(async () => {
    await adminPage.close();
  });

  // === MC-004: Guest checkout ===

  test('MC-004 - Guest checkout', async ({ page }) => {
    // === CHECKOUT (buyer's page) ===
    await switchCheckoutMode('classic');
    await configureGateway(config, {
      _3d_secure: 'yes',
      saved_cards: 'yes',
      transaction_mode: 'PURCHASE',
      checkout_mode: 'hosted_session',
    });

    logOffset = await getLogEntryCount(new Date().toISOString().slice(0, 19));
    payDate = await addToCartAndCheckout(page, config.products.physical);
    await fillBilling(page, billing);
    await selectPaymentMethod(page, config);
    await fillHostedSessionCC(page, cards.mastercard, config);

    // Guest should NOT see save card checkbox
    await expect(page.locator(`label[for="wc-${config.paymentMethodSlug}-new-payment-method"]`)).not.toBeVisible();

    total = await extractOrderTotal(page);
    session = await extractSessionId(page);

    await clickPlaceOrder(page);
    const result = await collectOrderReceivedData(page);
    await assertOrderReceived(page, { displayName: config.displayName, expectedTotal: total }, result);
    orderNumber = result.orderNumber;
    expect(orderNumber).toBeTruthy();

    // Guest cart should be empty after successful checkout
    await verifyCartEmpty(page);

    // === API VERIFICATION ===
    const { order, transactionId } = await verifyOrderViaAPI(orderNumber, config);
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(order.payment_method_title).toBe(config.displayName);
    expect(transactionId).toBeTruthy();

    // === LOG VERIFICATION ===
    await assertCaptureLogTrail({
      payDate, logOffset, session, total,
      transactionId: transactionId!, orderNumber, card: cards.mastercard,
      expectSessionPost: true, expectToken: false, expectCardDetailsFetch: true,
    });

    // === EMAIL VERIFICATION ===
    await verifyOrderEmails(orderNumber, { paymentMethodTitle: config.displayName });

    // === ADMIN BACKEND (admin page) ===
    await navigateToOrder(adminPage, orderNumber);
    await assertOrderStatus(adminPage, 'Processing');
    await assertPaymentMethodMeta(adminPage, config, transactionId);
    await assertCapturedNote(adminPage, config, transactionId!);
  });

  // === MC-005: New user, NOT saving CC ===

  test('MC-005 - New user not saving CC', async ({ page }) => {
    // === CHECKOUT (buyer's page) ===
    logOffset = await getLogEntryCount(new Date().toISOString().slice(0, 19));
    payDate = await addToCartAndCheckout(page, config.products.digital);
    await fillBilling(page, { ...billing, email: mc005Email });
    await createAccountAtCheckout(page, billing.password);
    await selectPaymentMethod(page, config);
    await fillHostedSessionCC(page, cards.mastercard, config);

    total = await extractOrderTotal(page);
    session = await extractSessionId(page);

    await clickPlaceOrder(page);
    const result = await collectOrderReceivedData(page);
    await assertOrderReceived(page, { displayName: config.displayName, expectedTotal: total }, result);
    orderNumber = result.orderNumber;
    expect(orderNumber).toBeTruthy();

    // Cart should be empty after successful checkout
    await verifyCartEmpty(page);

    // === API VERIFICATION ===
    const { order, transactionId } = await verifyOrderViaAPI(orderNumber, config);
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(transactionId).toBeTruthy();

    // === LOG VERIFICATION ===
    await assertCaptureLogTrail({
      payDate, logOffset, session, total,
      transactionId: transactionId!, orderNumber, card: cards.mastercard,
      expectSessionPost: true, expectToken: false, expectCardDetailsFetch: true,
    });

    // === EMAIL VERIFICATION ===
    await verifyOrderEmails(orderNumber, { paymentMethodTitle: config.displayName });

    // === ADMIN BACKEND (admin page) ===
    // Digital product: WooCommerce auto-completes it, so GI expects Completed.
    const mc005Status = expectedOrderStatus({ product: 'download', transaction: 'capture' });
    await navigateToOrder(adminPage, orderNumber);
    await assertOrderStatus(adminPage, mc005Status);
    await assertPaymentMethodMeta(adminPage, config, transactionId);
    await assertCapturedNote(adminPage, config, transactionId!);

    // === MY ACCOUNT (buyer's page) — 0 saved cards ===
    await frontendLogin(page, mc005Email, billing.password);
    await verifyPaymentMethods(page, { expectedCards: 0 });
    await verifyOrderInMyAccount(page, orderNumber, mc005Status, { expectedTotal: total, displayName: config.displayName });
  });

  // === MC-006: New user, saving CC ===

  test('MC-006 - New user saving CC', async ({ page }) => {
    // === CHECKOUT (buyer's page) ===
    logOffset = await getLogEntryCount(new Date().toISOString().slice(0, 19));
    payDate = await addToCartAndCheckout(page, config.products.digital);
    await fillBilling(page, { ...billing, email: mc006Email });
    await createAccountAtCheckout(page, billing.password);
    await selectPaymentMethod(page, config);
    await fillHostedSessionCC(page, cards.mastercard, config);
    await clickSaveCardCheckbox(page);

    total = await extractOrderTotal(page);
    session = await extractSessionId(page);

    await clickPlaceOrder(page);
    const result = await collectOrderReceivedData(page);
    await assertOrderReceived(page, { displayName: config.displayName, expectedTotal: total }, result);
    orderNumber = result.orderNumber;
    expect(orderNumber).toBeTruthy();

    await verifyCartEmpty(page);

    // === API VERIFICATION ===
    const { order, transactionId } = await verifyOrderViaAPI(orderNumber, config);
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(transactionId).toBeTruthy();

    // === LOG VERIFICATION ===
    await assertCaptureLogTrail({
      payDate, logOffset, session, total,
      transactionId: transactionId!, orderNumber, card: cards.mastercard,
      expectSessionPost: true, expectToken: true, expectCardDetailsFetch: true,
    });

    // === EMAIL VERIFICATION ===
    await verifyOrderEmails(orderNumber, { paymentMethodTitle: config.displayName });

    // === ADMIN BACKEND (admin page) ===
    // Digital product: WooCommerce auto-completes it, so GI expects Completed.
    const mc006Status = expectedOrderStatus({ product: 'download', transaction: 'capture' });
    await navigateToOrder(adminPage, orderNumber);
    await assertOrderStatus(adminPage, mc006Status);
    await assertPaymentMethodMeta(adminPage, config, transactionId);
    await assertCapturedNote(adminPage, config, transactionId!);

    // === MY ACCOUNT (buyer's page) — 1 saved card ===
    await frontendLogin(page, mc006Email, billing.password);
    await verifyPaymentMethods(page, {
      expectedCards: 1,
      cardName: cards.mastercard.name,
      fourDigits: fourDigits(cards.mastercard),
      expiryMonth: cards.mastercard.month,
      expiryYear: cards.mastercard.year,
    });
    await verifyOrderInMyAccount(page, orderNumber, mc006Status, { expectedTotal: total, displayName: config.displayName });
  });

  // === MC-007: Logged user, pay with saved CC ===
  // AUDIT 2026-04-29 vs GI: JUSTIFIED FIX — saved-token path skips
  // `verifySessionGetCardDetails` (saved-token flow doesn't fetch card
  // details from MPGS — token references the card, no GET /session/{id}
  // for fresh card data).

  test('MC-007 - Logged user pay with saved CC', async ({ page }) => {
    // === CHECKOUT (buyer's page) ===
    await frontendLogin(page, mc006Email, billing.password);
    logOffset = await getLogEntryCount(new Date().toISOString().slice(0, 19));
    payDate = await addToCartAndCheckout(page, config.products.physical);
    await selectPaymentMethod(page, config);
    await selectSavedToken(page, 1);

    total = await extractOrderTotal(page);
    session = await extractSessionId(page);

    await clickPlaceOrder(page);
    const result = await collectOrderReceivedData(page);
    await assertOrderReceived(page, { displayName: config.displayName, expectedTotal: total }, result);
    orderNumber = result.orderNumber;
    expect(orderNumber).toBeTruthy();

    await verifyCartEmpty(page);

    // === API VERIFICATION ===
    const { order, transactionId } = await verifyOrderViaAPI(orderNumber, config);
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(transactionId).toBeTruthy();

    // === LOG VERIFICATION ===
    // Saved-token path: no new session POST, no card-details GET; the session
    // may be empty in the DOM, so the composite derives it from the PUT log.
    await assertCaptureLogTrail({
      payDate, logOffset, session, total,
      transactionId: transactionId!, orderNumber, card: cards.mastercard,
      expectSessionPost: false, expectToken: false, expectCardDetailsFetch: false,
    });

    // === EMAIL VERIFICATION ===
    await verifyOrderEmails(orderNumber, { paymentMethodTitle: config.displayName });

    // === ADMIN BACKEND (admin page) ===
    await navigateToOrder(adminPage, orderNumber);
    await assertOrderStatus(adminPage, 'Processing');
    await assertPaymentMethodMeta(adminPage, config, transactionId);
    await assertCapturedNote(adminPage, config, transactionId!);

    // === MY ACCOUNT (buyer's page) — still 1 card ===
    await frontendLogin(page, mc006Email, billing.password);
    await verifyPaymentMethods(page, {
      expectedCards: 1,
      cardName: cards.mastercard.name,
      fourDigits: fourDigits(cards.mastercard),
      expiryMonth: cards.mastercard.month,
      expiryYear: cards.mastercard.year,
    });
    await verifyOrderInMyAccount(page, orderNumber, 'Processing', { expectedTotal: total, displayName: config.displayName });
  });

  // === MC-008: Logged user, pay with new CC (not saving) ===

  test('MC-008 - Logged user pay with new CC', async ({ page }) => {
    // === CHECKOUT (buyer's page) ===
    await frontendLogin(page, mc006Email, billing.password);
    logOffset = await getLogEntryCount(new Date().toISOString().slice(0, 19));
    payDate = await addToCartAndCheckout(page, config.products.physical);
    await selectPaymentMethod(page, config, true); // useNewToken = true
    await fillHostedSessionCC(page, cards.mastercard2, config);

    total = await extractOrderTotal(page);
    session = await extractSessionId(page);

    await clickPlaceOrder(page);
    const result = await collectOrderReceivedData(page);
    await assertOrderReceived(page, { displayName: config.displayName, expectedTotal: total }, result);
    orderNumber = result.orderNumber;
    expect(orderNumber).toBeTruthy();

    await verifyCartEmpty(page);

    // === API VERIFICATION ===
    const { order, transactionId } = await verifyOrderViaAPI(orderNumber, config);
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(transactionId).toBeTruthy();

    // === LOG VERIFICATION ===
    await assertCaptureLogTrail({
      payDate, logOffset, session, total,
      transactionId: transactionId!, orderNumber, card: cards.mastercard2,
      expectSessionPost: true, expectToken: false, expectCardDetailsFetch: true,
    });

    // === EMAIL VERIFICATION ===
    await verifyOrderEmails(orderNumber, { paymentMethodTitle: config.displayName });

    // === ADMIN BACKEND (admin page) ===
    await navigateToOrder(adminPage, orderNumber);
    await assertOrderStatus(adminPage, 'Processing');
    await assertPaymentMethodMeta(adminPage, config, transactionId);
    await assertCapturedNote(adminPage, config, transactionId!);

    // === MY ACCOUNT (buyer's page) — still 1 card (didn't save new one) ===
    await frontendLogin(page, mc006Email, billing.password);
    await verifyPaymentMethods(page, {
      expectedCards: 1,
      cardName: cards.mastercard.name,
      fourDigits: fourDigits(cards.mastercard),
      expiryMonth: cards.mastercard.month,
      expiryYear: cards.mastercard.year,
    });
    await verifyOrderInMyAccount(page, orderNumber, 'Processing', { expectedTotal: total, displayName: config.displayName });
  });

  // === MC-009: Logged user, pay with new CC and save it ===

  // AUDIT 2026-04-29 vs GI: JUSTIFIED FIX — challenge card adds
  // `handle3DSChallenge` + `AUTHENTICATION_SUCCESSFUL` log probe (GI's
  // shared-step library handles this conditionally; PW makes it explicit).
  test('MC-009 - Logged user pay with new CC and save it', async ({ page }) => {
    // === CHECKOUT (buyer's page) ===
    await frontendLogin(page, mc006Email, billing.password);
    logOffset = await getLogEntryCount(new Date().toISOString().slice(0, 19));
    payDate = await addToCartAndCheckout(page, config.products.physical);
    await selectPaymentMethod(page, config, true); // useNewToken = true
    await fillHostedSessionCC(page, cards.mastercard3, config);
    await clickSaveCardCheckbox(page);

    total = await extractOrderTotal(page);
    session = await extractSessionId(page);

    await clickPlaceOrder(page);
    await handle3DSChallenge(page);
    const result = await collectOrderReceivedData(page);
    await assertOrderReceived(page, { displayName: config.displayName, expectedTotal: total }, result);
    orderNumber = result.orderNumber;
    expect(orderNumber).toBeTruthy();

    await verifyCartEmpty(page);

    // === API VERIFICATION ===
    const { order, transactionId } = await verifyOrderViaAPI(orderNumber, config);
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(transactionId).toBeTruthy();

    // === LOG VERIFICATION ===
    await assertCaptureLogTrail({
      payDate, logOffset, session, total,
      transactionId: transactionId!, orderNumber, card: cards.mastercard3,
      expectSessionPost: true, expectToken: true, expectCardDetailsFetch: true,
    });

    // === EMAIL VERIFICATION ===
    await verifyOrderEmails(orderNumber, { paymentMethodTitle: config.displayName });

    // === ADMIN BACKEND (admin page) ===
    await navigateToOrder(adminPage, orderNumber);
    await assertOrderStatus(adminPage, 'Processing');
    await assertPaymentMethodMeta(adminPage, config, transactionId);
    await assertCapturedNote(adminPage, config, transactionId!);

    // === MY ACCOUNT (buyer's page) — 2 cards (MC-006 saved + MC-009 saved) ===
    await frontendLogin(page, mc006Email, billing.password);
    await verifyPaymentMethods(page, {
      expectedCards: 2,
      cards: [
        { cardName: cards.mastercard.name, fourDigits: fourDigits(cards.mastercard), expiryMonth: cards.mastercard.month, expiryYear: cards.mastercard.year },
        { cardName: cards.mastercard3.name, fourDigits: fourDigits(cards.mastercard3), expiryMonth: cards.mastercard3.month, expiryYear: cards.mastercard3.year },
      ],
    });
    await verifyOrderInMyAccount(page, orderNumber, 'Processing', { expectedTotal: total, displayName: config.displayName });
  });

  // === MC-010: Logged user, pay with second saved CC ===

  // AUDIT 2026-04-29 vs GI: JUSTIFIED FIX — saved-token of a challenge card
  // skips `verifySessionGetCardDetails` (saved-token path) and adds
  // conditional 3DS handling (challenge token MAY re-challenge per issuer).
  test('MC-010 - Logged user pay with second saved CC', async ({ page }) => {
    // === CHECKOUT (buyer's page) ===
    await frontendLogin(page, mc006Email, billing.password);
    logOffset = await getLogEntryCount(new Date().toISOString().slice(0, 19));
    payDate = await addToCartAndCheckout(page, config.products.physical);
    await selectPaymentMethod(page, config);
    await selectSavedToken(page, 2);

    total = await extractOrderTotal(page);
    session = await extractSessionId(page);

    await clickPlaceOrder(page);
    if (/acs|3ds|threedsecure|mastercard\.com.*prompt/i.test(page.url())) {
      await handle3DSChallenge(page);
    }
    const result = await collectOrderReceivedData(page);
    await assertOrderReceived(page, { displayName: config.displayName, expectedTotal: total }, result);
    orderNumber = result.orderNumber;
    expect(orderNumber).toBeTruthy();

    await verifyCartEmpty(page);

    // === API VERIFICATION ===
    const { order, transactionId } = await verifyOrderViaAPI(orderNumber, config);
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(transactionId).toBeTruthy();

    // === LOG VERIFICATION ===
    // Saved-token path: no new session POST, no card-details GET; the session
    // may be empty in the DOM, so the composite derives it from the PUT log.
    await assertCaptureLogTrail({
      payDate, logOffset, session, total,
      transactionId: transactionId!, orderNumber, card: cards.mastercard3,
      expectSessionPost: false, expectToken: false, expectCardDetailsFetch: false,
    });

    // === EMAIL VERIFICATION ===
    await verifyOrderEmails(orderNumber, { paymentMethodTitle: config.displayName });

    // === ADMIN BACKEND (admin page) ===
    await navigateToOrder(adminPage, orderNumber);
    await assertOrderStatus(adminPage, 'Processing');
    await assertPaymentMethodMeta(adminPage, config, transactionId);
    await assertCapturedNote(adminPage, config, transactionId!);

    // === MY ACCOUNT (buyer's page) — still 2 cards ===
    await frontendLogin(page, mc006Email, billing.password);
    await verifyPaymentMethods(page, {
      expectedCards: 2,
      cards: [
        { cardName: cards.mastercard.name, fourDigits: fourDigits(cards.mastercard), expiryMonth: cards.mastercard.month, expiryYear: cards.mastercard.year },
        { cardName: cards.mastercard3.name, fourDigits: fourDigits(cards.mastercard3), expiryMonth: cards.mastercard3.month, expiryYear: cards.mastercard3.year },
      ],
    });
    await verifyOrderInMyAccount(page, orderNumber, 'Processing', { expectedTotal: total, displayName: config.displayName });
  });
});
