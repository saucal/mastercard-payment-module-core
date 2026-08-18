# V2 Test Suites: DCC + Pre-Orders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Playwright coverage for the two V2 gateway addons that have none — Dynamic Currency Conversion and WooCommerce Pre-Orders — after finishing the `flows.ts` layer the existing suite was designed around but never got.

**Architecture:** Three phases, in order. **Phase A** completes the three-layer refactor from `docs/superpowers/specs/2026-07-31-playwright-three-layer-refactor-design.md`: extract the eight-block checkout-and-verify sequence that is currently pasted into ~60 test cases into `helpers/flows.ts`, and add the two missing log-trail composites that sit alongside the existing `assertCaptureLogTrail`. **Phase B** is live discovery — the DCC offer markup and the pre-order release path are gateway- and plugin-supplied DOM we have never seen, so they get captured from a real site before any spec is written rather than guessed. **Phase C** writes the two new suites on the finished layer, where each test case is ~15 lines instead of ~90.

**Tech Stack:** Playwright 1.x + TypeScript (own `package.json` under `tests/Playwright/`), WooCommerce REST + WP REST via `helpers/wc-api.ts`, the `wc-log-api-automation` companion plugin for log/mail/option endpoints, MPGS test gateway.

## Global Constraints

- **Scope is `tests/Playwright/` only.** No `includes/` or `src/` changes. If a spec proves an addon bug, record it and keep going — fixing gateway code is a separate effort.
- **Run `npx playwright test` from `tests/Playwright/`, NOT `run-tests-dev.sh`.** Corrected 2026-08-13 after the runner failed on first use. Two independent reasons:
  1. **It cannot run from this checkout.** `run-tests-dev.sh:72` walks up for a `packages/payment-core` directory and then calls `replace-domain`, `replace-prefix` and `build:core` (lines 220-222) — npm scripts that live in the *consuming* white-label plugin. This repo's `package.json` has `replace-text-domain` and none of those three, and there is no consuming-plugin checkout on this machine. Built mode exits at line 76.
  2. **It would be inert anyway.** The runner's build dance exists for one stated reason (`run-tests-dev.sh:18-21`): "the site serves this working copy directly." The configured target is remote staging — `WP_BASE_URL=https://mastercard.mystagingwebsite.com`, serving its own deployed copy — so rewriting local source cannot affect what the tests observe. `.env` already sets `META_PREFIX=mastercard_merchant_cloud`, the real built prefix, which is exactly what the build step would have produced.

  `playwright.config.ts:4` loads `.env` via dotenv, so a direct run picks up the prefix, the base URLs and the credentials. **The README's "always go through the dev runner" advice assumes a local site serving the working copy and does not apply to a remote target.** If the target is ever switched back to a local install, revisit this.
- **`workers: 3`** — three installs are configured (`playwright.config.ts:22` derives workers from `siteUrls().length`). The README's "one install therefore means one worker: a full 01-15 run takes about an hour" does not describe this setup; expect roughly 20-25 minutes.
- **`get-webhook-log` is missing from the deployed companion plugin.** Verified 2026-08-13: staging serves `get-log`, `get-mail`, `get-mastercard-order`, `to_checkout_blocks`, `to_checkout_classic`, `update-option` — no `get-webhook-log`, which the README lists as required. Anything reaching `assertions.ts#waitForWebhooks` or `wc-api.ts#getWebhookLogs` will fail on this site regardless of test correctness. Check whether a suite touches webhooks before blaming a failure on the gateway, and treat updating the companion plugin as a prerequisite for any webhook coverage.
- **Behaviour preservation in Phase A.** Every existing assertion keeps its meaning and every test keeps its ID and name. The gate is `playwright test --list` producing a byte-identical test inventory before and after, plus a live green run.
- **`configureGateway()` writes site-global gateway settings.** Any suite that flips a setting must be `test.describe.serial` and must set every setting it depends on in its first test — never inherit another suite's state. `workers` is already capped at the number of configured installs for this reason; do not raise it.
- **New suites are numbered folders** matching the existing convention: `tests/<NN>-<kebab-scenario>/suite.spec.ts`. Positional args to `playwright test` are regexes matched against the file path, so the numeric prefix is how a suite is selected.
- **Test IDs.** Existing suites use the Ghost Inspector `MC-NNN` ids. New cases have no GI ancestor, so they use a new prefix: `DCC-NNN` for Phase C Task 8, `PO-NNN` for Task 9. Do not invent new `MC-` numbers.
- **`retries: 1`, not 2.** `playwright.config.ts:51` sets 1; the README and commit `e235bcf` ("Retry twice so a run result means something") both claim 2. The config wins at runtime, so the odds of a run ending red on upstream noise alone are the README's ~6.5% figure, not ~0.85%. Do not "fix" this as a drive-by — it is a real decision about run cost, and raising it triples the worst-case wall clock. Just know which number applies when a batch goes red.
- **A suite is not done until it has been run against a live site and passed.** A `--list` pass and a TypeScript compile are necessary, never sufficient. Read the attached `flakiness-verdict` on any failure before treating it as a real defect — the measured upstream gateway failure rate is 0.16% per request against ~437 requests per full run.

---

## File Structure

**Modified in Phase A:**

| File | Responsibility after this plan |
| --- | --- |
| `helpers/flows.ts` | Grows from 1 function to 3: `collectOrderReceivedData` (unchanged), `checkoutHostedSession`, `assertOrderComplete`. Owns the orchestration currently inline in specs. |
| `helpers/assertions.ts` | Gains `assertAuthorizeLogTrail` and `assertHostedCheckoutLogTrail` next to the existing `assertCaptureLogTrail`. No existing export changes signature. |
| `tests/0[1-9]-*`, `tests/1[0-5]-*` | Thinned onto the flows layer. Same test ids, same names, same assertions. |
| `tests/08-*`, `tests/09-*` | Collapsed onto one shared case factory — these two are byte-identical in coverage. |
| `audit-assertions.py` | Hardcoded `/Users/saggio/...` and `/tmp/...` paths replaced with env vars. |
| `ASSERTION-MAP.md` | Refreshed to the current module layout. It currently documents three deleted files. |

**Created in Phase B/C:**

| File | Responsibility |
| --- | --- |
| `docs/superpowers/notes/2026-08-13-dcc-preorder-discovery.md` | Captured live DOM + admin paths + product ids. Input to Tasks 8 and 9. |
| `helpers/dcc.ts` | DCC primitives: quote-area waits, offer accept/decline actions, request-id read. |
| `helpers/pre-orders.ts` | Pre-order primitives: the admin release trigger and pre-order product cart entry. |
| `tests/_shared/session-validation-cases.ts` | The MC-001/002/003 case factory shared by suites 08 and 09. |
| `tests/19-dcc-hosted-session/suite.spec.ts` | DCC-001..DCC-006. |
| `tests/20-pre-orders/suite.spec.ts` | PO-001..PO-005. |

**Deliberately untouched:** `tests/16-*`, `tests/17-*`, `tests/18-*` (subscriptions). They have never been green and two `test.skip()` on site configuration that does not exist. Phase A's flows extraction will make them shorter later, but they are explicitly out of scope here — see "Deferred" at the end.

---

## Phase A — Finish the flows layer

### Task 1: `checkoutHostedSession` orchestrator

The single highest-leverage change in this plan. `tests/01-hosted-session-capture-classic/suite.spec.ts` repeats this exact sequence seven times, and 14 other specs repeat variants of it:

```
getLogEntryCount → addToCartAndCheckout → fillBilling → [createAccountAtCheckout]
→ selectPaymentMethod → fillHostedSessionCC | selectSavedToken → [clickSaveCardCheckbox]
→ extractOrderTotal → extractSessionId → clickPlaceOrder → [handle3DSChallenge]
→ collectOrderReceivedData → assertOrderReceived → verifyCartEmpty → verifyOrderViaAPI
→ logOrderContext
```

**Files:**
- Modify: `tests/Playwright/helpers/flows.ts` (currently 40 lines, one export)
- Modify: `tests/Playwright/tests/01-hosted-session-capture-classic/suite.spec.ts:52-109` (MC-004 only, in this task)

**Interfaces:**
- Consumes: `helpers/cart.ts#addToCartAndCheckout`, `helpers/checkout.ts#{fillBilling,createAccountAtCheckout,selectPaymentMethod,selectSavedToken,clickSaveCardCheckbox,extractOrderTotal,extractSessionId,clickPlaceOrder}`, `helpers/hosted-session.ts#fillHostedSessionCC`, `helpers/three-ds.ts#handle3DSChallenge`, `helpers/wp-login.ts#frontendLogin`, `helpers/wc-api.ts#{getLogEntryCount,verifyOrderViaAPI}`, `helpers/assertions.ts#{assertOrderReceived,verifyCartEmpty}`, `helpers/debug.ts#logOrderContext`.
- Produces: `CheckoutContext` and `checkoutHostedSession`. **`CheckoutContext` is deliberately spread-compatible with the existing `CaptureLogTrailExpected`** (`helpers/assertions.ts:970`) — its field names and types were chosen to match, so a spec can write `assertCaptureLogTrail({ ...ctx, expectSessionPost: true, ... })` with no adapter. Tasks 2, 3, 4, 8 and 9 all rely on that.

- [x] **Step 1: Record the current test inventory as the regression baseline**

This is the gate for every Phase A task. Capture it before touching anything.

`--list` output embeds `:line:col` for every test, and those shift on every edit — so a raw `diff` of two `--list` dumps flags a successful port as a coverage change. Normalize to file + test name first. Set `SP` to a scratch dir of your choosing and keep the baseline for the whole of Phase A.

```bash
cd tests/Playwright
SP=/tmp/pw-inventory && mkdir -p "$SP"
npx playwright test --list --reporter=list 2>&1 \
  | sed -E 's/:[0-9]+:[0-9]+ //' | grep '›' | sort > "$SP/names-before.txt"
wc -l < "$SP/names-before.txt"
```

Expected: **94**. That is the number to preserve through every Phase A task, and the names must match too — a rename would keep the count while changing coverage.

Reusable gate, referred to below as **the inventory gate**:

```bash
cd tests/Playwright && npx tsc --noEmit \
  && npx playwright test --list --reporter=list 2>&1 \
     | sed -E 's/:[0-9]+:[0-9]+ //' | grep '›' | sort > "$SP/names-after.txt" \
  && diff "$SP/names-before.txt" "$SP/names-after.txt" \
  && echo "INVENTORY UNCHANGED ($(wc -l < "$SP/names-after.txt") tests)"
```

> **One expected diff, from Task 4 Step 4.** The normalized line still carries the
> spec-file path, and collapsing suites 08 and 09 moved their twelve tests'
> declaration site to `_shared/session-validation-cases.ts`. So this gate reports
> twelve changed lines and `--list` reports **17 files, not 18**, while the
> describe-and-test names are byte-identical. To check names alone, drop the file
> column too:
>
> ```bash
> ... | sed -E 's/:[0-9]+:[0-9]+ //' | grep '›' \
>     | sed -E 's#^  \[chromium\] › [^›]+› ##' | sort
> ```
>
> Playwright still schedules the two spec files independently — a run puts classic
> and blocks on separate workers and separate installs.

- [x] **Step 2: Add `CheckoutContext` and `checkoutHostedSession` to `flows.ts`**

Append to `tests/Playwright/helpers/flows.ts`:

