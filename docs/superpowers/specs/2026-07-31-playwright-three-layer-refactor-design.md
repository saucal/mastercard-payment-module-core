# Design: payment-module-core Playwright suite → three-layer architecture

Date: 2026-07-31
Status: approved (pending final doc review)
Scope: `tests/Playwright/` only. No other repo touched.

## Context

Sibling GI→Playwright migrations (`bluesnap-automation`, and its finished
downstream `payoneer-v4-automation`) converged on a "three-layer" hand-written
architecture: DOM/site primitives → a pure REST/HTTP layer (`wc-api.ts`) → an
assertions layer that owns every `expect()` call → a flows layer that
orchestrates primitives/API calls into full scenarios, with spec files thinned
to `config → flow → assertions`. `bluesnap-automation`'s
`prompts/refactor-wc-automation.prompt.md` documents this as the reference
shape other gateway projects should copy.

`payment-module-core`'s `tests/Playwright/` never went through a GI-export
pipeline (`suites/`/`generated/`/`migrate-gi.js` don't exist here) — its 18
suites were hand-written directly, one `suite.spec.ts` per numbered scenario
folder (6,762 lines total), backed by a flat `helpers/` directory (15 files)
and a bespoke coverage-tracking pair: `ASSERTION-MAP.md` (14-phase admin
assertion flow, hand-maintained) + `audit-assertions.py` (GI-vs-Playwright
1:1 coverage diff tool, currently hardcoded to one developer's machine paths).

Audited `helpers/` and found responsibilities already mostly separated by
file, but layered *within* several files rather than *across* them — e.g.
`log-verification.ts` mixes thin log-fetch wrappers, business assertions, and
a webhook-polling wait in one 729-line file. The gap versus the reference
architecture is a missing `assertions.ts`/`flows.ts` split, not a lack of
modularity.

## Decisions (locked with user before writing this doc)

- **Scope**: `payment-module-core` only. `mastercard-automation` stays on its
  current `generated/`-scaffold pattern for now — not touched by this effort.
- **Depth**: incremental extraction. Existing spec test logic and assertions
  are preserved verbatim in meaning; only their *location* moves. Ported
  suite-by-suite, each verified before the next.
- **Legacy docs**: keep `ASSERTION-MAP.md` and `audit-assertions.py`. Fix the
  script's hardcoded `/Users/saggio/...` and `/tmp/...` paths (env var / CLI
  arg instead), then run it as the final coverage gate after all suites are
  ported.

## Target structure

```
tests/Playwright/
  helpers/
    checkout.ts, cart.ts, block-ui.ts, hosted-checkout.ts,      # unchanged —
    hosted-session.ts, three-ds.ts, wp-login.ts, my-account.ts  # primitives
    debug.ts, request-tracer.ts                                 # unchanged — infra
    admin-orders.ts        # trimmed to page-action primitives only (see below)
    wc-api.ts              # renamed from api.ts, absorbs Mailpit low-level client
    assertions.ts          # NEW — every business-assertion expect() call
    flows.ts               # NEW — orchestrators composed from the above
  tests/<NN-scenario>/suite.spec.ts   # thinned: config -> flow -> assertions
  fixtures/, plugin-config.ts, ASSERTION-MAP.md   # unchanged
  audit-assertions.py      # path-fixed, kept as final coverage gate
```

Primitive files that already contain a handful of structural `expect()`s
(readiness/visibility waits — `checkout.ts`:1, `hosted-session.ts`:4,
`three-ds.ts`:1, `wp-login.ts`:6, `my-account.ts`:11) are **not** touched.
Only functions whose purpose *is* a business assertion (gateway log content,
order state, order notes, email content) move to `assertions.ts`. This keeps
the change surgical instead of chasing every `expect()` in the codebase.

## File-level mapping

**`api.ts` → `wc-api.ts`** (rename only, logic unchanged): `getOrder`,
`getFailedOrders`, `getOrderMeta`, `verifyOrderViaAPI`, `getLogs`,
`getLogEntryCount`, `getWebhookLogs`, `configureGateway`,
`switchCheckoutMode`. Additionally absorbs the low-level Mailpit client
currently private to `email-verification.ts` (`searchMessages`,
`getMessageHtml`, `clearMessages`, `waitForEmails`) — this makes `wc-api.ts`
the single home for all non-browser I/O (WP REST, WC REST, log endpoints,
Mailpit), matching the reference projects.

**`log-verification.ts` → deleted, split three ways:**
- `extractSessionPostLogs`/`extractSessionGetLogs`/`extractTokenLogs`/
  `extractTransactionPutLogs`/`extractAllLogs` are one-line pass-throughs to
  `getLogs` — dropped; callers call `wc-api.getLogs` directly.
- `assertCardDetails` (private), `verifySessionPost`, `verifySessionGet`,
  `verifySessionGetCardDetails`, `verifyInitiateAuthentication`,
  `verifyAuthenticatePayer`, `verifyAuthenticationResult`,
  `verifyAuthorizeCaptureLog`, `verifyTokenLog`, `verifyTokenLogsEmpty`,
  `verifyAgreement`, `verifyVoidLog`, `verifyRefundLog` → `assertions.ts`,
  organized under the same phase headers `ASSERTION-MAP.md` already uses.
- `waitForWebhooks` → `assertions.ts` (its job is asserting webhooks arrived;
  the polling is incidental to that assertion, same treatment as bluesnap's
  polling-based verifies).

**`admin-orders.ts` → split in place:**
- Primitives stay: `detectHPOS`, `navigateToOrder`, `navigateToSubscription`,
  `capturePayment`, `voidPayment`, `refundPayment`,
  `triggerSubscriptionRenewal`, `extractRenewalOrderNumber`.
- Assertions move to `assertions.ts`: `assertOrderStatus`,
  `assertOrderNoteContains`, `assertCapturedNote`, `assertAuthorizedNote`,
  `assertPaymentMethodMeta`, `assertPaymentMethodInLineItems`,
  `assertCaptureFormVisible`, `assertVoidFormVisible`.

**`email-verification.ts` → deleted, split two ways:** low-level Mailpit
client → `wc-api.ts` (above); `verifyOrderEmails`, `verifyAdminEmail`,
`verifyCustomerEmail`, `assertPaymentMethodInEmail` (private) → `assertions.ts`.

**`order-received.ts` → deleted, split:** DOM read of order
number/subscription id (data collection, minus its `expect()`s) becomes a
`flows.ts` helper; the `expect()` calls (declined-error visible, title,
payment method, total) become an `assertOrderReceived`-style function in
`assertions.ts` that the flow calls.

**`flows.ts` (new):** orchestrators built from primitives + `wc-api.ts` +
`assertions.ts`, extracted from sequences currently duplicated inline across
the 18 `suite.spec.ts` files (full hosted-session checkout, full hosted
redirect checkout, capture, void, refund, subscription renewal, etc.). The
exact function inventory is discovered suite-by-suite during porting — it
depends on what's actually duplicated once suite 01 and its neighbors are
read side-by-side, not knowable up front without over-fitting the design to
one suite's shape.

## Rollout order (incremental, suite-by-suite)

1. **Skeleton**: create `wc-api.ts` (rename), `assertions.ts`, `flows.ts`
   per the mapping above, seeded from suite 01
   (`01-hosted-session-capture-classic`) since git history shows it was
   already hand-"ported to canonical shape" once before, plus
   `ASSERTION-MAP.md`'s phase list as the organizing structure for
   `assertions.ts`.
2. Port suite 01 onto the new layers. Verify: TypeScript compiles,
   `playwright test --list` still enumerates the same test names/count, and
   (only if the staging site is reachable from wherever this runs)
   `npx playwright test tests/01-*`.
3. Port the remaining 17 suites one at a time, grouped by family (hosted
   session variants → hosted checkout variants → refund/void →
   subscriptions), each verified before starting the next. `flows.ts` grows
   incrementally as repeated patterns are found; it is not fully speced
   before porting begins.
4. Fix `audit-assertions.py`'s hardcoded paths (repo-relative /
   env-var-driven `GI_BASE`/`PW_BASE` instead of
   `/Users/saggio/...`/`/tmp/...`), then run it across all 18 ported suites
   as the final 1:1 GI-assertion-coverage gate.
5. Delete `log-verification.ts`, `email-verification.ts`,
   `order-received.ts` once every export is confirmed absorbed and no
   dangling imports remain (`grep -rn` for each old module path across
   `tests/`).

## Verification & known limitation

Static verification available at every step from here: TypeScript
compilation, `playwright test --list` (test enumeration unchanged), diffing
moved assertion logic against `ASSERTION-MAP.md`'s phases, and grepping for
dangling imports of deleted files.

**Limitation**: there is no live WordPress/MPGS-gateway access from this
environment (needs the ngrok/staging host + WP/WooCommerce credentials in
`tests/Playwright/.env`). Actual `npx playwright test` execution against the
real site is a gate the user runs, or grants environment access for, after
each suite (or batch of suites) is ported — this plan cannot claim a suite
"passes" without that run having actually happened.

## Out of scope

- `mastercard-automation`, `bluesnap-automation`, `payoneer-v4-automation` —
  untouched.
- `plugin-config.ts`/`plugin-config.types.ts`, `fixtures/*`, `debug.ts`,
  `request-tracer.ts` — untouched.
- No change to the 18 scenario folders' test *behavior/coverage* — this is a
  structural relocation of existing logic, not a rewrite of what's asserted.
