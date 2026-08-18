# GI Assertion Phase → Playwright Helper Mapping

This document maps each GI imported step group to its Playwright helper function call.
Use this when updating suite files to add missing assertions.

## Read this first: specs do not call these functions directly

Suites 01-15 call **composites**, not the per-phase functions below. A spec reads
`config → flow → assertions` and nothing else:

```typescript
const ctx = await checkoutHostedSession(page, config, { productId, card });
await assertCaptureLogTrail({ ...ctx, expectSessionPost: true, expectToken: false, expectCardDetailsFetch: true });
await assertOrderComplete(ctx, config, { page, adminPage, emailPage }, { status: 'Processing', note: 'captured' });
```

The phase sections below still describe **what** is asserted and are accurate on
that. They no longer show how a spec is written. Use this table to find the entry
point, then read the phase for the detail:

| Phases | Entry point | Module |
|---|---|---|
| 2-8, 10 (hosted-session log trail) | `assertCaptureLogTrail`, or `assertAuthorizeLogTrail` for AUTHORIZE mode | `helpers/assertions.ts` |
| 2, 3, 10 only (hosted checkout) | `assertHostedCheckoutLogTrail` — MPGS runs 3DS and the payment in its own UI, so phases 5-8 never reach our log | `helpers/assertions.ts` |
| Admin-triggered CAPTURE | `assertCaptureOperationLog` | `helpers/assertions.ts` |
| 1, plus checkout driving | `checkoutHostedSession` / `checkoutHostedCheckout` | `helpers/flows.ts` |
| 11, 12, 13 | `assertOrderComplete` | `helpers/flows.ts` |
| MC-001..MC-003 field validation | `describeSessionValidationCases(mode)` | `tests/_shared/session-validation-cases.ts` |

Composite options that change which phases apply: `expect3DS: false` inverts
phases 5-7 to assert *absence* (the `_3d_secure=no` suites); `authStatus` pins
phase 7 to a specific result; `expectSessionPost` / `expectToken` /
`expectCardDetailsFetch` gate phases 3, 4 and 10.

`audit-assertions.py` mirrors this table in its `COMPOSITE_EXPANSIONS`. Change one,
change the other, then run `python3 audit-assertions.py --self-check`.

## Module homes

The three-layer refactor deleted `log-verification.ts`, `email-verification.ts`,
`order-received.ts`, `my-account.ts` and `api.ts` as assertion homes:

| What | Where now |
|---|---|
| Every business assertion (`verify*`, `assert*`) | `helpers/assertions.ts` |
| Log, mail and order fetches (`getLogs`, `verifyOrderViaAPI`, `getOrderMeta`) | `helpers/wc-api.ts` |
| Order-received page read | `collectOrderReceivedData` in `helpers/flows.ts` |
| Orchestrators | `helpers/flows.ts` |
| Admin navigation, capture/void/refund actions | `helpers/admin-orders.ts` |
| Logins | `helpers/wp-login.ts` |

## Admin Test Assertion Flow (standard order)

Every admin test follows this sequence. Some phases are conditional (marked with conditions).

### Phase 1: Get Woo Order Details
```typescript
import { verifyOrderViaAPI, getOrder, getOrderMeta } from '../../helpers/wc-api';

const { order, transactionId } = await verifyOrderViaAPI(orderNumber, config);
expect(order.payment_method).toBe(config.paymentMethodSlug);
expect(order.payment_method_title).toBe(config.displayName);
expect(transactionId).toBeTruthy();
// For non-declined: verify total matches
// For renewals: verify against totalRenew instead of total
```

### Phase 2: Log Extraction

The `extract*Logs` wrappers are gone. There is one fetch, `getLogs(payDate, path,
logOffset)` in `helpers/wc-api.ts`, and the composites call it — a spec should not
need to.

