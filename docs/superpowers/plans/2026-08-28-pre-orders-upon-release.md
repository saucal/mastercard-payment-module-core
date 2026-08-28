# Pre-orders Charged Upon Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a charge-upon-release pre-order store a credential at checkout without taking money, and charge the full total at release, in both hosted session and hosted checkout.

**Architecture:** The stored-credential shape already exists in `Subscriptions.php` — a `VERIFY` with `agreement` and `storedOnFile: TO_BE_STORED` at checkout, then a MERCHANT-initiated `PAY` on the token later. `PreOrders.php` grows its own copy of that shape rather than sharing it, because suites 16-18 are blocked and any edit to the subscription payment path would ship unverified. Two small filter-shaped changes in the gateway core support it; everything else lives in the addon.

**Tech Stack:** PHP 8.0+, WordPress/WooCommerce, WooCommerce Pre-Orders, MPGS REST API, Playwright (TypeScript) against remote staging installs.

**Spec:** `docs/superpowers/specs/2026-08-28-pre-orders-upon-release-design.md`

## Global Constraints

- PHP >= 8.0. No new runtime dependencies — neither `composer.json` has any, and the build relies on that.
- `PAYMENTS_CORE_HOOK_PREFIX_` and `__PAYMENTS_CORE_TEXT_DOMAIN__` are **literal strings in source**, replaced at build time. Write them literally; never substitute a real prefix.
- WordPress Coding Standards. `composer run-script phpcs` and `phpstan analyse` must both pass before every commit.
- Every code change is confined to: `includes/GatewayAddons/PreOrders.php`, `includes/Gateways/WC_Abstract_Payment_Gateway.php`, `includes/PaymentToken.php`, `tests/Playwright/**`.
- Playwright: one worker per configured install — two workers on one site fight over `configureGateway()`, which writes site-global settings.
- **Any Playwright run longer than a few minutes must be launched detached.** The Bash tool's 600000 ms cap is silently clamped and then kills the run mid-test, losing all output. Use `nohup ... & disown` and poll a log. `setsid` does not exist on macOS.
- Read a run's outcome from the reporter's own summary line (`N passed` / `N failed`), never from the `[n/total]` progress counter and never from an empty `test-results/`.
- Suite 20 is `test.describe.serial` — PO-003 depends on state PO-002 created. Keep new pairs serial in the same way.
- Test ids continue the `PO-` series. `PO-005` is retired and not reused.

## Assumption gates

Three MPGS behaviours cannot be verified from source. Each is proved by the first task that depends on it, and each task says what to do if it fails. **A failed gate means stop and revise the spec, not work around it.**

| Gate | Proved by | If it fails |
| --- | --- | --- |
| MPGS accepts a `$X` PAY on an order whose only prior transaction was a `$0` VERIFY | Task 3 | The release charge needs its own MPGS order id with `referenceOrderId` pointing at the verify, as `Subscriptions.php:610-628` does for renewals |
| MPGS Hosted Checkout accepts `interaction.operation = VERIFY` with `order.amount = 0.00` | Task 6 | Hosted checkout cannot carry these pre-orders. Revert Task 6, and instead fix the existing guard to actually fire by deferring registration to `woocommerce_cart_loaded_from_session`, as `init_addon_dcc` does (`DynamicCurrencyConversion.php:72`) |
| MPGS CREATE TOKEN accepts a hosted-checkout session id | Task 7 | Build `PaymentToken::create_from_order_data()` instead — Task 7 Step 6 covers this branch |

## Carried assumption — guests

WooCommerce payment tokens are user-bound, so a guest cannot hold the credential this flow depends on. **This plan implements: a cart containing a tokenizing pre-order requires an account** (Task 8). This was not confirmed by the user. If they would rather allow guests some other way, Task 8 is the only task to change.

## File structure

| File | Responsibility | Change |
| --- | --- | --- |
| `includes/GatewayAddons/PreOrders.php` | Everything pre-order-specific: payload shaping for both modes, token persistence on the hosted-checkout return, the release charge, the guest guard | Heavily modified |
| `includes/Gateways/WC_Abstract_Payment_Gateway.php:599` | Add one filter so a `VERIFIED` order need not be marked paid | 4 lines |
| `includes/PaymentToken.php` | Token minting | New method, only on the Task 7 fallback branch |
| `tests/Playwright/tests/20-pre-orders/suite.spec.ts` | Suite 20 | PO-002/PO-003 rewritten, PO-005 deleted, PO-006..PO-012 added |
| `tests/Playwright/helpers/assertions.ts` | Business assertions | `assertVerifyLogTrail`, `assertReleasePayLog` added |
| `tests/Playwright/helpers/pre-orders.ts` | Pre-order primitives | `cancelPreOrder` added |

---

### Task 0: Baseline and deploy loop

No production code. This task exists because every later task's test step depends on getting the working tree onto a staging install, and because a red baseline must not be mistaken for a regression you caused.

**Files:**
- Modify: none

- [ ] **Step 1: Establish how this working tree reaches the staging install under test**

This repo is the core module only — it has no plugin header and cannot be installed. The installable plugin is the wrapper `saucal/mastercard-merchant-cloud`, which pulls core in as the `packages/payment-core` submodule.

```sh
# Wrapper branch feature/playwright-mastercard-suite — NOT master, which is from
# Feb 2026 and whose .gitmodules still points at the old payment-module-core repo.
git clone -b feature/playwright-mastercard-suite <wrapper-repo> /tmp/wrapper
rsync -a --exclude .git --exclude node_modules --exclude vendor \
  /Users/christian/projects/mastercard-payment-module-core/ /tmp/wrapper/packages/payment-core/
cd /tmp/wrapper && npm install   # postinstall composer step fails on GitHub auth; harmless
npm run package
```

The last mile — installing that zip on the staging install — is the team's existing deployment path and is not scripted in this repo. **Confirm it works and note the exact command in this step before starting Task 1.** Every later task's "deploy" step means: rebuild as above, install, verify the version bumped.

- [ ] **Step 2: Confirm the suite-20 prerequisites still hold**

```sh
cd tests/Playwright
set -a; . ./.env; set +a
curl -s -u "$WP_USERNAME:$WP_API_PASS" "$WP_BASE_URL/wp-json/custom/v1" | jq -r '.routes|keys[]'
```

Expected: at least `get-log`, `get-mail`, `get-webhook-log`, `update-option`, `to_checkout_classic`, `to_checkout_blocks`. A `rest_no_route` for `get-mail` means the companion plugin on staging predates the email transport — update it rather than working around it.

- [ ] **Step 3: Run suite 20 unchanged and record the baseline**

```sh
cd tests/Playwright
set -a; . ./.env; set +a
nohup npx playwright test 20-pre-orders --reporter=line > /tmp/po-baseline.log 2>&1 < /dev/null &
disown
```

Poll `grep -oE "\[[0-9]+/[0-9]+\]" /tmp/po-baseline.log` for progress and read the final summary line.

Expected: 4 passed, 1 failed. **The failure must be PO-005** — it is a deliberate `test.fail()` documenting the bug this plan removes. Any other failure is a pre-existing problem to resolve before starting.

