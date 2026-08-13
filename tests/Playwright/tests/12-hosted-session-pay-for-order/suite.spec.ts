import { test, expect } from '../../fixtures/test';
import {
  switchCheckoutMode, configureGateway, verifyOrderViaAPI, getLogEntryCount, getLogs,
  findCustomerIdByEmail, createPendingOrder,
} from '../../helpers/wc-api';
import {
  selectPaymentMethod,
  clickPlaceOrder,
  clickSaveCardCheckbox,
  selectSavedToken,
  extractSessionId,
} from '../../helpers/checkout';
import { fillHostedSessionCC } from '../../helpers/hosted-session';
import { collectOrderReceivedData } from '../../helpers/flows';
import { handle3DSChallenge } from '../../helpers/three-ds';
import { frontendLogin, registerUser } from '../../helpers/wp-login';
import { navigateToOrder } from '../../helpers/admin-orders';
import {
  assertOrderStatus,
  assertPaymentMethodMeta,
  assertCapturedNote,
  verifySessionGet,
  verifySessionGetCardDetails,
  verifyInitiateAuthentication,
  verifyAuthenticatePayer,
  verifyAuthenticationResult,
  verifyAuthorizeCaptureLog,
  verifyTokenLog,
  verifyTokenLogsEmpty,
  verifyAdminEmail,
  assertOrderReceived,
  verifyPaymentMethods,
} from '../../helpers/assertions';
import config from '../../plugin-config';
import { cards, fourDigits } from '../../fixtures/cards';
import { billing, uniqueEmail } from '../../fixtures/billing';
import { logOrderContext } from '../../helpers/debug';
import { siteUrl, siteEnv } from '../../helpers/site';

const BASE_URL = siteUrl();
const WOO_USER = siteEnv('WOO_USER');
const WOO_PASS = siteEnv('WOO_PASS');

const wcAuth = 'Basic ' + Buffer.from(`${WOO_USER}:${WOO_PASS}`).toString('base64');

