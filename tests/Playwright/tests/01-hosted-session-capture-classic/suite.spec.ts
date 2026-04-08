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
  verifyAuthenticationResult,
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

test.describe.serial('Hosted Session - Capture - Classic', () => {
  let orderNumber: string;
  const mc005Email = uniqueEmail();
  const mc006Email = uniqueEmail();

  // Shared state per checkout test
  let payDate: string;
  let sessionDate: string;
  let session: string;
  let total: string;

  // === MC-004: Guest checkout ===

  test('MC-004 - Guest checkout', async ({ page }) => {
    await switchCheckoutMode('classic');
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

    // Phase 3: Verify session POST
    if (sessionPostLogs.logs[0]?.content.length) {
      const sessionPostLog = sessionPostLogs.logs[0].content[0];
      verifySessionPost(sessionPostLog, {
        session, total, currency: 'USD', transactionId: transactionId!, orderNumber,
      });
    }

    // Verify session GET (card details)
    if (sessionGetLogs.logs[0]?.content.length) {
      const sessionGetLog = sessionGetLogs.logs[0].content[0];
      verifySessionGet(sessionGetLog, { session, card: cards.mastercard });
    }

    // Phase 4: Verify token logs (empty for guest)
    verifyTokenLogsEmpty(tokenLogs);

    // Phase 5-7: Verify 3DS authentication logs (3ds=active)
    if (allLogs.logs[0]?.content.length) {
      const logContent = allLogs.logs[0].content;

      const initiateAuthLog = logContent.find(
        (l: any) => l.request?.body?.apiOperation === 'INITIATE_AUTHENTICATION'
      );
      if (initiateAuthLog) {
        verifyInitiateAuthentication(initiateAuthLog, {
          session, card: cards.mastercard, transactionId: transactionId!, currency: 'USD',
        });
      }

      const authenticatePayerLog = logContent.find(
        (l: any) => l.request?.body?.apiOperation === 'AUTHENTICATE_PAYER'
      );
      if (authenticatePayerLog) {
        verifyAuthenticatePayer(authenticatePayerLog, {
          session, transactionId: transactionId!, currency: 'USD', card: cards.mastercard,
        });
      }

      const authResultLog = logContent.find(
        (l: any) => l.response?.body?.authenticationStatus ||
                    l.response?.body?.order?.authenticationStatus
      );
      if (authResultLog) {
        verifyAuthenticationResult(authResultLog, {
          transactionId: transactionId!, currency: 'USD',
          authStatus: 'AUTHENTICATION_SUCCESSFUL',
        });
      }

      // Phase 8: Verify capture log
      const captureLog = logContent.find(
        (l: any) => l.request?.body?.apiOperation === 'PAY'
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

    // Phase 13: My Account — guest has no account, skip my-account checks
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

    // Phase 3: Verify session POST
    if (sessionPostLogs.logs[0]?.content.length) {
      const sessionPostLog = sessionPostLogs.logs[0].content[0];
      verifySessionPost(sessionPostLog, {
        session, total, currency: 'USD', transactionId: transactionId!, orderNumber,
      });
    }

    // Verify session GET
    if (sessionGetLogs.logs[0]?.content.length) {
      const sessionGetLog = sessionGetLogs.logs[0].content[0];
      verifySessionGet(sessionGetLog, { session, card: cards.mastercard });
    }

    // Phase 4: Token logs empty (not saving CC)
    verifyTokenLogsEmpty(tokenLogs);

    // Phase 5-8: Auth + capture logs
    if (allLogs.logs[0]?.content.length) {
      const logContent = allLogs.logs[0].content;

      const initiateAuthLog = logContent.find(
        (l: any) => l.request?.body?.apiOperation === 'INITIATE_AUTHENTICATION'
      );
      if (initiateAuthLog) {
        verifyInitiateAuthentication(initiateAuthLog, {
          session, card: cards.mastercard, transactionId: transactionId!, currency: 'USD',
        });
      }

      const authenticatePayerLog = logContent.find(
        (l: any) => l.request?.body?.apiOperation === 'AUTHENTICATE_PAYER'
      );
      if (authenticatePayerLog) {
        verifyAuthenticatePayer(authenticatePayerLog, {
          session, transactionId: transactionId!, currency: 'USD', card: cards.mastercard,
        });
      }

      const captureLog = logContent.find(
        (l: any) => l.request?.body?.apiOperation === 'PAY'
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

    // Phase 13: My Account — 0 saved cards (not saving CC)
    await frontendLogin(page, mc005Email, billing.password);
    await verifyPaymentMethods(page, { expectedCards: 0 });
    await verifyOrderInMyAccount(page, orderNumber, 'Processing', { expectedTotal: total, displayName: config.displayName });
    await verifyCartEmpty(page);
  });

  // === MC-006: New user, saving CC ===

  test('MC-006 - New user saving CC', async ({ page }) => {
    payDate = await addToCartAndCheckout(page, config.products.digital);
    sessionDate = payDate;
    await fillBilling(page, { ...billing, email: mc006Email });
    await createAccountAtCheckout(page, billing.password);
    await selectPaymentMethod(page, config);
    await fillHostedSessionCC(page, cards.mastercard, config);
    await clickSaveCardCheckbox(page);

    total = await extractOrderTotal(page);
    session = await extractSessionId(page);

    await clickPlaceOrder(page);
    const result = await verifyOrderReceived(page, { displayName: config.displayName, expectedTotal: total });
    orderNumber = result.orderNumber;
    expect(orderNumber).toBeTruthy();
  });

  test('MC-006 - New user saving CC - Admin', async ({ page }) => {
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

    // Phase 3: Verify session POST
    if (sessionPostLogs.logs[0]?.content.length) {
      const sessionPostLog = sessionPostLogs.logs[0].content[0];
      verifySessionPost(sessionPostLog, {
        session, total, currency: 'USD', transactionId: transactionId!, orderNumber,
      });
    }

    // Verify session GET
    if (sessionGetLogs.logs[0]?.content.length) {
      const sessionGetLog = sessionGetLogs.logs[0].content[0];
      verifySessionGet(sessionGetLog, { session, card: cards.mastercard });
    }

    // Phase 4: Token log present (saving CC)
    if (tokenLogs.logs[0]?.content.length) {
      const tokenLog = tokenLogs.logs[0].content[0];
      verifyTokenLog(tokenLog, { session, card: cards.mastercard });
    }

    // Phase 5-8: Auth + capture logs
    if (allLogs.logs[0]?.content.length) {
      const logContent = allLogs.logs[0].content;

      const initiateAuthLog = logContent.find(
        (l: any) => l.request?.body?.apiOperation === 'INITIATE_AUTHENTICATION'
      );
      if (initiateAuthLog) {
        verifyInitiateAuthentication(initiateAuthLog, {
          session, card: cards.mastercard, transactionId: transactionId!, currency: 'USD',
        });
      }

      const authenticatePayerLog = logContent.find(
        (l: any) => l.request?.body?.apiOperation === 'AUTHENTICATE_PAYER'
      );
      if (authenticatePayerLog) {
        verifyAuthenticatePayer(authenticatePayerLog, {
          session, transactionId: transactionId!, currency: 'USD', card: cards.mastercard,
        });
      }

      const captureLog = logContent.find(
        (l: any) => l.request?.body?.apiOperation === 'PAY'
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
    await frontendLogin(page, mc006Email, billing.password);
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

  // === MC-007: Logged user, pay with saved CC ===

  test('MC-007 - Logged user pay with saved CC', async ({ page }) => {
    await frontendLogin(page, mc006Email, billing.password);
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

  test('MC-007 - Logged user pay with saved CC - Admin', async ({ page }) => {
    expect(orderNumber).toBeTruthy();

    // Phase 1: WC API verification
    const { order, transactionId } = await verifyOrderViaAPI(orderNumber, config);
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(transactionId).toBeTruthy();

    // Phase 2: Log extraction
    const allLogs = await extractAllLogs(payDate);
    const sessionGetLogs = await extractSessionGetLogs(payDate, session, payDate);
    const tokenLogs = await extractTokenLogs(payDate, payDate);

    // Verify session GET has token (saved card)
    if (sessionGetLogs.logs[0]?.content.length) {
      const sessionGetLog = sessionGetLogs.logs[0].content[0];
      verifySessionGet(sessionGetLog, { session, card: cards.mastercard });
    }

    // Phase 4: No new token created (using saved CC, not re-saving)
    verifyTokenLogsEmpty(tokenLogs);

    // Phase 5-8: Auth + capture logs
    if (allLogs.logs[0]?.content.length) {
      const logContent = allLogs.logs[0].content;

      const initiateAuthLog = logContent.find(
        (l: any) => l.request?.body?.apiOperation === 'INITIATE_AUTHENTICATION'
      );
      if (initiateAuthLog) {
        verifyInitiateAuthentication(initiateAuthLog, {
          session, card: cards.mastercard, transactionId: transactionId!, currency: 'USD',
        });
      }

      const captureLog = logContent.find(
        (l: any) => l.request?.body?.apiOperation === 'PAY'
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
    await frontendLogin(page, mc006Email, billing.password);
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

  // === MC-008: Logged user, pay with new CC (not saving) ===

  test('MC-008 - Logged user pay with new CC', async ({ page }) => {
    await frontendLogin(page, mc006Email, billing.password);
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

    // Phase 3: Verify session POST
    if (sessionPostLogs.logs[0]?.content.length) {
      const sessionPostLog = sessionPostLogs.logs[0].content[0];
      verifySessionPost(sessionPostLog, {
        session, total, currency: 'USD', transactionId: transactionId!, orderNumber,
      });
    }

    if (sessionGetLogs.logs[0]?.content.length) {
      const sessionGetLog = sessionGetLogs.logs[0].content[0];
      verifySessionGet(sessionGetLog, { session, card: cards.mastercard });
    }

    // Phase 4: No token (not saving)
    verifyTokenLogsEmpty(tokenLogs);

    // Phase 5-8
    if (allLogs.logs[0]?.content.length) {
      const logContent = allLogs.logs[0].content;

      const initiateAuthLog = logContent.find(
        (l: any) => l.request?.body?.apiOperation === 'INITIATE_AUTHENTICATION'
      );
      if (initiateAuthLog) {
        verifyInitiateAuthentication(initiateAuthLog, {
          session, card: cards.mastercard, transactionId: transactionId!, currency: 'USD',
        });
      }

      const captureLog = logContent.find(
        (l: any) => l.request?.body?.apiOperation === 'PAY'
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

    // Phase 13: My Account — still 1 card (didn't save new one)
    await frontendLogin(page, mc006Email, billing.password);
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

  // === MC-009: Logged user, pay with new CC and save it ===

  test('MC-009 - Logged user pay with new CC and save it', async ({ page }) => {
    await frontendLogin(page, mc006Email, billing.password);
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

    // Phase 3: Verify session POST
    if (sessionPostLogs.logs[0]?.content.length) {
      const sessionPostLog = sessionPostLogs.logs[0].content[0];
      verifySessionPost(sessionPostLog, {
        session, total, currency: 'USD', transactionId: transactionId!, orderNumber,
      });
    }

    if (sessionGetLogs.logs[0]?.content.length) {
      const sessionGetLog = sessionGetLogs.logs[0].content[0];
      verifySessionGet(sessionGetLog, { session, card: cards.mastercard });
    }

    // Phase 4: Token present (saving new CC)
    if (tokenLogs.logs[0]?.content.length) {
      const tokenLog = tokenLogs.logs[0].content[0];
      verifyTokenLog(tokenLog, { session, card: cards.mastercard });
    }

    // Phase 5-8
    if (allLogs.logs[0]?.content.length) {
      const logContent = allLogs.logs[0].content;

      const initiateAuthLog = logContent.find(
        (l: any) => l.request?.body?.apiOperation === 'INITIATE_AUTHENTICATION'
      );
      if (initiateAuthLog) {
        verifyInitiateAuthentication(initiateAuthLog, {
          session, card: cards.mastercard, transactionId: transactionId!, currency: 'USD',
        });
      }

      const captureLog = logContent.find(
        (l: any) => l.request?.body?.apiOperation === 'PAY'
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

    // Phase 13: My Account — 2 cards (original from MC-006 + newly saved)
    await frontendLogin(page, mc006Email, billing.password);
    await verifyPaymentMethods(page, {
      expectedCards: 2,
      cardName: cards.mastercard.name,
      fourDigits: fourDigits(cards.mastercard),
      expiryMonth: cards.mastercard.month,
      expiryYear: cards.mastercard.year,
    });
    await verifyOrderInMyAccount(page, orderNumber, 'Processing', { expectedTotal: total, displayName: config.displayName });
    await verifyCartEmpty(page);
  });

  // === MC-010: Logged user, pay with second saved CC ===

  test('MC-010 - Logged user pay with second saved CC', async ({ page }) => {
    await frontendLogin(page, mc006Email, billing.password);
    payDate = await addToCartAndCheckout(page, config.products.physical);
    sessionDate = payDate;
    await selectPaymentMethod(page, config);
    await selectSavedToken(page, 2);

    total = await extractOrderTotal(page);
    session = await extractSessionId(page);

    await clickPlaceOrder(page);
    const result = await verifyOrderReceived(page, { displayName: config.displayName, expectedTotal: total });
    orderNumber = result.orderNumber;
    expect(orderNumber).toBeTruthy();
  });

  test('MC-010 - Logged user pay with second saved CC - Admin', async ({ page }) => {
    expect(orderNumber).toBeTruthy();

    // Phase 1: WC API verification
    const { order, transactionId } = await verifyOrderViaAPI(orderNumber, config);
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(transactionId).toBeTruthy();

    // Phase 2: Log extraction
    const allLogs = await extractAllLogs(payDate);
    const sessionGetLogs = await extractSessionGetLogs(payDate, session, payDate);
    const tokenLogs = await extractTokenLogs(payDate, payDate);

    // Verify session GET (second saved token)
    if (sessionGetLogs.logs[0]?.content.length) {
      const sessionGetLog = sessionGetLogs.logs[0].content[0];
      verifySessionGet(sessionGetLog, { session, card: cards.mastercard });
    }

    // No new token (using existing saved CC)
    verifyTokenLogsEmpty(tokenLogs);

    // Phase 5-8
    if (allLogs.logs[0]?.content.length) {
      const logContent = allLogs.logs[0].content;

      const initiateAuthLog = logContent.find(
        (l: any) => l.request?.body?.apiOperation === 'INITIATE_AUTHENTICATION'
      );
      if (initiateAuthLog) {
        verifyInitiateAuthentication(initiateAuthLog, {
          session, card: cards.mastercard, transactionId: transactionId!, currency: 'USD',
        });
      }

      const captureLog = logContent.find(
        (l: any) => l.request?.body?.apiOperation === 'PAY'
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

    // Phase 13: My Account — still 2 cards
    await frontendLogin(page, mc006Email, billing.password);
    await verifyPaymentMethods(page, {
      expectedCards: 2,
      cardName: cards.mastercard.name,
      fourDigits: fourDigits(cards.mastercard),
      expiryMonth: cards.mastercard.month,
      expiryYear: cards.mastercard.year,
    });
    await verifyOrderInMyAccount(page, orderNumber, 'Processing', { expectedTotal: total, displayName: config.displayName });
    await verifyCartEmpty(page);
  });
});