- [ ] **Step 4: Commit the deploy note**

Add the exact deploy command discovered in Step 1 to `tests/Playwright/README.md` under Prerequisites.

```bash
git add tests/Playwright/README.md
git commit -m "docs: record the staging deploy command the pre-order work depends on"
```

---

### Task 1: The `VERIFIED` branch must not complete the payment

**Files:**
- Modify: `includes/Gateways/WC_Abstract_Payment_Gateway.php:590-607`

**Interfaces:**
- Produces: filter `PAYMENTS_CORE_HOOK_PREFIX_complete_verified_payment` — `apply_filters( string, bool $complete, WC_Order $order )`, default `true`. Task 2 answers it `false` for tokenizing pre-orders.

`process_wc_order`'s `VERIFIED` branch calls `$order->payment_complete()` unconditionally. For a `$0` verify that stamps `date_paid` and makes `is_paid()` true before any money has moved.

This task ships the filter alone, with no consumer. It is deliberately unobservable on its own — the default preserves today's behaviour exactly — and is separated so that the behaviour change in Task 2 has a single, reviewable cause.

- [ ] **Step 1: Add the filter**

In `includes/Gateways/WC_Abstract_Payment_Gateway.php`, in the `case 'VERIFIED':` branch, replace the bare `$order->payment_complete( $order_data['id'] );` with:

```php
				/**
				 * Filter whether a verified payment should be marked complete.
				 *
				 * A zero-amount VERIFY stores a credential without moving money,
				 * so a flow that verifies now and charges later must be able to
				 * keep the order unpaid.
				 *
				 * @since 2.0.0
				 */
				if ( apply_filters( 'PAYMENTS_CORE_HOOK_PREFIX_complete_verified_payment', true, $order ) ) {
					$order->payment_complete( $order_data['id'] );
				}
```

Leave the order note above it and the `payment_success` action below it untouched — both must still fire.

- [ ] **Step 2: Verify statically**

```sh
composer run-script phpcs includes/Gateways/WC_Abstract_Payment_Gateway.php
vendor/bin/phpstan analyse -c phpstan.neon
```

Expected: no errors from either.

- [ ] **Step 3: Prove the default is inert**

Deploy, then re-run the one existing suite that exercises a `VERIFY` — suite 13, add-payment-method:

```sh
cd tests/Playwright
set -a; . ./.env; set +a
nohup npx playwright test 13-hosted-session-add-payment-method --reporter=line > /tmp/po-t1.log 2>&1 < /dev/null &
disown
```

Expected: 10 passed. A failure here means the filter changed behaviour it should not have.

- [ ] **Step 4: Commit**

```bash
git add includes/Gateways/WC_Abstract_Payment_Gateway.php
git commit -m "feat(core): let a verified payment opt out of payment_complete"
```

---

### Task 2: Hosted-session `$0` verify

**Files:**
- Modify: `includes/GatewayAddons/PreOrders.php:56-106`
- Test: `tests/Playwright/tests/20-pre-orders/suite.spec.ts` (PO-002), `tests/Playwright/helpers/assertions.ts`

**Interfaces:**
- Consumes: `PAYMENTS_CORE_HOOK_PREFIX_complete_verified_payment` from Task 1.
- Produces: `PreOrders::pre_order_agreement_id( WC_Order $order ): string`, used by Task 3 and Task 6. `assertVerifyLogTrail(expected): Promise<void>` in `helpers/assertions.ts`, used by Task 6.

- [ ] **Step 1: Write the failing test**

In `tests/Playwright/helpers/assertions.ts`, add — modelled on `assertCaptureOperationLog` (line 1170), which is the closest existing shape:

```typescript
/**
 * The checkout half of a charge-upon-release pre-order.
 *
 * Asserts the two things that together mean "credential stored, nothing
 * charged": a VERIFY whose order.amount is 0.00 carrying the agreement, and the
 * absence of any PAY or AUTHORIZE in the same window. The WooCommerce order
 * total is deliberately NOT 0 — only the payload amount is.
 */
export async function assertVerifyLogTrail(expected: {
  payDate: string;
  logOffset: number;
  orderNumber: string | number;
  agreementId: string;
  /** Inverts the 3DS section, exactly as suite 07 does with the same name. */
  expect3DS: boolean;
}): Promise<void> {
  const transactionLogs = await getLogs(expected.payDate, '/transaction', expected.logOffset);
  const entries = transactionLogs.logs[0]?.content ?? [];
  expect(entries.length, 'transaction PUT logs should not be empty').toBeGreaterThan(0);

  const verify = entries.find((l: LogEntry) => l.request?.body?.apiOperation === 'VERIFY');
  expect(verify, 'VERIFY log not found').toBeTruthy();
  expect(verify!.request.body.order.amount, 'the verify must charge nothing').toBe('0.00');
  expect(verify!.request.body.agreement?.id).toBe(expected.agreementId);
  expect(verify!.request.body.sourceOfFunds?.provided?.card?.storedOnFile).toBe('TO_BE_STORED');
  expect(verify!.response.body.result, 'the verify must succeed').toBe('SUCCESS');

  const charged = entries.filter(
    (l: LogEntry) => ['PAY', 'AUTHORIZE'].includes(l.request?.body?.apiOperation),
  );
  expect(charged, 'nothing may be charged at checkout for an upon-release pre-order').toHaveLength(0);

  const auth = entries.filter(
    (l: LogEntry) => ['INITIATE_AUTHENTICATION', 'AUTHENTICATE_PAYER'].includes(l.request?.body?.apiOperation),
  );
  if (expected.expect3DS) {
    expect(auth.length, 'the verify must authenticate when 3DS is on').toBeGreaterThan(0);
  } else {
    expect(auth, 'no authentication may happen when 3DS is off').toHaveLength(0);
  }
}
```

In `tests/Playwright/tests/20-pre-orders/suite.spec.ts`, replace PO-002 entirely:

```typescript
  // === PO-002: Charged upon release — the checkout half ===

  test('PO-002 - Pre-order charged upon release verifies and tokenizes', async ({ page, adminPage, emailPage }) => {
    // Deliberately PURCHASE: maybe_add_pre_order_payment_data must override it
    // with VERIFY. Asserting the verify trail against a PURCHASE setting is the
    // assertion that catches the addon regressing.
    await configureGateway(config, { ...BASE_SETTINGS });

    const ctx = await checkoutHostedSession(page, config, {
      productId: config.products.preOrderRelease,
      card: cards.mastercard,
      billing: { ...billing, email: preOrderEmail },
      createAccount: billing.password,
      // No saveCard: maybe_force_save_method_pre_order forces tokenization and
      // maybe_display_save_checkbox_pre_orders hides the checkbox (see PO-004).
    });
    releaseCtx = ctx;

    await assertVerifyLogTrail({
      payDate: ctx.payDate,
      logOffset: ctx.logOffset,
      orderNumber: ctx.orderNumber,
      agreementId: `${config.metaPrefix}_pre-order-${ctx.orderNumber}`,
      // BASE_SETTINGS carries _3d_secure: 'no'.
      expect3DS: false,
    });

    await assertPreOrderEmails(ctx.orderNumber, config, emailPage);
    await assertOrderComplete(ctx, config, { page, adminPage, emailPage }, {
      status: 'Pre-ordered',
      note: 'verified',
      emails: 'none',
    });

    // The credential is the whole point of this flow.
    await verifyPaymentMethods(page, { expectedCards: 1 });

    // The order must NOT look paid, and must still be worth its full total —
    // the 0.00 is a payload-level fact only.
    const order = await getOrder(ctx.orderNumber);
    expect(order.date_paid, 'an upon-release pre-order must not be marked paid').toBeNull();
    expect(order.total, 'the order keeps its full total').toBe(ctx.total);
  });
```