```typescript
import { getLogs } from '../../helpers/wc-api';

const allLogs         = await getLogs(payDate, '', logOffset);
const sessionPostLogs = await getLogs(payDate, '/session', logOffset);
const sessionGetLogs  = await getLogs(payDate, `/session/${session}`, logOffset);
const tokenLogs       = await getLogs(payDate, '/token', logOffset);
const transactionLogs = await getLogs(payDate, '/transaction', logOffset);
```

`logOffset` matters: it is the log-entry count taken *before* checkout, so the
window excludes earlier orders. `checkoutHostedSession` captures it into
`ctx.logOffset`; pass that through.

### Phase 3: Verify Session (conditional: not renewal, not refund-exceed)
```typescript
import { verifySessionPost, verifySessionGet } from '../../helpers/assertions';

const sessionPostLog = sessionPostLogs[0].content[0];
verifySessionPost(sessionPostLog, {
  session, total, currency: 'USD', transactionId, orderNumber,
  apiOperation: 'INITIATE_CHECKOUT' // or 'CREATE_SESSION' for hosted_session
});

const sessionGetLog = sessionGetLogs[0].content[0]; // or content[1] for second entry
verifySessionGet(sessionGetLog, {
  session, card: cards.mastercard, token // token if saved card
});
```

### Phase 4: Verify Token (conditional on savingCC/tokenizedCards)
```typescript
import { verifyTokenLog, verifyTokenLogsEmpty } from '../../helpers/assertions';

// If guest or not saving CC or tokenizedCards inactive:
verifyTokenLogsEmpty(tokenLogs);

// If saving CC:
const tokenLog = tokenLogs[0].content[0];
verifyTokenLog(tokenLog, { session, card: cards.mastercard });
```

### Phase 5: Verify Initiate Authentication (conditional: 3DS active)
```typescript
import { verifyInitiateAuthentication } from '../../helpers/assertions';

const authLog = allLogs[0].content[1]; // index depends on log ordering
verifyInitiateAuthentication(authLog, {
  session, card: cards.visaChallenge, transactionId, currency: 'USD'
});
```

### Phase 6: Verify Authenticate Payer (conditional: 3DS active)
```typescript
import { verifyAuthenticatePayer } from '../../helpers/assertions';

const payerLog = allLogs[0].content[2]; // or [3] depending on ordering
verifyAuthenticatePayer(payerLog, {
  session, transactionId, currency: 'USD', card: cards.visaChallenge
});
```

### Phase 7: Verify Authentication Result (conditional: 3DS active)
```typescript
import { verifyAuthenticationResult } from '../../helpers/assertions';

verifyAuthenticationResult(authResultLog, {
  transactionId, currency: 'USD',
  authStatus: 'AUTHENTICATION_SUCCESSFUL' // or 'AUTHENTICATION_ATTEMPTED'
});
```

### Phase 8: Verify Authorize/Capture/Pay
```typescript
import { verifyAuthorizeCaptureLog } from '../../helpers/assertions';

verifyAuthorizeCaptureLog(captureLog, {
  apiOperation: 'PAY', // or 'AUTHORIZE' or 'CAPTURE'
  session, total, currency: 'USD', transactionId, orderNumber,
  card: cards.mastercard
});
```

### Phase 9: Verify Agreement (conditional: subscription)
```typescript
import { verifyAgreement } from '../../helpers/assertions';

verifyAgreement(log, {
  type: 'RECURRING', amountVariability: 'FIXED',
  subscriptionId, frequency: 'MONTHLY', payDate
});
```

### Phase 10: Verify Saved Token Log (conditional: saving CC)
```typescript
import { verifyTokenLog } from '../../helpers/assertions';

verifyTokenLog(tokenLog, { session, card: cards.mastercard });
```

### Phase 11: Email Verification
```typescript
import { verifyOrderEmails, verifyAdminEmail, verifyCustomerEmail } from '../../helpers/assertions';

// For PURCHASE transactions (admin + customer emails):
await verifyOrderEmails(orderNumber, { paymentMethodTitle: config.displayName });

// For AUTHORIZE (admin only):
await verifyAdminEmail(orderNumber, { paymentMethodTitle: config.displayName });

// For customer-only (rare):
await verifyCustomerEmail(orderNumber, { paymentMethodTitle: config.displayName, customerEmail });
```

