import { test, expect } from '../../fixtures/test';
import { switchCheckoutMode, configureGateway } from '../../helpers/wc-api';
import { addToCartAndCheckout } from '../../helpers/cart';
import {
  fillBilling,
  selectPaymentMethod,
  clickPlaceOrder,
  getCheckoutError,
  type CheckoutMode,
} from '../../helpers/checkout';
import { fillHostedSessionCC } from '../../helpers/hosted-session';
import { handle3DSChallenge, type ThreeDSOutcome } from '../../helpers/three-ds';
import { requireDccOffer, answerDccOffer, type DccChoice } from '../../helpers/dcc';
import { waitForUnblock } from '../../helpers/block-ui';
import { checkoutHostedSession, assertOrderComplete } from '../../helpers/flows';
import { getLogs } from '../../helpers/wc-api';
import {
  assertDccOrderMeta,
  assertDccReceiptRow,
  assertDccAdminPanel,
  assertDccUptakeLog,
  assertDccQuoteInquiryLog,
  assertCaptureLogTrail,
} from '../../helpers/assertions';
import { navigateToOrder } from '../../helpers/admin-orders';
import config from '../../plugin-config';
import { cards } from '../../fixtures/cards';
import { billing, uniqueEmail } from '../../fixtures/billing';

/**
 * The DCC cases that need a currency-specific card, in either checkout mode.
 *
 * Suites 19 and 22 both run DCC on visaFrictionless/GBP with 3DS off, which
 * cannot reach a real ACS challenge or a declined authentication. These seven
 * cases add both, and they are identical between modes apart from the ids — the
 * mode is already parameterized inside `clickPlaceOrder` / `getCheckoutError`,
 * which detect it from the page. Same reasoning, and same shape, as
 * `session-validation-cases.ts` for suites 08/09.
 *
 * Not a spec file: Playwright's default testMatch only collects `*.spec.ts`, so
 * nothing here runs until a suite calls it.
 *
 *   classic (suite 19)  firstId 13  -> DCC-013..019
 *   blocks  (suite 22)  firstId 20  -> DCC-020..026
 *
 * The two cards, captured live 2026-08-19:
 *
 *   5288049999998964  MXN (762.67)  1 USD = 13.249999 MXN  challenges
 *   4541879999990975  HKD (447.24)  1 USD = 7.769999 HKD   frictionless, and
 *                                   the authentication is DECLINED
 *
 * The HKD card never reaches a challenge and never pays: INITIATE_AUTHENTICATION
 * succeeds, then AUTHENTICATE_PAYER comes back FAILURE / AUTHENTICATION_FAILED /
 * DECLINED and the gateway refuses to submit. That is what makes it worth a DCC
 * case — an accepted conversion offer must not leave anything behind on an order
 * that never happens.
 */
const MXN = 'MXN';

/** DCC on, 3DS on. Restated in full because configureGateway writes globally. */
const DCC_ON_3DS = {
  _3d_secure: 'yes',
  saved_cards: 'yes',
  transaction_mode: 'PURCHASE',
  checkout_mode: 'hosted_session',
  currency_conversion: 'yes',
} as const;