- [ ] **Step 2: Run it to make sure it fails**

```sh
cd tests/Playwright
set -a; . ./.env; set +a
npx playwright test 20-pre-orders -g "PO-002" --reporter=line
```

Expected: FAIL. The current code sends `AUTHORIZE`, so `assertVerifyLogTrail` reports "VERIFY log not found".

- [ ] **Step 3: Implement the payload change**

In `includes/GatewayAddons/PreOrders.php`, replace the body of `maybe_add_pre_order_payment_data` after the tokenization check, and add the agreement-id helper and the completion filter answer:

```php
		// Charged upon release: store the credential now and charge nothing.
		$payment_data['apiOperation']    = 'VERIFY';
		$payment_data['order']['amount'] = '0.00';
		$payment_data['agreement']       = array(
			'id'                => $this->pre_order_agreement_id( $order ),
			'type'              => 'UNSCHEDULED',
			'amountVariability' => 'FIXED',
		);

		return $payment_data;
	}


	/**
	 * The stored-credential agreement id for a pre-order.
	 *
	 * Keyed to the WooCommerce order rather than to a subscription: a pre-order
	 * has exactly one future charge and no schedule.
	 *
	 * @param WC_Order $order Order object.
	 *
	 * @return string
	 */
	protected function pre_order_agreement_id( $order ) {
		return 'PAYMENTS_CORE_HOOK_PREFIX_pre-order-' . $order->get_id();
	}


	/**
	 * Keep a tokenizing pre-order unpaid after its zero-amount verify.
	 *
	 * @param bool     $complete Whether to mark the payment complete.
	 * @param WC_Order $order    Order object.
	 *
	 * @return bool
	 */
	public function maybe_skip_complete_on_verify( $complete, $order ) {
		if ( ! $this->is_order( $order ) || ! $this->has_pre_order( $order->get_id() ) ) {
			return $complete;
		}

		if ( ! WC_Pre_Orders_Order::order_requires_payment_tokenization( $order ) ) {
			return $complete;
		}

		return false;
	}
```

Do **not** set `sourceOfFunds.provided.card.storedOnFile` here. The core adds `TO_BE_STORED` whenever `is_forcing_save_payment_method()` is true (`WC_Abstract_Payment_Gateway_CC.php:855-870`), `maybe_force_save_method_pre_order` already makes it true for these carts, and that block runs *after* this filter, so setting it here is redundant and would be overwritten anyway.

Register the new filter in `init_addon_pre_orders`, next to the existing `change_order_status` line:

```php
		add_filter( 'PAYMENTS_CORE_HOOK_PREFIX_complete_verified_payment', array( $this, 'maybe_skip_complete_on_verify' ), 10, 2 );
```

- [ ] **Step 4: Run the test to verify it passes**

Deploy, then:

```sh
cd tests/Playwright
set -a; . ./.env; set +a
npx playwright test 20-pre-orders -g "PO-002" --reporter=line
```

Expected: 1 passed.

- [ ] **Step 5: Commit**

```bash
composer run-script phpcs includes/GatewayAddons/PreOrders.php
git add includes/GatewayAddons/PreOrders.php tests/Playwright/helpers/assertions.ts tests/Playwright/tests/20-pre-orders/suite.spec.ts
git commit -m "feat(pre-orders): verify the card at checkout instead of authorizing"
```

---

### Task 3: Hosted-session release charge

**Gate:** proves MPGS accepts a `$X` PAY on an order whose only prior transaction was a `$0` VERIFY.

**Files:**
- Modify: `includes/GatewayAddons/PreOrders.php:203-268`
- Test: `tests/Playwright/tests/20-pre-orders/suite.spec.ts` (PO-003), `tests/Playwright/helpers/assertions.ts`

**Interfaces:**
- Consumes: `PreOrders::pre_order_agreement_id()` from Task 2.
- Produces: `assertReleasePayLog(expected): Promise<void>`, used by Task 9.

- [ ] **Step 1: Write the failing test**

In `helpers/assertions.ts`:

```typescript
/**
 * The release half: a merchant-initiated PAY for the full total against the
 * stored credential. `transaction.source: MERCHANT` is what tells the issuer
 * the cardholder is not present, and is the difference between this being
 * accepted and being treated as a fraudulent unattended charge.
 */
export async function assertReleasePayLog(expected: {
  payDate: string;
  logOffset: number;
  amount: string;
  currency?: string;
  orderNumber: string | number;
  agreementId: string;
}): Promise<void> {
  const transactionLogs = await getLogs(expected.payDate, '/transaction', expected.logOffset);
  const entries = transactionLogs.logs[0]?.content ?? [];
  const pay = entries.find(
    (l: LogEntry) => l.request?.body?.apiOperation === 'PAY'
      && l.request?.body?.transaction?.source === 'MERCHANT',
  );
  expect(pay, 'merchant-initiated PAY not found').toBeTruthy();
  expect(pay!.request.body.order.amount).toBe(expected.amount);
  expect(pay!.request.body.order.currency).toBe(expected.currency ?? 'USD');
  expect(pay!.request.body.agreement?.id).toBe(expected.agreementId);
  expect(pay!.request.body.sourceOfFunds?.token, 'the charge must use the stored token').toBeTruthy();
  expect(pay!.request.body.sourceOfFunds?.provided?.card?.storedOnFile).toBe('STORED');
  expect(pay!.response.body.result).toBe('SUCCESS');
  expect(pay!.response.body.order.status).toBe('CAPTURED');
}
```

In `suite.spec.ts`, replace PO-003:

```typescript
  // === PO-003: Releasing charges the stored credential ===

  test('PO-003 - Releasing the pre-order charges the stored card', async ({ adminPage }) => {
    expect(releaseCtx, 'PO-002 must have run first').toBeTruthy();
    const ctx = releaseCtx!;

    // A fresh window: the release can land in a later log file than the verify,
    // opened the way flows.ts:208 opens one.
    const payDate = new Date().toISOString().slice(0, 19);
    const logOffset = await getLogEntryCount(payDate);

    await releasePreOrder(adminPage, ctx.orderNumber);
    await assertPreOrderStatus(adminPage, ctx.orderNumber, 'Completed');

    await navigateToOrder(adminPage, ctx.orderNumber);
    await assertOrderStatus(adminPage, 'Processing');
    await assertOrderNoteContains(adminPage, 'pre-order payment captured');

    await assertReleasePayLog({
      payDate,
      logOffset,
      amount: ctx.total,
      orderNumber: ctx.orderNumber,
      agreementId: `${config.metaPrefix}_pre-order-${ctx.orderNumber}`,
    });
  });
```