```ts
import { expect } from '@playwright/test';
import type { PluginConfig, BillingData, CardData } from '../plugin-config.types';
import { addToCartAndCheckout } from './cart';
import {
  fillBilling,
  createAccountAtCheckout,
  selectPaymentMethod,
  selectSavedToken,
  clickSaveCardCheckbox,
  extractOrderTotal,
  extractSessionId,
  clickPlaceOrder,
} from './checkout';
import { fillHostedSessionCC } from './hosted-session';
import { handle3DSChallenge } from './three-ds';
import { frontendLogin } from './wp-login';
import { getLogEntryCount, verifyOrderViaAPI } from './wc-api';
import { assertOrderReceived, verifyCartEmpty } from './assertions';
import { logOrderContext } from './debug';
import { fourDigits } from '../fixtures/cards';

/**
 * Everything a downstream assertion needs about one completed checkout.
 *
 * Field names match `CaptureLogTrailExpected` on purpose: a spec spreads this
 * straight into assertCaptureLogTrail/assertAuthorizeLogTrail and adds only the
 * three expect* booleans. Renaming a field here breaks that, so don't.
 */
export interface CheckoutContext {
  orderNumber: string;
  subscriptionId?: string;
  transactionId: string;
  /** Raw WC REST order object, for assertions that need more than the id. */
  order: any;
  session: string;
  total: string;
  payDate: string;
  logOffset: number;
  card: CardData;
}

export interface HostedSessionCheckoutOptions {
  productId: number;
  /**
   * Always required. On the saved-token path the card is not typed in, but the
   * log assertions still match against the card the token represents — so pass
   * the card that was originally saved.
   */
  card: CardData;
  /** Defaults to the shared `billing` fixture. Pass an override to vary email. */
  billing?: BillingData;
  /** Log in before adding to cart. */
  loginAs?: { email: string; password: string };
  /** Tick "create an account" at checkout with this password. */
  createAccount?: string;
  /** Tick "save payment method". */
  saveCard?: boolean;
  /** 1-based index into the saved-token list. Mutually exclusive with `card`. */
  savedTokenIndex?: number;
  /** Force the "use a new card" radio even when saved tokens exist. */
  useNewToken?: boolean;
  /**
   * 'always' waits for the ACS prompt unconditionally; 'maybe' handles it only
   * if the browser actually landed on one (saved challenge tokens may or may
   * not re-challenge, per issuer); 'never' skips it.
   */
  threeDS?: 'always' | 'maybe' | 'never';
  /** Assert the save-card checkbox is NOT rendered (guest checkout). */
  expectNoSaveCardCheckbox?: boolean;
}

/**
 * Drive a hosted-session checkout end to end and return everything the
 * assertion layer needs. Replaces the ~40-line block that was pasted into every
 * test case in suites 01-15.
 *
 * Does the buyer-side work and the order-received + REST reads only. It asserts
 * the order-received page (via assertOrderReceived) and an empty cart, because
 * both are invariants of "the checkout succeeded" rather than per-suite choices.
 * Everything else — log trails, emails, admin screens — is the caller's job via
 * assertOrderComplete and the assert*LogTrail composites.
 */
export async function checkoutHostedSession(
  page: Page,
  config: PluginConfig,
  opts: HostedSessionCheckoutOptions,
): Promise<CheckoutContext> {
  const billingData = opts.billing ?? (await import('../fixtures/billing')).billing;

  if (opts.loginAs) {
    await frontendLogin(page, opts.loginAs.email, opts.loginAs.password);
  }

  const logOffset = await getLogEntryCount(new Date().toISOString().slice(0, 19));
  const payDate = await addToCartAndCheckout(page, opts.productId);

  // A logged-in returning customer has billing pre-filled and no account
  // checkbox; only fill when the caller gave us data to fill with.
  if (!opts.loginAs || opts.billing) {
    await fillBilling(page, billingData);
  }
  if (opts.createAccount) {
    await createAccountAtCheckout(page, opts.createAccount);
  }

  await selectPaymentMethod(page, config, opts.useNewToken ?? false);

  if (opts.savedTokenIndex !== undefined) {
    await selectSavedToken(page, opts.savedTokenIndex);
  } else {
    if (!opts.card) throw new Error('checkoutHostedSession: pass either `card` or `savedTokenIndex`');
    await fillHostedSessionCC(page, opts.card, config);
  }

  if (opts.expectNoSaveCardCheckbox) {
    await expect(
      page.locator(`label[for="wc-${config.paymentMethodSlug}-new-payment-method"]`),
    ).not.toBeVisible();
  }
  if (opts.saveCard) {
    await clickSaveCardCheckbox(page);
  }

  const total = await extractOrderTotal(page);
  const session = await extractSessionId(page);

  await clickPlaceOrder(page);

  const threeDS = opts.threeDS ?? 'never';
  if (threeDS === 'always') {
    await handle3DSChallenge(page);
  } else if (threeDS === 'maybe' && /acs|3ds|threedsecure|mastercard\.com.*prompt/i.test(page.url())) {
    await handle3DSChallenge(page);
  }

  const received = await collectOrderReceivedData(page);
  await assertOrderReceived(page, { displayName: config.displayName, expectedTotal: total }, received);
  expect(received.orderNumber, 'order number should be present on order-received').toBeTruthy();
  await verifyCartEmpty(page);

  const { order, transactionId } = await verifyOrderViaAPI(received.orderNumber, config);
  expect(order.payment_method).toBe(config.paymentMethodSlug);
  expect(order.payment_method_title).toBe(config.displayName);
  expect(transactionId, 'gateway transaction id should be on the order').toBeTruthy();

  const ctx: CheckoutContext = {
    orderNumber: received.orderNumber,
    subscriptionId: received.subscriptionId,
    transactionId: transactionId!,
    order,
    session,
    total,
    payDate,
    logOffset,
    card: opts.card ?? { number: '', name: '', shortName: '', month: '', year: '', cvv: '' },
  };

  await logOrderContext(`${page.url()}`, {
    orderNumber: ctx.orderNumber, transactionId: ctx.transactionId,
    session: ctx.session, total: ctx.total, payDate: ctx.payDate, logOffset: ctx.logOffset,
    card: opts.card ? `${opts.card.name} ****${fourDigits(opts.card)}` : '(saved token)',
  });

  return ctx;
}
```

Add `Page` to the existing `@playwright/test` import at the top of the file.

> **Saved-token `card`:** a saved-token checkout has no card object at the DOM level, but `assertCaptureLogTrail` still needs a `CardData` to match log contents against, so `card` is required on every path. Suite 01's MC-007 and MC-010 already pass the originating card. **Deviation from the first draft of this plan:** `card` was going to be optional with an empty-object fallback; making it required is simpler and the fallback could only ever have masked a mistake.
>
> **Also simplified:** the default-billing lookup is a plain `import { billing as defaultBilling } from '../fixtures/billing'`, not the dynamic `await import(...)` the draft used. There was no reason for the dynamic form.
>
> **`logOrderContext` label:** `flows.ts` calls `test.info().title` (importing `test` from `@playwright/test`), which is valid anywhere inside a running test and keeps the label identical to what the inline call sites passed. No label option needed.

- [x] **Step 3: Verify it compiles and the inventory is unchanged**

Run **the inventory gate** (Task 1, Step 1).

Expected: `tsc` silent, `INVENTORY UNCHANGED`. A `flows.ts` addition cannot change the inventory; if it does, something imported at module scope is throwing.

- [x] **Step 4: Port MC-004 in suite 01 onto it**

Replace `tests/01-hosted-session-capture-classic/suite.spec.ts:52-109` (the whole `MC-004` test body) with:

```ts
  test('MC-004 - Guest checkout', async ({ page, adminPage, emailPage }) => {
    await switchCheckoutMode('classic');
    await configureGateway(config, {
      _3d_secure: 'yes',
      saved_cards: 'yes',
      transaction_mode: 'PURCHASE',
      checkout_mode: 'hosted_session',
    });

    const ctx = await checkoutHostedSession(page, config, {
      productId: config.products.physical,
      card: cards.mastercard,
      expectNoSaveCardCheckbox: true,
    });
    orderNumber = ctx.orderNumber;

    await assertCaptureLogTrail({
      ...ctx,
      expectSessionPost: true, expectToken: false, expectCardDetailsFetch: true,
    });

    await verifyOrderEmails(ctx.orderNumber, { paymentMethodTitle: config.displayName, page: emailPage });

    await navigateToOrder(adminPage, ctx.orderNumber);
    await assertOrderStatus(adminPage, 'Processing');
    await assertPaymentMethodMeta(adminPage, config, ctx.transactionId);
    await assertCapturedNote(adminPage, config, ctx.transactionId);
  });
```

Add `checkoutHostedSession` to the existing `helpers/flows` import.

Note what this preserves exactly: the guest save-card-checkbox negative assertion (now `expectNoSaveCardCheckbox`), the `verifyCartEmpty`, both `order.payment_method` / `payment_method_title` checks, the `transactionId` truthiness check, and the `logOrderContext` call. Nothing was dropped.

- [x] **Step 5: Run MC-004 against the live site**

```bash
cd tests/Playwright   # if not already there
npx playwright test '01-' --grep "MC-004"
```

Expected: 1 passed. If it fails, read the attached `flakiness-verdict` first — "no unusable gateway response" means the port is wrong, gateway requests listed means retry.

**Result 2026-08-13: 1 passed (2.2m).** Order 6162, session `SESSION0002883639194I3184681K03`, no retries. Committed as `d4e821a`.

- [x] **Step 6: Commit**

```bash
git add tests/Playwright/helpers/flows.ts tests/Playwright/tests/01-hosted-session-capture-classic/suite.spec.ts
git commit -m "test: extract checkoutHostedSession into the flows layer

Finishes step 3 of the three-layer design for the first test case. MC-004's
40-line inline checkout block becomes one call; behaviour and assertions are
unchanged."
```

---

### Task 2: `assertOrderComplete` — the verification half

The admin-side block is as duplicated as the checkout block: `navigateToOrder` appears 61 times across the specs, `assertPaymentMethodMeta` 63, `verifyOrderEmails` 48.

**Files:**
- Modify: `tests/Playwright/helpers/flows.ts`
- Modify: `tests/Playwright/tests/01-hosted-session-capture-classic/suite.spec.ts` (all seven cases)

**Interfaces:**
- Consumes: `CheckoutContext` from Task 1; `helpers/admin-orders.ts#navigateToOrder`; `helpers/assertions.ts#{assertOrderStatus,assertPaymentMethodMeta,assertCapturedNote,assertAuthorizedNote,verifyOrderEmails,verifyAdminEmail,verifyPaymentMethods,verifyOrderInMyAccount}`; `helpers/wp-login.ts#frontendLogin`.
- Produces: `assertOrderComplete(ctx, config, pages, opts)` and `OrderCompleteOptions`. Tasks 3, 4, 8, 9 call it.

- [x] **Step 1: Add `assertOrderComplete` to `flows.ts`** — done in `d4e821a` alongside Task 1; the two functions are one coherent unit and splitting the commit would have left `flows.ts` half-useful.

