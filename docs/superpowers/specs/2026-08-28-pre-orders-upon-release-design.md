# Pre-orders charged upon release — stored-credential refactor

**Date:** 2026-08-28
**Status:** design approved, not yet planned
**Covers:** `includes/GatewayAddons/PreOrders.php`, two filter-shaped changes in the gateway core, suite 20

## The problem

A pre-order charged upon release must take no money at checkout and the full amount
at release. Today it takes an `AUTHORIZE` for the full amount at checkout and captures
that authorization at release. That is wrong in two independent ways.

**It is wrong even where it works.** On hosted session the flow completes end to end,
but a card authorization expires in roughly 7 to 30 days while a release date is
routinely months out. Every pre-order with a realistic release date has a dead
authorization by the time the merchant releases it.

**It is broken outright on hosted checkout.** `init_addon_pre_orders` runs from
`build()`, before the cart is loaded from the session, so
`cart_contains_pre_order_tokenization()` sees no cart and the hosted-checkout guard at
`PreOrders.php:44` never fires. The gateway claims `supports('pre-orders')` for a cart
it cannot handle. A buyer who proceeds is charged in full at checkout (the forced
`AUTHORIZE` never reaches the hosted-checkout payload, so `interaction.operation`
stays at the merchant's `transaction_mode`), no token is stored (`maybe_save_cards()`
is never called on that path), and at release
`process_pre_order_release_payment` finds the `order_captured` meta, logs
"already captured" and returns without calling `payment_complete()`. This is the bug
`PO-005` documents as an expected failure.

## What it should do

At checkout, whatever the mode:

- The WooCommerce order keeps its **full total**. Checkout displays the real price and
  the order is worth the real price. Nothing about the pre-order changes what the
  customer sees.
- The gateway is sent a **`VERIFY` with `order.amount` forced to `0.00`**, which stores
  the credential without moving money. The amount override is payload-level only; the
  WC order is untouched.

At release — whether the admin completes the pre-order or the release date arrives —
the stored credential is charged **`PAY` for the full total**. Never `AUTHORIZE`; there
is nothing to capture later.

On cancellation, nothing happens.

Pre-orders charged **upfront** are unchanged: an ordinary capture at checkout, and at
release nothing but WooCommerce status movement.

## Decisions taken

| Decision | Choice | Rationale |
| --- | --- | --- |
| Share the stored-credential mechanics with `Subscriptions`? | **No — duplicate the shape inside `PreOrders`** | Suites 16-18 are unported and blocked, so subscriptions have no live coverage. A shared abstraction means editing the subscription payment path and shipping it unverified. Suite 20 is green; keep every change inside what we can prove. Revisit once 16-18 run. |
| 3DS on the `$0` verify | **Follows the gateway's `_3d_secure` setting** | Consistent with every other flow. Costs more declines at release for merchants running 3DS off; suite 20 gains a 3DS-off pass to cover both. |
| Release charge fails | **Order to `failed`, reason in the note and the log, nothing customer-facing** | What the code does today. Admin watches the order list. No retry machinery, no recovery email. |
| Hosted checkout tokenization | **Assume MPGS supports it and design for it** | See Assumptions. If the probe disproves it, the hosted-checkout half becomes a correctly-firing block instead. |

## Design

### Registration

Delete the guard at `PreOrders.php:43-46`. Once both modes carry tokenizing
pre-orders there is nothing to guard, so `supports('pre-orders')` is claimed
unconditionally and the "runs before the cart loads" bug ceases to exist by deletion
rather than by deferring registration to `woocommerce_cart_loaded_from_session`. The
three cart-dependent filters read the cart when they fire, not when they register, so
registration timing never mattered to them.

### Checkout — hosted session

`maybe_add_pre_order_payment_data` keeps its hooks and, when
`WC_Pre_Orders_Order::order_requires_payment_tokenization( $order )`, sets:

- `apiOperation` → `VERIFY`
- `order.amount` → `'0.00'` (overriding `base_order_payload`, which sets the order total
  at `WC_Abstract_Payment_Gateway.php:227`)
- `agreement.id` → `unique_order_id( $order )`, stable per order and already persisted