Note the fresh log window: the old PO-003 reused PO-002's `payDate`/`logOffset` because the capture fired inside the same window. Do not carry that over — it was already flagged as fragile across midnight, and the release is now a separate transaction.

- [ ] **Step 2: Run it to make sure it fails**

```sh
cd tests/Playwright
set -a; . ./.env; set +a
npx playwright test 20-pre-orders -g "PO-002|PO-003" --reporter=line
```

Expected: PO-002 passes, PO-003 FAILS — the current handler tries to capture an authorization that no longer exists, so `get_authorized_amount()` returns 0 and it throws "No authorized amount found for this pre-order."

- [ ] **Step 3: Rewrite the release handler**

Replace `process_pre_order_release_payment` in `includes/GatewayAddons/PreOrders.php`:

```php
	public function process_pre_order_release_payment( $order_id ) {
		$order = wc_get_order( $order_id );

		if ( ! $order ) {
			$this->core_plugin->logger()->log( sprintf( 'Pre-order release: Invalid order ID %d', $order_id ), 'error' );
			return;
		}

		// Ensure this is our gateway.
		if ( $order->get_payment_method() !== $this->id ) {
			return;
		}

		// Ensure this is a pre-order.
		if ( ! WC_Pre_Orders_Order::order_contains_pre_order( $order_id ) ) {
			return;
		}

		// Charged upfront: the money moved at checkout, so releasing is a status
		// movement in WooCommerce and nothing else.
		if ( ! WC_Pre_Orders_Order::order_requires_payment_tokenization( $order ) ) {
			return;
		}

		try {
			$token = $this->pre_order_payment_token( $order );

			if ( ! $token ) {
				throw new Exception( __( 'No stored card found for this pre-order.', '__PAYMENTS_CORE_TEXT_DOMAIN__' ) );
			}

			$transaction_id = $this->unique_transaction_id( $order );

			$this->create_payment_transaction(
				$order,
				$this->unique_order_id( $order ),
				$transaction_id,
				array(
					'apiOperation'  => 'PAY',
					'order'         => $this->hosted_session_order_payload( $order ),
					'agreement'     => array(
						'id' => $this->pre_order_agreement_id( $order ),
					),
					'transaction'   => array(
						'source'    => 'MERCHANT',
						'reference' => $transaction_id,
					),
					'sourceOfFunds' => array(
						'type'     => 'CARD',
						'token'    => $token,
						'provided' => array(
							'card' => array(
								'storedOnFile' => 'STORED',
							),
						),
					),
				)
			);

			$order->add_order_note(
				sprintf(
					// translators: %1$s: Gateway title, %2$s: Amount.
					__( '%1$s pre-order payment captured: %2$s', '__PAYMENTS_CORE_TEXT_DOMAIN__' ),
					$this->title,
					wc_price( $order->get_total(), array( 'currency' => $order->get_currency() ) )
				)
			);

			$order->payment_complete( $order->get_transaction_id() );

			$this->core_plugin->logger()->log( sprintf( 'Pre-order %d payment captured successfully', $order_id ), 'info' );

		} catch ( Exception $e ) {
			$order->update_status(
				'failed',
				sprintf(
					// translators: %s: Error message.
					__( 'Pre-order release payment failed: %s', '__PAYMENTS_CORE_TEXT_DOMAIN__' ),
					$e->getMessage()
				)
			);

			$this->core_plugin->logger()->log(
				sprintf( 'Pre-order %d payment capture failed: %s', $order_id, $e->getMessage() ),
				'error'
			);
		}
	}


	/**
	 * The stored card token for a pre-order, or an empty string.
	 *
	 * @param WC_Order $order Order object.
	 *
	 * @return string
	 */
	protected function pre_order_payment_token( $order ) {
		$token_ids = $order->get_payment_tokens();

		if ( empty( $token_ids ) || ! is_array( $token_ids ) ) {
			return '';
		}

		$token = new WC_Payment_Token_CC( reset( $token_ids ) );

		return $token instanceof WC_Payment_Token_CC ? $token->get_token() : '';
	}
```

Add `use WC_Payment_Token_CC;` to the file's imports.

Everything authorization-shaped comes out with it: the `order_captured` early return, `get_authorized_amount()` and `process_capture_payment()` have no meaning once nothing is ever authorized. `maybe_hide_capture_meta_box_pre_order` stays — there is still no authorization for an admin to capture by hand.

- [ ] **Step 4: Run the test to verify it passes**

Deploy, then:

```sh
cd tests/Playwright
set -a; . ./.env; set +a
npx playwright test 20-pre-orders -g "PO-002|PO-003" --reporter=line
```

Expected: 2 passed.

**Gate:** if the PAY comes back rejected because the order already carries a `$0` VERIFY, stop. Switch the charge to its own MPGS order id with `referenceOrderId` pointing at the verify — `Subscriptions.php:610-628` is the working example — and note the change in the spec.

- [ ] **Step 5: Commit**

```bash
composer run-script phpcs includes/GatewayAddons/PreOrders.php
vendor/bin/phpstan analyse -c phpstan.neon
git add includes/GatewayAddons/PreOrders.php tests/Playwright/helpers/assertions.ts tests/Playwright/tests/20-pre-orders/suite.spec.ts
git commit -m "feat(pre-orders): charge the stored credential at release"
```

---

### Task 4: A failed release charge fails the order

**Files:**
- Test only: `tests/Playwright/tests/20-pre-orders/suite.spec.ts` (PO-006)

The behaviour already exists — the `catch` in Task 3 does it. This task proves it, because an untested failure path in a money flow is where silent data loss lives.

- [ ] **Step 1: Write the failing test**

Append to `suite.spec.ts`, inside the serial describe:

```typescript
  // === PO-006: The release charge is declined ===

  test('PO-006 - A declined release charge fails the order', async ({ page, adminPage }) => {
    await configureGateway(config, { ...BASE_SETTINGS });

    const ctx = await checkoutHostedSession(page, config, {
      productId: config.products.preOrderRelease,
      card: cards.declined,
      billing: { ...billing, email: uniqueEmail() },
      createAccount: billing.password,
    });

    // The verify itself must still succeed — this card declines the charge, not
    // the credential check. If the verify fails, this case is testing nothing.
    await assertVerifyLogTrail({
      payDate: ctx.payDate,
      logOffset: ctx.logOffset,
      orderNumber: ctx.orderNumber,
      agreementId: `${config.metaPrefix}_pre-order-${ctx.orderNumber}`,
      // BASE_SETTINGS carries _3d_secure: 'no'.
      expect3DS: false,
    });

    await releasePreOrder(adminPage, ctx.orderNumber);

    await navigateToOrder(adminPage, ctx.orderNumber);
    await assertOrderStatus(adminPage, 'Failed');
    await assertOrderNoteContains(adminPage, 'Pre-order release payment failed');
  });
```

