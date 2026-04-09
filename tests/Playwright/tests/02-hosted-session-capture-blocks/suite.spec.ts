import { test, expect } from '../../fixtures/test';
import { switchCheckoutMode, configureGateway, verifyOrderViaAPI } from '../../helpers/api';
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
import { verifyOrderReceived } from '../../helpers/order-received';
import {
  extractAllLogs,
  extractSessionPostLogs,
  extractSessionGetLogs,
  extractTokenLogs,
  verifySessionPost,
  verifySessionGet,
  verifyInitiateAuthentication,
  verifyAuthenticatePayer,
  verifyAuthorizeCaptureLog,
  verifyTokenLog,
  verifyTokenLogsEmpty,
} from '../../helpers/log-verification';
import { verifyOrderEmails } from '../../helpers/email-verification';
import { adminLogin, frontendLogin } from '../../helpers/wp-login';
import { navigateToOrder, assertOrderStatus, assertPaymentMethodMeta, assertCapturedNote } from '../../helpers/admin-orders';
import { verifyPaymentMethods, verifyOrderInMyAccount, verifyCartEmpty } from '../../helpers/my-account';
import config from '../../plugin-config';
import { cards, fourDigits } from '../../fixtures/cards';
import { billing, uniqueEmail } from '../../fixtures/billing';

