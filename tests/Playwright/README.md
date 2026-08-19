# Playwright E2E Suite

End-to-end tests for the MPGS payment gateway, ported from the Ghost Inspector suite.

They live in `payment-core` because every MPGS plugin is white-labeled — same API,
different branding — so one suite covers all consuming plugins, parameterised by
`plugin-config.ts` and environment variables.

## Layout

| Layer | Where | Contains |
| --- | --- | --- |
| Primitives | `helpers/checkout.ts`, `cart.ts`, `block-ui.ts`, `hosted-checkout.ts`, `hosted-session.ts`, `three-ds.ts`, `wp-login.ts`, `my-account.ts`, `admin-orders.ts` | DOM actions. Readiness/visibility waits live here; business assertions do not |
| I/O | `helpers/wc-api.ts` | All non-browser I/O — WP REST, WC REST, the log endpoints, logged mail |
| Assertions | `helpers/assertions.ts` | Every business-assertion `expect()` |
| Flows | `helpers/flows.ts` | Orchestrators composing the above |
| Infra | `helpers/site.ts`, `global-setup.ts`, `fixtures/test.ts`, `helpers/gateway-health.ts` | Multi-install routing, admin sessions, failure diagnostics |

Spec files should read as `config → flow → assertions`.

`ASSERTION-MAP.md` maps each Ghost Inspector assertion phase to the composite that
covers it, and is current with this layout.

## Prerequisites

Three of these are easy to miss and each one fails the whole suite. All were
required to get a green run on a previously-working install.

1. **The gateway plugin active and configured** against the MPGS test gateway,
   with its `debug` setting `yes` — otherwise nothing is logged and every log
   assertion fails.

2. **`wc-log-api-automation` active, on a build that has `custom/v1/get-mail`.**
   The suite reads request/response logs and *sent mail* through its REST
   endpoints. Check before anything else:

   ```sh
   curl -s -u admin:<app-password> "$WP_BASE_URL/wp-json/custom/v1" | jq -r '.routes|keys[]'
   ```

   You need at least `get-log`, `get-mail`, `get-webhook-log`, `update-option`,
   `to_checkout_classic`, `to_checkout_blocks`. A `rest_no_route` for `get-mail`
   means the deployed plugin predates the email transport — update it, don't
   work around it.

3. **WP Mail Logging installed and active.** `get-mail` reads the `wp_wpml_mails`
   table it creates. Without it the endpoint returns
   `{"code":"wpml_table_missing"}` and every email assertion fails.

   ```sh
   wp plugin install wp-mail-logging --activate
   ```

4. **The digital product must be virtual _and_ downloadable.** WooCommerce only
   auto-completes an order when every item is both, and the digital-product tests
   assert `Completed`. A virtual-but-not-downloadable product stops at
   `Processing` and fails deterministically — it looks like a gateway bug and is
   not one.

   ```sh
   wp eval '$p=wc_get_product(316); $p->set_downloadable(true); $p->save();'
   ```

5. **Node 18+**, and `npm ci` **in this directory** — it has its own
   `package.json`, separate from payment-core's.

### Site-side WooCommerce options

```sh
wp option update woocommerce_enable_myaccount_registration yes
wp option update woocommerce_enable_signup_and_login_from_checkout yes
wp option update woocommerce_registration_generate_password no
wp option update ghost_inspector_log_prefix "<GATEWAY_SLUG>-logs"
```

> **`ghost_inspector_log_prefix` is the one people miss.** `Logger` writes to
> `<plugin_id>-logs`, where `plugin_id` is the gateway id. If the prefix does not
> match the active plugin's slug, the log API reads a different file and
> assertions fail in ways that look like gateway bugs. Update it whenever you
> switch which white-label plugin is active.

## Setup

Copy `.env.example` to `.env` (gitignored):

| Var | Meaning |
| --- | --- |
| `WP_BASE_URL` | Primary install. |
| `WP_BASE_URLS` | Comma-separated list, one per parallel worker. Overrides the singular vars. |
| `WP_BASE_STG_URL`, `WP_BASE_DEV_URL` | Second and third installs, if you prefer separate vars. |
| `WP_USERNAME` / `WP_PASSWORD` / `WP_ADMIN_PASS` | Admin login. |
| `WP_API_PASS`, `WP_API_PASS_2`, `WP_API_PASS_3` | Admin **application password** per install, in `WP_BASE_URLS` order. |
| `WOO_USER` / `WOO_PASS` | WooCommerce REST consumer key / secret. |
| `GATEWAY_SLUG` | Gateway id, e.g. `mastercard_merchant_cloud`. |
| `META_PREFIX` | Order-meta prefix. Same as the built hook prefix. |
| `GATEWAY_DISPLAY_NAME` | Must match the gateway's `title` setting exactly. |
| `PRODUCT_PHYSICAL`, `PRODUCT_DIGITAL`, `PRODUCT_SUBSCRIPTION` | Product IDs. Default `61` / `316` / `66`. |