- [ ] **Step 2: Run it**

```sh
cd tests/Playwright
set -a; . ./.env; set +a
npx playwright test 20-pre-orders -g "PO-006" --reporter=line
```

Expected: PASS if `cards.declined` verifies but declines the PAY.

**If the verify itself is declined**, this card cannot express the case. Swap to a card that tokenizes and then declines a charge — `fixtures/cards.ts` gained `visaHkdFrictionless` (authentication declined) and `mastercardMxnChallenge` during the DCC work; probe which one verifies-then-declines and use it, noting the choice in a comment.

- [ ] **Step 3: Commit**

```bash
git add tests/Playwright/tests/20-pre-orders/suite.spec.ts
git commit -m "test: a declined release charge fails the pre-order"
```

---

### Task 5: Cancelling does nothing

**Files:**
- Modify: `tests/Playwright/helpers/pre-orders.ts`
- Test: `tests/Playwright/tests/20-pre-orders/suite.spec.ts` (PO-007)

No production code. We hook nothing for pre-order cancellation and, with `VERIFY`, there is no held authorization to release — unlike today, where cancelling leaves a dangling auth. This is a requirement satisfied by absence, and the test exists to keep it that way.

- [ ] **Step 1: Add the cancel primitive**

In `helpers/pre-orders.ts`, alongside `releasePreOrder` — the same admin screen and the same row matcher, a different bulk action:

```typescript
/**
 * Cancel a pre-order from the admin Pre-Orders screen.
 *
 * Matched on the bulk-action checkbox value rather than the visible text, for
 * the same reason releasePreOrder is: the cell reads "Order 4790", so a text
 * match on the number alone would also hit "Order 47901".
 */
export async function cancelPreOrder(page: Page, orderNumber: string): Promise<void> {
  await ensureAdminSession(page);
  await page.goto(preOrdersUrl());
  await preOrderRow(page, orderNumber).locator('input[name="order_id[]"]').check();
  await page.selectOption('select[name="action"]', 'cancel');
  await page.click('#doaction');
  await expect(preOrderRow(page, orderNumber)).toContainText('Cancelled');
}
```

Confirm the option value against the live screen before running — `cancel` is the expected slug but the Pre-Orders bulk-action values are not pinned by anything in this repo.

- [ ] **Step 2: Write the test**

```typescript
  // === PO-007: Cancelling before release charges nothing ===

  test('PO-007 - Cancelling a pre-order charges nothing', async ({ page, adminPage }) => {
    await configureGateway(config, { ...BASE_SETTINGS });

    const ctx = await checkoutHostedSession(page, config, {
      productId: config.products.preOrderRelease,
      card: cards.mastercard,
      billing: { ...billing, email: uniqueEmail() },
      createAccount: billing.password,
    });

    // A fresh window, the way flows.ts:208 opens one.
    const payDate = new Date().toISOString().slice(0, 19);
    const logOffset = await getLogEntryCount(payDate);

    await cancelPreOrder(adminPage, ctx.orderNumber);

    await navigateToOrder(adminPage, ctx.orderNumber);
    await assertOrderStatus(adminPage, 'Cancelled');

    // The gateway must not have been touched at all.
    const transactionLogs = await getLogs(payDate, '/transaction', logOffset);
    const entries = transactionLogs.logs[0]?.content ?? [];
    expect(
      entries.filter((l) => ['PAY', 'AUTHORIZE', 'CAPTURE', 'VOID'].includes(l.request?.body?.apiOperation)),
      'cancelling a pre-order must not call the gateway',
    ).toHaveLength(0);
  });
```

- [ ] **Step 3: Run it**

```sh
cd tests/Playwright
set -a; . ./.env; set +a
npx playwright test 20-pre-orders -g "PO-007" --reporter=line
```

Expected: 1 passed.

- [ ] **Step 4: Commit**

```bash
git add tests/Playwright/helpers/pre-orders.ts tests/Playwright/tests/20-pre-orders/suite.spec.ts
git commit -m "test: cancelling a pre-order touches the gateway not at all"
```

---

### Task 6: Hosted-checkout `$0` verify

**Gate:** proves MPGS Hosted Checkout accepts `interaction.operation = VERIFY`.

**Files:**
- Modify: `includes/GatewayAddons/PreOrders.php` (`init_addon_pre_orders`, new filter callback)
- Test: `tests/Playwright/tests/20-pre-orders/suite.spec.ts` (PO-008)

**Interfaces:**
- Consumes: `PreOrders::pre_order_agreement_id()` from Task 2, `assertVerifyLogTrail` from Task 2.

- [ ] **Step 1: Remove the guard**

Delete `PreOrders.php:43-46`:

```php
		// Hosted checkout is not compatible with pre-orders that require tokenization.
		if ( $this->is_hosted_checkout() && $this->cart_contains_pre_order_tokenization() ) {
			return;
		}
```

With both modes supported there is nothing to guard, and the "runs before the cart loads" bug this guard could never win against stops existing by deletion rather than by deferring registration.

- [ ] **Step 2: Shape the hosted-checkout payload**

Register in `init_addon_pre_orders`:

```php
		add_filter( 'PAYMENTS_CORE_HOOK_PREFIX_checkout_session_payload', array( $this, 'maybe_add_pre_order_checkout_session_data' ), 10, 2 );
```

And add:

```php
	/**
	 * Shape the hosted-checkout session for a pre-order charged upon release.
	 *
	 * The hosted-checkout request never passes through
	 * `process_payment_data`, so the verify has to be built here instead.
	 *
	 * @param array         $payload Checkout session payload.
	 * @param WC_Order|null $order   Order object.
	 *
	 * @return array
	 */
	public function maybe_add_pre_order_checkout_session_data( $payload, $order ) {
		if ( ! $this->is_order( $order ) || ! $this->has_pre_order( $order->get_id() ) ) {
			return $payload;
		}

		if ( ! WC_Pre_Orders_Order::order_requires_payment_tokenization( $order ) ) {
			return $payload;
		}

		$payload['order']['amount']         = '0.00';
		$payload['interaction']['operation'] = 'VERIFY';
		$payload['agreement']                = array(
			'id'                => $this->pre_order_agreement_id( $order ),
			'type'              => 'UNSCHEDULED',
			'amountVariability' => 'FIXED',
		);
		$payload['sourceOfFunds']            = array(
			'provided' => array(
				'card' => array(
					'storedOnFile' => 'TO_BE_STORED',
				),
			),
		);

		return $payload;
	}
```

- [ ] **Step 3: Write the test**

