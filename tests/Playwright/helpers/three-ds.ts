import { Page, expect } from '@playwright/test';

/**
 * What to tell the ACS emulator to answer.
 *
 * These are the literal option values of `select#selectAuthResult` on
 * `https://mtf.gateway.mastercard.com/acs/mastercard/v2/prompt`, captured live
 * 2026-08-19. The letter in each comment is the 3DS transaction status the
 * gateway reports back.
 */
export type ThreeDSOutcome =
  | 'AUTHENTICATED'                 // (Y) successful — the default
  | 'UNAUTHENTICATED'               // (N) not authenticated, transaction denied
  | 'CANCELLED_AUTHENTICATION'      // (N) payer cancelled the challenge
  | 'AUTHENTICATION_NOT_AVAILABLE'  // (U)
  | 'AUTHENTICATION_REJECTED'       // (R)
  | 'AUTHENTICATION_SERVER_ERROR';  // (E)

export interface ThreeDSChallengeOptions {
  /** Defaults to 'AUTHENTICATED', which is what every pre-existing caller wants. */
  outcome?: ThreeDSOutcome;
  /** Where the browser is expected to land afterwards. */
  urlPattern?: RegExp;
}

/**
 * Answer the ACS challenge.
 *
 * The emulator is a single form: a `select#selectAuthResult` and a submit
 * button. This used to drive it with `Tab Tab Enter`, which worked only because
 * AUTHENTICATED happens to be the select's first option — it could never decline,
 * and it would have silently changed meaning if MPGS reordered the list. The
 * outcome is now chosen explicitly.
 */
export async function handle3DSChallenge(
  page: Page,
  opts: ThreeDSChallengeOptions = {},
): Promise<void> {
  const { outcome = 'AUTHENTICATED', urlPattern = /order-received|checkout/ } = opts;

  await expect(page.locator('center > h1')).toContainText('ACS Emulator for 3DS V2', { timeout: 30000 });
  await page.selectOption('#selectAuthResult', outcome);
  await page.click('#acssubmit');
  await page.waitForURL(urlPattern, { timeout: 60000 });
}

export async function waitFor3DSFrame(page: Page): Promise<void> {
  // Verify the 3DS challenge overlay and frame structure
  await page.waitForSelector('.absolute', { timeout: 30000 });
  await page.waitForSelector('iframe#challengeFrame', { timeout: 10000 });
}
