# DCC + Pre-Orders discovery

Date: 2026-08-13
Site: `https://mastercard.mystagingwebsite.com` (store currency **USD**)
Method: `tests/Playwright/tests/_discovery/probe.spec.ts` (throwaway, deleted after the run) + WC/WP REST.

Input to Tasks 7-9 of `docs/superpowers/plans/2026-08-13-v2-dcc-preorders-test-suites.md`.
Everything below is **observed**, not inferred, except where marked.

## DCC — hosted session

### There are three offer shapes, not two

| Shape | Markup | Must be answered? |
| --- | --- | --- |
| No quote | request-id field stays empty | no |
| **`Unavailable`** | one hidden `input[name=dccOfferState][value=Unavailable]` | **no** — already submittable |
| **Real offer** | `#dccOfferAccept` + `#dccOfferReject` radios | **yes** — blocks place-order |

The `Unavailable` shape is injected by `src/js/frontend/_hostedSessions.js:1335` when
the gateway returns a quote with empty `offerText`. It still populates a
`requestId`, so **presence of a requestId does NOT mean a real offer** — classify
on the radios.

### Per-card results (all six distinct PANs probed)

| Fixture | PAN | Shape |
| --- | --- | --- |
| `mastercard` | 5123456789012346 | Unavailable |
| `mastercard2` | 5555555555000018 | **RADIOS** |
| `mastercard3` | 5123450000000008 | Unavailable |
| `visaChallenge` | 4440000009900010 | **RADIOS** |
| `visaFrictionless` | 4440000042200014 | **RADIOS** |
| `visaFrictionlessAttempted` | 4440000042200022 | **RADIOS** |

`declined` and `expired` were not probed: they reuse `mastercard`'s and
`mastercard2`'s PANs respectively and differ only by expiry month, which MPGS
uses to force the outcome. `invalidCC` fails field validation before any quote.

**Four of six cards produce radios.** That is why every hosted-session suite had
to pin `currency_conversion: 'no'` — the suites using `visaChallenge` /
`visaFrictionless` (02, 06, 07, 10, 12, 13, 16, 17, 18) would all stall on an
unanswered offer otherwise.

**Best card for suite 19: `visaFrictionless`** — real radios, and no 3DS
challenge to complicate the flow.

### Offer markup, verbatim

Payer currency is **GBP** against a USD store:

```html
<div>
  <p>Pay with GBP or USD?</p>
  <table><tbody>
    <tr class="dcc_option">
      <td><input id="dccOfferAccept" name="dccOfferState" type="radio" value="Accept"></td>
      <td><label for="dccOfferAccept">GBP (35.11)</label></td>
    </tr>
    <tr class="dcc_disclosure">
      <td></td><td>1 USD = 0.609999 GBP, which includes a rate margin of 2%</td>
    </tr>
    <tr class="dcc_option">
      <td><input id="dccOfferReject" name="dccOfferState" type="radio" value="Reject"></td>
      ...
```

- Values are **`Accept`** and **`Reject`**. The plan originally guessed
  `Decline` — wrong. `DynamicCurrencyConversion.php:203` compares `'Accept' ===`
  and maps anything else to `DECLINED`, so `Reject` lands correctly.
- Stable ids `#dccOfferAccept` / `#dccOfferReject` exist and are preferable to
  the value-based selector.
- Suite 19 constants: `PAYER_CURRENCY = 'GBP'`, exchange rate ~`0.609999`,
  2% margin. Do not assert the rate literally — it moves.
- Container: `#<slug>_currency_conversion`. Hidden field:
  `#<slug>_dcc_request_id`, e.g. `2d0c6461e-044c-4565-817c-83f586977011`.

## DCC — MPGS hosted checkout

The plugin's `currency_conversion` setting **cannot** control this:
`init_addon_dcc` returns at the `is_hosted_checkout()` guard before reading it.
The offer comes from the MPGS merchant profile and renders on MPGS's own page
(`https://test-gateway.mastercard.com/checkout/pay/<session>`).