```typescript
  // === PO-008: Upon-release through hosted checkout — the checkout half ===

  test('PO-008 - Hosted checkout verifies and tokenizes an upon-release pre-order', async ({ page, adminPage, emailPage }) => {
    await configureGateway(config, {
      ...BASE_SETTINGS, checkout_mode: 'hosted_checkout', hosted_checkout_mode: 'embedded',
    });

    try {
      const ctx = await checkoutHostedCheckout(page, config, {
        productId: config.products.preOrderRelease,
        card: cards.mastercard,
        billing: { ...billing, email: uniqueEmail() },
        createAccount: billing.password,
      });
      hostedCheckoutReleaseCtx = ctx;

      await assertVerifyLogTrail({
        payDate: ctx.payDate,
        logOffset: ctx.logOffset,
        orderNumber: ctx.orderNumber,
        agreementId: `${config.metaPrefix}_pre-order-${ctx.orderNumber}`,
        // BASE_SETTINGS carries _3d_secure: 'no'.
        expect3DS: false,
      });

      const order = await getOrder(ctx.orderNumber);
      expect(order.date_paid, 'an upon-release pre-order must not be marked paid').toBeNull();
      expect(order.total, 'the order keeps its full total').toBe(ctx.total);
    } finally {
      // checkout_mode is site-global; leaving hosted checkout on breaks every
      // later suite.
      await configureGateway(config, { ...BASE_SETTINGS });
    }
  });
```

Declare `let hostedCheckoutReleaseCtx: CheckoutContext | undefined;` next to `releaseCtx` at the top of the describe — Task 9 releases it.

`assertVerifyLogTrail` asserts the request body of a `/transaction` entry; hosted checkout's verify is an `INITIATE_CHECKOUT` on `/session`. **Before implementing, check where the hosted-checkout verify actually lands in the log** — `assertHostedCheckoutLogTrail` (assertions.ts:1214) shows the hosted-checkout trail is shorter and differently shaped. If the operation is only visible on the session create, add a sibling `assertHostedCheckoutVerifyLog` rather than bending `assertVerifyLogTrail` to cover both.

- [ ] **Step 4: Run it**

Deploy, then:

```sh
cd tests/Playwright
set -a; . ./.env; set +a
npx playwright test 20-pre-orders -g "PO-008" --reporter=line
```

**Gate:** if MPGS rejects `INITIATE_CHECKOUT` with `operation: VERIFY`, stop. Revert this task, and instead make the existing guard fire correctly by deferring the cart-dependent half of `init_addon_pre_orders` to `woocommerce_cart_loaded_from_session`, as `init_addon_dcc` does (`DynamicCurrencyConversion.php:72`). Tasks 7 and 9 then fall away and PO-005 comes back as a real, passing negative case.

- [ ] **Step 5: Commit**

```bash
composer run-script phpcs includes/GatewayAddons/PreOrders.php
git add includes/GatewayAddons/PreOrders.php tests/Playwright/tests/20-pre-orders/suite.spec.ts
git commit -m "feat(pre-orders): verify through hosted checkout instead of refusing it"
```

---

### Task 7: Persist the hosted-checkout token

**Gate:** proves MPGS CREATE TOKEN accepts a hosted-checkout session id.

**Files:**
- Modify: `includes/GatewayAddons/PreOrders.php`
- Modify (fallback branch only): `includes/PaymentToken.php`
- Test: `tests/Playwright/tests/20-pre-orders/suite.spec.ts` (PO-008 extended)

`maybe_save_cards()` runs only on the hosted-session path (`WC_Abstract_Payment_Gateway_CC.php:878`), so hosted checkout returns with no token. `process_wc_order` fires `PAYMENTS_CORE_HOOK_PREFIX_payment_success` inside the `VERIFIED` branch (`WC_Abstract_Payment_Gateway.php:606`), which the hosted-checkout return reaches.

- [ ] **Step 1: Extend PO-008 with the token assertion**

Add to PO-008, inside the `try`, after `assertVerifyLogTrail`:

```typescript
      // Hosted checkout does not run maybe_save_cards, so this is the addon's
      // own token persistence and nothing else.
      await verifyPaymentMethods(page, { expectedCards: 1 });
```

- [ ] **Step 2: Run it to make sure it fails**

```sh
cd tests/Playwright
set -a; . ./.env; set +a
npx playwright test 20-pre-orders -g "PO-008" --reporter=line
```

Expected: FAIL — no saved card.

- [ ] **Step 3: Persist the token from `payment_success`**

Register in `init_addon_pre_orders`:

```php
		add_action( 'PAYMENTS_CORE_HOOK_PREFIX_payment_success', array( $this, 'maybe_store_pre_order_token' ), 10, 2 );
```

And add:

```php
	/**
	 * Store the credential for a hosted-checkout pre-order.
	 *
	 * Hosted session already did this through `maybe_save_cards`; the
	 * "already has one" guard is what keeps this from storing a second copy.
	 *
	 * @param WC_Order $order      Order object.
	 * @param array    $order_data Order data from the gateway.
	 *
	 * @return void
	 */
	public function maybe_store_pre_order_token( $order, $order_data ) {
		if ( ! $this->is_order( $order ) || ! $this->has_pre_order( $order->get_id() ) ) {
			return;
		}

		if ( ! WC_Pre_Orders_Order::order_requires_payment_tokenization( $order ) ) {
			return;
		}

		if ( ! empty( $order->get_payment_tokens() ) ) {
			return;
		}

		$user_id = $order->get_user_id( 'system' );

		if ( ! $user_id ) {
			$this->core_plugin->logger()->log(
				sprintf( 'Pre-order %d has no customer, so no card can be stored', $order->get_id() ),
				'error'
			);
			return;
		}

		$session_id = $order->get_meta( 'PAYMENTS_CORE_HOOK_PREFIX_session_id' );

		if ( ! $session_id ) {
			return;
		}

		$token_id = $this->payment_token()->process_saved_cards(
			array( 'session' => array( 'id' => $session_id ) ),
			$user_id
		);

		if ( $token_id ) {
			$order->add_payment_token( new WC_Payment_Token_CC( $token_id ) );
		}
	}
```

- [ ] **Step 4: Run the test to verify it passes**

Deploy, then re-run PO-008. Expected: 1 passed.

- [ ] **Step 5: Commit**

```bash
composer run-script phpcs includes/GatewayAddons/PreOrders.php
git add includes/GatewayAddons/PreOrders.php tests/Playwright/tests/20-pre-orders/suite.spec.ts
git commit -m "feat(pre-orders): store the card after a hosted-checkout verify"
```

- [ ] **Step 6: Fallback branch — only if Step 4 failed because CREATE TOKEN rejected the session**

`process_saved_cards` mints a token from a session (`PaymentToken.php:59-67`). If a hosted-checkout session is not acceptable to CREATE TOKEN, build the token from the retrieve-order response instead. Add to `includes/PaymentToken.php`:

```php
	/**
	 * Build a token from card data already returned by the gateway.
	 *
	 * The session-based route mints a token from a hosted *session*. A hosted
	 * checkout has no such session, so the card data on the completed order is
	 * the only source.
	 *
	 * @param array $card    Card data — `sourceOfFunds.provided.card`.
	 * @param int   $user_id User ID.
	 *
	 * @return int|false
	 */
	public function create_from_card_data( $card, $user_id ) {
		try {
			if ( empty( $card['token'] ) || empty( $card['brand'] ) || empty( $card['number'] ) || empty( $card['expiry'] ) ) {
				throw new Exception( 'Incomplete card data' );
			}

			$token = new WC_Payment_Token_CC();
			$token->set_token( $card['token'] );
			$token->set_gateway_id( $this->gateway->id );
			$token->set_card_type( $card['brand'] );
			$token->set_last4( substr( $card['number'], -4 ) );

            $m = array(); // phpcs:ignore
			preg_match( '/^(\d{2})(\d{2})$/', $card['expiry'], $m );

			$token->set_expiry_month( $m[1] );
			$token->set_expiry_year( '20' . $m[2] );
			$token->set_user_id( $user_id );
			$token->save();

			return $token->get_id();
		} catch ( Exception $e ) {
			$this->gateway->core_plugin()->logger()->log( 'Error storing card data: ' . $e->getMessage(), 'error' );
			return false;
		}
	}
```