```ts
export interface OrderCompleteOptions {
  /** Admin order-screen status, e.g. 'Processing', 'On hold', 'Completed'. */
  status: string;
  /** Which gateway order note to require. 'none' for flows that add neither. */
  note: 'captured' | 'authorized' | 'none';
  /** 'both' = admin + customer, 'admin' = admin only (authorize flows), 'none'. */
  emails?: 'both' | 'admin' | 'none';
  /**
   * When set, logs the buyer in and checks My Account. `cards` mirrors
   * verifyPaymentMethods' own options, so pass exactly what that expects.
   */
  myAccount?: {
    email: string;
    password: string;
    expectedCards: number;
    cardName?: string;
    fourDigits?: string;
    expiryMonth?: string;
    expiryYear?: string;
    /** Mirrors assertions.ts' own `CardRow` — expiry fields are optional there. */
    cards?: Array<{ cardName: string; fourDigits: string; expiryMonth?: string; expiryYear?: string }>;
  };
}

/**
 * The email + admin-order + My Account verification block that followed every
 * checkout in suites 01-15. Log-trail assertions are NOT here: which trail
 * applies is the one thing that genuinely varies per suite, so the spec calls
 * assertCaptureLogTrail / assertAuthorizeLogTrail / assertHostedCheckoutLogTrail
 * itself, right after checkoutHostedSession and before this.
 */
export async function assertOrderComplete(
  ctx: CheckoutContext,
  config: PluginConfig,
  pages: { page: Page; adminPage: Page; emailPage: Page },
  opts: OrderCompleteOptions,
): Promise<void> {
  const emails = opts.emails ?? 'both';
  if (emails === 'both') {
    await verifyOrderEmails(ctx.orderNumber, { paymentMethodTitle: config.displayName, page: pages.emailPage });
  } else if (emails === 'admin') {
    await verifyAdminEmail(ctx.orderNumber, { paymentMethodTitle: config.displayName, page: pages.emailPage });
  }

  await navigateToOrder(pages.adminPage, ctx.orderNumber);
  await assertOrderStatus(pages.adminPage, opts.status);
  await assertPaymentMethodMeta(pages.adminPage, config, ctx.transactionId);
  if (opts.note === 'captured') {
    await assertCapturedNote(pages.adminPage, config, ctx.transactionId);
  } else if (opts.note === 'authorized') {
    await assertAuthorizedNote(pages.adminPage, config, ctx.transactionId);
  }

  if (opts.myAccount) {
    const { email, password, ...cardExpectations } = opts.myAccount;
    await frontendLogin(pages.page, email, password);
    await verifyPaymentMethods(pages.page, cardExpectations);
    await verifyOrderInMyAccount(pages.page, ctx.orderNumber, opts.status, {
      expectedTotal: ctx.total,
      displayName: config.displayName,
    });
  }
}
```

Extend the `./assertions` and `./admin-orders` imports at the top of `flows.ts` accordingly.

- [x] **Step 2: Verify compile + inventory** — passed in `d4e821a` (94 tests, unchanged).

- [x] **Step 3: Port the remaining six cases of suite 01** — `b2a4325`

MC-004 is already done (Task 1). Six left: MC-005 through MC-010.

Each case collapses to config → checkout → trail → complete. MC-009 in full, as the richest example (challenge card, saved card, two cards in My Account):

```ts
  test('MC-009 - Logged user pay with new CC and save it', async ({ page, adminPage, emailPage }) => {
    const ctx = await checkoutHostedSession(page, config, {
      productId: config.products.physical,
      card: cards.mastercard3,
      loginAs: { email: mc006Email, password: billing.password },
      useNewToken: true,
      saveCard: true,
      threeDS: 'always',
    });
    orderNumber = ctx.orderNumber;

    await assertCaptureLogTrail({
      ...ctx,
      expectSessionPost: true, expectToken: true, expectCardDetailsFetch: true,
    });

    await assertOrderComplete(ctx, config, { page, adminPage, emailPage }, {
      status: 'Processing',
      note: 'captured',
      myAccount: {
        email: mc006Email,
        password: billing.password,
        expectedCards: 2,
        cards: [
          { cardName: cards.mastercard.name, fourDigits: fourDigits(cards.mastercard), expiryMonth: cards.mastercard.month, expiryYear: cards.mastercard.year },
          { cardName: cards.mastercard3.name, fourDigits: fourDigits(cards.mastercard3), expiryMonth: cards.mastercard3.month, expiryYear: cards.mastercard3.year },
        ],
      },
    });
  });
```

The remaining six map as follows. Keep every `AUDIT 2026-04-29 vs GI:` comment block exactly where it is — those record deliberate divergences from the Ghost Inspector source and `audit-assertions.py` reads them.

| Case | `checkoutHostedSession` options | trail booleans | `assertOrderComplete` |
| --- | --- | --- | --- |
| MC-004 | `physical`, `mastercard`, `expectNoSaveCardCheckbox: true` | post ✓ token ✗ details ✓ | Processing, captured |
| MC-005 | `digital`, `mastercard`, `billing: {...billing, email: mc005Email}`, `createAccount: billing.password` | post ✓ token ✗ details ✓ | `expectedOrderStatus({product:'download',transaction:'capture'})`, captured, myAccount 0 cards |
| MC-006 | `digital`, `mastercard`, `billing: {...billing, email: mc006Email}`, `createAccount`, `saveCard: true` | post ✓ token ✓ details ✓ | same status helper, captured, myAccount 1 card |
| MC-007 | `physical`, `card: cards.mastercard`, `loginAs: mc006`, `savedTokenIndex: 1` | post ✗ token ✗ details ✗ | Processing, captured, myAccount 1 card |
| MC-008 | `physical`, `mastercard2`, `loginAs: mc006`, `useNewToken: true` | post ✓ token ✗ details ✓ | Processing, captured, myAccount 1 card |
| MC-010 | `physical`, `card: cards.mastercard3`, `loginAs: mc006`, `savedTokenIndex: 2`, `threeDS: 'maybe'` | post ✗ token ✗ details ✗ | Processing, captured, myAccount 2 cards |

- [x] **Step 4: Run the whole suite 01 live** — `b2a4325`

```bash
cd tests/Playwright   # if not already there
npx playwright test '01-'
```

Expected: 7 passed. This suite is `describe.serial` and MC-007 onward depend on the card MC-006 saved, so a single-case run is not sufficient evidence here.

- [x] **Step 5: Confirm the line count moved the right way** — `b2a4325`

```bash
wc -l tests/Playwright/tests/01-hosted-session-capture-classic/suite.spec.ts
```

Expected: roughly 150 lines, down from 485. If it is still over 250, inline blocks were left behind — find them.

- [x] **Step 6: Commit** — `b2a4325`

```bash
git add tests/Playwright/helpers/flows.ts tests/Playwright/tests/01-hosted-session-capture-classic/suite.spec.ts
git commit -m "test: port suite 01 onto the flows layer

485 -> ~150 lines. Same seven test ids, same assertions, verified by a green
live run and an unchanged --list inventory."
```

---

### Task 3: The two missing log-trail composites

`assertCaptureLogTrail` exists and works but covers only the PURCHASE hosted-session path. The authorize path and the hosted-checkout path have no composite, which is why suites 03/04/05 carry 18 inline log calls each and 14 carries 15.

**Files:**
- Modify: `tests/Playwright/helpers/assertions.ts` (append after `assertCaptureLogTrail`, which ends at line 1088)

**Interfaces:**
- Consumes: `getLogs`, `LogEntry`, `LogResponse` from `./wc-api`; the existing private-in-spirit `verifySessionGet`, `verifySessionGetCardDetails`, `verifyTokenLogsEmpty`, `verifyAuthorizeCaptureLog`, `verifyInitiateAuthentication`, `verifyAuthenticatePayer` in this same file.
- Produces: `assertAuthorizeLogTrail(expected: AuthorizeLogTrailExpected)` and `assertHostedCheckoutLogTrail(expected: HostedCheckoutLogTrailExpected)`. Tasks 4 and 9 call them. Both accept a spread `CheckoutContext` plus their own flags, exactly like `assertCaptureLogTrail`.

- [x] **Step 1: Add `assertAuthorizeLogTrail`** — `0e55529`

Append to `helpers/assertions.ts`. This is `assertCaptureLogTrail` with `apiOperation: 'AUTHORIZE'` in place of `'PAY'`, plus an optional follow-up CAPTURE assertion for the authorize-then-capture flows:

```ts
export interface AuthorizeLogTrailExpected {
  payDate: string;
  logOffset: number;
  session: string;
  total: string;
  currency?: string;
  transactionId: string;
  orderNumber: string | number;
  card: CardData;
  expectSessionPost: boolean;
  expectToken: boolean;
  expectCardDetailsFetch: boolean;
}

/**
 * The AUTHORIZE-mode sibling of assertCaptureLogTrail: identical session/token/
 * 3DS trail, but the money movement is AUTHORIZE rather than PAY and there is no
 * CAPTURE yet. Use assertCaptureOperationLog afterwards for the capture step.
 */
export async function assertAuthorizeLogTrail(expected: AuthorizeLogTrailExpected): Promise<void> {
  const currency = expected.currency ?? 'USD';
  const txFilter = (l: LogEntry) => !expected.transactionId || l.request?.url?.includes(expected.transactionId);

  const allLogs = await getLogs(expected.payDate, '', expected.logOffset);
  const sessionGetLogs = await getLogs(expected.payDate, `/session/${expected.session}`, expected.logOffset);
  const tokenLogs = await getLogs(expected.payDate, '/token', expected.logOffset);

  if (expected.expectSessionPost) {
    const sessionPostLogs = await getLogs(expected.payDate, '/session', expected.logOffset);
    expect(sessionPostLogs.logs[0]?.content.length, 'session POST logs should not be empty').toBeGreaterThan(0);
    const sessionPostLog = expected.session
      ? sessionPostLogs.logs[0].content.find((l: LogEntry) => l.response?.body?.session?.id === expected.session)
      : sessionPostLogs.logs[0].content[0];
    expect(sessionPostLog, `session POST entry not found for session ${expected.session}`).toBeTruthy();
    verifySessionPost(sessionPostLog!, {
      session: expected.session, total: expected.total, currency,
      transactionId: expected.transactionId, orderNumber: expected.orderNumber,
    });
  }

  expect(sessionGetLogs.logs[0]?.content.length, 'session GET logs should not be empty').toBeGreaterThan(0);
  const sessionPut = sessionGetLogs.logs[0].content.find(
    (l: LogEntry) => l.request?.type === 'PUT'
      && l.request?.body?.apiOperation === 'UPDATE_SESSION'
      && l.response?.body?.session?.updateStatus === 'SUCCESS',
  );
  expect(sessionPut, 'UPDATE_SESSION PUT log entry not found').toBeTruthy();
  const resolvedSession: string = expected.session
    || sessionPut!.request.body.session?.id
    || sessionPut!.response.body.session?.id
    || '';
  verifySessionGet(sessionPut!, { session: resolvedSession, card: expected.card });

  if (expected.expectCardDetailsFetch) {
    const sessionGet = sessionGetLogs.logs[0].content.find(
      (l: LogEntry) => l.request?.type === 'GET'
        && l.request?.url?.includes('/session/')
        && l.response?.body?.session?.id === resolvedSession,
    );
    expect(sessionGet, 'session GET card details entry not found').toBeTruthy();
    verifySessionGetCardDetails(sessionGet!, { session: resolvedSession, card: expected.card });
  }

  if (expected.expectToken) {
    expect(tokenLogs.logs[0]?.content.length, 'token logs should not be empty').toBeGreaterThan(0);
    verifyTokenLog(tokenLogs.logs[0].content[0], { session: resolvedSession, card: expected.card });
  } else {
    verifyTokenLogsEmpty(tokenLogs);
  }

  expect(allLogs.logs[0]?.content.length, 'all logs should not be empty').toBeGreaterThan(0);
  const logContent: LogEntry[] = allLogs.logs[0].content;

  const authorizeLog = logContent.find(
    (l: LogEntry) => l.request?.body?.apiOperation === 'AUTHORIZE' && txFilter(l) && l.response?.body?.result === 'SUCCESS',
  );
  expect(authorizeLog, 'AUTHORIZE log not found').toBeTruthy();
  verifyAuthorizeCaptureLog(authorizeLog!, {
    apiOperation: 'AUTHORIZE', session: resolvedSession, total: expected.total, currency,
    transactionId: expected.transactionId, orderNumber: expected.orderNumber, card: expected.card,
  });
}

/**
 * Assert a follow-up CAPTURE (or VOID) against an already-authorized order.
 * Used by the authorize→capture suites and by the pre-order release flow, which
 * captures through a different admin path but produces the same gateway call.
 */
export async function assertCaptureOperationLog(expected: {
  payDate: string;
  logOffset: number;
  amount: string;
  currency?: string;
  transactionId: string;
  orderNumber: string | number;
  card: CardData;
  apiOperation?: 'CAPTURE' | 'VOID_AUTHORIZATION';
}): Promise<void> {
  const apiOperation = expected.apiOperation ?? 'CAPTURE';
  const transactionLogs = await getLogs(expected.payDate, '/transaction', expected.logOffset);
  expect(transactionLogs.logs[0]?.content.length, 'transaction PUT logs should not be empty').toBeGreaterThan(0);
  const log = transactionLogs.logs[0].content.find(
    (l: LogEntry) => l.request?.body?.apiOperation === apiOperation
      && l.request?.url?.includes(expected.transactionId),
  );
  expect(log, `${apiOperation} log not found`).toBeTruthy();
  verifyAuthorizeCaptureLog(log!, {
    apiOperation, total: expected.amount, currency: expected.currency ?? 'USD',
    transactionId: expected.transactionId, orderNumber: expected.orderNumber, card: expected.card,
  });
}
```