Mint the application passwords for every configured install:

```sh
node scripts/mint-app-passwords.mjs
```

It prints `WP_API_PASS`, `WP_API_PASS_2`, `WP_API_PASS_3` to paste into `.env`.
Not idempotent — it creates a **new** password named `pw-e2e` each time.

> `siteUrl()` falls back to a hardcoded URL when nothing is configured, so a
> typo'd `.env` runs green against the wrong host instead of failing. If results
> look impossible, check which site the run announced.

## Running

Always go through the dev runner, **not** `npx playwright test`:

```sh
# one suite
bash tests/Playwright/scripts/run-tests-dev.sh 'tests/01-'

# suites 01-15 (all canonically ported)
bash tests/Playwright/scripts/run-tests-dev.sh 'tests/(0[1-9]|1[0-5])-'

# a single test case
bash tests/Playwright/scripts/run-tests-dev.sh 'tests/01-' --grep "MC-004"
```

Positional args reach Playwright as **regexes matched against the file path**.

### Built vs unbuilt

```sh
run-tests-dev.sh [--built|--unbuilt] <playwright args...>
```

`built` is the default and is what you want. Mode can also come from
`TEST_MODE=built|unbuilt`; the flag wins.

| | built (default) | unbuilt |
| --- | --- | --- |
| Working copy | rewritten, then restored | untouched |
| Hook names under test | real (`<slug>_*`) | placeholders |
| Speed | slower (asset build + composer install) | fast |
| Can break the site if interrupted | yes | no |

> **Unbuilt cannot run the hosted-session suites.** The gateway registers its AJAX
> endpoints with the build-time literal
> (`wc_ajax_PAYMENTS_CORE_HOOK_PREFIX_reset_hosted_session`) while the frontend JS
> builds the endpoint from the *runtime* prefix (`get_prefix()`, always the gateway
> id). Unbuilt those disagree and checkout fails with "There was an error obtaining
> the payment session." Affects all four endpoints, so in practice every suite.

### Why the runner exists

Source ships with build-time placeholders (`__PAYMENTS_CORE_TEXT_DOMAIN__`,
`PAYMENTS_CORE_HOOK_PREFIX`) replaced only at package time, but the tests assert
against the real hook names and meta keys. So the runner snapshots uncommitted
work, applies `replace-domain` / `replace-prefix` / `build:core` from the plugin
root, runs Playwright, then **always** restores. The consuming plugin must define
all three npm scripts.

It finds the plugin root by walking up for `packages/payment-core`, so it works
whether the suite lives in the submodule or in a worktree.

### Parallelism

`workers` is derived from the number of configured installs and never exceeds it —
two workers on one site would fight over `configureGateway()`, which rewrites
site-global settings. `fullyParallel: false` keeps every test of a spec file on one
worker. `global-setup.ts` signs into each install once and caches the session in
`auth/admin-<host>.json`.

One install therefore means one worker: a full 01–15 run takes about an hour.
Three installs bring that down proportionally.

## Suite status

- **01–15** — ported and green.
- **16–18** (subscriptions) — **not** ported, excluded from normal runs, never yet
  green. Two also carry `TODO`s for site configuration that does not exist
  (Subscriptions switching, early manual renewal).
- **19** (DCC, hosted session, classic) — green.
- **20** (pre-orders) — green. PO-005 is a deliberate `test.fail()`: it documents
  a real gateway bug, so it turns **red when the bug is fixed**. See the Task 9
  notes in `docs/superpowers/plans/2026-08-13-v2-dcc-preorders-test-suites.md`.
- **21** (DCC through MPGS hosted checkout) — green. A different feature from 19
  despite the name: the offer is MPGS's, and the `currency_conversion` setting is
  inert in that mode.
- **22** (DCC, hosted session, blocks) — green. Blocks renders the offer area from
  React and validates it client-side, and the server reads a lowercased
  `dccofferstate`, so almost none of suite 19's code path is shared.