test.describe.serial('Hosted Session - Pay For Order', () => {
  const mcEmail = uniqueEmail();
  let mcCustomerId: number;
  let mc012Token: string;



  // === MC-011: Pay for order, not saving CC ===
  // AUDIT 2026-04-29 vs GI (applies to MC-011/012/013): DRIFT — GI uses
  // `prodType=virtual`, PW uses `config.products.physical`. Functionally
  // harmless (pay-for-order works the same with either) but violates
  // source-of-truth fidelity. Either switch to `config.products.digital`
  // / a `virtual` config slot, or document why physical is preferred.

  test('MC-011 - Pay for order not saving CC', async ({ page, emailPage, adminPage }) => {
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
    mcCustomerId = await findCustomerIdByEmail(mcEmail);

    const logOffset = await getLogEntryCount(new Date().toISOString().slice(0, 19));
    const payDate = new Date().toISOString().slice(0, 19);

    const { orderId, orderKey, paymentUrl } = await createPendingOrder({ productId: config.products.physical, customerId: mcCustomerId, email: mcEmail, billing });
    // WooCommerce's own pay URL points at whatever page this install uses for
    // checkout; a hand-built /checkout/… path lands on the cart when the
    // checkout page lives elsewhere (e.g. /checkout-blocks/).
    await page.goto(paymentUrl || `/checkout/order-pay/${orderId}/?pay_for_order=true&key=${orderKey}`);
    await page.waitForLoadState('load');

    await selectPaymentMethod(page, config);
    await fillHostedSessionCC(page, cards.mastercard, config);
    const session = await extractSessionId(page);

    await clickPlaceOrder(page);
    await page.waitForURL(/order-received/, { timeout: 60000 });
    const result = await collectOrderReceivedData(page);
    await assertOrderReceived(page, { displayName: config.displayName }, result);
    const orderNumber = result.orderNumber;
    expect(orderNumber).toBeTruthy();

    const { order, transactionId } = await verifyOrderViaAPI(orderNumber, config);
    await logOrderContext(test.info().title, { orderNumber: orderNumber, transactionId, session, payDate, logOffset });
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(order.payment_method_title).toBe(config.displayName);
    expect(transactionId).toBeTruthy();
    const total: string = String(order.total);

    const allLogs = await getLogs(payDate, '', logOffset);
    const sessionGetLogs = await getLogs(payDate, `/session/${session}`, logOffset);
    const tokenLogs = await getLogs(payDate, '/token', logOffset);

    expect(sessionGetLogs.logs[0]?.content.length, 'session GET logs should not be empty').toBeGreaterThan(0);
    const sessionPut = sessionGetLogs.logs[0].content.find(
      (l: any) => l.request?.type === 'PUT'
        && l.request?.body?.apiOperation === 'UPDATE_SESSION'
        && l.response?.body?.session?.updateStatus === 'SUCCESS'
    );
    expect(sessionPut, 'UPDATE_SESSION PUT log entry not found').toBeTruthy();
    verifySessionGet(sessionPut!, { session, card: cards.mastercard });
    const sessionGet = sessionGetLogs.logs[0].content.find(
      (l: any) => l.request?.type === 'GET'
        && l.request?.url?.includes('/session/')
        && l.response?.body?.session?.id === session
    );
    expect(sessionGet, 'session GET card details entry not found').toBeTruthy();
    verifySessionGetCardDetails(sessionGet!, { session, card: cards.mastercard });

    verifyTokenLogsEmpty(tokenLogs);

    expect(allLogs.logs[0]?.content.length, 'all logs should not be empty').toBeGreaterThan(0);
    const logContent = allLogs.logs[0].content;
    const txFilter = (l: any) => !transactionId || l.request?.url?.includes(transactionId);

    const initiateAuthLog = logContent.find(
      (l: any) => l.request?.body?.apiOperation === 'INITIATE_AUTHENTICATION' && txFilter(l) && l.response?.body?.result === 'SUCCESS'
    );
    expect(initiateAuthLog, 'INITIATE_AUTHENTICATION log not found').toBeTruthy();
    verifyInitiateAuthentication(initiateAuthLog!, {
      session, card: cards.mastercard, transactionId: transactionId!, currency: 'USD',
    });

    const authenticatePayerLog = logContent.find(
      (l: any) => l.request?.body?.apiOperation === 'AUTHENTICATE_PAYER' && txFilter(l) && l.response?.body?.result === 'SUCCESS'
    );
    expect(authenticatePayerLog, 'AUTHENTICATE_PAYER log not found').toBeTruthy();
    verifyAuthenticatePayer(authenticatePayerLog!, {
      session, transactionId: transactionId!, currency: 'USD', card: cards.mastercard,
    });

    const authResultLog = logContent.find(
      (l: any) => txFilter(l) && (
        l.response?.body?.authenticationStatus === 'AUTHENTICATION_SUCCESSFUL'
        || l.response?.body?.order?.authenticationStatus === 'AUTHENTICATION_SUCCESSFUL'
      )
    );
    expect(authResultLog, 'AUTHENTICATION_SUCCESSFUL result log not found').toBeTruthy();
    verifyAuthenticationResult(authResultLog!, {
      transactionId: transactionId!, currency: 'USD', authStatus: 'AUTHENTICATION_SUCCESSFUL',
    });

    const captureLog = logContent.find(
      (l: any) => l.request?.body?.apiOperation === 'PAY' && txFilter(l) && l.response?.body?.result === 'SUCCESS'
    );
    expect(captureLog, 'PAY log not found').toBeTruthy();
    verifyAuthorizeCaptureLog(captureLog!, {
      apiOperation: 'PAY', session, total, currency: 'USD',
      transactionId: transactionId!, orderNumber, card: cards.mastercard,
    });

    await verifyAdminEmail(orderNumber, { paymentMethodTitle: config.displayName, page: emailPage });

    await navigateToOrder(adminPage, orderNumber);
    await assertOrderStatus(adminPage, 'Processing');
    await assertPaymentMethodMeta(adminPage, config, transactionId);
    await assertCapturedNote(adminPage, config, transactionId!);
  });

  // === MC-012: Pay for order, saving CC (challenge card) ===
  // AUDIT 2026-04-29 vs GI: JUSTIFIED FIX — `selectPaymentMethod(...,true)`
  // (useNewToken=true) mirrors GI step 31 (clicks the new-token radio
  // before filling CC iframe). Without it, WC tokenization-form.js keeps
  // the .saveNew row hidden and `clickSaveCardCheckbox` would fail.

  test('MC-012 - Pay for order saving CC', async ({ page, emailPage, adminPage }) => {
    // Explicit login — registerUser in MC-011 does not survive across tests
    // reliably (cookies / WP nonces differ on /checkout/order-pay/). Without
    // a logged-in session WC's tokenization-form.js reads is_logged_in=""
    // from wc_tokenization_form_params and force-hides the save-card row.
    await frontendLogin(page, mcEmail, billing.password);

    const logOffset = await getLogEntryCount(new Date().toISOString().slice(0, 19));
    const payDate = new Date().toISOString().slice(0, 19);

    const { orderId, orderKey, paymentUrl } = await createPendingOrder({ productId: config.products.physical, customerId: mcCustomerId, email: mcEmail, billing });
    // WooCommerce's own pay URL points at whatever page this install uses for
    // checkout; a hand-built /checkout/… path lands on the cart when the
    // checkout page lives elsewhere (e.g. /checkout-blocks/).
    await page.goto(paymentUrl || `/checkout/order-pay/${orderId}/?pay_for_order=true&key=${orderKey}`);
    await page.waitForLoadState('load');

    // useNewToken=true clicks the "Use new payment method" radio — required
    // on pay-for-order, where WC tokenization-form.js keeps the .saveNew row
    // hidden until the new-token radio fires `change` (matches GI step 31
    // where the radio is clicked before filling the CC iframe).
    await selectPaymentMethod(page, config, true);
    await fillHostedSessionCC(page, cards.visaChallenge, config);
    await clickSaveCardCheckbox(page);
    const session = await extractSessionId(page);

    await clickPlaceOrder(page);
    await handle3DSChallenge(page);
    await page.waitForURL(/order-received/, { timeout: 60000 });
    const result = await collectOrderReceivedData(page);
    await assertOrderReceived(page, { displayName: config.displayName }, result);
    const orderNumber = result.orderNumber;
    expect(orderNumber).toBeTruthy();

    const { order, transactionId } = await verifyOrderViaAPI(orderNumber, config);
    await logOrderContext(test.info().title, { orderNumber: orderNumber, transactionId, session, payDate, logOffset });
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(transactionId).toBeTruthy();
    const total: string = String(order.total);

    const allLogs = await getLogs(payDate, '', logOffset);
    const sessionGetLogs = await getLogs(payDate, `/session/${session}`, logOffset);
    const tokenLogs = await getLogs(payDate, '/token', logOffset);

    expect(sessionGetLogs.logs[0]?.content.length, 'session GET logs should not be empty').toBeGreaterThan(0);
    const sessionPut = sessionGetLogs.logs[0].content.find(
      (l: any) => l.request?.type === 'PUT'
        && l.request?.body?.apiOperation === 'UPDATE_SESSION'
        && l.response?.body?.session?.updateStatus === 'SUCCESS'
    );
    expect(sessionPut, 'UPDATE_SESSION PUT log entry not found').toBeTruthy();
    verifySessionGet(sessionPut!, { session, card: cards.visaChallenge });

    expect(tokenLogs.logs[0]?.content.length, 'token logs should not be empty (saving CC)').toBeGreaterThan(0);
    const tokenLog = tokenLogs.logs[0].content[0];
    verifyTokenLog(tokenLog, { session, card: cards.visaChallenge });
    mc012Token = tokenLog.response?.body?.token || '';
    expect(mc012Token, 'token id should be captured').toBeTruthy();

    expect(allLogs.logs[0]?.content.length, 'all logs should not be empty').toBeGreaterThan(0);
    const logContent = allLogs.logs[0].content;
    const txFilter = (l: any) => !transactionId || l.request?.url?.includes(transactionId);

    const initiateAuthLog = logContent.find(
      (l: any) => l.request?.body?.apiOperation === 'INITIATE_AUTHENTICATION' && txFilter(l) && l.response?.body?.result === 'SUCCESS'
    );
    expect(initiateAuthLog, 'INITIATE_AUTHENTICATION log not found').toBeTruthy();

    const authenticatePayerLog = logContent.find(
      (l: any) => l.request?.body?.apiOperation === 'AUTHENTICATE_PAYER' && txFilter(l)
    );
    expect(authenticatePayerLog, 'AUTHENTICATE_PAYER log not found').toBeTruthy();

    const authResultLog = logContent.find(
      (l: any) => txFilter(l) && (
        l.response?.body?.authenticationStatus === 'AUTHENTICATION_SUCCESSFUL'
        || l.response?.body?.order?.authenticationStatus === 'AUTHENTICATION_SUCCESSFUL'
      )
    );
    expect(authResultLog, 'AUTHENTICATION_SUCCESSFUL result log not found').toBeTruthy();

    const captureLog = logContent.find(
      (l: any) => l.request?.body?.apiOperation === 'PAY' && txFilter(l) && l.response?.body?.result === 'SUCCESS'
    );
    expect(captureLog, 'PAY log not found').toBeTruthy();
    verifyAuthorizeCaptureLog(captureLog!, {
      apiOperation: 'PAY', session, total, currency: 'USD',
      transactionId: transactionId!, orderNumber, card: cards.visaChallenge,
    });

    await verifyAdminEmail(orderNumber, { paymentMethodTitle: config.displayName, page: emailPage });

    await navigateToOrder(adminPage, orderNumber);
    await assertOrderStatus(adminPage, 'Processing');
    await assertPaymentMethodMeta(adminPage, config, transactionId);
    await assertCapturedNote(adminPage, config, transactionId!);

    await verifyPaymentMethods(page, {
      expectedCards: 1,
      cardName: cards.visaChallenge.name,
      fourDigits: fourDigits(cards.visaChallenge),
      expiryMonth: cards.visaChallenge.month,
      expiryYear: cards.visaChallenge.year,
    });
  });

  // === MC-013: Pay for order with saved CC ===
  // AUDIT 2026-04-29 vs GI: JUSTIFIED FIX — conditional 3DS handler. Saved
  // visaChallenge token MAY re-challenge depending on issuer behavior;
  // PW gates handle3DSChallenge on URL-pattern detection.

  test('MC-013 - Pay for order with saved CC', async ({ page, emailPage, adminPage }) => {
    await frontendLogin(page, mcEmail, billing.password);
    const logOffset = await getLogEntryCount(new Date().toISOString().slice(0, 19));
    const payDate = new Date().toISOString().slice(0, 19);

    const { orderId, orderKey, paymentUrl } = await createPendingOrder({ productId: config.products.physical, customerId: mcCustomerId, email: mcEmail, billing });
    // WooCommerce's own pay URL points at whatever page this install uses for
    // checkout; a hand-built /checkout/… path lands on the cart when the
    // checkout page lives elsewhere (e.g. /checkout-blocks/).
    await page.goto(paymentUrl || `/checkout/order-pay/${orderId}/?pay_for_order=true&key=${orderKey}`);
    await page.waitForLoadState('load');

    await selectPaymentMethod(page, config);
    await selectSavedToken(page, 1);

    await clickPlaceOrder(page);
    if (/acs|3ds|threedsecure|mastercard\.com.*prompt/i.test(page.url())) {
      await handle3DSChallenge(page);
    }
    await page.waitForURL(/order-received/, { timeout: 60000 });
    const result = await collectOrderReceivedData(page);
    await assertOrderReceived(page, { displayName: config.displayName }, result);
    const orderNumber = result.orderNumber;
    expect(orderNumber).toBeTruthy();

    const { order, transactionId } = await verifyOrderViaAPI(orderNumber, config);
    await logOrderContext(test.info().title, { orderNumber: orderNumber, transactionId, payDate, logOffset });
    expect(order.payment_method).toBe(config.paymentMethodSlug);
    expect(transactionId).toBeTruthy();
    const total: string = String(order.total);

    const sessionGetLogs = await getLogs(payDate, '/session/', logOffset);
    expect(sessionGetLogs.logs[0]?.content.length, 'session GET logs should not be empty').toBeGreaterThan(0);
    const sessionPut = sessionGetLogs.logs[0].content.find(
      (l: any) => l.request?.type === 'PUT'
        && l.request?.body?.apiOperation === 'UPDATE_SESSION'
        && l.response?.body?.session?.updateStatus === 'SUCCESS'
    );
    expect(sessionPut, 'UPDATE_SESSION PUT log entry not found (saved-token path)').toBeTruthy();
    const resolvedSession = sessionPut!.response?.body?.session?.id || '';
    expect(resolvedSession, 'session id should be derivable from UPDATE_SESSION').toBeTruthy();
    verifySessionGet(sessionPut!, { session: resolvedSession, card: cards.visaChallenge, token: mc012Token });

    const allLogs = await getLogs(payDate, '', logOffset);
    const logContent = allLogs.logs[0]?.content ?? [];
    const txFilter = (l: any) => !transactionId || l.request?.url?.includes(transactionId);

    const captureLog = logContent.find(
      (l: any) => l.request?.body?.apiOperation === 'PAY' && txFilter(l) && l.response?.body?.result === 'SUCCESS'
    );
    expect(captureLog, 'PAY log not found').toBeTruthy();
    verifyAuthorizeCaptureLog(captureLog!, {
      apiOperation: 'PAY', session: resolvedSession, total, currency: 'USD',
      transactionId: transactionId!, orderNumber, card: cards.visaChallenge,
    });

    await verifyAdminEmail(orderNumber, { paymentMethodTitle: config.displayName, page: emailPage });

    await navigateToOrder(adminPage, orderNumber);
    await assertOrderStatus(adminPage, 'Processing');
    await assertPaymentMethodMeta(adminPage, config, transactionId);
    await assertCapturedNote(adminPage, config, transactionId!);
  });
});