- [x] **Step 2: Add `assertHostedCheckoutLogTrail`** — `0e55529`

Hosted checkout has a genuinely *shorter* trail — MPGS runs `INITIATE_AUTHENTICATION` / `AUTHENTICATE_PAYER` / `PAY` inside its own iframe on its own domain, so those never reach our server log. The README documents this. Asserting them would be wrong, not merely absent.

```ts
export interface HostedCheckoutLogTrailExpected {
  payDate: string;
  logOffset: number;
  session: string;
  total: string;
  currency?: string;
  transactionId: string;
  orderNumber: string | number;
  card: CardData;
  /** 'PAY' for capture mode, 'AUTHORIZE' for authorize mode. */
  apiOperation: 'PAY' | 'AUTHORIZE';
}

/**
 * Hosted-checkout log trail. Deliberately shorter than the hosted-session one:
 * MPGS performs INITIATE_AUTHENTICATION, AUTHENTICATE_PAYER and the payment
 * inside its own hosted iframe, so those calls never appear in *our* gateway log
 * (README, "Gotchas"). Only the session create/update and the final retrieve do.
 */
export async function assertHostedCheckoutLogTrail(expected: HostedCheckoutLogTrailExpected): Promise<void> {
  const currency = expected.currency ?? 'USD';
  const sessionLogs = await getLogs(expected.payDate, '/session', expected.logOffset);
  expect(sessionLogs.logs[0]?.content.length, 'hosted-checkout session logs should not be empty').toBeGreaterThan(0);

  const createSession = sessionLogs.logs[0].content.find(
    (l: LogEntry) => l.request?.type === 'POST' && l.response?.body?.session?.id === expected.session,
  );
  expect(createSession, `hosted-checkout CREATE_CHECKOUT_SESSION not found for ${expected.session}`).toBeTruthy();
  verifySessionPost(createSession!, {
    session: expected.session, total: expected.total, currency,
    transactionId: expected.transactionId, orderNumber: expected.orderNumber,
  });

  const allLogs = await getLogs(expected.payDate, '', expected.logOffset);
  expect(allLogs.logs[0]?.content.length, 'all logs should not be empty').toBeGreaterThan(0);
  const retrieve = allLogs.logs[0].content.find(
    (l: LogEntry) => l.request?.url?.includes(expected.transactionId)
      && l.request?.type === 'GET'
      && l.response?.body?.result === 'SUCCESS',
  );
  expect(retrieve, 'hosted-checkout order retrieve (GET) log not found').toBeTruthy();
  expect(retrieve!.response.body.transaction?.[0]?.transaction?.type
    ?? retrieve!.response.body.transaction?.[0]?.transaction?.authorizationCode
    ?? retrieve!.response.body.result, 'retrieve should report the settled transaction').toBeTruthy();
}
```

> **Step 2 carries real uncertainty.** The exact shape of the hosted-checkout retrieve response is the one thing here not already proven by an existing passing assertion. Suites 03/04/05 pass today with inline assertions — before writing this composite, read `tests/03-hosted-checkout-embedded-capture/suite.spec.ts:100-130` and mirror what it actually checks rather than the sketch above. If they differ, the existing spec is the authority: it is green against the live gateway and this is not.

- [x] **Step 3: Verify compile + inventory** — `0e55529`

Run **the inventory gate** (Task 1, Step 1).

Expected: silent, `INVENTORY UNCHANGED`. The composites have no callers yet, so this only proves they compile.

- [x] **Step 4: Commit** — `0e55529`

```bash
git add tests/Playwright/helpers/assertions.ts
git commit -m "test: add authorize and hosted-checkout log-trail composites

Siblings of the existing assertCaptureLogTrail. No callers yet; suites move onto
them in the next task."
```

---

### Task 4: Port suites 02-15 onto the flows layer

**Files:**
- Modify: `tests/Playwright/tests/02-*` through `tests/15-*/suite.spec.ts` (14 files)
- Create: `tests/Playwright/tests/_shared/session-validation-cases.ts`

**Interfaces:**
- Consumes: everything produced by Tasks 1-3.
- Produces: `describeSessionValidationCases(mode: 'classic' | 'blocks')` from the new `_shared` module, called by suites 08 and 09.

- [x] **Step 1: Port suite 02 (blocks capture) — five cases** — `db3396e`

02 is **not** a copy of 01. It has five cases, not seven: no MC-006, no MC-007, and its MC-010 is "Logged user pay with saved CC" where 01's MC-010 is "second saved CC". **Do not merge 02 into 01's factory** — that would silently change coverage. Thin it independently, using the same shape as Task 2 Step 3, with `switchCheckoutMode('blocks')`.

Expected result: 666 → roughly 120 lines. This is the single biggest reduction in the suite.

- [x] **Step 2: Run suite 02 live** — `db3396e`

```bash
npx playwright test '02-'
```

Expected: 5 passed.

- [x] **Step 3: Commit, then repeat for the rest in these batches** — batches a-f in `8883db4`, `1564926`, `3e4265f` and the 13-15 commit below

Port and verify one batch at a time. Each batch is a commit and a live run — do not batch the runs, because a break in one suite is far cheaper to locate against one changed suite than five.

| Batch | Suites | Trail composite to use |
| --- | --- | --- |
| a | 03, 04, 05 (hosted checkout) | `assertHostedCheckoutLogTrail` — `apiOperation: 'PAY'` for 03/04, `'AUTHORIZE'` for 05 |
| b | 06, 07 (3DS active / inactive) | `assertCaptureLogTrail` |
| c | 08, 09 (session validation) | none — these assert DOM validation, not logs. Collapse via Step 4 below. |
| d | 10, 11 (declined, save-cc-off) | `assertCaptureLogTrail` |
| e | 12, 13 (pay-for-order, add-payment-method) | `assertCaptureLogTrail` |
| f | 14, 15 (authorize/capture/void, refund) | `assertAuthorizeLogTrail` + `assertCaptureOperationLog` |

> **What the table got wrong, as executed.** Four of these six rows needed
> correcting against the live specs. Recorded here because the sketch reads as
> authoritative and the specs are what actually hold.
>
> - **Row b, suite 07** — runs `_3d_secure: 'no'` and asserts
>   `INITIATE_AUTHENTICATION` / `AUTHENTICATE_PAYER` are *absent*. The composite
>   required them present. Added `expect3DS?: boolean`.
> - **Row b, suite 06** — pins a specific final auth status per case and runs
>   `verifyAuthenticationResult` on it. The composite only probed for existence,
>   and only for challenge cards, so MC-051 (`SUCCESSFUL`) and MC-052
>   (`ATTEMPTED`) would have become the same test. Added `authStatus?`.
> - **Row d, suite 10** — **not ported, on purpose.** A declined checkout never
>   reaches order-received, so `checkoutHostedSession`'s order-received and
>   empty-cart assertions do not apply, and the PAY log is a `FAILURE`, so no
>   trail composite fits. It is already 148 lines with its own local
>   `pickFailedOrderSince`. Porting it would mean a fourth orchestrator for three
>   cases sharing fifteen lines.
> - **Row e, suite 13** — only MC-051 of its ten cases is a checkout; the rest
>   drive `/my-account/add-payment-method` and never place an order. Expect a
>   small line delta here (332 → 288), not a large one.
> - **Row f, suite 15** — is PURCHASE + REFUND. There is no authorize trail and
>   no capture operation, so neither listed composite applies. It asserts no
>   checkout trail at all, deliberately: the REFUND is what is under test.
>
> Hosted checkout also needed its own orchestrator, `checkoutHostedCheckout`,
> which Task 1 did not build — twelve cases were repeating its ~25 lines.

Per batch:

```bash
cd tests/Playwright
npx playwright test '(03|04|05)-'   # adjust the regex per batch
```

Then run **the inventory gate** (Task 1, Step 1), and commit:

```bash
git add -A tests/Playwright/tests && git commit -m "test: port suites 03-05 onto the flows layer"
```

- [x] **Step 4: Collapse suites 08 and 09 onto one shared factory** — `16d2ffb`

Unlike 01/02, these two are genuinely identical: six cases, same ids, same names (`MC-001 - Session loading`, `MC-002 - Place order without CC info`, and four `MC-003` variants). The only difference is classic vs blocks, which `switchCheckoutMode` + `getSelectors(mode)` already parameterize.

Create `tests/Playwright/tests/_shared/session-validation-cases.ts`:

```ts
import { test, expect } from '../../fixtures/test';
import { switchCheckoutMode, configureGateway } from '../../helpers/wc-api';
import { addToCartAndCheckout } from '../../helpers/cart';
import { fillBilling, selectPaymentMethod, clickPlaceOrder, getCheckoutError } from '../../helpers/checkout';
import { assertSessionFieldsPresent, fillHostedSessionCCPartial } from '../../helpers/hosted-session';
import config from '../../plugin-config';
import { cards } from '../../fixtures/cards';
import { billing } from '../../fixtures/billing';
import type { CheckoutMode } from '../../helpers/checkout';

/**
 * MC-001..MC-003 hosted-session field-validation cases. Suites 08 (classic) and
 * 09 (blocks) were byte-identical in coverage; this is the single copy, called
 * once per mode. Test ids and names are unchanged from both originals.
 */
export function describeSessionValidationCases(mode: CheckoutMode): void {
  // ... exact bodies lifted from tests/08-hosted-session-session-classic/suite.spec.ts,
  // with switchCheckoutMode(mode) in place of the hardcoded mode. Copy them
  // verbatim; do not paraphrase the assertions.
}
```

> **This step is a copy, not a rewrite.** Open `tests/08-*/suite.spec.ts`, move the six test bodies across unchanged, and replace only the literal `'classic'` with `mode`. Then both `tests/08-*/suite.spec.ts` and `tests/09-*/suite.spec.ts` become three lines: import, `test.describe.serial('...', () => describeSessionValidationCases('classic'))`, done. The describe *titles* stay different (`Hosted Session - Session - Classic` / `- Blocks`) so the inventory diff stays clean.