| Control | Meaning |
| --- | --- |
| `#label-home-currency` | **Accept** — pay in the card's currency (observed `BRL (134.11)`) |
| `#label-transactional-currency` | **Reject** — pay in the order currency (observed `USD (57.56)`) |
| `#mastercardDisclaimer` | the "MAKE SURE YOU UNDERSTAND THE COSTS…" text |
| `#order-summary-muted-currency` | order currency, `USD` |

**`#label-home-currency` is the accept selector that was previously unknown.**
`answerHostedCheckoutDcc` implements both sides as of `c7325c2`.

**The pay control is renamed when an offer is showing.** Verified 2026-08-18:
with a conversion on offer the MPGS page has **`#pay-label-dcc1`** and *no* bare
`#pay-label`, so anything clicking the latter times out. `clickHostedCheckoutPay`
now matches `[id^="pay-label"]`. This was a latent break in suites 03-05 too —
they pass only while MPGS declines to quote their card, which is MPGS's choice and
not a setting we control.

> Payer currency is MPGS's choice and is **not stable**: the note first recorded
> BRL here, and a 2026-08-18 run returned GBP for the same card. Assert *that a
> conversion happened*, never a specific currency, unless a test pins it
> deliberately. `DccExpected.payerCurrency` is optional for this reason.

**The `dcc_*` meta IS written on this path** — settled by a live run on
2026-08-18, since the source alone could not say. `process_dcc_data` and
`render_dcc_data` are registered *before* the `is_hosted_checkout()` guard
(`DynamicCurrencyConversion.php:42-47`), and MPGS does return
`currencyConversion` with `uptake=ACCEPTED` on the post-payment retrieve. Order
6268: rate `0.609999`, `GBP`, `35.11` against a USD `57.56` order.

What does **not** happen here, because `init_dcc_hooks` is past the guard:

| | Hosted session | Hosted checkout |
| --- | --- | --- |
| `currency_conversion` setting | gates DCC | **inert** — an offer arrives with it set to `no` |
| Our own quote call | yes | no — MPGS quotes on its own page |
| Offer validation (`validate_dcc_data`) | yes | no |
| `Paid Amount:` receipt row | yes | **no** — `render_dcc_data_receipt` never registered |
| `dcc_*` meta on accept | yes | yes |
| Admin DCC panel | yes | yes |

Covered by `tests/21-dcc-hosted-checkout` (DCC-007 accept, DCC-008 reject).

## Pre-orders

Plugin: `woocommerce-pre-orders/woocommerce-pre-orders`, **network-active**.

| Product | ID | `_wc_pre_orders_when_to_charge` | Notes |
| --- | --- | --- | --- |
| Album Medium Fish - Upon release | **4789** | `upon_release` | simple/physical, price 52.3256, availability `32472144000` (~year 2999, so it stays a pre-order) |
| Large Gift - Physical | **1595** | `upfront` | simple, price 34.5, availability `4070908800` (~2099). Converted from variable + pre-orders enabled by Chris on 2026-08-13. |

Both paths are available. `config.products.preOrder{Upfront,Release}` default to
1595 / 4789.

> Suite 20 must assert both ids are non-zero before using them. A product without
> `_wc_pre_orders_enabled=yes` still checks out fine, so every pre-order-specific
> assertion would pass vacuously against the wrong product rather than failing.
>
> 1595 must stay **simple**. `addToCartAndCheckout()` uses `?add-to-cart=<id>`,
> which needs a *variation* id for a variable product — as a variable product it
> had variations 1596/1597/1598.

### Release path

`/wp-admin/admin.php?page=wc_pre_orders` — returns 200. Per-row **`Complete`** and
**`Cancel`** actions, both `<a href=null>` (JS-driven, not plain links), plus
status filters `?pre_order_status=completed|cancelled`.

`Complete` is what fires
`wc_pre_orders_process_pre_order_completion_payment_<gateway>` and therefore
`PreOrders::process_pre_order_release_payment`.