test.describe.serial('Hosted Session - Capture - Blocks', () => {
  let orderNumber: string;
  const mc005Email = uniqueEmail();

  // Shared state per checkout test
  let payDate: string;
  let sessionDate: string;
  let session: string;
  let total: string;

  // === MC-004: Guest checkout ===

  test('MC-004 - Guest checkout', async ({ page }) => {
    await switchCheckoutMode('blocks');
    await configureGateway(config, {
      _3d_secure: 'yes',
      saved_cards: 'yes',
      transaction_mode: 'PURCHASE',
      checkout_mode: 'hosted_session',
    });

    payDate = await addToCartAndCheckout(page, config.products.physical);
    sessionDate = payDate;
    await fillBilling(page, billing);
    await selectPaymentMethod(page, config);
    await fillHostedSessionCC(page, cards.mastercard, config);

    // Guest should NOT see save card checkbox
    await expect(page.locator(`label[for="wc-${config.paymentMethodSlug}-new-payment-method"]`)).not.toBeVisible();

    total = await extractOrderTotal(page);
    session = await extractSessionId(page);

    await clickPlaceOrder(page);
    const result = await verifyOrderReceived(page, { displayName: config.displayName, expectedTotal: total });
    orderNumber = result.orderNumber;
    expect(orderNumber).toBeTruthy();
  });

  test('MC-004 - Guest checkout - Admin', async ({ page }) => {
    expect(orderNumber).toBeTruthy();

    // Phase 1: WC API verification
    const { order, transactionId } = await verifyOrderViaAPI(orderNumber, config);
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(order.payment_method_title).toBe(config.displayName);
    expect(transactionId).toBeTruthy();

    // Phase 2: Log extraction
    const allLogs = await extractAllLogs(payDate);
    const sessionPostLogs = await extractSessionPostLogs(payDate, sessionDate, '', '');
    const sessionGetLogs = await extractSessionGetLogs(payDate, session, payDate);
    const tokenLogs = await extractTokenLogs(payDate, payDate);

    // Phase 3: Verify session POST (find entry matching this order's session)
    if (sessionPostLogs.logs[0]?.content.length) {
      const sessionPostLog = session
        ? sessionPostLogs.logs[0].content.find((l: any) => l.response?.body?.session?.id === session)
        : sessionPostLogs.logs[0].content[0];
      if (sessionPostLog) {
        verifySessionPost(sessionPostLog, {
          session, total, currency: 'USD', transactionId: transactionId!, orderNumber,
        });
      }
    }

    // Verify session GET (UPDATE_SESSION PUT + GET card details)
    if (sessionGetLogs.logs[0]?.content.length) {
      const sessionGetLog = sessionGetLogs.logs[0].content[0];
      verifySessionGet(sessionGetLog, { session, card: cards.mastercard });

      // Card details are in the GET entry (content[1]) if available
      if (sessionGetLogs.logs[0].content.length > 1) {
        const { verifySessionGetCardDetails } = await import('../../helpers/log-verification');
        const sessionGetCardLog = sessionGetLogs.logs[0].content[1];
        verifySessionGetCardDetails(sessionGetCardLog, { session, card: cards.mastercard });
      }
    }

    // Phase 4: Token logs empty (guest)
    verifyTokenLogsEmpty(tokenLogs);

    // Phase 5-8: Auth + capture logs (filter by transaction ID to avoid cross-order matches)
    if (allLogs.logs[0]?.content.length) {
      const logContent = allLogs.logs[0].content;
      const txFilter = (l: any) => !transactionId || l.request?.url?.includes(transactionId);

      const initiateAuthLog = logContent.find(
        (l: any) => l.request?.body?.apiOperation === 'INITIATE_AUTHENTICATION' && txFilter(l)
      );
      if (initiateAuthLog) {
        verifyInitiateAuthentication(initiateAuthLog, {
          session, card: cards.mastercard, transactionId: transactionId!, currency: 'USD',
        });
      }

      const authenticatePayerLog = logContent.find(
        (l: any) => l.request?.body?.apiOperation === 'AUTHENTICATE_PAYER' && txFilter(l)
      );
      if (authenticatePayerLog) {
        verifyAuthenticatePayer(authenticatePayerLog, {
          session, transactionId: transactionId!, currency: 'USD', card: cards.mastercard,
        });
      }

      const captureLog = logContent.find(
        (l: any) => l.request?.body?.apiOperation === 'PAY' && txFilter(l) && txFilter(l)
      );
      if (captureLog) {
        verifyAuthorizeCaptureLog(captureLog, {
          apiOperation: 'PAY', session, total, currency: 'USD',
          transactionId: transactionId!, orderNumber, card: cards.mastercard,
        });
      }
    }

    // Phase 11: Email verification (admin + customer for capture)
    await verifyOrderEmails(orderNumber, { paymentMethodTitle: config.displayName });

    // Phase 12: Admin backend check
    await adminLogin(page);
    await navigateToOrder(page, orderNumber);
    await assertOrderStatus(page, 'Processing');
    await assertPaymentMethodMeta(page, config, transactionId);
    await assertCapturedNote(page, config, transactionId!);

    // Phase 13: Guest has no account, verify cart empty
    await verifyCartEmpty(page);
  });

  // === MC-005: New user, NOT saving CC ===

  test('MC-005 - New user not saving CC', async ({ page }) => {
    payDate = await addToCartAndCheckout(page, config.products.digital);
    sessionDate = payDate;
    await fillBilling(page, { ...billing, email: mc005Email });
    await createAccountAtCheckout(page, billing.password);
    await selectPaymentMethod(page, config);
    await fillHostedSessionCC(page, cards.mastercard, config);

    total = await extractOrderTotal(page);
    session = await extractSessionId(page);

    await clickPlaceOrder(page);
    const result = await verifyOrderReceived(page, { displayName: config.displayName, expectedTotal: total });
    orderNumber = result.orderNumber;
    expect(orderNumber).toBeTruthy();
  });

  test('MC-005 - New user not saving CC - Admin', async ({ page }) => {
    expect(orderNumber).toBeTruthy();

    // Phase 1: WC API verification
    const { order, transactionId } = await verifyOrderViaAPI(orderNumber, config);
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(transactionId).toBeTruthy();

    // Phase 2: Log extraction
    const allLogs = await extractAllLogs(payDate);
    const sessionPostLogs = await extractSessionPostLogs(payDate, sessionDate, '', '');
    const sessionGetLogs = await extractSessionGetLogs(payDate, session, payDate);
    const tokenLogs = await extractTokenLogs(payDate, payDate);

    // Phase 3: Verify session POST (find entry matching this order's session)
    if (sessionPostLogs.logs[0]?.content.length) {
      const sessionPostLog = session
        ? sessionPostLogs.logs[0].content.find((l: any) => l.response?.body?.session?.id === session)
        : sessionPostLogs.logs[0].content[0];
      if (sessionPostLog) {
        verifySessionPost(sessionPostLog, {
          session, total, currency: 'USD', transactionId: transactionId!, orderNumber,
        });
      }
    }

    if (sessionGetLogs.logs[0]?.content.length) {
      const sessionGetLog = sessionGetLogs.logs[0].content[0];
      verifySessionGet(sessionGetLog, { session, card: cards.mastercard });
    }

    // Phase 4: Token empty (not saving)
    verifyTokenLogsEmpty(tokenLogs);

    // Phase 5-8 (filter by transaction ID to avoid cross-order matches)
    if (allLogs.logs[0]?.content.length) {
      const logContent = allLogs.logs[0].content;
      const txFilter = (l: any) => !transactionId || l.request?.url?.includes(transactionId);

      const initiateAuthLog = logContent.find(
        (l: any) => l.request?.body?.apiOperation === 'INITIATE_AUTHENTICATION' && txFilter(l)
      );
      if (initiateAuthLog) {
        verifyInitiateAuthentication(initiateAuthLog, {
          session, card: cards.mastercard, transactionId: transactionId!, currency: 'USD',
        });
      }

      const authenticatePayerLog = logContent.find(
        (l: any) => l.request?.body?.apiOperation === 'AUTHENTICATE_PAYER' && txFilter(l)
      );
      if (authenticatePayerLog) {
        verifyAuthenticatePayer(authenticatePayerLog, {
          session, transactionId: transactionId!, currency: 'USD', card: cards.mastercard,
        });
      }

      const captureLog = logContent.find(
        (l: any) => l.request?.body?.apiOperation === 'PAY' && txFilter(l) && txFilter(l)
      );
      if (captureLog) {
        verifyAuthorizeCaptureLog(captureLog, {
          apiOperation: 'PAY', session, total, currency: 'USD',
          transactionId: transactionId!, orderNumber, card: cards.mastercard,
        });
      }
    }

    // Phase 11: Email verification
    await verifyOrderEmails(orderNumber, { paymentMethodTitle: config.displayName });

    // Phase 12: Admin backend check
    await adminLogin(page);
    await navigateToOrder(page, orderNumber);
    await assertOrderStatus(page, 'Processing');
    await assertPaymentMethodMeta(page, config, transactionId);
    await assertCapturedNote(page, config, transactionId!);

    // Phase 13: My Account — 0 saved cards
    await frontendLogin(page, mc005Email, billing.password);
    await verifyPaymentMethods(page, { expectedCards: 0 });
    await verifyOrderInMyAccount(page, orderNumber, 'Processing', { expectedTotal: total, displayName: config.displayName });
    await verifyCartEmpty(page);
  });

  // === MC-008: Logged user, pay with new CC (not saving) ===

  test('MC-008 - Logged user pay with new CC', async ({ page }) => {
    await frontendLogin(page, mc005Email, billing.password);
    payDate = await addToCartAndCheckout(page, config.products.physical);
    sessionDate = payDate;
    await selectPaymentMethod(page, config, true); // useNewToken = true
    await fillHostedSessionCC(page, cards.mastercard, config);

    total = await extractOrderTotal(page);
    session = await extractSessionId(page);

    await clickPlaceOrder(page);
    const result = await verifyOrderReceived(page, { displayName: config.displayName, expectedTotal: total });
    orderNumber = result.orderNumber;
    expect(orderNumber).toBeTruthy();
  });

  test('MC-008 - Logged user pay with new CC - Admin', async ({ page }) => {
    expect(orderNumber).toBeTruthy();

    // Phase 1: WC API verification
    const { order, transactionId } = await verifyOrderViaAPI(orderNumber, config);
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(transactionId).toBeTruthy();

    // Phase 2: Log extraction
    const allLogs = await extractAllLogs(payDate);
    const sessionPostLogs = await extractSessionPostLogs(payDate, sessionDate, '', '');
    const sessionGetLogs = await extractSessionGetLogs(payDate, session, payDate);
    const tokenLogs = await extractTokenLogs(payDate, payDate);

    // Phase 3 (find entry matching this order's session)
    if (sessionPostLogs.logs[0]?.content.length) {
      const sessionPostLog = session
        ? sessionPostLogs.logs[0].content.find((l: any) => l.response?.body?.session?.id === session)
        : sessionPostLogs.logs[0].content[0];
      if (sessionPostLog) {
        verifySessionPost(sessionPostLog, {
          session, total, currency: 'USD', transactionId: transactionId!, orderNumber,
        });
      }
    }

    if (sessionGetLogs.logs[0]?.content.length) {
      const sessionGetLog = sessionGetLogs.logs[0].content[0];
      verifySessionGet(sessionGetLog, { session, card: cards.mastercard });
    }

    verifyTokenLogsEmpty(tokenLogs);

    // Phase 5-8 (filter by transaction ID to avoid cross-order matches)
    if (allLogs.logs[0]?.content.length) {
      const logContent = allLogs.logs[0].content;
      const txFilter = (l: any) => !transactionId || l.request?.url?.includes(transactionId);

      const initiateAuthLog = logContent.find(
        (l: any) => l.request?.body?.apiOperation === 'INITIATE_AUTHENTICATION' && txFilter(l)
      );
      if (initiateAuthLog) {
        verifyInitiateAuthentication(initiateAuthLog, {
          session, card: cards.mastercard, transactionId: transactionId!, currency: 'USD',
        });
      }

      const captureLog = logContent.find(
        (l: any) => l.request?.body?.apiOperation === 'PAY' && txFilter(l)
      );
      if (captureLog) {
        verifyAuthorizeCaptureLog(captureLog, {
          apiOperation: 'PAY', session, total, currency: 'USD',
          transactionId: transactionId!, orderNumber, card: cards.mastercard,
        });
      }
    }

    // Phase 11: Email verification
    await verifyOrderEmails(orderNumber, { paymentMethodTitle: config.displayName });

    // Phase 12: Admin backend check
    await adminLogin(page);
    await navigateToOrder(page, orderNumber);
    await assertOrderStatus(page, 'Processing');
    await assertPaymentMethodMeta(page, config, transactionId);
    await assertCapturedNote(page, config, transactionId!);

    // Phase 13: My Account — still 0 saved cards
    await frontendLogin(page, mc005Email, billing.password);
    await verifyPaymentMethods(page, { expectedCards: 0 });
    await verifyOrderInMyAccount(page, orderNumber, 'Processing', { expectedTotal: total, displayName: config.displayName });
    await verifyCartEmpty(page);
  });

  // === MC-009: Logged user, pay with new CC and save it ===

  test('MC-009 - Logged user pay with new CC and save it', async ({ page }) => {
    await frontendLogin(page, mc005Email, billing.password);
    payDate = await addToCartAndCheckout(page, config.products.physical);
    sessionDate = payDate;
    await selectPaymentMethod(page, config, true); // useNewToken = true
    await fillHostedSessionCC(page, cards.mastercard, config);
    await clickSaveCardCheckbox(page);

    total = await extractOrderTotal(page);
    session = await extractSessionId(page);

    await clickPlaceOrder(page);
    const result = await verifyOrderReceived(page, { displayName: config.displayName, expectedTotal: total });
    orderNumber = result.orderNumber;
    expect(orderNumber).toBeTruthy();
  });

  test('MC-009 - Logged user pay with new CC and save it - Admin', async ({ page }) => {
    expect(orderNumber).toBeTruthy();

    // Phase 1: WC API verification
    const { order, transactionId } = await verifyOrderViaAPI(orderNumber, config);
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(transactionId).toBeTruthy();

    // Phase 2: Log extraction
    const allLogs = await extractAllLogs(payDate);
    const sessionPostLogs = await extractSessionPostLogs(payDate, sessionDate, '', '');
    const sessionGetLogs = await extractSessionGetLogs(payDate, session, payDate);
    const tokenLogs = await extractTokenLogs(payDate, payDate);

    // Phase 3 (find entry matching this order's session)
    if (sessionPostLogs.logs[0]?.content.length) {
      const sessionPostLog = session
        ? sessionPostLogs.logs[0].content.find((l: any) => l.response?.body?.session?.id === session)
        : sessionPostLogs.logs[0].content[0];
      if (sessionPostLog) {
        verifySessionPost(sessionPostLog, {
          session, total, currency: 'USD', transactionId: transactionId!, orderNumber,
        });
      }
    }

    if (sessionGetLogs.logs[0]?.content.length) {
      const sessionGetLog = sessionGetLogs.logs[0].content[0];
      verifySessionGet(sessionGetLog, { session, card: cards.mastercard });
    }

    // Phase 4: Token present (saving CC)
    if (tokenLogs.logs[0]?.content.length) {
      const tokenLog = tokenLogs.logs[0].content[0];
      verifyTokenLog(tokenLog, { session, card: cards.mastercard });
    }

    // Phase 5-8 (filter by transaction ID to avoid cross-order matches)
    if (allLogs.logs[0]?.content.length) {
      const logContent = allLogs.logs[0].content;
      const txFilter = (l: any) => !transactionId || l.request?.url?.includes(transactionId);

      const initiateAuthLog = logContent.find(
        (l: any) => l.request?.body?.apiOperation === 'INITIATE_AUTHENTICATION' && txFilter(l)
      );
      if (initiateAuthLog) {
        verifyInitiateAuthentication(initiateAuthLog, {
          session, card: cards.mastercard, transactionId: transactionId!, currency: 'USD',
        });
      }

      const captureLog = logContent.find(
        (l: any) => l.request?.body?.apiOperation === 'PAY' && txFilter(l)
      );
      if (captureLog) {
        verifyAuthorizeCaptureLog(captureLog, {
          apiOperation: 'PAY', session, total, currency: 'USD',
          transactionId: transactionId!, orderNumber, card: cards.mastercard,
        });
      }
    }

    // Phase 11: Email verification
    await verifyOrderEmails(orderNumber, { paymentMethodTitle: config.displayName });

    // Phase 12: Admin backend check
    await adminLogin(page);
    await navigateToOrder(page, orderNumber);
    await assertOrderStatus(page, 'Processing');
    await assertPaymentMethodMeta(page, config, transactionId);
    await assertCapturedNote(page, config, transactionId!);

    // Phase 13: My Account — 1 saved card
    await frontendLogin(page, mc005Email, billing.password);
    await verifyPaymentMethods(page, {
      expectedCards: 1,
      cardName: cards.mastercard.name,
      fourDigits: fourDigits(cards.mastercard),
      expiryMonth: cards.mastercard.month,
      expiryYear: cards.mastercard.year,
    });
    await verifyOrderInMyAccount(page, orderNumber, 'Processing', { expectedTotal: total, displayName: config.displayName });
    await verifyCartEmpty(page);
  });

  // === MC-010: Logged user, pay with saved CC (from MC-009) ===

  test('MC-010 - Logged user pay with saved CC', async ({ page }) => {
    await frontendLogin(page, mc005Email, billing.password);
    payDate = await addToCartAndCheckout(page, config.products.physical);
    sessionDate = payDate;
    await selectPaymentMethod(page, config);
    await selectSavedToken(page, 1);

    total = await extractOrderTotal(page);
    session = await extractSessionId(page);

    await clickPlaceOrder(page);
    const result = await verifyOrderReceived(page, { displayName: config.displayName, expectedTotal: total });
    orderNumber = result.orderNumber;
    expect(orderNumber).toBeTruthy();
  });

  test('MC-010 - Logged user pay with saved CC - Admin', async ({ page }) => {
    expect(orderNumber).toBeTruthy();

    // Phase 1: WC API verification
    const { order, transactionId } = await verifyOrderViaAPI(orderNumber, config);
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(transactionId).toBeTruthy();

    // Phase 2: Log extraction
    const allLogs = await extractAllLogs(payDate);
    const sessionGetLogs = await extractSessionGetLogs(payDate, session, payDate);
    const tokenLogs = await extractTokenLogs(payDate, payDate);

    // Verify session GET (saved card)
    if (sessionGetLogs.logs[0]?.content.length) {
      const sessionGetLog = sessionGetLogs.logs[0].content[0];
      verifySessionGet(sessionGetLog, { session, card: cards.mastercard });
    }

    // No new token (using saved CC)
    verifyTokenLogsEmpty(tokenLogs);

    // Phase 5-8 (filter by transaction ID to avoid cross-order matches)
    if (allLogs.logs[0]?.content.length) {
      const logContent = allLogs.logs[0].content;
      const txFilter = (l: any) => !transactionId || l.request?.url?.includes(transactionId);

      const initiateAuthLog = logContent.find(
        (l: any) => l.request?.body?.apiOperation === 'INITIATE_AUTHENTICATION' && txFilter(l)
      );
      if (initiateAuthLog) {
        verifyInitiateAuthentication(initiateAuthLog, {
          session, card: cards.mastercard, transactionId: transactionId!, currency: 'USD',
        });
      }

      const captureLog = logContent.find(
        (l: any) => l.request?.body?.apiOperation === 'PAY' && txFilter(l)
      );
      if (captureLog) {
        verifyAuthorizeCaptureLog(captureLog, {
          apiOperation: 'PAY', session, total, currency: 'USD',
          transactionId: transactionId!, orderNumber, card: cards.mastercard,
        });
      }
    }

    // Phase 11: Email verification
    await verifyOrderEmails(orderNumber, { paymentMethodTitle: config.displayName });

    // Phase 12: Admin backend check
    await adminLogin(page);
    await navigateToOrder(page, orderNumber);
    await assertOrderStatus(page, 'Processing');
    await assertPaymentMethodMeta(page, config, transactionId);
    await assertCapturedNote(page, config, transactionId!);

    // Phase 13: My Account — still 1 card
    await frontendLogin(page, mc005Email, billing.password);
    await verifyPaymentMethods(page, {
      expectedCards: 1,
      cardName: cards.mastercard.name,
      fourDigits: fourDigits(cards.mastercard),
      expiryMonth: cards.mastercard.month,
      expiryYear: cards.mastercard.year,
    });
    await verifyOrderInMyAccount(page, orderNumber, 'Processing', { expectedTotal: total, displayName: config.displayName });
    await verifyCartEmpty(page);
  });
});