```bash
npx playwright test '(08|09)-'
```

Expected: 12 passed (6 per mode).

- [x] **Step 5: Final Phase A gate — full 01-15 run** — 67 passed in 31.0m, no retries, no flaky verdicts. New upstream-noise baseline.

```bash
cd tests/Playwright   # if not already there
npx playwright test '(0[1-9]|1[0-5])-'
```

Expected: all green. With `workers: 3` this is roughly 20-25 minutes, not the README's one hour (that figure assumes a single install). This is the run that earns the right to build on this layer. Note in the commit how many retries fired and what the `flakiness-verdict` attachments said; that is the new upstream-noise baseline.

- [x] **Step 6: Commit** — `b430934`

```bash
git add -A tests/Playwright
git commit -m "test: complete the flows-layer port for suites 01-15

Full 01-15 run green. --list inventory identical to pre-refactor baseline."
```

---

### Task 5: Unblock the coverage gate and refresh the stale map

Two known-broken support pieces, both called out in the design doc and the README but never done. Small, and they stop misleading the next person.

> **This task needed more than its four steps, because Task 4 broke the script.**
> Fixing the paths would have produced a *runnable* audit that lied. The specs no
> longer contain the identifiers the matchers grep for — those calls moved behind
> the composites — so with a real GI export the audit reported near-total coverage
> loss across suites 01-15. Measured before the fix: 18 identifier-suite hits
> across a 13-identifier sample; after, 143.
>
> Added, beyond Steps 1-4:
>
> - `COMPOSITE_EXPANSIONS` — what each orchestrator and composite performs, read
>   off its body in `helpers/`, so a spec calling `assertCaptureLogTrail` counts as
>   covering the phases it actually asserts. Mirrors ASSERTION-MAP's entry-point
>   table; keep the two in step.
> - `load_playwright_spec` follows `../_shared/…` imports, so suites 08 and 09 are
>   not read as empty now that their six test bodies live in the shared module.
>   Scoped to `_shared` on purpose: pulling in `helpers/` would make every
>   identifier match everywhere and the audit always green.
> - `--self-check`, which verifies every identifier the script looks for is still
>   exported by `helpers/` or `tests/_shared/`. It runs without a GI export, and it
>   immediately caught three dead references: `extractAllLogs`, `extractTokenLogs`
>   and `verifyOrderReceived` (split into `assertOrderReceived` and
>   `collectOrderReceivedData`). Run it after touching either file.
>
> The map also recommended `page.locator('text=Save to account')`, which is the
> locator that broke suite 01 during Task 4 — it matches every gateway's save-card
> label, not ours. That advice is now an explicit warning instead.

**Files:**
- Modify: `audit-assertions.py:17-22`
- Modify: `tests/Playwright/ASSERTION-MAP.md`

- [x] **Step 1: Replace the hardcoded paths in `audit-assertions.py`**

Lines 17-22 currently read:

```python
GI_BASE = (
    "/Users/saggio/Dropbox/@@ Portable Soft/GIT/docker-environment"
)
PW_BASE = "/tmp/payment-core-playwright/tests/Playwright/tests"
```

Replace with:

```python
import os

# Both default to nothing so a missing GI export fails with a clear message
# instead of silently auditing zero suites against a path that never existed.
GI_BASE = os.environ.get("GI_BASE", "")
PW_BASE = os.environ.get(
    "PW_BASE",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "tests", "Playwright", "tests"),
)

if not GI_BASE or not os.path.isdir(GI_BASE):
    raise SystemExit(
        "GI_BASE is unset or not a directory.\n"
        "Point it at the Ghost Inspector export root:\n"
        "  GI_BASE=/path/to/docker-environment python3 audit-assertions.py"
    )
if not os.path.isdir(PW_BASE):
    raise SystemExit(f"PW_BASE is not a directory: {PW_BASE}")
```

- [x] **Step 2: Verify the script now fails loudly rather than silently** — exits 1 with the GI_BASE message.

```bash
cd /Users/christian/projects/mastercard-payment-module-core
python3 audit-assertions.py
```

Expected: exits with the `GI_BASE is unset` message. That is the correct outcome without a GI export in hand — the old code would have produced an empty or nonsense audit instead.

- [x] **Step 3: Refresh `ASSERTION-MAP.md`'s module references**

`tests/Playwright/README.md:21-23` flags this in the README's own text: the map still refers to `log-verification.ts`, `email-verification.ts` and `order-received.ts`, all deleted. Update the module column to the current homes — `helpers/assertions.ts` for every business assertion, `helpers/wc-api.ts` for the log/mail fetches, `helpers/flows.ts` for the order-received read — and add the three composites (`assertCaptureLogTrail`, `assertAuthorizeLogTrail`, `assertHostedCheckoutLogTrail`) as the entry points for the phase groups they cover. Keep the 14-phase structure; it is still accurate about *what* is asserted.

Then delete the now-false warning at `README.md:21-23`.

- [x] **Step 4: Commit**

```bash
git add audit-assertions.py tests/Playwright/ASSERTION-MAP.md tests/Playwright/README.md
git commit -m "test: unbreak audit-assertions.py paths, refresh ASSERTION-MAP

The audit script pointed at one developer's home directory and /tmp; it now
takes GI_BASE/PW_BASE from the environment and refuses to run silently. The
assertion map documented three modules deleted in the three-layer refactor."
```

---

## Phase B — Discovery before writing new specs

### Task 6: Capture the live DCC and pre-order surfaces

**Everything in Phase C depends on this task, and none of it can be answered from the repo.** The DCC offer markup is authored by MPGS and injected as an HTML blob (`offerText`) — `src/js/frontend/_hostedSessions.js:1335` shows the plugin only knows it might be a single hidden input or a set of radios named `dccOfferState`. The pre-order release path is WooCommerce Pre-Orders' admin UI, which is not in this repo at all. Writing selectors for either without looking would be guessing.

**Files:**
- Create: `docs/superpowers/notes/2026-08-13-dcc-preorder-discovery.md`
- Modify: `tests/Playwright/plugin-config.ts`, `tests/Playwright/plugin-config.types.ts`, `tests/Playwright/.env.example`

**Interfaces:**
- Produces: the discovery note (input to Tasks 7-9), plus `config.products.preOrderUpfront`, `config.products.preOrderRelease`, and `config.dccMetaKeys` on `PluginConfig`.

- [x] **Step 1: Confirm the environment prerequisites the whole phase rests on** — `01bf0f6`

```bash
source tests/Playwright/.env
# The companion plugin's routes — every log, mail and option assertion needs these
curl -s -u "$WP_USERNAME:$WP_API_PASS" "$WP_BASE_URL/wp-json/custom/v1" | jq -r '.routes|keys[]'
```

Expected to include `get-log`, `get-mail`, `get-webhook-log`, `update-option`, `to_checkout_classic`, `to_checkout_blocks`. A `rest_no_route` on `get-mail` means the deployed companion plugin predates the email transport — update it rather than working around it.

```bash
# Pre-Orders active, and the gateway's own DCC setting present
wp plugin list --status=active --field=name | grep -i pre-order
wp option get "woocommerce_${GATEWAY_SLUG}_settings" --format=json | jq '.currency_conversion, .checkout_mode, .debug'
```

Expected: the pre-orders plugin listed; `debug` is `"yes"` (without it nothing is logged and every log assertion fails).

- [x] **Step 2: Find the two pre-order products and record their ids** — `78f3f25`

The two pre-order paths behave completely differently and both need a product:
- **charged upfront** → normal `PURCHASE`, pre-order marked complete at checkout
- **charged upon release** → `AUTHORIZE` (`includes/GatewayAddons/PreOrders.php:103`), forced card tokenization, capture deferred to release

```bash
wp post list --post_type=product --format=table --fields=ID,post_title
# For each candidate, the two meta keys that decide the path:
wp post meta get <ID> _wc_pre_orders_enabled
wp post meta get <ID> _wc_pre_orders_when_to_charge   # 'upfront' | 'upon_release'
```

Record both ids. If only one exists, create the other in the admin — a charge-upon-release product is mandatory for PO-002 through PO-005 and there is no way to test that path without one.

- [x] **Step 3: Find a card/currency pair that actually produces a DCC offer** — `01bf0f6`

DCC only quotes when the card's billing currency differs from the order currency. The store stays in its normal currency — **no store-currency switching is needed for gateway DCC**, which is why scope was set to the gateway feature only. What is needed is a test card issued outside that currency.

```bash
# Enable DCC, then watch the quote call
wp option patch update "woocommerce_${GATEWAY_SLUG}_settings" currency_conversion yes
```

Then, for each card in `fixtures/cards.ts`, drive a checkout to the point where card entry completes and watch for the `paymentOptionsInquiry` response:

```bash
cd tests/Playwright
npx playwright test --list  # sanity
# Use playwright-cli interactively against the checkout, or add a scratch spec
# that fills the card and dumps the quote-area HTML:
#   await page.locator(`#${config.paymentMethodSlug}_currency_conversion`).innerHTML()
```

Record, for the card that produces an offer:
- the card number used
- the **full HTML** of `#<slug>_currency_conversion` after the quote lands
- whether `input[name="dccOfferState"]` renders as one hidden input or several radios, and the exact `value` of each. `includes/GatewayAddons/DynamicCurrencyConversion.php:203` compares the literal string `'Accept'`, so anything else maps to `DECLINED` — confirm the real values rather than assuming.
- the `value` of `#<slug>_dcc_request_id` after the quote

- [x] **Step 4: Find the pre-order release trigger** — `01bf0f6`

`includes/GatewayAddons/PreOrders.php:73` hooks `wc_pre_orders_process_pre_order_completion_payment_<gateway>`, fired by the Pre-Orders plugin when a pre-order is released. Find how an admin fires it: locate the Pre-Orders admin screen, and record the exact URL, the control (bulk action vs per-row link), and its selector.

Note also that `PreOrders.php:309` hides the gateway capture metabox for any pre-order — so the release cannot be triggered through the normal capture form, and PO-004 asserts that metabox is absent.

- [x] **Step 5: Write the discovery note** — `01bf0f6`

Create `docs/superpowers/notes/2026-08-13-dcc-preorder-discovery.md` with: the confirmed REST routes, both pre-order product ids and their `_wc_pre_orders_when_to_charge` values, the DCC-producing card number, the verbatim offer-area HTML, the exact `dccOfferState` control shape and values, the `dcc_request_id` format, and the pre-order release URL + selector. Anything that could not be confirmed goes in an explicit "unresolved" section — Tasks 7-9 must not invent a selector for an unresolved item.

- [x] **Step 6: Extend `plugin-config.ts` with what was found** — `01bf0f6`

`plugin-config.types.ts` — add to `PluginConfig`:

```ts
  products: {
    physical: number;
    digital: number;
    subscription: number;
    preOrderUpfront: number;
    preOrderRelease: number;
  };
  dccMetaKeys: {
    exchangeRate: string;
    currency: string;
    amount: string;
  };
```

`plugin-config.ts` — add to the config object (meta keys mirror `DynamicCurrencyConversion.php:228-230`, which prefix with the same build-time hook prefix every other meta key uses):