> **Caution:** the screen's `h1` reads "Help & Support" (the theme/admin wrapper),
> so do not assert on the heading to confirm you are on the right screen — match
> the row for the order instead.
>
> There are already **9 completed and 9 cancelled** pre-orders on this site, all
> for product 4789. Any new test must locate its own order by number, never by
> position in the list.

## Companion plugin — RESOLVED 2026-08-17

> **This blocker is closed.** All three installs now serve all 8 `custom/v1`
> routes, `get-mail` and `install-plugin` included:
>
> ```sh
> curl -s "$WP_BASE_URL/wp-json/custom/v1" | jq -r '.routes|keys[]'
> ```
>
> **Email-assertion failures are real failures again** — do not write them off as
> environmental. The rest of this section is kept as the diagnosis of what was
> wrong between 2026-08-13 and the deploy, not as current state.

### Original diagnosis (2026-08-13) — the deployed build was stale, not deficient

The suite needs `get-log`, `get-mail`, `get-webhook-log`, `update-option`,
`to_checkout_classic`, `to_checkout_blocks` in namespace `custom/v1`.

As of 2026-08-13 `ghost-inspector-runner` v1.4.1 was deactivated and
`wc-log-api` v1.5.0 activated. That fixed `get-webhook-log` and removed
`get-mail`, which `verifyOrderEmails` / `verifyAdminEmail` /
`verifyCustomerEmail` need — i.e. **suites 01-07 and 11-18**.

**`get-mail` IS in wc-log-api.** The local source at `~/helper/wc-log-api`
(v1.5.0, repo `saucal/wc-log-api-automation`) registers it unconditionally on
`rest_api_init` at `includes/custom-endpoints.php:40`. The deployed build simply
does not have it:

| | Routes |
| --- | --- |
| Local source v1.5.0 | `get-log`, **`get-mail`**, `get-webhook-log`, `get-mastercard-order`, `update-option`, `to_checkout_blocks`, `to_checkout_classic`, **`install-plugin`** — 8 |
| Deployed "v1.5.0" | `get-log`, `get-webhook-log`, `get-mastercard-order`, `update-option`, `to_checkout_blocks`, `to_checkout_classic` — 6 |

Exactly the two unconditional routes are missing, so the deployed build predates
the source while still reporting v1.5.0 (version header not bumped). Verified
across all 23 REST namespaces — `get-mail` exists nowhere on the site.

**Fix: deploy the current `wc-log-api`.** Note the catch-22 —
`/install-plugin` is the target of the deploy-plugin GitHub workflow
(`custom-endpoints.php:830-835`: "WP core REST cannot sideload a custom zip"),
and it is one of the two missing routes, so the deployed build cannot update
itself. It needs a manual upload of `~/helper/wc-log-api` or a fresh build.

Re-check after deploying:

```sh
curl -s -u "$WP_USERNAME:$WP_API_PASS" "$WP_BASE_URL/wp-json/custom/v1" | jq -r '.routes|keys[]'
```

`update-option` is POST-only — a GET returns 404 and that is not a fault.

~~Until `get-mail` is back, treat any email-assertion failure as environmental.~~
Superseded — see the RESOLVED banner at the top of this section.

## Gateway settings observed

`transaction_mode=PURCHASE`, `checkout_mode=hosted_session`,
`hosted_checkout_mode=redirect`, `saved_cards=yes`, `debug=yes`,
`currency_conversion=no` (left off by the suite-01 run; the probe restores `no`).

## Method notes worth keeping

- **`fillHostedSessionCC` is not idempotent.** Re-filling MPGS's per-field iframes
  appends rather than replaces — a second pass yields `"01010101"` in
  `expiryMonth`. Each card needs a fresh checkout; cards cannot be iterated
  within one page.
- **No wp-cli on this host.** Product and plugin discovery went through
  `wc/v3/products` and `wp/v2/plugins`; the plan's `wp post list` / `wp option get`
  steps are not usable here.
- The DCC quote fires on **card-field validation**, not page load, so it must be
  awaited after the card is filled.