It does **not** set `storedOnFile`. The core adds `TO_BE_STORED` whenever
`is_forcing_save_payment_method()` is true (`WC_Abstract_Payment_Gateway_CC.php:855-870`),
`maybe_force_save_method_pre_order` already makes it true for these carts, and that
block runs after the `process_payment_hosted_session_data` filter, so it composes.

Everything downstream already handles it: line 874 routes `VERIFY` into
`create_payment_transaction` without touching `maybe_flag_order_as_paid`, and
`maybe_save_cards()` at line 878 stores the token. 3DS follows `_3d_secure` through
the existing `get_3ds_authentication` branch, with the agreement riding into the
authentication payload the way `maybe_add_subscription_authentication_initiate_data`
does it.

### Checkout — hosted checkout

All three hosted-checkout payload builders already run filters, so the request side
needs no core change. One hook on `PAYMENTS_CORE_HOOK_PREFIX_checkout_session_payload`
sets, for a tokenizing pre-order cart:

- `order.amount` → `'0.00'`
- `interaction.operation` → `'VERIFY'` (replacing `$this->transaction_mode`,
  `WC_Abstract_Payment_Gateway_CC.php:2228`)
- `agreement.id` and `sourceOfFunds.provided.card.storedOnFile = 'TO_BE_STORED'`

The return trip needs the token persisted, and `maybe_save_cards()` is hosted-session
only. `process_wc_order` fires `PAYMENTS_CORE_HOOK_PREFIX_payment_success` inside the
`VERIFIED` branch (`WC_Abstract_Payment_Gateway.php:606`), and that branch is reached
on the hosted-checkout return. So `PreOrders` hooks `payment_success` and mints the
token when the order is a tokenizing pre-order that has none yet — the "has none yet"
guard is what stops it double-storing on the hosted-session path, where
`maybe_save_cards()` already ran.

How the token is minted depends on Assumption 2:

- **If CREATE TOKEN accepts a hosted-checkout session:** reuse
  `PaymentToken::process_saved_cards()`, feeding it the checkout session id already on
  the order meta (`PAYMENTS_CORE_HOOK_PREFIX_session_id`). No new core code.
- **If it does not:** add `PaymentToken::create_from_order_data()`, building a
  `WC_Payment_Token_CC` from the `sourceOfFunds.provided.card` block of the
  retrieve-order response instead of minting from a session.

### Core change 1 — `VERIFIED` must not complete the payment

`process_wc_order`'s `VERIFIED` branch calls `$order->payment_complete()`
(`WC_Abstract_Payment_Gateway.php:599`). For a pre-order that stamps `date_paid` and
makes `is_paid()` true before a cent has moved. The status still ends up right —
`maybe_flag_pre_order_as_completed` marks it pre-ordered immediately after — but the
order counts as paid in reports and `process_return_callback`'s `is_paid()` guard
(`WC_Abstract_Payment_Gateway_CC.php:2464`) changes behaviour on re-entry.

Add a filter in that branch, default `true`, which `PreOrders` answers `false` for a
tokenizing pre-order — the same idiom as the existing `change_order_status` filter that
`PreOrders.php:70` already uses for this class of override.

This path is currently untested in any mode: `VERIFY` only happens today on the
add-payment-method page, where there is no order
(`WC_Abstract_Payment_Gateway_CC.php:793-796`), so the `VERIFIED` branch's
`payment_complete()` has likely never run against a real order.

### Release

Trigger is unchanged: `wc_pre_orders_process_pre_order_completion_payment_<gateway>`,
already hooked at `PreOrders.php:73`. Both the admin "complete" action and the
scheduled release date converge on it.

`process_pre_order_release_payment` is rewritten:

1. Keep the existing guards — order exists, our gateway, contains a pre-order.
2. **Add a guard**: do nothing unless `order_requires_payment_tokenization( $order )`.
   Upfront pre-orders must no-op here; today they fall through to the
   `order_captured` early return by accident rather than by intent.
3. Resolve the token from `$order->get_payment_tokens()`. None means fail with a clear
   message — the credential is the whole flow.
4. Build the charge: `apiOperation => 'PAY'`, full-amount order payload,
   `agreement.id`, `transaction.source => 'MERCHANT'`,
   `sourceOfFunds` carrying the token with `storedOnFile => 'STORED'`. Modelled on
   `Subscriptions.php:610-628`, not calling it.