### Prerequisites for 19–22

- **WooCommerce Pre-Orders** active, with one `upfront` and one `upon_release`
  product, both simple and both with an availability date far enough out that they
  stay pre-orders. `PRODUCT_PREORDER_UPFRONT` / `PRODUCT_PREORDER_RELEASE` (default
  1595 / 4789). Suite 20 asserts the meta over REST before it runs, so a wrong id
  fails loudly instead of passing vacuously.
- **A card whose issuing currency differs from the store currency.** Only some
  fixture PANs draw a conversion offer — `visaFrictionless` does, `mastercard`
  returns the "Unavailable" shape. The DCC suites fail rather than skip if no
  offer arrives, which is the point.
- The `currency_conversion` gateway setting; each DCC suite sets it itself.

## Is this failure real, or the gateway?

Every failed test attaches a **`flakiness-verdict`**. Read it first.

```
FLAKINESS VERDICT: 1 gateway request(s) came back unusable during this test.
  2026-08-06T01:25:56  GET  https://test-gateway.mastercard.com/.../session/SESSION000244...
```

- **Gateway requests listed** → upstream, or a log-parser decode failure. Either
  way not a failed assertion; that is what retries are for.
- **"no unusable gateway response"** → ours. Investigate it; do not retry it away.

One upstream failure surfaces in several unrelated-looking ways:

| What you see | What actually happened |
| --- | --- |
| "The Payment Session is invalid or has expired" | gateway call failed |
| "There was an error creating the payment session" | gateway call failed |
| MPGS iframes never render | gateway call failed |
| Checkout never leaves `/checkout/` | gateway call failed |
| **"session GET card details entry not found"** | gateway call failed |

That last row is the trap: a failed call still logs its request but with an empty
response body, so assertions matching on `response.body.<field>` report the entry
as **missing** rather than **failed**.

Measured baseline: **7 failures in 4314 gateway requests (0.16%)**, against ~437
gateway requests per full run — so roughly half of runs hit at least one blip
through no fault of the tests. Hence `retries: 2`, which puts a run ending red on
upstream alone at ~0.85% instead of ~6.5%.

It cannot be fixed from the test side: WordPress caps the connect phase at 10s
(Requests v2 `connect_timeout`, which `class-wp-http.php` never lets the plugin's
`'timeout' => 60` override). Reducing it for real means retrying the gateway call
inside the plugin — a payment-path change.

> **Blind spot:** the log API reads only the *active* log file and WooCommerce
> rotates at 5MB, which one full run can reach. Entries in a rotated file are
> invisible, so "none found" can also mean "could not look". If the symptom is one
> of the gateway ones above, check the raw logs in
> `wp-content/uploads/wc-logs/` before concluding it is yours.

## Gotchas

- **Two white-label plugins can never be active at once.** Identical
  `composer.json` produces the same `ComposerAutoloaderInit<hash>` class in each
  `vendor/`, so activating the second fatals with *"Cannot declare class … name
  already in use"*.
- **Site 500s after an interrupted run** — the submodule was left with hook-prefix
  replacements applied. Recover with `git -C packages/payment-core reset --hard`.
- **`adminLogin` / `frontendLogin` timeouts** are usually the site, not the test.
  Check it responds before debugging.
- **`getLogs` returns 404** when today's log file does not exist yet; that is
  swallowed to an empty result deliberately.
- **Hosted-checkout suites (03–05) have no `INITIATE_AUTHENTICATION` /
  `AUTHENTICATE_PAYER` / `PAY` server logs** — MPGS runs those in its own iframe.
- **`networkidle` never settles in hosted-checkout embedded mode**: MPGS loads a
  TechLab fingerprinting script that re-fetches itself continuously. Wait for the
  element you actually need. Redirect mode (04/05) is unaffected — that bundle
  loads on MPGS's domain, not the merchant page.

## Debug artifacts

Each failed test writes to `test-results/`:

| File | Contents |
| --- | --- |
| `flakiness-verdict` | gateway vs test-side (attached to the report) |
| `error-context.md` / `*-error.txt` | Playwright error + surrounding source |
| `test-failed-*.png` | Full-page screenshot |
| `*.html` | Full page HTML with iframe contents inlined — best source for selectors |
| `*-console.log`, `*-network.log` | Browser console, request/response list |
| `*.yml` | Aria snapshot |

The runner archives the previous `test-results/` into `test-results-archive/<ts>/`
before each run, because Playwright wipes its output directory on start.