```ts
  products: {
    physical: parseInt(process.env.PRODUCT_PHYSICAL || '61', 10),
    digital: parseInt(process.env.PRODUCT_DIGITAL || '316', 10),
    subscription: parseInt(process.env.PRODUCT_SUBSCRIPTION || '66', 10),
    preOrderUpfront: parseInt(process.env.PRODUCT_PREORDER_UPFRONT || '0', 10),
    preOrderRelease: parseInt(process.env.PRODUCT_PREORDER_RELEASE || '0', 10),
  },
  dccMetaKeys: {
    exchangeRate: `${metaPrefix}_dcc_exchange_rate`,
    currency: `${metaPrefix}_dcc_currency`,
    amount: `${metaPrefix}_dcc_amount`,
  },
```

Default the pre-order ids to `0` rather than a guess, and document in `.env.example` that suite 20 requires both. A `0` fails immediately and legibly; a wrong hardcoded id produces a confusing mid-checkout failure.

Add to `.env.example`:

```
# WooCommerce Pre-Orders product IDs — suite 20 will not run without both.
# Upfront = charged at checkout; Release = charged when the pre-order is released.
PRODUCT_PREORDER_UPFRONT=
PRODUCT_PREORDER_RELEASE=

# A card issued in a currency other than the store currency, so MPGS returns a
# DCC quote. See docs/superpowers/notes/2026-08-13-dcc-preorder-discovery.md
CARD_DCC_FOREIGN=
```

- [x] **Step 7: Commit** — `01bf0f6`

```bash
git add docs/superpowers/notes/2026-08-13-dcc-preorder-discovery.md \
        tests/Playwright/plugin-config.ts tests/Playwright/plugin-config.types.ts \
        tests/Playwright/.env.example
git commit -m "test: record DCC + pre-order discovery, extend plugin-config

Captures the live DCC offer markup, the DCC-triggering card, both pre-order
product ids and the release trigger, so suites 19 and 20 can be written against
observed DOM rather than guessed selectors."
```

---

## Phase C — The new suites

### Task 7: DCC primitives

**Files:**
- Create: `tests/Playwright/helpers/dcc.ts`
- Modify: `tests/Playwright/helpers/assertions.ts`

**Interfaces:**
- Consumes: the discovery note's confirmed selectors; `config.dccMetaKeys`; `helpers/wc-api.ts#getOrderMeta`.
- Produces: `waitForDccQuote`, `respondToDccOffer`, `readDccRequestId`, `assertNoDccQuote` (in `dcc.ts`); `assertDccOrderMeta`, `assertDccReceiptRow`, `assertDccAdminPanel`, `assertDccQuoteLog` (in `assertions.ts`). Task 8 calls all of them.

- [x] **Step 1: Write `helpers/dcc.ts`** — `c7325c2`

```ts
import { Page, expect } from '@playwright/test';
import type { PluginConfig } from '../plugin-config.types';

/** The quote area the gateway injects its offer HTML into. */
function quoteArea(page: Page, config: PluginConfig) {
  return page.locator(`#${config.paymentMethodSlug}_currency_conversion`);
}

/** The hidden field carrying the quote's requestId back to the server. */
function requestIdField(page: Page, config: PluginConfig) {
  return page.locator(`#${config.paymentMethodSlug}_dcc_request_id`);
}

/**
 * Wait for the paymentOptionsInquiry quote to land and populate the offer area.
 *
 * The quote fires on card-field validation, not on page load, so this must be
 * called after fillHostedSessionCC. The request-id field is the reliable signal:
 * _hostedSessions.js sets the offer HTML and the request id together, and clears
 * both on failure, so a non-empty request id means a real offer arrived.
 */
export async function waitForDccQuote(page: Page, config: PluginConfig, timeout = 30_000): Promise<string> {
  await expect
    .poll(async () => (await requestIdField(page, config).inputValue().catch(() => '')).length, {
      message: 'DCC quote requestId never populated — no offer came back from the gateway',
      timeout,
    })
    .toBeGreaterThan(0);
  return requestIdField(page, config).inputValue();
}

/**
 * Assert that NO quote was offered. Used for the paths where DCC must stay out
 * of the way: the setting off, and a cart containing a subscription
 * (DynamicCurrencyConversion.php:109 bails on those).
 */
export async function assertNoDccQuote(page: Page, config: PluginConfig): Promise<void> {
  // Poll rather than assert once: the quote is async, so a bare check would pass
  // simply by running before a quote that does eventually arrive.
  await expect
    .poll(async () => (await requestIdField(page, config).inputValue().catch(() => '')).length, {
      message: 'a DCC quote arrived where none should have',
      timeout: 8_000,
    })
    .toBe(0);
  await expect(quoteArea(page, config)).toBeEmpty();
}

/**
 * Accept or decline the offer. The control's shape is gateway-authored HTML, so
 * the exact selector and values come from the discovery note — fill them in from
 * docs/superpowers/notes/2026-08-13-dcc-preorder-discovery.md before use.
 */
export async function respondToDccOffer(
  page: Page,
  config: PluginConfig,
  choice: 'accept' | 'decline',
): Promise<void> {
  const value = choice === 'accept' ? 'Accept' : 'Decline';
  const control = page.locator(`input[name="dccOfferState"][value="${value}"]`);
  await control.waitFor({ state: 'visible', timeout: 15_000 });
  await control.check();
  await expect(control).toBeChecked();
}

export async function readDccRequestId(page: Page, config: PluginConfig): Promise<string> {
  return requestIdField(page, config).inputValue();
}
```

> **`respondToDccOffer` values are the one guess left in this plan, and it must not survive Step 1.** `DynamicCurrencyConversion.php:203` compares against the literal `'Accept'` and treats everything else as `DECLINED`, which is why `'Accept'` is the accept value — but the *decline* value and the control type (radio vs something else) are gateway-authored. Replace both with the observed values from the discovery note before running anything. If the discovery note listed this as unresolved, stop and resolve it; do not proceed on the guess.

- [x] **Step 2: Add the DCC assertions to `assertions.ts`**

> **The sketch's `assertDccQuoteLog` was wrong and is split in two.** It asserted a
> `PAYMENT_OPTIONS_INQUIRY` entry in our gateway log for every DCC case. That entry
> only exists on the **saved-token** path: `ajax_dcc_quote` inquires server-side via
> `api()->payment_options_inquiry()`. For an entered card, `_hostedSessions.js:1422`
> posts the inquiry from the **browser straight to MPGS** —
> `dccRequestEndpoint` is `api()->get_domain() . 'paymentOptionsInquiry'`,
> authenticated with the session id — so nothing passes through WordPress to log.
> As written it would have failed DCC-001, 002, 003 and 005 for a reason unrelated
> to DCC working.
>
> - `assertDccUptakeLog` — the universal signal. `maybe_add_dcc_payment_data`
>   attaches `currencyConversion: { requestId, uptake }` to the payment data our
>   server sends, so it is in the PAY/AUTHORIZE request body on every path.
> - `assertDccQuoteInquiryLog` — the server-side inquiry, saved-token path only
>   (DCC-004). Its failure message says so, so the next person does not debug a
>   phantom.
>
> Everything else in the sketch checked out against
> `includes/GatewayAddons/DynamicCurrencyConversion.php`: the three meta keys and
> their ACCEPTED-plus-complete-quote precondition (`:220-230`), the `Paid Amount:`
> receipt row (`:258`), and all five admin-panel labels (`:294-305`). The admin
> panel locator now targets the `<p>` following the `<h4>` rather than the
> heading's parent, which is the whole order-data box.
>
> `LogEntry` in `wc-api.ts` gained `request.body.currencyConversion` and
> `response.body.paymentTypes` — the DCC fields were not in the type.

```ts
// ─── Dynamic Currency Conversion ──────────────────────────────────────────────

export interface DccExpected {
  /** The payer's currency, i.e. the card's — not the store's. */
  payerCurrency: string;
}

/**
 * Assert the three dcc_* meta keys DynamicCurrencyConversion::process_dcc_data
 * writes on an accepted offer. Only written on ACCEPTED with a complete quote,
 * so this is also the negative assertion for declined offers via `expectAbsent`.
 */
export async function assertDccOrderMeta(
  orderNumber: string,
  config: PluginConfig,
  expected: DccExpected & { expectAbsent?: boolean },
): Promise<void> {
  const order = await getOrder(orderNumber);
  const rate = getOrderMeta(order, config.dccMetaKeys.exchangeRate);
  const currency = getOrderMeta(order, config.dccMetaKeys.currency);
  const amount = getOrderMeta(order, config.dccMetaKeys.amount);

  if (expected.expectAbsent) {
    expect(rate, 'dcc exchange rate should not be written for a declined offer').toBeFalsy();
    expect(currency, 'dcc currency should not be written for a declined offer').toBeFalsy();
    expect(amount, 'dcc amount should not be written for a declined offer').toBeFalsy();
    return;
  }

  expect(rate, 'dcc exchange rate meta missing').toBeTruthy();
  expect(Number(rate), 'dcc exchange rate should be numeric and non-zero').toBeGreaterThan(0);
  expect(currency, 'dcc currency meta missing').toBe(expected.payerCurrency);
  expect(Number(amount), 'dcc converted amount should be numeric and non-zero').toBeGreaterThan(0);
  // The converted amount must differ from the order total — same number means
  // the "conversion" did nothing and the assertion above would pass vacuously.
  expect(Number(amount), 'converted amount should differ from the order total')
    .not.toBe(Number(order.total));
}

/**
 * The "Paid Amount:" row render_dcc_data_receipt adds to the order totals table
 * on the order-received page and in My Account.
 */
export async function assertDccReceiptRow(page: Page, expected: DccExpected): Promise<void> {
  const row = page.locator('tr:has-text("Paid Amount"), li:has-text("Paid Amount")').first();
  await expect(row, 'DCC "Paid Amount" row missing from the receipt').toBeVisible({ timeout: 15_000 });
  await expect(row).toContainText(expected.payerCurrency);
}

/**
 * The DCC panel render_dcc_data prints after the billing address on the admin
 * order screen. Asserts all five labels, since a partial render is the likely
 * failure and a single-label check would miss it.
 */
export async function assertDccAdminPanel(page: Page, expected: DccExpected): Promise<void> {
  const panel = page.locator('h4:has-text("Dynamic Currency Conversion")').locator('..');
  await expect(panel, 'DCC admin panel missing').toBeVisible({ timeout: 15_000 });
  for (const label of ['Original Currency:', 'Payment Currency:', 'Original Amount:', 'Paid Amount (Converted):', 'Exchange Rate:']) {
    await expect(panel, `DCC panel missing "${label}"`).toContainText(label);
  }
  await expect(panel).toContainText(expected.payerCurrency);
}

/**
 * Assert the PAYMENT_OPTIONS_INQUIRY quote call and the currencyConversion block
 * on the PAY request that followed it.
 */