Then in `maybe_store_pre_order_token`, replace the `process_saved_cards` call with:

```php
		$card = $order_data['sourceOfFunds']['provided']['card'] ?? array();

		if ( empty( $card ) ) {
			return;
		}

		$token_id = $this->payment_token()->create_from_card_data( $card, $user_id );
```

This branch requires the token to be present in the retrieve-order response. If it is not there either, hosted checkout cannot store a credential and Task 6's gate should be treated as failed after all.

---

### Task 8: A tokenizing pre-order requires an account

**Files:**
- Modify: `includes/GatewayAddons/PreOrders.php`
- Test: `tests/Playwright/tests/20-pre-orders/suite.spec.ts` (PO-010)

**This implements an unconfirmed recommendation** (see "Carried assumption"). WooCommerce payment tokens are user-bound, so a guest checkout on this flow produces an order that can never be charged. Better to refuse at checkout than to sell something that cannot be collected.

- [ ] **Step 1: Write the failing test**

```typescript
  // === PO-010: A guest cannot place a tokenizing pre-order ===

  test('PO-010 - Guests are refused a charged-upon-release pre-order', async ({ page }) => {
    await configureGateway(config, { ...BASE_SETTINGS });

    await addToCartAndCheckout(page, config.products.preOrderRelease);
    await fillBilling(page, { ...billing, email: uniqueEmail() });

    // No createAccount: this is a guest.
    await expect(
      page.locator(`li.payment_method_${config.paymentMethodSlug}`),
      'the gateway must not offer itself to a guest for a tokenizing pre-order',
    ).toHaveCount(0);
  });
```

- [ ] **Step 2: Run it to make sure it fails**

```sh
cd tests/Playwright
set -a; . ./.env; set +a
npx playwright test 20-pre-orders -g "PO-010" --reporter=line
```

Expected: FAIL — the gateway is offered.

- [ ] **Step 3: Refuse the gateway for guests on these carts**

In `init_addon_pre_orders`:

```php
		add_filter( 'woocommerce_available_payment_gateways', array( $this, 'maybe_hide_for_guest_pre_order' ), 20 );
```

And:

```php
	/**
	 * Hide the gateway from guests on a cart that needs a stored card.
	 *
	 * WooCommerce payment tokens belong to a user, so a guest cannot hold the
	 * credential this flow charges at release. Refusing at checkout beats
	 * taking an order that can never be collected.
	 *
	 * @param array $gateways Available gateways.
	 *
	 * @return array
	 */
	public function maybe_hide_for_guest_pre_order( $gateways ) {
		if ( is_user_logged_in() || ! $this->cart_contains_pre_order_tokenization() ) {
			return $gateways;
		}

		unset( $gateways[ $this->id ] );

		return $gateways;
	}
```

This one reads the cart at filter time, so registering it at `build()` is safe.

- [ ] **Step 4: Run the test to verify it passes**

Deploy, re-run PO-010. Expected: 1 passed.

Then re-run PO-002 to confirm the account-creating path is unaffected:

```sh
npx playwright test 20-pre-orders -g "PO-002|PO-010" --reporter=line
```

Expected: 2 passed. PO-002 creates an account at checkout, so it must still be offered the gateway.

- [ ] **Step 5: Commit**

```bash
composer run-script phpcs includes/GatewayAddons/PreOrders.php
git add includes/GatewayAddons/PreOrders.php tests/Playwright/tests/20-pre-orders/suite.spec.ts
git commit -m "feat(pre-orders): refuse guests a pre-order that needs a stored card"
```

---

### Task 9: Release a hosted-checkout pre-order

**Files:**
- Test only: `tests/Playwright/tests/20-pre-orders/suite.spec.ts` (PO-009)

No production code — the release handler does not care which mode stored the credential. This task proves that claim rather than assuming it.

- [ ] **Step 1: Write the test**

```typescript
  // === PO-009: Releasing a hosted-checkout pre-order ===

  test('PO-009 - Releasing a hosted-checkout pre-order charges the stored card', async ({ adminPage }) => {
    expect(hostedCheckoutReleaseCtx, 'PO-008 must have run first').toBeTruthy();
    const ctx = hostedCheckoutReleaseCtx!;

    // A fresh window, the way flows.ts:208 opens one.
    const payDate = new Date().toISOString().slice(0, 19);
    const logOffset = await getLogEntryCount(payDate);

    await releasePreOrder(adminPage, ctx.orderNumber);
    await assertPreOrderStatus(adminPage, ctx.orderNumber, 'Completed');

    await navigateToOrder(adminPage, ctx.orderNumber);
    await assertOrderStatus(adminPage, 'Processing');
    await assertOrderNoteContains(adminPage, 'pre-order payment captured');

    await assertReleasePayLog({
      payDate,
      logOffset,
      amount: ctx.total,
      orderNumber: ctx.orderNumber,
      agreementId: `${config.metaPrefix}_pre-order-${ctx.orderNumber}`,
    });
  });
```

- [ ] **Step 2: Run it**

```sh
cd tests/Playwright
set -a; . ./.env; set +a
npx playwright test 20-pre-orders -g "PO-008|PO-009" --reporter=line
```

Expected: 2 passed.

- [ ] **Step 3: Commit**

```bash
git add tests/Playwright/tests/20-pre-orders/suite.spec.ts
git commit -m "test: release a pre-order that was tokenized through hosted checkout"
```

---

### Task 10: The two coverage gaps — upfront on hosted checkout, and 3DS off

**Files:**
- Test only: `tests/Playwright/tests/20-pre-orders/suite.spec.ts` (PO-011, PO-012)

Neither needs production code. Upfront takes no addon branch at all, so it should already work in hosted checkout, and the verify follows `_3d_secure` by decision, so both settings need a pass.

- [ ] **Step 1: Write PO-011 — upfront through hosted checkout**

```typescript
  // === PO-011: Upfront through hosted checkout ===

  test('PO-011 - Pre-order charged upfront through hosted checkout', async ({ page, adminPage, emailPage }) => {
    await configureGateway(config, {
      ...BASE_SETTINGS, checkout_mode: 'hosted_checkout', hosted_checkout_mode: 'embedded',
    });

    try {
      const ctx = await checkoutHostedCheckout(page, config, {
        productId: config.products.preOrderUpfront,
        card: cards.mastercard,
        billing: { ...billing, email: uniqueEmail() },
      });

      // Upfront takes no addon branch: an ordinary hosted-checkout capture whose
      // only pre-order trait is the status.
      await assertHostedCheckoutLogTrail({
        payDate: ctx.payDate, logOffset: ctx.logOffset, total: ctx.total,
        transactionId: ctx.transactionId, orderNumber: ctx.orderNumber,
      });
      await assertPreOrderEmails(ctx.orderNumber, config, emailPage);

      await navigateToOrder(adminPage, ctx.orderNumber);
      await assertOrderStatus(adminPage, 'Pre-ordered');
      await assertCaptureFormVisible(adminPage, config, false);
    } finally {
      await configureGateway(config, { ...BASE_SETTINGS });
    }
  });
```