### Phase 12: Check Order in WP Admin Backend
```typescript
// Navigate to order in admin, verify status and payment info
await adminLogin(page);
await navigateToOrder(page, orderNumber);
await assertOrderStatus(page, 'Processing'); // or 'On hold', 'Completed', 'Failed'
await expect(page.locator('.woocommerce-order-data__meta')).toContainText(`Payment via ${config.displayName}`);
// For non-declined orders, verify transaction ID in order notes:
await expect(page.locator('li.note.system-note .note_content > p').first()).toContainText(transactionId);
```

### Phase 13: Check My Account
```typescript
import { verifyPaymentMethods, verifyOrderInMyAccount, verifyCartEmpty } from '../../helpers/assertions';

// Verify saved payment methods count and details
await verifyPaymentMethods(page, { expectedCards: N, cardName: card.name, fourDigits: fourDigits(card) });

// Verify order status in My Account
await verifyOrderInMyAccount(page, orderNumber, 'Processing');

// Verify cart is empty
await verifyCartEmpty(page);
```

### Phase 14: Check Subscription (conditional)
```typescript
import { verifySubscription } from '../../helpers/assertions';

await verifySubscription(page, subscriptionId, {
  expectedStatus: 'Active',
  displayName: config.displayName
});
```

## Checkout Test Assertion Flow (standard)

### Save Card Checkbox Assertions

Pass `expectNoSaveCardCheckbox: true` to `checkoutHostedSession`; do not hand-roll
this.

```typescript
// Guest, or saved_cards off: NOT visible. Scoped to our gateway's own label.
await expect(page.locator(`label[for="wc-${config.paymentMethodSlug}-new-payment-method"]`)).not.toBeVisible();

// Blocks guest:
await expect(page.locator('div.wc-block-components-payment-methods__save-card-info input')).not.toBeVisible();

// New user with save enabled: IS visible
// Subscription: NOT visible (forced tokenization)
```

> **Do not add `page.locator('text=Save to account')`.** This map used to
> recommend it and suite 11 carried it. That wording belongs to no gateway in
> particular — WooCommerce renders the same label for every one — so on a checkout
> page that also offers PayPal it matches two elements and fails on a strict-mode
> violation rather than on anything about the payment method under test. The
> slug-scoped locator above asserts the same thing about the only gateway that
> matters here.

### Order Received Assertions
```typescript
// Standard: h1 = "Order received", .order > strong = orderNumber, .method > strong contains displayName
// Physical product: verify total in correct tfoot row
// Virtual/download: different tfoot row index
// Subscription: extract subscriptionId from td.subscription-id > a
```

## Condition Reference

| GI Variable | Meaning | Affects |
|-------------|---------|---------|
| `hosted=session` | Hosted session flow | CC fill method, session log apiOperation |
| `hosted=checkoutR` | Hosted checkout redirect | CC fill on MPGS page, INITIATE_CHECKOUT apiOperation |
| `transaction=declined` | Declined card | No order-received, error on checkout, failed order |
| `transactionType=authorize` | Auth only | On hold status, admin email only, AUTHORIZE apiOperation |
| `transactionType=capture` | Capture | Processing status, both emails, PAY apiOperation |
| `subscription=yes` | Subscription | Agreement logs, forced tokenization, subscription assertions |
| `3ds=active` | 3DS enabled | Auth initiate/payer logs present |
| `3ds=inactive` | 3DS disabled | No auth logs |
| `tokenizedCards=inactive` | Save CC disabled | Token logs empty, no save checkbox |
| `savingCC=yes` | User saves card | Token log with card details |
| `savedCC=yes` | Using saved card | Session GET has token, no new token log |
| `renewal=yes` | Subscription renewal | Uses totalRenew, no session logs, token from stored |
| `challenge=yes` | 3DS challenge | handle3DSChallenge called, PENDING in authenticate payer |