export async function assertDccQuoteLog(expected: {
  payDate: string;
  logOffset: number;
  transactionId: string;
  uptake: 'ACCEPTED' | 'DECLINED' | 'NOT_AVAILABLE';
}): Promise<void> {
  const allLogs = await getLogs(expected.payDate, '', expected.logOffset);
  expect(allLogs.logs[0]?.content.length, 'all logs should not be empty').toBeGreaterThan(0);
  const content: LogEntry[] = allLogs.logs[0].content;

  const inquiry = content.find((l: LogEntry) => l.request?.body?.apiOperation === 'PAYMENT_OPTIONS_INQUIRY');
  expect(inquiry, 'PAYMENT_OPTIONS_INQUIRY log not found').toBeTruthy();
  expect(inquiry!.response?.body?.result, 'quote inquiry should succeed').toBe('SUCCESS');
  expect(
    inquiry!.response?.body?.paymentTypes?.card?.currencyConversion?.requestId,
    'quote response should carry a currencyConversion requestId',
  ).toBeTruthy();

  const pay = content.find(
    (l: LogEntry) => l.request?.url?.includes(expected.transactionId)
      && (l.request?.body?.apiOperation === 'PAY' || l.request?.body?.apiOperation === 'AUTHORIZE'),
  );
  expect(pay, 'PAY/AUTHORIZE log not found for the DCC order').toBeTruthy();
  expect(
    pay!.request?.body?.currencyConversion?.uptake,
    `PAY request should carry uptake=${expected.uptake}`,
  ).toBe(expected.uptake);
}
```

Extend the existing `./wc-api` import in `assertions.ts:3` — it currently reads
`import { getLogs, getWebhookLogs, getLogEntryCount, getLoggedMail } from './wc-api';`
and needs `getOrder` and `getOrderMeta` added.

- [x] **Step 3: Verify compile** — clean; `--list` unchanged at 94, as expected for helpers with no callers yet.

```bash
cd tests/Playwright && npx tsc --noEmit
```

Expected: silent.

- [x] **Step 4: Commit**

```bash
git add tests/Playwright/helpers/dcc.ts tests/Playwright/helpers/assertions.ts
git commit -m "test: add DCC primitives and assertions"
```

---

### Task 8: Suite 19 — DCC hosted session

Covers what `includes/GatewayAddons/DynamicCurrencyConversion.php` actually does: quote on card entry, accept → converted meta + receipt row + admin panel, decline → no meta, offer-state validation, saved-token quote via the AJAX endpoint, and the two paths where DCC must stay silent.

**Files:**
- Create: `tests/Playwright/tests/19-dcc-hosted-session/suite.spec.ts`

**Interfaces:**
- Consumes: Tasks 1, 2, 7; `config.dccMetaKeys`; the discovery note's card and selectors.

- [ ] **Step 1: Write DCC-001 (accept the offer) and run it**

```ts
import { test, expect } from '../../fixtures/test';
import { switchCheckoutMode, configureGateway } from '../../helpers/wc-api';
import { addToCartAndCheckout } from '../../helpers/cart';
import { fillBilling, selectPaymentMethod, clickPlaceOrder, extractOrderTotal, extractSessionId, getCheckoutError } from '../../helpers/checkout';
import { fillHostedSessionCC } from '../../helpers/hosted-session';
import { checkoutHostedSession, assertOrderComplete, collectOrderReceivedData } from '../../helpers/flows';
import { waitForDccQuote, respondToDccOffer, assertNoDccQuote } from '../../helpers/dcc';
import { assertDccOrderMeta, assertDccReceiptRow, assertDccAdminPanel, assertDccQuoteLog, assertOrderReceived } from '../../helpers/assertions';
import { navigateToOrder } from '../../helpers/admin-orders';
import config from '../../plugin-config';
import { cards } from '../../fixtures/cards';
import { billing } from '../../fixtures/billing';

// The card that produces a quote, and the currency it is issued in. Both come
// from docs/superpowers/notes/2026-08-13-dcc-preorder-discovery.md — DCC only
// quotes when the card currency differs from the order currency.
const dccCard = cards[process.env.CARD_DCC_FOREIGN ?? 'mastercard'];
const PAYER_CURRENCY = process.env.CARD_DCC_CURRENCY ?? 'EUR';

test.describe.serial('DCC - Hosted Session', () => {
  test.beforeAll(() => {
    expect(
      config.products.physical,
      'PRODUCT_PHYSICAL must be set',
    ).toBeGreaterThan(0);
  });

  test('DCC-001 - Accept the conversion offer', async ({ page, adminPage, emailPage }) => {
    await switchCheckoutMode('classic');
    await configureGateway(config, {
      _3d_secure: 'no',
      saved_cards: 'yes',
      transaction_mode: 'PURCHASE',
      checkout_mode: 'hosted_session',
      currency_conversion: 'yes',
    });

    // Hand-driven rather than via checkoutHostedSession: the offer has to be
    // answered between card entry and place-order, which is inside that flow.
    const logOffset = await (await import('../../helpers/wc-api')).getLogEntryCount(new Date().toISOString().slice(0, 19));
    const payDate = await addToCartAndCheckout(page, config.products.physical);
    await fillBilling(page, billing);
    await selectPaymentMethod(page, config);
    await fillHostedSessionCC(page, dccCard, config);

    const requestId = await waitForDccQuote(page, config);
    expect(requestId, 'quote requestId should be non-empty').toBeTruthy();
    await respondToDccOffer(page, config, 'accept');

    const total = await extractOrderTotal(page);
    const session = await extractSessionId(page);
    await clickPlaceOrder(page);

    const received = await collectOrderReceivedData(page);
    await assertOrderReceived(page, { displayName: config.displayName, expectedTotal: total }, received);
    const { order, transactionId } = await (await import('../../helpers/wc-api')).verifyOrderViaAPI(received.orderNumber, config);

    // The converted amount is shown on the receipt the buyer is looking at now.
    await assertDccReceiptRow(page, { payerCurrency: PAYER_CURRENCY });

    await assertDccQuoteLog({ payDate, logOffset, transactionId: transactionId!, uptake: 'ACCEPTED' });
    await assertDccOrderMeta(received.orderNumber, config, { payerCurrency: PAYER_CURRENCY });

    await navigateToOrder(adminPage, received.orderNumber);
    await assertDccAdminPanel(adminPage, { payerCurrency: PAYER_CURRENCY });
  });
});
```

```bash
npx playwright test '19-' --grep "DCC-001"
```

Expected: 1 passed. A failure in `waitForDccQuote` means the card/currency pair does not produce an offer — go back to Task 6 Step 3 rather than loosening the assertion.

- [ ] **Step 2: Add DCC-002 (decline) and run**

Same as DCC-001 through the quote, then `respondToDccOffer(page, config, 'decline')`. Assert:
- `assertDccQuoteLog({ ..., uptake: 'DECLINED' })`
- `assertDccOrderMeta(orderNumber, config, { payerCurrency: PAYER_CURRENCY, expectAbsent: true })` — `process_dcc_data` returns early unless uptake is `ACCEPTED`
- no "Paid Amount" row: `await expect(page.locator('tr:has-text("Paid Amount")')).toHaveCount(0)`
- no admin DCC panel: `await expect(adminPage.locator('h4:has-text("Dynamic Currency Conversion")')).toHaveCount(0)`
- the order total still in the store currency, unchanged

- [ ] **Step 3: Add DCC-003 (offer state not chosen is rejected) and run**

`validate_dcc_data` (`DynamicCurrencyConversion.php:153`) adds a checkout error when a `_dcc_request_id` is present but no `dccOfferState` was submitted. Fill the card, wait for the quote, do **not** answer the offer, then place the order and assert the error:

```ts
    await clickPlaceOrder(page);
    expect(await getCheckoutError(page)).toContain('accept or reject the currency conversion offer');
    // And no order was created
    await expect(page).toHaveURL(/checkout/);
```

> If the gateway renders the offer as a single *hidden* `dccOfferState` input rather than radios (the `Unavailable` shape, `_hostedSessions.js:1335`), this case cannot be provoked from the UI — the field is always submitted. If the discovery note shows that shape, **skip DCC-003 with an explanatory `test.skip()` naming the reason**; do not delete it, and do not fake the condition by removing the field with JS.

- [ ] **Step 4: Add DCC-004 (saved-token quote) and run**

Exercises `ajax_dcc_quote`, a different code path from the card-entry quote — it fetches the quote server-side from the stored token instead of from the card number. Reuse the card saved by DCC-001 if it saved one; otherwise run a `saveCard: true` checkout first via `checkoutHostedSession`, then:

```ts
    await selectPaymentMethod(page, config);
    await selectSavedToken(page, 1);
    const requestId = await waitForDccQuote(page, config);
    expect(requestId).toBeTruthy();
    await respondToDccOffer(page, config, 'accept');
```

Then the same accept assertions as DCC-001, plus: the quote came from the AJAX endpoint, not the browser-to-gateway call.

- [ ] **Step 5: Add DCC-005 (setting off ⇒ no quote) and run**

```ts
    await configureGateway(config, { currency_conversion: 'no', /* ...rest as DCC-001 */ });
```

Then fill the card and `assertNoDccQuote(page, config)`. Also assert the info area itself is absent — `display_dcc_info_area` only prints the div when `dcc_enabled`:

```ts
    await expect(page.locator(`#${config.paymentMethodSlug}_currency_conversion`)).toHaveCount(0);
```

Finish the checkout and confirm it succeeds normally with no `dcc_*` meta. **This test must restore `currency_conversion: 'yes'` or run last** — the setting is site-global and a leaked `'no'` silently guts every other DCC test.

- [ ] **Step 6: Add DCC-006 (subscription cart ⇒ no quote) and run**

`init_dcc_hooks` bails when the cart contains a subscription (`DynamicCurrencyConversion.php:109`), so no DCC script data, no quote. With `currency_conversion: 'yes'` and `subscription: 'yes'`, add `config.products.subscription` to the cart and `assertNoDccQuote(page, config)`.

Guard it, since the subscription product depends on WooCommerce Subscriptions being configured:

```ts
    test.skip(!config.products.subscription, 'PRODUCT_SUBSCRIPTION not configured');
```

- [ ] **Step 7: Run the whole suite and commit**

```bash
npx playwright test '19-'
```

Expected: 6 passed (or passed-with-documented-skips for DCC-003/DCC-006).

```bash
git add tests/Playwright/tests/19-dcc-hosted-session
git commit -m "test: add suite 19 - DCC hosted session

Covers accept, decline, unanswered-offer validation, the saved-token AJAX quote,
and the two paths where DCC must stay silent (setting off, subscription cart)."
```

---

### Task 9: Suite 20 — Pre-orders

Covers `includes/GatewayAddons/PreOrders.php`. The two paths are genuinely different flows, not variants: charged-upfront is an ordinary purchase, charged-upon-release is `AUTHORIZE` + forced tokenization + a deferred capture fired by the Pre-Orders release action.

**Files:**
- Create: `tests/Playwright/helpers/pre-orders.ts`
- Create: `tests/Playwright/tests/20-pre-orders/suite.spec.ts`

**Interfaces:**
- Consumes: Tasks 1, 2, 3 (`assertAuthorizeLogTrail`, `assertCaptureOperationLog`); the discovery note's product ids and release path.
- Produces: `releasePreOrder(adminPage, orderNumber)` and `assertPreOrderStatus(adminPage, expected)` in `helpers/pre-orders.ts`.

- [ ] **Step 1: Write `helpers/pre-orders.ts`**

```ts
import { Page, expect } from '@playwright/test';
import { siteUrl } from './site';
import { ensureAdminSession } from './wp-login';

/**
 * Fire the pre-order release, which is what triggers
 * wc_pre_orders_process_pre_order_completion_payment_<gateway> and therefore the
 * deferred capture in PreOrders::process_pre_order_release_payment.
 *
 * The screen URL and control come from
 * docs/superpowers/notes/2026-08-13-dcc-preorder-discovery.md — fill both in
 * from the observed admin UI before use.
 */
export async function releasePreOrder(adminPage: Page, orderNumber: string): Promise<void> {
  await ensureAdminSession(adminPage);
  await adminPage.goto(`${siteUrl()}/wp-admin/admin.php?page=wc_pre_orders`);
  await adminPage.waitForLoadState('domcontentloaded');

  const row = adminPage.locator(`tr:has-text("#${orderNumber}")`).first();
  await expect(row, `pre-order row for #${orderNumber} not found on the pre-orders screen`)
    .toBeVisible({ timeout: 30_000 });

  // Selector per the discovery note.
  await row.locator('a:has-text("Complete"), .complete').first().click();
  await adminPage.waitForLoadState('load');
}