- [ ] **Step 2: Write PO-012 — the verify with 3DS off**

```typescript
  // === PO-012: The verify follows the gateway's 3DS setting ===

  test('PO-012 - Upon-release verify with 3DS inactive', async ({ page, adminPage }) => {
    // BASE_SETTINGS already carries _3d_secure: 'no', so this is the 3DS-off
    // pass; PO-002 covers 3DS on once the suite's base flips. Setting it
    // explicitly here keeps the case honest if BASE_SETTINGS changes.
    await configureGateway(config, { ...BASE_SETTINGS, _3d_secure: 'no' });

    const ctx = await checkoutHostedSession(page, config, {
      productId: config.products.preOrderRelease,
      card: cards.visaChallenge,
      billing: { ...billing, email: uniqueEmail() },
      createAccount: billing.password,
      threeDS: 'never',
    });

    await assertVerifyLogTrail({
      payDate: ctx.payDate,
      logOffset: ctx.logOffset,
      orderNumber: ctx.orderNumber,
      agreementId: `${config.metaPrefix}_pre-order-${ctx.orderNumber}`,
      // BASE_SETTINGS carries _3d_secure: 'no'.
      expect3DS: false,
    });

    // expect3DS: false above is the whole assertion — INITIATE_AUTHENTICATION
    // and AUTHENTICATE_PAYER must be absent. Suite 07 inverts its trail with a
    // parameter of the same name rather than a separate helper.
  });
```

`threeDS: 'never'` is the default in `flows.ts:267` and a valid value of `'always' | 'maybe' | 'never'`; passing it explicitly is documentation, not behaviour.

**PO-002 also runs with `_3d_secure: 'no'`,** so as written the pair covers 3DS-off twice. Flip PO-002 to `_3d_secure: 'yes'` with `expect3DS: true` and a challenge card, so PO-002 covers 3DS-on and PO-012 covers 3DS-off. Confirm PO-002 still passes after the flip.

- [ ] **Step 3: Run both**

```sh
cd tests/Playwright
set -a; . ./.env; set +a
npx playwright test 20-pre-orders -g "PO-011|PO-012" --reporter=line
```

Expected: 2 passed.

- [ ] **Step 4: Commit**

```bash
git add tests/Playwright/tests/20-pre-orders/suite.spec.ts
git commit -m "test: upfront through hosted checkout, and the verify with 3DS off"
```

---

### Task 11: Retire PO-005 and prove nothing leaked

**Files:**
- Modify: `tests/Playwright/tests/20-pre-orders/suite.spec.ts`, `tests/Playwright/README.md`, `tests/Playwright/ASSERTION-MAP.md`
- Modify: `docs/superpowers/specs/2026-08-28-pre-orders-upon-release-design.md`

- [ ] **Step 1: Delete PO-005**

Remove the whole `PO-005` test including its docblock. The bug it documented — `init_addon_pre_orders` claiming `supports('pre-orders')` for a cart hosted checkout could not handle — no longer exists, because hosted checkout now handles that cart. A `test.fail()` whose bug is gone goes red, so it must go rather than be left to rot.

- [ ] **Step 2: Update the suite docs**

In `tests/Playwright/README.md`, update suite 20's row: both charge modes across both checkout modes, twelve cases, no expected failure. In `ASSERTION-MAP.md`, add the two new assertion helpers.

- [ ] **Step 3: Record what the gates actually returned**

In the spec's "Assumptions to validate" section, replace each assumption with what the live runs proved, and delete the fallback that did not happen. A spec that still reads as speculative after the work is done misleads the next reader.

- [ ] **Step 4: Run suite 20 whole**

```sh
cd tests/Playwright
set -a; . ./.env; set +a
nohup npx playwright test 20-pre-orders --reporter=line > /tmp/po-final.log 2>&1 < /dev/null &
disown
```

Expected: 11 passed, 0 failed. (PO-001 through PO-004 and PO-006 through PO-012, with PO-005 gone.)

- [ ] **Step 5: Prove the new suites did not leak gateway settings**

`configureGateway` writes site-global settings and PO-008/PO-011 switch `checkout_mode`. A `finally` that fails to run leaves hosted checkout on and breaks every later suite, which is exactly the failure mode PO-005's comment warned about.

```sh
cd tests/Playwright
set -a; . ./.env; set +a
nohup npx playwright test '(0[1-9]|1[0-5])-' --reporter=line > /tmp/gate.log 2>&1 < /dev/null &
disown
```

This takes about 31 minutes. Poll with a separate backgrounded `until ! pgrep -f "playwright test"` loop, re-arming it when the watcher hits the 10-minute cap — the detached run survives, only the watcher dies.

Expected: the same result as the Task 0 baseline for suites 01-15. If suites that passed at baseline now fail, a `finally` did not run.

- [ ] **Step 6: Commit**

```bash
git add tests/Playwright docs/superpowers/specs
git commit -m "test: retire PO-005 and record what the gateway probes returned"
```

---

## Self-review

**Spec coverage.** Registration guard → Task 6. Hosted-session verify → Task 2. Hosted-checkout verify → Task 6. Core change 1 (`VERIFIED` completion) → Task 1. Token persistence including both branches → Task 7. Release charge → Task 3. Cancellation → Task 5. Failure handling → Task 4. Guest question → Task 8. Every test-plan row → Tasks 2, 3, 4, 5, 9, 10, 11. All three assumption gates are attached to the task that proves them.

**Known soft spots, deliberately left as checks rather than guesses:**

- Task 0 Step 1 cannot name the staging install command — it is not in this repo. It must be resolved before Task 1.
- Task 5's `cancel` bulk-action slug is unverified against the live admin screen.
- Task 6 Step 3 may need a hosted-checkout-shaped log assertion rather than reusing `assertVerifyLogTrail`; the step says how to tell.
**Helper names were checked against the tree rather than assumed.** `checkoutHostedCheckout` (flows.ts:372), `addToCartAndCheckout` (cart.ts:9), `fillBilling` (checkout.ts:99), `verifyPaymentMethods` (assertions.ts:872), `getOrder` (wc-api.ts:50) and `getLogEntryCount` all exist and are used as written. `assertSavedCardCount`, `assertOrderNotPaid`, `currentLogWindow` and `assertNo3DSInLog` did **not** exist and have been replaced above with the real equivalents — do not reintroduce them.

The only genuinely new test-side code is `assertVerifyLogTrail` and `assertReleasePayLog` (Tasks 2 and 3) and `cancelPreOrder` (Task 5).