export function describeDccCardCases(mode: CheckoutMode, firstId: number): void {
  const id = (n: number) => `DCC-${String(firstId + n).padStart(3, '0')}`;

  // ─── Currency-specific cards ────────────────────────────────────────────────
  //
  // Everything above runs on visaFrictionless/GBP with 3DS off. The cases below
  // add the two dimensions that combination cannot reach: a real ACS challenge
  // answered both ways, and an authentication that is declined outright.

  /** The account DCC-013 creates, whose saved card DCC-019 quotes against. */
  const mxnEmail = uniqueEmail();
  const mxnReturning = { email: mxnEmail, password: billing.password };

  /**
   * Drive a checkout that is expected NOT to complete, and return the error the
   * buyer is shown.
   *
   * `checkoutHostedSession` cannot be used for these: it asserts the
   * order-received page and an empty cart, and a declined authentication reaches
   * neither. That is the same reason suite 10 was never ported.
   */
  async function attemptBlockedCheckout(
    page: import('@playwright/test').Page,
    card: typeof cards[string],
    choice: DccChoice,
    outcome?: ThreeDSOutcome,
  ): Promise<string> {
    await addToCartAndCheckout(page, config.products.physical);
    await fillBilling(page, billing);
    await selectPaymentMethod(page, config);
    await fillHostedSessionCC(page, card, config);

    // The offer must really be on the page before answering it, or these cases
    // would pass for the wrong reason on a card that never quoted.
    await requireDccOffer(page, config);
    expect(await answerDccOffer(page, config, choice), 'DCC offer could not be answered').toBe(true);

    await clickPlaceOrder(page);
    if (outcome) await handle3DSChallenge(page, { outcome });
    await waitForUnblock(page);

    // No order-received, no order: the buyer is still on checkout.
    await expect(page).toHaveURL(/checkout/);

    // Give a late notice time to render — waitForUnblock returns as soon as the
    // overlay clears, but a decline arriving through the ACS round-trip paints
    // its notice a moment later. Returns whatever is there, empty included:
    // whether a message appears at all differs by mode, and that difference is
    // itself something these cases assert.
    let error = '';
    await expect
      .poll(async () => {
        error = await getCheckoutError(page);
        return error.trim().length;
      }, { timeout: 15_000 })
      .toBeGreaterThan(0)
      .catch(() => {});
    return error.trim();
  }

  // === DCC-013: MXN, offer accepted, challenge passed ===

  test(`${id(0)} - MXN offer accepted through a passed 3DS challenge`, async ({ page, adminPage, emailPage }) => {
    // Restated rather than inherited: the caller's earlier cases may have left
    // any mode behind, and the whole point of this factory is to run in both.
    await switchCheckoutMode(mode);
    await configureGateway(config, { ...DCC_ON_3DS });

    const ctx = await checkoutHostedSession(page, config, {
      productId: config.products.physical,
      card: cards.mastercardMxnChallenge,
      billing: { ...billing, email: mxnEmail },
      createAccount: billing.password,
      saveCard: true,
      requireDccOffer: true,
      dccChoice: 'accept',
      // The card challenges, so the ACS prompt is not optional here.
      threeDS: 'always',
    });

    // On the 3DS path the conversion is declared at INITIATE_AUTHENTICATION
    // rather than on PAY — maybe_add_dcc_payment_data reads $_POST, and the PAY
    // runs on the post-ACS request, which no longer carries the offer fields.
    // MPGS applies it to the session, so the order still comes back converted;
    // assertDccUptakeLog looks for whichever operation declared it.
    await assertDccUptakeLog({ ...ctx, uptake: 'ACCEPTED' });
    await assertDccOrderMeta(ctx.orderNumber, config, { payerCurrency: MXN });

    await page.goto(ctx.orderReceivedUrl);
    await assertDccReceiptRow(page, { payerCurrency: MXN });

    await navigateToOrder(adminPage, ctx.orderNumber);
    await assertDccAdminPanel(adminPage, { payerCurrency: MXN });

    // KNOWN DEFECT, blocks only. A buyer who creates their account *at checkout*
    // is not tokenized when a 3DS challenge intervenes — the gateway makes no
    // /token call at all, so the card the buyer asked to save is silently not
    // saved. Isolated 2026-08-19 against three controls, all of which do
    // tokenize:
    //
    //   classic, account created at checkout, challenge   order 6344   1 call
    //   blocks,  already logged in, challenge             suite 02 MC-009
    //   blocks,  account created at checkout, 3DS off     DCC-009, reused by DCC-012
    //   blocks,  account created at checkout, challenge   orders 6355 + 6360   0 calls
    //
    // Not DCC-related: 6360 reproduced it with currency_conversion off. Suite 02
    // never covers it because it has no "new user saving CC" case in blocks.
    const tokenizes = mode === 'classic';
    await assertCaptureLogTrail({
      ...ctx, expectSessionPost: true, expectToken: tokenizes, expectCardDetailsFetch: true,
    });
    if (!tokenizes) {
      // Pins the broken value deliberately: when the defect is fixed this goes
      // red and whoever fixed it flips the expectation above.
      const tokenLogs = await getLogs(ctx.payDate, '/token', ctx.logOffset);
      expect(
        tokenLogs.logs[0]?.content.length ?? 0,
        'blocks now tokenizes through a challenge — fix is in, set tokenizes = true',
      ).toBe(0);
    }
    await assertOrderComplete(ctx, config, { page, adminPage, emailPage }, {
      status: 'Processing',
      note: 'captured',
    });
  });

  // === DCC-014: MXN, offer declined, challenge passed ===

  test(`${id(1)} - MXN offer declined through a passed 3DS challenge`, async ({ page, adminPage, emailPage }) => {
    const ctx = await checkoutHostedSession(page, config, {
      productId: config.products.physical,
      card: cards.mastercardMxnChallenge,
      requireDccOffer: true,
      dccChoice: 'reject',
      threeDS: 'always',
    });

    await assertDccUptakeLog({ ...ctx, uptake: 'DECLINED' });
    await assertDccOrderMeta(ctx.orderNumber, config, {
      payerCurrency: MXN,
      expectAbsent: true,
    });
    expect(ctx.order.currency, 'order currency should be unchanged').toBe('USD');

    await assertOrderComplete(ctx, config, { page, adminPage, emailPage }, {
      status: 'Processing',
      note: 'captured',
    });
  });

  // === DCC-015 / DCC-016: MXN, challenge declined, either side of the offer ===
  //
  // The two decline paths surface differently, and the strings below are the
  // distinction. A challenge answered UNAUTHENTICATED comes back as a declined
  // payment method; the HKD card's frictionless failure comes back as an
  // authentication error. Both captured live 2026-08-19.

  /**
   * What the buyer is told when a challenge comes back UNAUTHENTICATED.
   *
   * Classic shows a proper message. **Blocks shows nothing at all** — a KNOWN
   * DEFECT: the buyer is returned to the checkout with the cart still full and
   * no notice anywhere. Verified 2026-08-19 over a 15s wait and against the full
   * accessibility tree of the failed page, which contains no error text. Pinned
   * as the empty string, so the day a message is added this goes red and whoever
   * added it replaces this branch with the real copy.
   *
   * Either way the invariant that matters — no order, buyer still on checkout —
   * is asserted by attemptBlockedCheckout itself.
   */
  function expectChallengeDeclined(error: string): void {
    if (mode === 'classic') {
      expect(error).toContain('payment method was declined');
    } else {
      expect(error, 'blocks now reports a declined challenge — pin the real copy here').toBe('');
    }
  }

  test(`${id(2)} - MXN offer accepted but the 3DS challenge is declined`, async ({ page }) => {
    expectChallengeDeclined(await attemptBlockedCheckout(
      page, cards.mastercardMxnChallenge, 'accept', 'UNAUTHENTICATED',
    ));
  });

  test(`${id(3)} - MXN offer declined and the 3DS challenge is declined`, async ({ page }) => {
    expectChallengeDeclined(await attemptBlockedCheckout(
      page, cards.mastercardMxnChallenge, 'reject', 'UNAUTHENTICATED',
    ));
  });

  // === DCC-017 / DCC-018: HKD, authentication declined without a challenge ===

  test(`${id(4)} - HKD offer accepted but authentication is declined`, async ({ page }) => {
    // No outcome argument: this card never reaches an ACS prompt. The decline
    // happens at AUTHENTICATE_PAYER, frictionlessly.
    const error = await attemptBlockedCheckout(page, cards.visaHkdFrictionless, 'accept');
    expect(error).toContain('error with the payment authentication');
  });

  test(`${id(5)} - HKD offer declined and authentication is declined`, async ({ page }) => {
    const error = await attemptBlockedCheckout(page, cards.visaHkdFrictionless, 'reject');
    expect(error).toContain('error with the payment authentication');
  });

  // === DCC-019: the saved MXN card still draws an offer ===

  test(`${id(6)} - Saved card quotes an offer and challenges`, async ({ page, adminPage, emailPage }) => {
    // This case pays with the card ${id(0)} saved. In blocks that card was never
    // saved — see the defect noted there — so there is no token to select and
    // this cannot run until it is fixed. The saved-token + DCC combination is
    // still covered in blocks by DCC-012, which saves its card without a
    // challenge; what is missing here is saved token + challenge.
    test.skip(
      mode === 'blocks',
      'blocks does not tokenize an account created at checkout through a 3DS challenge',
    );

    const ctx = await checkoutHostedSession(page, config, {
      productId: config.products.physical,
      // The card DCC-013 saved; the token stands in for it.
      card: cards.mastercardMxnChallenge,
      loginAs: mxnReturning,
      savedTokenIndex: 1,
      requireDccOffer: true,
      dccChoice: 'accept',
      // A saved challenge token may or may not re-challenge, per issuer.
      threeDS: 'maybe',
    });

    // The distinguishing assertion: a saved token has no PAN in the DOM, so the
    // browser cannot quote against MPGS directly — ajax_dcc_quote fetches it
    // server-side, which is the only way the inquiry reaches our log.
    await assertDccQuoteInquiryLog({ payDate: ctx.payDate, logOffset: ctx.logOffset });

    await assertDccUptakeLog({ ...ctx, uptake: 'ACCEPTED' });
    await assertDccOrderMeta(ctx.orderNumber, config, { payerCurrency: MXN });

    await navigateToOrder(adminPage, ctx.orderNumber);
    await assertDccAdminPanel(adminPage, { payerCurrency: MXN });

    await assertOrderComplete(ctx, config, { page, adminPage, emailPage }, {
      status: 'Processing',
      note: 'captured',
      // Still the one card DCC-013 saved.
      myAccount: { ...mxnReturning, expectedCards: 1 },
    });
  });

  // 3DS is site-global and the cases above turn it on. Leaving it on would
  // silently change the meaning of any later suite that does not set it.
  test.afterAll(async () => {
    await configureGateway(config, { ...DCC_ON_3DS, _3d_secure: 'no' });
  });
}