/** The pre-order's own status column, distinct from the WC order status. */
export async function assertPreOrderStatus(adminPage: Page, expected: string): Promise<void> {
  await expect(adminPage.locator('.wc-pre-orders-status, td.pre_order_status').first())
    .toContainText(expected, { timeout: 15_000 });
}
```

- [ ] **Step 2: Write PO-001 (charged upfront) and run**

The upfront path takes no special branch — `maybe_add_pre_order_payment_data` returns early (`PreOrders.php:98`) — so this is an ordinary capture checkout plus the pre-order-specific admin state. That makes it the cheapest case and the right one to prove the plumbing.

```ts
  test('PO-001 - Pre-order charged upfront', async ({ page, adminPage, emailPage }) => {
    await switchCheckoutMode('classic');
    await configureGateway(config, {
      _3d_secure: 'no', saved_cards: 'yes',
      transaction_mode: 'PURCHASE', checkout_mode: 'hosted_session',
    });

    const ctx = await checkoutHostedSession(page, config, {
      productId: config.products.preOrderUpfront,
      card: cards.mastercard,
    });

    await assertCaptureLogTrail({
      ...ctx, expectSessionPost: true, expectToken: false, expectCardDetailsFetch: true,
    });
    await assertOrderComplete(ctx, config, { page, adminPage, emailPage }, {
      status: 'Processing', note: 'captured',
    });

    // PreOrders::maybe_hide_capture_meta_box_pre_order hides the gateway capture
    // box for every pre-order, upfront included.
    await assertCaptureFormVisible(adminPage, config, false);
  });
```

Guard the whole suite on the product ids being configured:

```ts
  test.beforeAll(() => {
    expect(config.products.preOrderUpfront, 'PRODUCT_PREORDER_UPFRONT must be set — see .env.example').toBeGreaterThan(0);
    expect(config.products.preOrderRelease, 'PRODUCT_PREORDER_RELEASE must be set — see .env.example').toBeGreaterThan(0);
  });
```

```bash
npx playwright test '20-' --grep "PO-001"
```

Expected: 1 passed.

- [ ] **Step 3: Write PO-002 (charged upon release — checkout half) and run**

The interesting path. `maybe_add_pre_order_payment_data` forces `apiOperation: 'AUTHORIZE'` regardless of the gateway's `transaction_mode`, and `maybe_force_save_method_pre_order` forces tokenization. So: set `transaction_mode: 'PURCHASE'` deliberately, and assert the gateway still authorized — that is the whole point of the addon and the assertion that would catch it regressing.

```ts
  test('PO-002 - Pre-order charged upon release authorizes and tokenizes', async ({ page, adminPage, emailPage }) => {
    await configureGateway(config, {
      _3d_secure: 'no', saved_cards: 'yes',
      transaction_mode: 'PURCHASE',   // deliberately PURCHASE: the addon must override it
      checkout_mode: 'hosted_session',
    });

    const ctx = await checkoutHostedSession(page, config, {
      productId: config.products.preOrderRelease,
      card: cards.mastercard,
      billing: { ...billing, email: preOrderEmail },
      createAccount: billing.password,
      // No saveCard: the addon forces tokenization, so the checkbox is hidden.
    });
    releaseCtx = ctx;

    // Forced tokenization means a token WAS created even though nothing was ticked.
    await assertAuthorizeLogTrail({
      ...ctx, expectSessionPost: true, expectToken: true, expectCardDetailsFetch: true,
    });

    await assertOrderComplete(ctx, config, { page, adminPage, emailPage }, {
      status: 'Pre-ordered',
      note: 'authorized',
      emails: 'admin',
    });
  });
```

> **`status: 'Pre-ordered'` is the label to verify first.** `mark_order_as_pre_ordered` sets the Pre-Orders plugin's own status, and `maybe_bypass_change_status` stops the gateway from moving it. Confirm the exact admin label from the discovery note or a manual checkout before trusting this string — `assertOrderStatus` does an exact text match and a wrong label fails in a way that looks like a gateway bug.

- [ ] **Step 4: Write PO-003 (release captures the authorized funds) and run**

Depends on PO-002's order, so keep the suite `describe.serial` and carry `releaseCtx`.

```ts
  test('PO-003 - Releasing the pre-order captures the authorization', async ({ adminPage }) => {
    expect(releaseCtx, 'PO-002 must have run first').toBeTruthy();

    await releasePreOrder(adminPage, releaseCtx.orderNumber);

    await navigateToOrder(adminPage, releaseCtx.orderNumber);
    await assertOrderStatus(adminPage, 'Processing');
    // PreOrders::process_pre_order_release_payment adds its own note.
    await assertOrderNoteContains(adminPage, 'pre-order payment captured');

    await assertCaptureOperationLog({
      payDate: releaseCtx.payDate,
      logOffset: releaseCtx.logOffset,
      amount: releaseCtx.total,
      transactionId: releaseCtx.transactionId,
      orderNumber: releaseCtx.orderNumber,
      card: releaseCtx.card,
    });
  });
```

> The capture fires after PO-002's `payDate`/`logOffset` window opened, so reusing that window is correct and finds the entry. But if the release happens on a *later day* than the checkout, `getLogs` reads a different log file and finds nothing. If this suite is ever split across a date boundary, capture a fresh `payDate`/`logOffset` immediately before `releasePreOrder` instead.

- [ ] **Step 5: Write PO-004 (forced-save UI) and run**

Asserts the two UI consequences of forced tokenization, both pure DOM and cheap:

```ts
  test('PO-004 - Save-card checkbox hidden and notice reworded', async ({ page }) => {
    await addToCartAndCheckout(page, config.products.preOrderRelease);
    await fillBilling(page, billing);
    await selectPaymentMethod(page, config);

    // maybe_display_save_checkbox_pre_orders returns false for these carts.
    await expect(page.locator(`label[for="wc-${config.paymentMethodSlug}-new-payment-method"]`))
      .toHaveCount(0);

    // change_save_card_notice_pre_order swaps the notice text.
    await expect(page.locator('.payment_box, .wc-block-components-payment-method-content'))
      .toContainText('allowing to charge your card for future payments');
  });
```

- [ ] **Step 6: Write PO-005 (hosted checkout declines the tokenization path) and run**

`init_addon_pre_orders` returns early — never adding `'pre-orders'` to `supports` — when the mode is hosted checkout and the cart needs tokenization (`PreOrders.php:44`). The observable result is that the gateway does not offer itself for that cart.

```ts
  test('PO-005 - Hosted checkout does not support tokenized pre-orders', async ({ page }) => {
    await configureGateway(config, {
      checkout_mode: 'hosted_checkout', hosted_checkout_mode: 'embedded',
      transaction_mode: 'PURCHASE', _3d_secure: 'no',
    });

    await addToCartAndCheckout(page, config.products.preOrderRelease);
    await fillBilling(page, billing);
    await expect(
      page.locator(`li.payment_method_${config.paymentMethodSlug}, #radio-control-wc-payment-method-options-${config.paymentMethodSlug}`),
      'gateway should not be offered for a tokenizing pre-order in hosted-checkout mode',
    ).toHaveCount(0);
  });
```

**Restore `checkout_mode: 'hosted_session'` at the end of this test** — it is site-global, and leaving hosted checkout on breaks every later suite.

- [ ] **Step 7: Run the whole suite, then the full regression, and commit**

```bash
npx playwright test '20-'
# Then prove the new suites did not leak gateway settings into the old ones:
npx playwright test '(0[1-9]|1[0-5]|19|20)-'
```

Expected: all green. The second run is the one that matters — suites 19 and 20 both flip site-global settings, and a leak shows up as an unrelated older suite failing.

```bash
git add tests/Playwright/helpers/pre-orders.ts tests/Playwright/tests/20-pre-orders
git commit -m "test: add suite 20 - pre-orders

Covers charged-upfront, charged-upon-release (AUTHORIZE override + forced
tokenization), the release capture, the forced-save UI, and hosted checkout
declining the tokenization path."
```

- [ ] **Step 8: Update the README's suite status**

`tests/Playwright/README.md:176-182` currently says "01-15 ported and green, 16-18 not ported". Update to reflect 19 and 20, and add the two new prerequisites to the Prerequisites list: WooCommerce Pre-Orders active with both product types, and `currency_conversion` plus a foreign-currency card for DCC. Add the new env vars to the setup table.

```bash
git add tests/Playwright/README.md
git commit -m "docs: document suites 19-20 and their prerequisites"
```

---

## Deferred: subscriptions (suites 16-18)

Not in this plan, by decision. Current state:

- **16** (1,060 lines, 62 inline log calls) has never been green.
- **17** `test.skip()`s at line 218 — needs WooCommerce Subscriptions *Switching* configured and an upgradeable product, which the site does not have.
- **18** `test.skip()`s at line 213 — needs early manual renewal enabled, likewise absent.

Two of the three are blocked on site configuration rather than test code, so they are not work that can be finished by writing TypeScript. When they are picked up, Phase A pays off there too: 16's 62 inline log calls are largely `assertCaptureLogTrail` plus an agreement assertion, so the missing piece is one more composite (`assertSubscriptionAgreementTrail`, wrapping the existing `verifyAgreement`) alongside the two added in Task 3.

---

## Self-Review

**Spec coverage.** Every element of the agreed scope maps to a task: gateway DCC → Tasks 7-8 (accept, decline, validation, saved-token AJAX quote, setting-off, subscription-exclusion — all six branches in `DynamicCurrencyConversion.php`); pre-orders → Task 9 (both charge modes, release capture, forced-save UI, hosted-checkout exclusion — all five branches in `PreOrders.php`); "refactor first" → Phase A, Tasks 1-5. Subscriptions explicitly deferred with reasons. Store-side multi-currency deliberately excluded per the scope decision, and Task 6 Step 3 records *why* it is not needed (DCC keys off card currency, not store currency).

**Two guesses are flagged, not hidden.** `respondToDccOffer`'s decline value and control type (Task 7 Step 1) and the `'Pre-ordered'` status label (Task 9 Step 3) are gateway- and plugin-authored strings that cannot be read from this repo. Both carry an explicit instruction to replace them from the Task 6 discovery note before running, and Task 6 Step 5 requires unconfirmable items to be listed as unresolved. `assertHostedCheckoutLogTrail` (Task 3 Step 2) carries the same warning, with the existing green suite 03 named as the authority over the sketch.

**Type consistency.** `CheckoutContext` (Task 1) is spread-compatible with `CaptureLogTrailExpected` (existing), `AuthorizeLogTrailExpected` and `HostedCheckoutLogTrailExpected` (Task 3) — verified field by field: `payDate`, `logOffset`, `session`, `total`, `transactionId`, `orderNumber`, `card` are present in all four with matching types. `assertOrderComplete`'s `myAccount` field names mirror `verifyPaymentMethods`' existing options exactly (`expectedCards`, `cardName`, `fourDigits`, `expiryMonth`, `expiryYear`, `cards`), so it destructures straight through. `config.dccMetaKeys` is defined in Task 6 Step 6 and consumed in Task 7 Step 2. `config.products.preOrder{Upfront,Release}` defined in Task 6 Step 6, consumed in Task 9.

**Honest limitation.** Every live-run step in this plan is a real gate that requires a reachable, correctly configured site. None of them can be satisfied by compilation or `--list`. A task whose live run has not happened is not complete, regardless of how the code reads.
