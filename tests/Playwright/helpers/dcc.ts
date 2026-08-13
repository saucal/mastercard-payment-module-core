import { Page, FrameLocator, expect } from '@playwright/test';
import type { PluginConfig } from '../plugin-config.types';

/**
 * Dynamic Currency Conversion primitives.
 *
 * DCC is a site-global gateway setting (`currency_conversion`, default 'yes' —
 * DynamicCurrencyConversion.php:91). When it is on and MPGS returns a quote for
 * the entered card, the checkout renders an Accept/Reject choice that MUST be
 * answered before place-order will submit — unanswered, WooCommerce silently
 * stays on /checkout/ and nothing in the gateway log looks wrong.
 *
 * Whether an offer appears depends on the card's issuing currency versus the
 * order currency, which is a property of the BIN at MPGS and not something the
 * suite controls. Hence the split below:
 *
 *   answerDccOffer()  — best-effort. No offer? No-op. For flows where DCC is
 *                       incidental and may or may not fire.
 *   requireDccOffer()  — strict. Fails if no offer arrives. For the DCC suite,
 *                       where the offer IS the thing under test.
 */

export type DccChoice = 'accept' | 'reject';

/** MPGS compares the literal 'Accept'; anything else maps to DECLINED. */
const OFFER_VALUE: Record<DccChoice, string> = {
  accept: 'Accept',
  reject: 'Reject',
};

/** The hidden field carrying the quote's requestId back to the server. */
function requestIdField(page: Page, config: PluginConfig) {
  return page.locator(`#${config.paymentMethodSlug}_dcc_request_id`);
}

/** The area the gateway injects its offer HTML (and the radios) into. */
function quoteArea(page: Page, config: PluginConfig) {
  return page.locator(`#${config.paymentMethodSlug}_currency_conversion`);
}

function offerRadio(page: Page, config: PluginConfig, choice: DccChoice) {
  return page.locator(`input[name="dccOfferState"][value="${OFFER_VALUE[choice]}"]`);
}

/**
 * Wait for a quote and return its requestId. Fails if none arrives.
 *
 * The quote fires on card-field validation, not page load, so call this after
 * the card is filled. The requestId field is the signal to poll:
 * _hostedSessions.js sets the offer HTML and the requestId together and clears
 * both on failure, so a non-empty requestId means a real offer landed.
 */
export async function requireDccOffer(page: Page, config: PluginConfig, timeout = 30_000): Promise<string> {
  await expect
    .poll(async () => (await requestIdField(page, config).inputValue().catch(() => '')).length, {
      message: 'no DCC quote arrived — check currency_conversion is on and the card draws an offer',
      timeout,
    })
    .toBeGreaterThan(0);
  return requestIdField(page, config).inputValue();
}

/**
 * Answer a DCC offer if one is present. Returns true if it answered, false if
 * there was nothing to answer.
 *
 * Best-effort on purpose: most cards in `fixtures/cards.ts` draw no offer, and a
 * checkout that never gets one is not a failure. Cheap when DCC is off entirely
 * — the hidden field is only rendered when the addon is enabled, so an absent
 * field short-circuits immediately rather than burning the poll timeout.
 */
export async function answerDccOffer(
  page: Page,
  config: PluginConfig,
  choice: DccChoice = 'reject',
  timeout = 8_000,
): Promise<boolean> {
  // DCC off entirely: display_dcc_info_area/dcc_after_payment_method_fields
  // never render, so there is nothing to wait for.
  if (await requestIdField(page, config).count() === 0) return false;

  // Field exists but may still be empty — the quote is async. A miss here is a
  // legitimate "this card draws no offer", not an error.
  const arrived = await expect
    .poll(async () => (await requestIdField(page, config).inputValue().catch(() => '')).length, { timeout })
    .toBeGreaterThan(0)
    .then(() => true)
    .catch(() => false);
  if (!arrived) return false;

  const radio = offerRadio(page, config, choice);
  // An offer with no radios is the 'Unavailable' shape: _hostedSessions.js
  // injects a single hidden dccOfferState instead, already submittable as-is.
  if (await radio.count() === 0) return false;

  await radio.check();
  await expect(radio).toBeChecked();
  return true;
}

/**
 * Assert no offer is on the page. For the paths where DCC must stay out of the
 * way: the setting off, and a subscription cart (init_dcc_hooks bails on those,
 * DynamicCurrencyConversion.php:109).
 *
 * Polls rather than checking once — the quote is async, so a bare check would
 * pass simply by running before a quote that does eventually arrive.
 */
export async function assertNoDccQuote(page: Page, config: PluginConfig, timeout = 8_000): Promise<void> {
  await expect
    .poll(async () => (await requestIdField(page, config).inputValue().catch(() => '')).length, {
      message: 'a DCC quote arrived where none should have',
      timeout,
    })
    .toBe(0);
  await expect(offerRadio(page, config, 'accept')).toHaveCount(0);
}

/**
 * Answer the DCC offer on MPGS's own hosted-checkout page.
 *
 * Separate from the hosted-session helpers above because this is MPGS's markup
 * on MPGS's domain, not ours: `#label-transactional-currency` means "charge me
 * in the order's currency", i.e. the reject side. The plugin's
 * `currency_conversion` setting cannot suppress it — init_addon_dcc returns
 * early for hosted checkout, so the offer comes from the MPGS merchant profile.
 *
 * Returns true if it answered. `accept` is not implemented: the id of the
 * pay-in-card-currency option has not been observed yet, and guessing it would
 * silently select the wrong currency.
 */
export async function answerHostedCheckoutDcc(
  host: Page | FrameLocator,
  choice: DccChoice = 'reject',
): Promise<boolean> {
  if (choice === 'accept') {
    throw new Error(
      'answerHostedCheckoutDcc: only "reject" is implemented. The MPGS hosted-page '
      + 'option for paying in the card currency has not been identified yet — capture '
      + 'it from a live offer before using accept here.',
    );
  }
  const option = host.locator('#label-transactional-currency');
  if (!(await option.isVisible({ timeout: 5_000 }).catch(() => false))) return false;
  await option.click();
  return true;
}