5. `create_payment_transaction( $order, unique_order_id( $order ), unique_transaction_id( $order ), $payload )`.
   Same MPGS order id as the verify with a fresh transaction attempt, the way capture,
   refund and void already work (`WC_Abstract_Payment_Gateway.php:331-349`).
6. Order note, then `payment_complete()` — now genuinely paid.
7. On failure, catch, `update_status( 'failed', <acquirer reason> )` and log.

Everything authorization-shaped comes out: `get_authorized_amount()`,
`process_capture_payment()` and the `order_captured` early return have no meaning
once nothing is ever authorized.

`maybe_hide_capture_meta_box_pre_order` stays as is — there is still no authorization
for an admin to capture by hand.

### Cancellation

No work. We hook nothing for pre-order cancellation anywhere (`pre_order` appears
outside `PreOrders.php` only at `WC_Abstract_Payment_Gateway_CC.php:223`, the addon
registration), and with `VERIFY` there is no held authorization to release — unlike
today, where cancelling leaves a dangling auth. This is a requirement satisfied by
absence; the test exists to keep it that way.

## Assumptions to validate before building

Each is a gateway behaviour, unverifiable from source. **Validate all three first**;
each one that fails changes the design rather than the code.

1. **MPGS Hosted Checkout accepts `interaction.operation = VERIFY`** with
   `order.amount = 0.00`. If not, hosted checkout cannot carry tokenizing pre-orders and
   the guard at `PreOrders.php:44` is right after all — it just has to be fixed to
   actually fire, by deferring to `woocommerce_cart_loaded_from_session` the way
   `init_addon_dcc` does (`DynamicCurrencyConversion.php:72`).
2. **CREATE TOKEN accepts a hosted-checkout session id.** Decides which of the two
   token-minting routes above is built.
3. **MPGS accepts a `$X` PAY against an order whose only prior transaction was a `$0`
   VERIFY.** If not, the release charge needs its own MPGS order id with
   `referenceOrderId` pointing at the verify — which is what `Subscriptions.php:610-628`
   already does for renewals, so the fallback is known.

## Open question — guests

WooCommerce payment tokens are user-bound; `PaymentToken::process_saved_cards()` bails
without a user id. So a guest cannot hold the credential a charge-upon-release
pre-order depends on. PO-002 sidesteps this by creating an account at checkout, so the
gap is untested rather than known-broken.

Recommendation: a cart containing a tokenizing pre-order requires an account, enforced
at checkout with a clear notice, rather than silently producing an order that can never
be charged. **Needs a decision before implementation.**

## Test plan

Suite 20 is rewritten, not extended — PO-002 and PO-003 currently assert the behaviour
this design replaces.

| Case | Change |
| --- | --- |
| PO-001 upfront, hosted session | Unchanged |
| **new** upfront, hosted checkout embedded | Upfront has no reason to fail there and is untested; an ordinary capture with `Pre-ordered` status |
| PO-002 upon release, hosted session | Rewritten: `VERIFY` at `0.00`, token stored, order **not** paid, status `Pre-ordered`, no money movement in the log trail |
| PO-003 release, hosted session | Rewritten: release fires a `PAY` on the token for the full total; order paid |
| **new** upon release + release, hosted checkout | The same pair through hosted checkout |
| **new** verify with 3DS off | The verify follows `_3d_secure`, so both settings need a pass |
| **new** release charge declined | Order goes to `failed` with the acquirer reason; nothing customer-facing |
| **new** cancel before release | No gateway call, no charge |
| PO-004 forced-save UI | Unchanged |
| PO-005 | **Deleted.** The bug it documents stops existing. |

Only the admin-completion release route is currently exercised (`releasePreOrder` drives
the admin Pre-Orders screen). The scheduled release-date route stays untested and is
called out here so nobody reads suite 20 as covering it.

## Out of scope

- Upfront pre-orders beyond the one new hosted-checkout case.
- Extracting the stored-credential mechanics shared with `Subscriptions` — revisit when
  suites 16-18 run.
- Retries or customer-facing recovery on a failed release charge.
