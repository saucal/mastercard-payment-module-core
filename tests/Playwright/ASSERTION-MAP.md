# GI Assertion Phase → Playwright Helper Mapping

This document maps each GI imported step group to its Playwright helper function call.
Use this when updating suite files to add missing assertions.

## Admin Test Assertion Flow (standard order)

Every admin test follows this sequence. Some phases are conditional (marked with conditions).

### Phase 1: Get Woo Order Details
```typescript
import { verifyOrderViaAPI, getOrder, getOrderMeta } from '../../helpers/api';

const { order, transactionId } = await verifyOrderViaAPI(orderNumber, config);
expect(order.payment_method).toBe(config.paymentMethodSlug);
expect(order.payment_method_title).toBe(config.displayName);
expect(transactionId).toBeTruthy();
// For non-declined: verify total matches
// For renewals: verify against totalRenew instead of total
```

### Phase 2: Log Extraction
```typescript
import {
  extractAllLogs, extractSessionPostLogs, extractSessionGetLogs,
  extractTokenLogs, extractTransactionPutLogs
} from '../../helpers/log-verification';

const allLogs = await extractAllLogs(payDate);
const sessionPostLogs = await extractSessionPostLogs(payDate, sessionDate);
const sessionGetLogs = await extractSessionGetLogs(payDate, session);
const tokenLogs = await extractTokenLogs(payDate);
```

### Phase 3: Verify Session (conditional: not renewal, not refund-exceed)
```typescript
import { verifySessionPost, verifySessionGet } from '../../helpers/log-verification';

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
import { verifyTokenLog, verifyTokenLogsEmpty } from '../../helpers/log-verification';

// If guest or not saving CC or tokenizedCards inactive:
verifyTokenLogsEmpty(tokenLogs);

// If saving CC:
const tokenLog = tokenLogs[0].content[0];
verifyTokenLog(tokenLog, { session, card: cards.mastercard });
```

### Phase 5: Verify Initiate Authentication (conditional: 3DS active)
```typescript
import { verifyInitiateAuthentication } from '../../helpers/log-verification';

const authLog = allLogs[0].content[1]; // index depends on log ordering
verifyInitiateAuthentication(authLog, {
  session, card: cards.visaChallenge, transactionId, currency: 'USD'
});
```

### Phase 6: Verify Authenticate Payer (conditional: 3DS active)
```typescript
import { verifyAuthenticatePayer } from '../../helpers/log-verification';

const payerLog = allLogs[0].content[2]; // or [3] depending on ordering
verifyAuthenticatePayer(payerLog, {
  session, transactionId, currency: 'USD', card: cards.visaChallenge
});
```

### Phase 7: Verify Authentication Result (conditional: 3DS active)
```typescript
import { verifyAuthenticationResult } from '../../helpers/log-verification';

verifyAuthenticationResult(authResultLog, {
  transactionId, currency: 'USD',
  authStatus: 'AUTHENTICATION_SUCCESSFUL' // or 'AUTHENTICATION_ATTEMPTED'
});
```

### Phase 8: Verify Authorize/Capture/Pay
```typescript
import { verifyAuthorizeCaptureLog } from '../../helpers/log-verification';

verifyAuthorizeCaptureLog(captureLog, {
  apiOperation: 'PAY', // or 'AUTHORIZE' or 'CAPTURE'
  session, total, currency: 'USD', transactionId, orderNumber,
  card: cards.mastercard
});
```

### Phase 9: Verify Agreement (conditional: subscription)
```typescript
import { verifyAgreement } from '../../helpers/log-verification';

verifyAgreement(log, {
  type: 'RECURRING', amountVariability: 'FIXED',
  subscriptionId, frequency: 'MONTHLY', payDate
});
```

### Phase 10: Verify Saved Token Log (conditional: saving CC)
```typescript
import { verifyTokenLog } from '../../helpers/log-verification';

verifyTokenLog(tokenLog, { session, card: cards.mastercard });
```

### Phase 11: Email Verification
```typescript
import { verifyOrderEmails, verifyAdminEmail, verifyCustomerEmail } from '../../helpers/email-verification';

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
import { verifyPaymentMethods, verifyOrderInMyAccount, verifyCartEmpty } from '../../helpers/my-account';

// Verify saved payment methods count and details
await verifyPaymentMethods(page, { expectedCards: N, cardName: card.name, fourDigits: fourDigits(card) });

// Verify order status in My Account
await verifyOrderInMyAccount(page, orderNumber, 'Processing');

// Verify cart is empty
await verifyCartEmpty(page);
```

### Phase 14: Check Subscription (conditional)
```typescript
import { verifySubscription } from '../../helpers/my-account';

await verifySubscription(page, subscriptionId, {
  expectedStatus: 'Active',
  displayName: config.displayName
});
```

## Checkout Test Assertion Flow (standard)

### Save Card Checkbox Assertions
```typescript
// Guest: NOT visible
await expect(page.locator(`label[for="wc-${config.paymentMethodSlug}-new-payment-method"]`)).not.toBeVisible();
await expect(page.locator('text=Save to account')).not.toBeVisible();

// Blocks guest:
await expect(page.locator('div.wc-block-components-payment-methods__save-card-info input')).not.toBeVisible();

// New user with save enabled: IS visible
// Subscription: NOT visible (forced tokenization)
```

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
