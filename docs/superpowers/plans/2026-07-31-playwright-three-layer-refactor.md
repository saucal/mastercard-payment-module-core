# payment-module-core Playwright Three-Layer Refactor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure `tests/Playwright/` so its `helpers/` follow the same
primitives → `wc-api.ts` → `assertions.ts` → `flows.ts` layering used by
`bluesnap-automation`/`payoneer-v4-automation`, without changing what any of
the 18 suites actually asserts.

**Architecture:** Mechanical relocation first (rename `api.ts`→`wc-api.ts`,
split `admin-orders.ts`/`log-verification.ts`/`email-verification.ts`/
`order-received.ts` into primitives vs. `assertions.ts`, drop dead
`extract*Logs` wrappers) — each step touches only import paths / call sites,
verified by `tsc` + `playwright test --list`. Then suite-by-suite dedup: pull
the ~60-line duplicated "fetch logs → find entry → verify" blocks (7 of them,
near-identical, in suite 01 alone) into named composite functions in
`assertions.ts`/`flows.ts`, one suite at a time, each verified before the
next.

**Tech Stack:** TypeScript, `@playwright/test` ^1.50, Node ESM, Python 3
(`audit-assertions.py`).

**Reference:** `docs/superpowers/specs/2026-07-31-playwright-three-layer-refactor-design.md`

## Global Constraints

- Preserve existing assertion **behavior** exactly — this is a relocation of
  code, not a rewrite of what's checked. Where a moved function drops a
  provably-dead/unused parameter (confirmed unused at every call site), that
  is allowed (see Task 3) — it is not a behavior change. **Task 4 is the one
  deliberate exception**: email verification's transport moves from Mailpit
  to the `custom/v1/get-mail` DB endpoint (matching the bluesnap/payoneer
  convergence) — what's asserted about each email is unchanged, how it's
  fetched is not, and that task carries its own live-verification step
  because of it.
- **`tsc` is NOT clean at baseline. Do not "fix" these.** Measured
  2026-07-31 on `feature/v2-finalize` at commit `9e5b79e`, `npx tsc --noEmit`
  from `tests/Playwright/` emits exactly these 5 pre-existing errors:

  ```
  helpers/log-verification.ts(238,24): error TS2339: Property 'version' does not exist on type '{ id: string; updateStatus: string; }'.
  tests/10-hosted-session-declined/suite.spec.ts(88,36): error TS2339: Property 'response' does not exist on type ...
  tests/10-hosted-session-declined/suite.spec.ts(127,36): error TS2339: Property 'response' does not exist on type ...
  tests/12-hosted-session-pay-for-order/suite.spec.ts(275,43): error TS2339: Property 'token' does not exist on type ...
  tests/13-hosted-session-add-payment-method/suite.spec.ts(116,43): error TS2339: Property 'token' does not exist on type ...
  ```

  The success criterion for every task is therefore **"no *new* `tsc`
  errors"**, not "no errors". The `log-verification.ts(238,24)` one travels
  into `assertions.ts` at Task 3 and will be reported at its new line number
  from then on — that is expected, not a regression. Fixing any of these 5 is
  out of scope (they are latent `LogEntry` type-shape gaps, unrelated to
  layering).
- **Baseline test count: `Total: 94 tests in 18 files`** (same measurement
  point). Every task must leave `npx playwright test --list | tail -1`
  reporting exactly that, with unchanged test names.
- No live WP/MPGS-gateway access from the environment this plan may be
  executed in. Actual `npx playwright test <suite>` execution against the
  real site is a gate the user runs (or grants environment access for)
  after each task — do not claim a suite "passes" without that run having
  happened.
- Work stays inside `/Users/christian/Automation/payment-module-core/tests/Playwright/`
  (plus `audit-assertions.py` at repo root for Task 9). No other repo touched.
- One task = one commit. Commit message prefix `refactor(playwright):`.
- **Never `git add -A`.** The working tree carries pre-existing unrelated WIP
  (as of 2026-07-31: a modified `tests/Playwright/playwright.config.ts`
  changing dotenv's path to `tests/Playwright/.env`, and a deleted
  `tests/Playwright/.env.example`; plus untracked `ghost-inspector-export/`
  and `test-results/`). None of it belongs to this refactor. Stage the exact
  files each task touched — `git add <path> <path>` — and leave everything
  else alone. The `git add -A` lines in the task steps below are shorthand;
  substitute explicit paths.

---

### Task 1: Rename `api.ts` → `wc-api.ts`

**Files:**
- Create: `tests/Playwright/helpers/wc-api.ts` (moved content of `api.ts`, unchanged)
- Delete: `tests/Playwright/helpers/api.ts`
- Modify: every file under `tests/Playwright/` importing from `./api` or `../../helpers/api`

**Interfaces:**
- Produces: `wc-api.ts` exports (unchanged names/signatures) —
  `switchCheckoutMode`, `configureGateway`, `getOrder`, `getFailedOrders`,
  `getOrderMeta`, `verifyOrderViaAPI`, `getLogs`, `getLogEntryCount`,
  `getWebhookLogs`.

- [ ] **Step 1: Move the file**

```bash
cd /Users/christian/Automation/payment-module-core/tests/Playwright
git mv helpers/api.ts helpers/wc-api.ts
```

- [ ] **Step 2: Rewrite every import**

```bash
grep -rl "helpers/api'" . --include='*.ts' | xargs sed -i '' "s#helpers/api'#helpers/wc-api'#g"
grep -rl "from './api'" helpers --include='*.ts' | xargs sed -i '' "s#from './api'#from './wc-api'#g"
```

Then manually check any remaining hits:
```bash
grep -rn "helpers/api\b" . --include='*.ts'
```
Expected: no output.

- [ ] **Step 3: Verify**

```bash
npx tsc --noEmit
npx playwright test --list | tail -1
```
Expected: `tsc` reports **only the 5 baseline errors** listed in Global
Constraints (no new ones); `Total: 94 tests in 18 files`.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor(playwright): rename api.ts to wc-api.ts"
```

---

### Task 2: Split `admin-orders.ts` — assertions move to `assertions.ts`

**Files:**
- Create: `tests/Playwright/helpers/assertions.ts`
- Modify: `tests/Playwright/helpers/admin-orders.ts` (remove the 8 functions listed below)
- Modify: every suite importing the moved functions from `../../helpers/admin-orders`

**Interfaces:**
- Consumes: nothing new (functions are moved verbatim).
- Produces: `assertions.ts` now exports `assertOrderStatus`,
  `assertOrderNoteContains`, `assertCapturedNote`, `assertAuthorizedNote`,
  `assertPaymentMethodMeta`, `assertPaymentMethodInLineItems`,
  `assertCaptureFormVisible`, `assertVoidFormVisible` — same signatures as
  today in `admin-orders.ts`.
- `admin-orders.ts` keeps: `detectHPOS`, `navigateToOrder`,
  `navigateToSubscription`, `capturePayment`, `voidPayment`, `refundPayment`,
  `triggerSubscriptionRenewal`, `extractRenewalOrderNumber`.

- [ ] **Step 1: Create `assertions.ts` with the moved functions**

```ts
// tests/Playwright/helpers/assertions.ts
import { Page, expect } from '@playwright/test';
import type { PluginConfig } from '../plugin-config.types';

export async function assertOrderStatus(page: Page, expectedStatus: string): Promise<void> {
  await expect(page.locator('#select2-order_status-container')).toContainText(expectedStatus);
}

/**
 * Verify that a specific text appears in the order notes.
 * Optionally check at a specific position (1-indexed system note).
 */
export async function assertOrderNoteContains(page: Page, text: string, position?: number): Promise<void> {
  if (position) {
    const positionalNote = page.locator(`li.note.system-note:nth-of-type(${position}) .note_content p`);
    if (await positionalNote.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(positionalNote).toContainText(text);
      return;
    }
  }
  const notes = page.locator('li.note .note_content p, #order_note_list li .note_content p');
  const noteTexts = await notes.allTextContents();
  const found = noteTexts.some(n => n.includes(text));
  expect(found, `Expected order note containing "${text}" but found: ${noteTexts.join(' | ')}`).toBeTruthy();
}

export async function assertCapturedNote(page: Page, config: PluginConfig, transactionId: string): Promise<void> {
  await assertOrderNoteContains(page, `${config.displayName} payment was Captured (Order ID: ${transactionId})`, 2);
}

export async function assertAuthorizedNote(page: Page, config: PluginConfig, transactionId: string): Promise<void> {
  await assertOrderNoteContains(page, `${config.displayName} payment was Authorized (Order ID: ${transactionId})`);
}

export async function assertPaymentMethodMeta(page: Page, config: PluginConfig, transactionId?: string): Promise<void> {
  if (transactionId) {
    await expect(page.locator('.woocommerce-order-data__meta')).toContainText(`Payment via ${config.displayName} (${transactionId})`);
  } else {
    await expect(page.locator('.woocommerce-order-data__meta')).toContainText(`Payment via ${config.displayName}`);
  }
}

export async function assertPaymentMethodInLineItems(page: Page, config: PluginConfig): Promise<void> {
  const desc = page.locator('tbody > tr:nth-child(2) > td:nth-child(1) > span.description');
  if (await desc.isVisible({ timeout: 3000 }).catch(() => false)) {
    await expect(desc).toContainText(config.displayName);
  }
}

export async function assertCaptureFormVisible(page: Page, config: PluginConfig, visible: boolean): Promise<void> {
  const form = page.locator(`.${config.paymentMethodSlug}-capture-form, .acme-capture-form, .mpgs-capture-form`);
  if (visible) {
    await expect(form.first()).toBeVisible();
  } else {
    await expect(form.first()).not.toBeVisible();
  }
}

export async function assertVoidFormVisible(page: Page, config: PluginConfig, visible: boolean): Promise<void> {
  const form = page.locator(`.${config.paymentMethodSlug}-void-form, .acme-void-form, .mpgs-void-form`);
  if (visible) {
    await expect(form.first()).toBeVisible();
  } else {
    await expect(form.first()).not.toBeVisible();
  }
}
```

- [ ] **Step 2: Remove the 8 moved functions from `admin-orders.ts`**

Delete `assertOrderStatus`, `assertOrderNoteContains`, `assertCapturedNote`,
`assertAuthorizedNote`, `assertPaymentMethodMeta`,
`assertPaymentMethodInLineItems`, `assertCaptureFormVisible`,
`assertVoidFormVisible` from `helpers/admin-orders.ts`. Drop the now-unused
`expect` import from `@playwright/test` if nothing else in the file uses it
(`detectHPOS`/`navigateToOrder`/etc. don't call `expect` directly — check
with `grep -n "expect(" helpers/admin-orders.ts` after deleting; if no
matches, remove `expect` from the import line, keep `Page`).

- [ ] **Step 3: Fix every importer**

```bash
grep -rln "from '../../helpers/admin-orders'" tests --include='*.ts'
```
For each match, split the import into two lines — primitives still from
`admin-orders`, assertions now from `assertions`. Example for suite 01
(`tests/01-hosted-session-capture-classic/suite.spec.ts:34`):

```ts
// before
import { navigateToOrder, assertOrderStatus, assertPaymentMethodMeta, assertCapturedNote } from '../../helpers/admin-orders';

// after
import { navigateToOrder } from '../../helpers/admin-orders';
import { assertOrderStatus, assertPaymentMethodMeta, assertCapturedNote } from '../../helpers/assertions';
```

Apply the same split to every other matched file, keeping only the names
each file actually imports.

- [ ] **Step 4: Verify**

```bash
npx tsc --noEmit
npx playwright test --list | tail -1
```
Expected: only the 5 baseline `tsc` errors, `Total: 94 tests in 18 files`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(playwright): extract admin-order assertions into assertions.ts"
```

---

### Task 3: Fold `log-verification.ts` into `assertions.ts`; drop dead `extract*Logs` wrappers

**Files:**
- Modify: `tests/Playwright/helpers/assertions.ts` (append)
- Delete: `tests/Playwright/helpers/log-verification.ts`
- Modify: every suite importing from `../../helpers/log-verification`

**Interfaces:**
- Consumes: `getLogs`, `getWebhookLogs`, `getLogEntryCount` from `./wc-api`.
- Produces: `assertions.ts` now additionally exports `verifySessionPost`,
  `verifySessionGet`, `verifySessionGetCardDetails`,
  `verifyInitiateAuthentication`, `verifyAuthenticatePayer`,
  `verifyAuthenticationResult`, `verifyAuthorizeCaptureLog`, `verifyTokenLog`,
  `verifyTokenLogsEmpty`, `verifyAgreement`, `verifyVoidLog`,
  `verifyRefundLog`, `waitForWebhooks`, plus the `LogEntry`/`LogResponse`
  types — all with identical signatures/bodies to today's
  `log-verification.ts`.
- The 5 wrapper functions `extractSessionPostLogs`, `extractSessionGetLogs`,
  `extractTokenLogs`, `extractTransactionPutLogs`, `extractAllLogs` are
  **dropped** — every call site is rewritten to call `getLogs` directly
  (see Step 3's exact mapping; each wrapper ignored one or more of its own
  parameters at every call site found in the codebase, so this is a
  pure simplification, not a behavior change).

- [ ] **Step 1: Append the verify\*/type content to `assertions.ts`**

Copy `helpers/log-verification.ts` lines 1–729 into `assertions.ts` **except**:
- Drop the `import { expect } from '@playwright/test';` line (already
  imported in `assertions.ts` from Task 2 — merge into the single existing
  import statement instead).
- Drop the `import { getLogs, getWebhookLogs, getLogEntryCount } from './api';`
  line; add `getLogs, getWebhookLogs, getLogEntryCount` to a new
  `import { ... } from './wc-api';` line in `assertions.ts`.
- Drop the entire "─── Extraction helpers ───" section (the 5
  `extract*Logs` functions, lines 105–162 of the current file) — these are
  the wrappers being removed.
- Keep everything else verbatim: `parseAmount`, the `LogEntry`/`LogResponse`
  interfaces, `assertCardDetails`, and all `verify*`/`waitForWebhooks`
  functions.
- `assertions.ts` already has `import type { PluginConfig } from '../plugin-config.types';`
  from Task 2 — add `CardData` to that same line (`import type { CardData, PluginConfig } from '../plugin-config.types';`),
  since `assertCardDetails`/`verifySessionGetCardDetails`/etc. all take a `CardData` parameter.

- [ ] **Step 2: Delete the old file**

```bash
git rm tests/Playwright/helpers/log-verification.ts
```

- [ ] **Step 3: Rewrite every call site — two changes per importer**

```bash
grep -rln "from '../../helpers/log-verification'" tests --include='*.ts'
```

For each matched file:

1. Change the import path from `'../../helpers/log-verification'` to
   `'../../helpers/assertions'` (drop any of the 5 `extract*` names from the
   import list — they no longer exist).
2. Replace each `extract*Logs(...)` call with a direct `getLogs(...)` call.

   **The rule** (this, not the table, is authoritative — there are ~130 call
   sites across all 18 suites and they do not all share one argument shape):
   each wrapper's signature is `(date, ...dead..., offset = 0)`. Keep the
   **first** argument (the date) and the **last** argument **only if it is
   the offset**, drop everything in between, and inline the wrapper's
   hardcoded `urlFilter` string:

   | Wrapper | urlFilter to inline | Signature (from `log-verification.ts`) |
   |---|---|---|
   | `extractAllLogs` | `''` | `(date, offset = 0)` |
   | `extractSessionPostLogs` | `'/session'` | `(date, sessionDate, adminUser, apiPass, offset = 0)` |
   | `extractSessionGetLogs` | `` `/session/${session}` `` | `(date, session, payDate, offset = 0)` |
   | `extractTokenLogs` | `'/token'` | `(date, payDate, offset = 0)` |
   | `extractTransactionPutLogs` | `'/transaction'` | `(date, offset = 0)` |

   Note `extractSessionGetLogs` is the one wrapper whose 2nd argument is
   **live** — it interpolates into the urlFilter. Every other wrapper's
   middle arguments are dead at every call site.

   **The 4 shapes that actually occur** (verified by grep across all 18
   suites, 2026-07-31):

   | Occurs in | Old call | New call |
   |---|---|---|
   | suites 01–15 (with offset) | `extractAllLogs(payDate, logOffset)` | `getLogs(payDate, '', logOffset)` |
   | suites 01–15 | `extractSessionPostLogs(payDate, sessionDate, '', '', logOffset)` | `getLogs(payDate, '/session', logOffset)` |
   | suites 01–15 | `extractSessionGetLogs(payDate, session, payDate, logOffset)` | `getLogs(payDate, \`/session/${session}\`, logOffset)` |
   | suites 01–15 | `extractTokenLogs(payDate, payDate, logOffset)` | `getLogs(payDate, '/token', logOffset)` |
   | suites 14, 15 | `extractTransactionPutLogs(payDate, logOffset)` | `getLogs(payDate, '/transaction', logOffset)` |
   | **suites 12, 13** (empty session) | `extractSessionGetLogs(payDate, '', payDate, logOffset)` | `getLogs(payDate, '/session/', logOffset)` |
   | **suites 16, 17, 18** (NO offset arg — defaults to 0) | `extractAllLogs(payDate)` | `getLogs(payDate, '')` |
   | **suites 16, 17, 18** | `extractSessionPostLogs(renewDate, renewDate, '', '')` | `getLogs(renewDate, '/session')` |
   | **suites 16, 17, 18** | `extractSessionGetLogs(renewDate, mc060Session, renewDate)` | `getLogs(renewDate, \`/session/${mc060Session}\`)` |
   | **suites 16, 17, 18** | `extractTokenLogs(mc061PayDate, mc061PayDate)` | `getLogs(mc061PayDate, '/token')` |

   The bolded rows are the ones the naive 4-shape reading misses. Suites
   16/17/18 use per-test date variables (`mc060PayDate`, `renewDate`,
   `upgradePayDate`, `manualRenewDate`, …) and omit the offset entirely —
   preserve whatever date expression each call site passes, and **do not
   invent an offset argument where none was passed** (`getLogs`'s own
   `skip = 0` default matches the wrapper's `offset = 0` default, so
   omitting it is exactly equivalent).
3. Add `getLogs` (and `getWebhookLogs`/`getLogEntryCount` if that file
   didn't already import them from `wc-api`) to that file's `wc-api` import
   line.

- [ ] **Step 4: Verify**

```bash
npx tsc --noEmit
npx playwright test --list | tail -1
grep -rn "extractAllLogs\|extractSessionPostLogs\|extractSessionGetLogs\|extractTokenLogs\|extractTransactionPutLogs" tests helpers
```
Expected: only the 5 baseline `tsc` errors (the `log-verification.ts(238,24)`
one now reported against `assertions.ts` at its new line number),
`Total: 94 tests in 18 files`, and grep returns no matches anywhere.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(playwright): fold log-verification.ts into assertions.ts, drop dead extract*Logs wrappers"
```

---

### Task 4: Replace Mailpit with the `get-mail` DB endpoint; split into `wc-api.ts` + `assertions.ts`

**Discovered mid-plan (2026-07-31)**: `bluesnap-automation`/`payoneer-v4-automation`
converged on 2026-06-18 away from external mail-catchers onto querying WP
Mail Logging's DB table via a REST route on their helper plugin
(`docs/superpowers/specs/2026-06-18-bluesnap-email-extraction-convergence-design.md`
in `bluesnap-automation`). The mastercard test site's helper plugin,
`ghost-inspector-runner` (source: `/Users/christian/helper/ghost-inspector-runner-mastercard-1.4.1.zip`,
`includes/custom-endpoints.php:190-282`), **already exposes the same
endpoint** at `custom/v1/get-mail` — same namespace `wc-api.ts` already
calls for `/get-log`, `/update-option`, `/to_checkout_classic`, same
Basic-Auth `administrator`-capability permission model (`wpAuthHeaders()`
already used for every other `custom/v1` call works unchanged). Response
shape: `{ table, count, mails: [{ mail_id, timestamp, receiver, subject,
headers, message }] }`, newest first, query params `to`/`subject`/
`contains`/`since`/`limit` (all optional, AND-combined, substring `LIKE`
except `since` which is `>=`).

This task replaces Mailpit entirely (no fallback kept) with a client for
that endpoint, while preserving the exact external signatures and
admin-vs-customer subject-heuristic matching logic `email-verification.ts`
already has today — only the transport changes, and the `getMessageHtml`
round-trip disappears since `get-mail`'s `message` column already is the
full body (one HTTP call instead of two).

**Verify before starting**: confirm `custom/v1/get-mail` actually responds
on the live test site —

```bash
curl -s -u "$WP_USERNAME:$WP_API_PASS" "$WP_BASE_URL/wp-json/custom/v1/get-mail?limit=1"
```
Expected: JSON with a `table`/`count`/`mails` shape (even if `mails` is
empty). A 404 `wpml_table_missing` means WP Mail Logging isn't active/
migrated on that site — stop and resolve that first, this task can't proceed
without it. A 404 with no such route at all means the deployed
`ghost-inspector-runner` plugin version predates this endpoint — stop and
get it updated to (at least) 1.4.1 first.

**Files:**
- Modify: `tests/Playwright/helpers/wc-api.ts` (append `get-mail` client)
- Modify: `tests/Playwright/helpers/assertions.ts` (append email assertions)
- Delete: `tests/Playwright/helpers/email-verification.ts`
- Modify: every suite importing from `../../helpers/email-verification`

**Interfaces:**
- Produces: `wc-api.ts` additionally exports the `LoggedMail` type and
  `getLoggedMail(opts, poll?): Promise<LoggedMail[]>`.
- `assertions.ts` additionally exports `verifyOrderEmails`,
  `verifyAdminEmail`, `verifyCustomerEmail` — **identical signatures to
  today** (`(orderNumber, options)`), so no caller besides the import path
  needs to change.

- [ ] **Step 1: Add the `get-mail` client to `wc-api.ts`**

```ts
export interface LoggedMail {
  mail_id: number;
  timestamp: string;
  receiver: string;
  subject: string;
  headers: string;
  message: string; // full HTML/text body WordPress generated
}

interface LoggedMailResponse {
  table: string;
  count: number;
  mails: LoggedMail[];
}

/**
 * Poll custom/v1/get-mail (backed by the WP Mail Logging DB table) until at
 * least `minCount` matching rows appear, then return them. Throws on
 * timeout, mirroring the semantics of the Mailpit `waitForEmails` helper
 * this replaces — a silent empty return would let callers that expect two
 * mails (admin + customer) skip an assertion instead of failing.
 * `contains` is matched against the DB row's full message body server-side.
 */
export async function getLoggedMail(
  opts: { to?: string; subject?: string; contains?: string; since?: string; limit?: number },
  poll: { minCount?: number; timeoutMs?: number; intervalMs?: number } = {},
): Promise<LoggedMail[]> {
  const minCount = poll.minCount ?? 1;
  const timeoutMs = poll.timeoutMs ?? 60000;
  const intervalMs = poll.intervalMs ?? 3000;
  const deadline = Date.now() + timeoutMs;
  let lastSeen: LoggedMail[] = [];

  for (;;) {
    const params = new URLSearchParams({
      ...(opts.to ? { to: opts.to } : {}),
      ...(opts.subject ? { subject: opts.subject } : {}),
      ...(opts.contains ? { contains: opts.contains } : {}),
      ...(opts.since ? { since: opts.since } : {}),
      limit: String(opts.limit ?? 100),
    });
    const res = await fetch(`${BASE_URL}/wp-json/custom/v1/get-mail?${params}`, { headers: wpAuthHeaders() });
    if (!res.ok) throw new Error(`getLoggedMail failed: ${res.status}`);
    const data: LoggedMailResponse = await res.json();
    lastSeen = data.mails || [];
    if (lastSeen.length >= minCount) return lastSeen;
    if (Date.now() >= deadline) {
      const seen = lastSeen.map(m => `${m.receiver}/${m.subject}`).join(', ');
      throw new Error(
        `getLoggedMail timeout: wanted >=${minCount} mails matching ${JSON.stringify(opts)} `
        + `within ${timeoutMs}ms, got ${lastSeen.length}. Seen: [${seen}]`,
      );
    }
    await new Promise(r => setTimeout(r, intervalMs));
  }
}
```

`minCount` is the load-bearing part of this port: the Mailpit original
called `waitForEmails(orderNumber, 2)` for `verifyOrderEmails` and
`waitForEmails(orderNumber, 1)` for the single-recipient variants. Without
`minCount`, a poll that lands after the admin mail is written but before the
customer mail is would return one row, and `verifyOrderEmails`'s
`if (customerMsg)` guard would silently skip the customer-email assertion at
all ~40 of its call sites while still reporting green.

- [ ] **Step 2: Rewrite the assertion functions in `assertions.ts`**

Append to `assertions.ts`, importing `getLoggedMail` from `./wc-api`. Logic
is the original subject-heuristic matching, unchanged — only the data
source and the dropped second fetch differ:

```ts
function assertPaymentMethodInEmail(mail: LoggedMail, paymentMethodTitle: string): void {
  expect(mail.message).toContain(paymentMethodTitle);
}

export async function verifyOrderEmails(
  orderNumber: string,
  options: { paymentMethodTitle: string; adminEmail?: string; customerEmail?: string }
): Promise<void> {
  // minCount: 2 — the original Mailpit helper waited for BOTH the admin and
  // the customer mail before asserting; returning after only the admin row
  // exists would silently skip the customer assertion below.
  const mails = await getLoggedMail({ contains: orderNumber }, { minCount: 2 });

  const adminMsg = mails.find(m =>
    m.subject.toLowerCase().includes('new order') || m.subject.includes(`Order #${orderNumber}`)
  );
  const customerMsg = mails.find(m =>
    m.subject.toLowerCase().includes('order has been received') ||
    m.subject.toLowerCase().includes('order is on') ||
    m.subject.toLowerCase().includes('your order')
  );

  expect(adminMsg, `Admin email for order ${orderNumber} not found`).toBeTruthy();
  assertPaymentMethodInEmail(adminMsg!, options.paymentMethodTitle);

  if (customerMsg) {
    assertPaymentMethodInEmail(customerMsg, options.paymentMethodTitle);
  }
}

export async function verifyAdminEmail(
  orderNumber: string,
  options: { paymentMethodTitle: string; adminEmail?: string }
): Promise<void> {
  const adminAddr = options.adminEmail || 'admin@';
  const mails = await getLoggedMail({ contains: orderNumber });

  const adminMsg = mails.find(m =>
    m.receiver.includes(adminAddr) ||
    m.subject.toLowerCase().includes('new order')
  );
  expect(adminMsg).toBeTruthy();
  assertPaymentMethodInEmail(adminMsg!, options.paymentMethodTitle);
}

export async function verifyCustomerEmail(
  orderNumber: string,
  options: { paymentMethodTitle: string; customerEmail: string }
): Promise<void> {
  const mails = await getLoggedMail({ contains: orderNumber });

  const customerMsg = mails.find(m =>
    m.receiver === options.customerEmail ||
    (m.subject.toLowerCase().includes('order') && !m.subject.toLowerCase().includes('new order'))
  );
  expect(customerMsg).toBeTruthy();
  assertPaymentMethodInEmail(customerMsg!, options.paymentMethodTitle);
}
```

Note the original Mailpit version searched by `orderNumber` as a free-text
query (Mailpit's search matched subject/body); `get-mail`'s `contains`
param is a body-only `LIKE`. If WooCommerce's admin/customer subject lines
for this plugin always embed the order number in the body too (true for
stock WooCommerce order-confirmation templates), this is a faithful
equivalent — confirm during Step 4's live check that both `adminMsg` and
`customerMsg` are actually found for a real order, not just that the call
doesn't throw.

- [ ] **Step 3: Delete the old file and fix every importer**

```bash
git rm tests/Playwright/helpers/email-verification.ts
grep -rln "from '../../helpers/email-verification'" tests --include='*.ts'
```
For each match, change the import path to `'../../helpers/assertions'`. The
only names any suite imports from this module are `verifyOrderEmails`,
`verifyAdminEmail` and `verifyCustomerEmail` (verified by grep across all 18
suites, 2026-07-31 — `clearMessages` has **zero** call sites, which is why
the `get-mail` port drops it entirely rather than reimplementing a
DB-truncating equivalent).

- [ ] **Step 4: Verify — static, then live**

```bash
npx tsc --noEmit
npx playwright test --list | tail -1
```
Then, since this task changes real network behavior (not just code
location), run at least one suite that calls `verifyOrderEmails` against
the real site if reachable (e.g. `npx playwright test tests/01-hosted-session-capture-classic -g "MC-004"`)
and confirm the admin+customer email assertions actually pass — this is the
one task in the mechanical Phase A where "relocate and trust tsc" isn't
enough, because the data source itself changed. If no site access, say so
explicitly and flag this task's live verification as still outstanding.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(playwright): replace Mailpit with custom/v1/get-mail DB endpoint"
```

---

### Task 5: Split `order-received.ts` — create `flows.ts`, assertion piece → `assertions.ts`

**Files:**
- Create: `tests/Playwright/helpers/flows.ts`
- Modify: `tests/Playwright/helpers/assertions.ts` (append)
- Delete: `tests/Playwright/helpers/order-received.ts`
- Modify: every suite importing `verifyOrderReceived` from `../../helpers/order-received`

**Interfaces:**
- Consumes: `waitForPageLoad` from `./block-ui`.
- Produces: `flows.ts` exports `collectOrderReceivedData(page): Promise<OrderReceivedData>`
  and `OrderReceivedData` (`{ orderNumber: string; subscriptionId?: string; declined: boolean }`).
  `assertions.ts` exports `assertOrderReceived(page, options, data?): Promise<void>`
  (the `expect()`-only half; `data` is the value `collectOrderReceivedData`
  just returned, needed to assert the subscription-id invariant — see below).
  Suites call both — see the replacement call pattern in Step 3.

`verifyOrderReceived` did navigation-wait + data-read + assertions in one
function, returning data the caller needs (`orderNumber`). Splitting it
means the caller now makes two calls where it made one; `collectOrderReceivedData`
runs first (it still needs to know if the flow declined, to skip the total
read), then `assertOrderReceived` runs the checks.

**Two traps in this split** — both are why the original's single-function
shape happened to work, and both must be handled explicitly:

1. The original ran `await expect(h1.entry-title).toContainText('Order received')`
   *before* reading the order number. That `expect` auto-retries, so it
   doubled as a **wait** for the confirmation page to render. Reading the
   order number first, with only `waitForPageLoad` behind it, removes that
   wait and will flake. `collectOrderReceivedData` must therefore `waitFor`
   the order-number locator itself before reading it.
2. The original asserted `expect(subscriptionId, 'Subscription ID should not
   be empty').toBeTruthy()` whenever a subscription link was present. A naive
   split drops that assertion silently (the data-collection half has no
   `expect`, the assertion half has no `subscriptionId`) — a real loss of
   coverage. Hence `assertOrderReceived`'s third `data` parameter.

- [ ] **Step 1: Create `flows.ts`**

```ts
// tests/Playwright/helpers/flows.ts
import { Page } from '@playwright/test';
import { waitForPageLoad } from './block-ui';

export interface OrderReceivedData {
  orderNumber: string;
  subscriptionId?: string;
  declined: boolean;
}

/**
 * Read the order-received page's data (order number, subscription id) without
 * asserting anything. Pass the result to assertions.assertOrderReceived().
 */
export async function collectOrderReceivedData(page: Page): Promise<OrderReceivedData> {
  await waitForPageLoad(page);

  const declined = await page.locator('.woocommerce-error').isVisible().catch(() => false);
  if (declined) {
    return { orderNumber: '', declined: true };
  }

  // The original verifyOrderReceived() got its wait for free from an
  // auto-retrying expect() on the page title. Without that, this read races
  // the confirmation page's render — wait for the element explicitly.
  const orderLocator = page.locator('.order > strong, li:has-text("Order number") > strong').first();
  await orderLocator.waitFor({ state: 'visible', timeout: 30000 });
  const orderNumber = (await orderLocator.textContent() || '').trim();

  let subscriptionId: string | undefined;
  const subLink = page.locator('td.subscription-id > a');
  if (await subLink.isVisible({ timeout: 2000 }).catch(() => false)) {
    subscriptionId = (await subLink.textContent() || '').trim();
  }

  return { orderNumber, subscriptionId, declined: false };
}
```

- [ ] **Step 2: Append to `assertions.ts`**

```ts
export async function assertOrderReceived(
  page: Page,
  options: { displayName: string; expectDeclined?: boolean; expectedTotal?: string },
  data?: OrderReceivedData,
): Promise<void> {
  if (options.expectDeclined) {
    await expect(page.locator('.woocommerce-error')).toBeVisible();
    return;
  }

  await expect(page.locator('h1.entry-title')).toContainText('Order received');

  await expect(
    page.locator('.method > strong, li:has-text("Payment method") > strong')
  ).toContainText(options.displayName);

  if (options.expectedTotal) {
    const totalLocator = page.locator(
      'tfoot tr.order-total td span.woocommerce-Price-amount.amount > bdi, ' +
      'li:has-text("Total") > strong, ' +
      'tr:has(> th:has-text("Total"), > td.rowheader:has-text("Total")) td .woocommerce-Price-amount.amount'
    ).first();
    await expect(totalLocator).toContainText(options.expectedTotal);
  }

  // Preserved from the original verifyOrderReceived(): when the page rendered
  // a subscription link, its id must not be empty. `undefined` means no link
  // was present at all, which is the non-subscription case — not a failure.
  if (data?.subscriptionId !== undefined) {
    expect(data.subscriptionId, 'Subscription ID should not be empty').toBeTruthy();
  }
}
```

`assertions.ts` needs `import type { OrderReceivedData } from './flows';`
added for this (`Page`/`expect` are already imported from Task 2). Note this
makes `assertions.ts` import a type from `flows.ts` while `flows.ts` imports
nothing from `assertions.ts` — a one-way type-only dependency, no cycle.

- [ ] **Step 3: Delete the old file and fix every importer**

```bash
git rm tests/Playwright/helpers/order-received.ts
grep -rln "from '../../helpers/order-received'" tests --include='*.ts'
```

For each matched file, replace the import and the call site. Example
(suite 01, all 7 tests share this exact pattern):

```ts
// before
import { verifyOrderReceived } from '../../helpers/order-received';
...
const result = await verifyOrderReceived(page, { displayName: config.displayName, expectedTotal: total });
orderNumber = result.orderNumber;
expect(orderNumber).toBeTruthy();

// after
import { collectOrderReceivedData } from '../../helpers/flows';
import { assertOrderReceived } from '../../helpers/assertions';
...
const result = await collectOrderReceivedData(page);
await assertOrderReceived(page, { displayName: config.displayName, expectedTotal: total }, result);
orderNumber = result.orderNumber;
expect(orderNumber).toBeTruthy();
```

**Always pass `result` as the third argument** — that is what preserves the
subscription-id assertion. A call site that omits it silently drops that
check.

For call sites passing `expectDeclined: true`, keep that option on the
`assertOrderReceived` call only (`collectOrderReceivedData` takes no
options — it already returns `declined` unconditionally).

- [ ] **Step 4: Verify**

```bash
npx tsc --noEmit
npx playwright test --list | tail -1
grep -rn "assertOrderReceived(" tests --include='*.ts' | grep -v ", result)" | grep -v "expectDeclined"
```
Expected: only the 5 baseline `tsc` errors, `Total: 94 tests in 18 files`,
and the grep returns nothing (every non-declined call site passes its
collected data through).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(playwright): split order-received.ts into flows.ts + assertions.ts"
```

---

### Task 6: Move `my-account.ts`'s business assertions into `assertions.ts`

**Files:**
- Modify: `tests/Playwright/helpers/assertions.ts` (append)
- Delete: `tests/Playwright/helpers/my-account.ts`
- Modify: every suite importing from `../../helpers/my-account`

`my-account.ts` (142 lines) exports exactly four functions —
`verifyPaymentMethods`, `verifyOrderInMyAccount`, `verifySubscription`,
`verifyCartEmpty` — and all four are business assertions (11 `expect()`
calls between them: saved-card count/brand/expiry, order row status/total/
payment method, subscription state, empty-cart message). None is a
navigation primitive. Leaving them outside `assertions.ts` while
`admin-orders.ts`'s equivalents moved in (Task 2) would leave the
"assertions.ts owns the business assertions" rule half-applied — this task
closes that gap. Because the file has no non-assertion exports left over,
it is deleted outright rather than split.

**Interfaces:**
- Produces: `assertions.ts` additionally exports `verifyPaymentMethods`,
  `verifyOrderInMyAccount`, `verifySubscription`, `verifyCartEmpty` — moved
  verbatim, **signatures unchanged**, so no call site changes except its
  import path.

- [ ] **Step 1: Move the four functions**

Read `helpers/my-account.ts` in full and append all four function bodies
(plus any private helpers/types they use, and any `Page`/`expect`/config
imports not already present) to `assertions.ts` **verbatim** — no signature
or logic changes. Merge its imports into `assertions.ts`'s existing import
statements rather than adding duplicate lines.

- [ ] **Step 2: Delete the old file and repoint every importer**

```bash
git rm tests/Playwright/helpers/my-account.ts
grep -rln "from '../../helpers/my-account'" tests --include='*.ts'
```
For each match, change the import path to `'../../helpers/assertions'`,
keeping the same imported names. If a file now imports from
`'../../helpers/assertions'` twice, merge the two import statements.

- [ ] **Step 3: Verify**

```bash
npx tsc --noEmit
npx playwright test --list | tail -1
grep -rn "helpers/my-account" tests helpers --include='*.ts'
```
Expected: only the 5 baseline `tsc` errors, `Total: 94 tests in 18 files`,
grep returns nothing.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor(playwright): move my-account assertions into assertions.ts"
```

---

### Task 7: Port suite 01 (`01-hosted-session-capture-classic`) — dedup the log-verification block

**Files:**
- Modify: `tests/Playwright/helpers/assertions.ts` (append `assertCaptureLogTrail`)
- Modify: `tests/Playwright/tests/01-hosted-session-capture-classic/suite.spec.ts`

This is the template the remaining 17 suites (Task 8) repeat. Suite 01 has
7 tests (MC-004 through MC-010); each repeats an ~60-line
"fetch logs → find entry → verify" block that differs only in which card,
whether a session-POST log is expected (false for the two saved-token
tests, MC-007/MC-010), whether a token log is expected (true only for
MC-006/MC-009, which save a new card), and whether the session GET fetch
also verifies card details (skipped for saved-token tests). This task
collapses all 7 into one composite call.

**Interfaces:**
- Consumes: `getLogs` from `./wc-api`; `verifySessionPost`, `verifySessionGet`,
  `verifySessionGetCardDetails`, `verifyInitiateAuthentication`,
  `verifyAuthenticatePayer`, `verifyAuthorizeCaptureLog`, `verifyTokenLog`,
  `verifyTokenLogsEmpty` (already in `assertions.ts` from Task 3).
- Produces: `assertCaptureLogTrail(expected: CaptureLogTrailExpected): Promise<void>`.

- [ ] **Step 1: Append `assertCaptureLogTrail` to `assertions.ts`**

```ts
export interface CaptureLogTrailExpected {
  payDate: string;
  logOffset: number;
  session: string;
  total: string;
  currency?: string;
  transactionId: string;
  orderNumber: string | number;
  card: CardData;
  /** false for saved-token checkouts, which don't POST a new session */
  expectSessionPost: boolean;
  /** true only when the checkout saves a new card */
  expectToken: boolean;
  /** false for saved-token checkouts, which don't re-fetch card details */
  expectCardDetailsFetch: boolean;
}

/**
 * Dedup of the capture-flow log-verification block repeated across
 * MC-004..MC-010 in 01-hosted-session-capture-classic: fetches the
 * session/token/all logs for the order, locates each relevant entry, and
 * runs the matching verify* assertion against it.
 */
export async function assertCaptureLogTrail(expected: CaptureLogTrailExpected): Promise<void> {
  const currency = expected.currency ?? 'USD';
  const txFilter = (l: LogEntry) => !expected.transactionId || l.request.url.includes(String(expected.transactionId));

  if (expected.expectSessionPost) {
    const sessionPostLogs = await getLogs(expected.payDate, '/session', expected.logOffset);
    expect(sessionPostLogs.logs[0]?.content.length, 'session POST logs should not be empty').toBeGreaterThan(0);
    const sessionPostLog = expected.session
      ? sessionPostLogs.logs[0].content.find((l: LogEntry) => l.response?.body?.session?.id === expected.session && (l.response?.body?.result === 'SUCCESS' || l.response?.body?.session?.updateStatus === 'SUCCESS' || l.response?.body?.session?.version))
      : sessionPostLogs.logs[0].content[0];
    expect(sessionPostLog, `session POST entry not found for session ${expected.session}`).toBeTruthy();
    verifySessionPost(sessionPostLog!, {
      session: expected.session, total: expected.total, currency,
      transactionId: expected.transactionId, orderNumber: expected.orderNumber,
    });
  }

  const sessionGetLogs = await getLogs(expected.payDate, `/session/${expected.session}`, expected.logOffset);
  expect(sessionGetLogs.logs[0]?.content.length, 'session GET logs should not be empty').toBeGreaterThan(0);
  const sessionPut = sessionGetLogs.logs[0].content.find(
    (l: LogEntry) => l.request?.type === 'PUT'
      && l.request?.body?.apiOperation === 'UPDATE_SESSION'
      && l.response?.body?.session?.updateStatus === 'SUCCESS'
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
        && l.response?.body?.session?.id === resolvedSession
    );
    expect(sessionGet, 'session GET card details entry not found').toBeTruthy();
    verifySessionGetCardDetails(sessionGet!, { session: resolvedSession, card: expected.card });
  }

  const tokenLogs = await getLogs(expected.payDate, '/token', expected.logOffset);
  if (expected.expectToken) {
    expect(tokenLogs.logs[0]?.content.length, 'token logs should not be empty').toBeGreaterThan(0);
    verifyTokenLog(tokenLogs.logs[0].content[0], { session: resolvedSession, card: expected.card });
  } else {
    verifyTokenLogsEmpty(tokenLogs);
  }

  const allLogs = await getLogs(expected.payDate, '', expected.logOffset);
  expect(allLogs.logs[0]?.content.length, 'all logs should not be empty').toBeGreaterThan(0);
  const logContent: LogEntry[] = allLogs.logs[0].content;

  const initiateAuthLog = logContent.find(
    (l: LogEntry) => l.request?.body?.apiOperation === 'INITIATE_AUTHENTICATION' && txFilter(l) && l.response?.body?.result === 'SUCCESS'
  );
  expect(initiateAuthLog, 'INITIATE_AUTHENTICATION log not found').toBeTruthy();
  verifyInitiateAuthentication(initiateAuthLog!, {
    session: resolvedSession, card: expected.card, transactionId: expected.transactionId, currency,
  });

  const expectedAuthResult = expected.card.challenge ? 'PENDING' : 'SUCCESS';
  const authenticatePayerLog = logContent.find(
    (l: LogEntry) => l.request?.body?.apiOperation === 'AUTHENTICATE_PAYER' && txFilter(l)
      && l.response?.body?.result === expectedAuthResult
  );
  expect(authenticatePayerLog, 'AUTHENTICATE_PAYER log not found').toBeTruthy();
  verifyAuthenticatePayer(authenticatePayerLog!, {
    session: resolvedSession, transactionId: expected.transactionId, currency, card: expected.card,
  });

  if (expected.card.challenge) {
    const authResultLog = logContent.find(
      (l: LogEntry) => txFilter(l) && (
        l.response?.body?.authenticationStatus === 'AUTHENTICATION_SUCCESSFUL'
        || l.response?.body?.order?.authenticationStatus === 'AUTHENTICATION_SUCCESSFUL'
      )
    );
    expect(authResultLog, 'AUTHENTICATION_SUCCESSFUL result log not found').toBeTruthy();
  }

  const captureLog = logContent.find(
    (l: LogEntry) => l.request?.body?.apiOperation === 'PAY' && txFilter(l) && l.response?.body?.result === 'SUCCESS'
  );
  expect(captureLog, 'PAY log not found').toBeTruthy();
  verifyAuthorizeCaptureLog(captureLog!, {
    apiOperation: 'PAY', session: resolvedSession, total: expected.total, currency,
    transactionId: expected.transactionId, orderNumber: expected.orderNumber, card: expected.card,
  });
}
```

`CardData` must already be imported in `assertions.ts` (it is, via the
types used by `verifyCardDetails` etc. moved in Task 3 — check the import
line includes it; add `import type { CardData } from '../plugin-config.types';`
if not already present).

- [ ] **Step 2: Rewrite each of the 7 tests in `suite.spec.ts`**

Replace the `=== LOG VERIFICATION ===` block in each test with one call.
Example for MC-004 (guest checkout — no session-post skip, no token, direct
card-details fetch):

```ts
// === LOG VERIFICATION ===
await assertCaptureLogTrail({
  payDate, logOffset, session, total,
  transactionId: transactionId!, orderNumber, card: cards.mastercard,
  expectSessionPost: true, expectToken: false, expectCardDetailsFetch: true,
});
```

**`sessionDate` is deliberately not a parameter.** Every call site set
`sessionDate = payDate` and the only consumer was
`extractSessionPostLogs(payDate, sessionDate, ...)`, whose 2nd argument was
dead (Task 3 removed it). After this task the suite's `sessionDate`
declaration and its per-test `sessionDate = payDate` assignments are
write-only — **delete the declaration and every assignment**. `tsc` won't
flag them (`strict: false`, no `noUnusedLocals`), so this must be done by
hand; grep the file for `sessionDate` afterwards and expect zero hits.

Per-test parameters (derived from the current inline blocks read in this
plan's research pass):

| Test | card | expectSessionPost | expectToken | expectCardDetailsFetch |
|---|---|---|---|---|
| MC-004 | `cards.mastercard` | `true` | `false` | `true` |
| MC-005 | `cards.mastercard` | `true` | `false` | `true` |
| MC-006 | `cards.mastercard` | `true` | `true` | `true` |
| MC-007 | `cards.mastercard` | `false` | `false` | `false` |
| MC-008 | `cards.mastercard2` | `true` | `false` | `true` |
| MC-009 | `cards.mastercard3` | `true` | `true` | `true` |
| MC-010 | `cards.mastercard3` | `false` | `false` | `false` |

Remove the now-unused local `allLogs`/`sessionPostLogs`/`sessionGetLogs`/
`tokenLogs`/`logContent`/`txFilter`/`sessionPut`/`resolvedSession` variables
and the now-redundant `extractAllLogs`/etc. imports from each test if they
aren't used elsewhere in the same test (check MC-007/MC-010 — they compute
`resolvedSession` for use in the *admin*/*my-account* sections below the
log block too; grep each test body for `resolvedSession` after the log
block to confirm whether it's still referenced before deleting the local).
If a test still needs the resolved session downstream, keep computing it
locally only where needed, or use `session` directly if the two tests don't
actually reuse `resolvedSession` outside the log block (confirm by reading
the test body — in the current file, `resolvedSession` is not used after
the log-verification block in either MC-007 or MC-010, so it can be dropped
entirely).

Update the suite's import block: remove `extractAllLogs`,
`extractSessionPostLogs`, `extractSessionGetLogs`, `extractTokenLogs`,
`verifySessionPost`, `verifySessionGet`, `verifySessionGetCardDetails`,
`verifyInitiateAuthentication`, `verifyAuthenticatePayer`,
`verifyAuthorizeCaptureLog`, `verifyTokenLog`, `verifyTokenLogsEmpty` from
the `../../helpers/log-verification`-turned-`assertions` import (Task 3
already redirected this import to `assertions`), replacing with just
`assertCaptureLogTrail`.

- [ ] **Step 3: Verify**

```bash
npx tsc --noEmit
npx playwright test --list
```
Expected: only the 5 baseline `tsc` errors; `Total: 94 tests in 18 files`
with the 7 MC-004..MC-010 test names identical to before this task. Also
confirm the dead local is gone:
```bash
grep -n "sessionDate" tests/01-hosted-session-capture-classic/suite.spec.ts
```
Expected: no output.

- [ ] **Step 4: Run against the real site if reachable**

```bash
npx playwright test tests/01-hosted-session-capture-classic
```
If the environment executing this plan has no network path to the
`WP_BASE_URL` in `.env`, skip this step and say so explicitly — do not mark
the task done as "passing" without this having actually run. If you have
site access, this is the first real regression check for the whole
refactor; a failure here means re-reading the diff against the original
7 blocks line-by-line before proceeding to Task 8.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(playwright): port suite 01 to assertCaptureLogTrail"
```

---

### Task 8: Port suites 02–18 — repeat Task 7's procedure per suite

**Files:** one suite folder under `tests/Playwright/tests/` per iteration,
plus `helpers/assertions.ts`/`helpers/flows.ts` as new composite functions
are discovered.

The remaining suites, in the family-grouped order from the design doc:

1. `02-hosted-session-capture-blocks`
2. `08-hosted-session-session-classic`
3. `09-hosted-session-session-blocks`
4. `06-hosted-session-3ds`
5. `07-hosted-session-3ds-inactive`
6. `10-hosted-session-declined`
7. `11-hosted-session-save-cc-deactivated`
8. `12-hosted-session-pay-for-order`
9. `13-hosted-session-add-payment-method`
10. `03-hosted-checkout-embedded-capture`
11. `04-hosted-checkout-redirect-capture`
12. `05-hosted-checkout-redirect-authorize`
13. `14-authorize-capture-void`
14. `15-refund`
15. `16-subscription-renewal`
16. `17-subscription-upgrade`
17. `18-subscription-manual-renewal`

**This is a template, not 17 pre-written tasks** — `assertCaptureLogTrail`
was only knowable by reading suite 01's actual file first; the same is true
for each remaining suite, and pre-guessing their content here would violate
the "no placeholders" rule this plan otherwise holds to. Execute the
following procedure once per suite above, in order, each as its own task
with its own commit:

- [ ] **Step 1: Read the suite's `suite.spec.ts` in full.**

- [ ] **Step 2: Identify duplicated blocks.** Compare each test in the file
  against its siblings in the same file. Look specifically for: repeated
  log-fetch-find-verify sequences (does `assertCaptureLogTrail` already
  cover this suite's variant? check its params can express the difference —
  e.g. an `AUTHORIZE` vs `PAY` `apiOperation`, a refund/void log instead of
  a capture log). If `assertCaptureLogTrail` covers it with existing
  parameters, use it directly. If the suite needs a genuinely different
  sequence (e.g. `15-refund` verifying `verifyRefundLog` instead of
  `verifyAuthorizeCaptureLog`), write a new composite function in
  `assertions.ts` following the exact same shape as `assertCaptureLogTrail`
  — fetch logs, find entry, call the matching `verify*` function — rather
  than leaving the block inline.

- [ ] **Step 3: Identify duplicated checkout/admin orchestration**, if any
  (e.g. "add to cart → fill billing → select payment → fill CC → place
  order → verify received" repeated verbatim across tests in the same
  file). If a sequence is duplicated 2+ times *within this suite*, extract
  it to `flows.ts` as a named function (e.g. `checkoutWithNewCard(page,
  config, card, options)`) returning whatever data callers use afterward.
  Do not extract something used only once — that's premature abstraction.

- [ ] **Step 4: Rewrite the suite's tests** to call the composite
  assertion(s) / flow(s), removing the duplicated inline code, exactly as
  done for suite 01 in Task 7.

- [ ] **Step 5: Verify**

```bash
npx tsc --noEmit
npx playwright test --list
```
Expected: only the 5 baseline `tsc` errors, `Total: 94 tests in 18 files`,
this suite's test names unchanged. If the suite had a write-only
`sessionDate` local (suites 01–02, 06–07, 11 do), confirm it's removed:
`grep -n "sessionDate" tests/<NN-suite-slug>/suite.spec.ts` → no output.

- [ ] **Step 6: Run against the real site if reachable**

```bash
npx playwright test tests/<NN-suite-slug>
```
Same caveat as Task 7 Step 4 — report explicitly if this couldn't be run.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(playwright): port suite <NN> to three-layer helpers"
```

**Recommended execution:** dispatch one fresh subagent per suite via
superpowers:subagent-driven-development, each given this task's Steps 1–7
plus the suite's folder path — this keeps each suite's context isolated
(no subagent needs to hold all 18 suites' code at once) and matches how
`bluesnap-automation` actually executed its own suite-by-suite port
historically ("Port suite N to canonical shape" commits).

---

### Task 9: Fix `audit-assertions.py` portability + reconcile `PHASE_MATCHERS`, run final coverage check

**Files:**
- Modify: `audit-assertions.py` (repo root)

Two independent problems, both must be fixed before this script's output
can be trusted post-refactor:

1. **Portability**: `GI_BASE`/`PW_BASE` (lines 17–22) are hardcoded to one
   developer's Dropbox path and `/tmp/payment-core-playwright/...`.
2. **Identifier drift**: `PHASE_MATCHERS` (lines 47–96) does plain
   substring matching against each suite's `*.spec.ts` **text only** (see
   `load_playwright_spec`, line ~208 — it globs `*.spec.ts` in the suite
   directory, it does not follow imports into `helpers/`). Every function
   this refactor relocated out of the spec file and every composite
   function introduced in Tasks 7–8 (`assertCaptureLogTrail` and whatever
   Task 8 added) is now invisible to this text scan unless the map is
   updated. Three entries break **before** Tasks 7–8 even start (verified by
   grep against the current script, 2026-07-31):
   - line 62, `"Verify Transaction on logs"` → references `extractAllLogs`
     and `extractTokenLogs`, both deleted by **Task 3**.
   - lines 73–74, `"Place Order button enabled"` and `"Place Order"` → both
     reference `verifyOrderReceived`, deleted by **Task 5** (split into
     `collectOrderReceivedData` + `assertOrderReceived`).

   `verifyPaymentMethods`/`verifyOrderInMyAccount`/`verifySubscription`/
   `verifyCartEmpty` (lines 68–71) survive Task 6 unchanged — that task only
   moves them between files, and this script matches identifier text in the
   spec, not import paths. No edit needed for those.

- [ ] **Step 1: Fix the paths**

```python
GI_BASE = os.environ.get(
    "GI_EXPORT_DIR",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "ghost-inspector-export"),
)
PW_BASE = os.environ.get(
    "PW_TESTS_DIR",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "tests", "Playwright", "tests"),
)
```
This makes the script work out-of-the-box when run from the repo root (both
`ghost-inspector-export/` and `tests/Playwright/tests/` are repo-relative),
while still allowing override via env var for anyone running it from a
different checkout layout.

- [ ] **Step 2: Reconcile `PHASE_MATCHERS` against the post-refactor identifier names**

For each `PHASE_MATCHERS` entry whose old identifiers were relocated into a
composite function during Tasks 7–8, add that composite function's name to
the entry's identifier list (do not remove the old names — a suite not yet
covered by a composite, if any remain, still needs the original match).
At minimum, from Task 7:

```python
    ("Verify Session",                              ["verifySessionPost", "verifySessionGet", "assertCaptureLogTrail"]),
    ("Verify Authorize/Capture log",                ["verifyAuthorizeCaptureLog", "assertCaptureLogTrail"]),
    ("Verify Initiate Authentication log",          ["verifyInitiateAuthentication", "assertCaptureLogTrail"]),
    ("Verify Authenticate Payer log",                ["verifyAuthenticatePayer", "assertCaptureLogTrail"]),
    ("Verify Saved token log",                       ["verifyTokenLog", "verifyTokenLogsEmpty", "assertCaptureLogTrail"]),
    ("Verify Transaction on logs",                   ["verifyAuthorizeCaptureLog", "verifyRefundLog",
                                                      "verifyVoidLog", "verifyAuthenticationResult",
                                                      "verifyTokenLog", "assertCaptureLogTrail"]),
    ("Place Order button enabled",                   ["clickPlaceOrder", "assertOrderReceived"]),
    ("Place Order",                                  ["clickPlaceOrder", "assertOrderReceived"]),
```
(Note `extractAllLogs`/`extractTokenLogs` dropped from the
`"Verify Transaction on logs"` entry — dead since Task 3 — and
`verifyOrderReceived` replaced with `assertOrderReceived` in the two
`"Place Order"` entries, dead since Task 5. `assertOrderReceived` is the
right identifier to match on rather than `collectOrderReceivedData`, since
the GI phase these map to is an assertion phase.) Then add whatever
composite function name(s) Task 8
introduced for the refund/void/subscription suites to the corresponding
entries (`"Refund order"` → add the refund composite's name if one was
created, `"Capture/Void Payment by Admin"` → add the void composite's name,
etc.) — the exact names depend on what Task 8 actually built; check
`git log -p audit-assertions.py` isn't skippable here, check `assertions.ts`
and `flows.ts`'s final exports and match each new composite to the phase(s)
its internals cover.

- [ ] **Step 3: Run the full audit**

```bash
cd /Users/christian/Automation/payment-module-core
python3 audit-assertions.py
```
Expected: coverage report with no new ❌/❓ entries versus the last known-good
run before this refactor started (compare against the findings documented
in the `Document audit findings (suites 01-15 vs Ghost Inspector
source-of-truth)` commit, `710c1e6`). If new gaps appear, they're either a
missed `PHASE_MATCHERS` entry (fix and re-run) or an actual coverage
regression introduced somewhere in Tasks 1–8 (stop and investigate — do not
paper over by loosening the matcher).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "fix(audit): portable paths + reconcile PHASE_MATCHERS with three-layer refactor"
```

---

### Task 10: Final cleanup — confirm no dangling references, remove dead imports

**Files:** whole `tests/Playwright/` tree (read-only checks + trims only).

- [ ] **Step 1: Confirm the 5 deleted modules have zero references left**

```bash
grep -rn "helpers/log-verification\|helpers/email-verification\|helpers/order-received\|helpers/my-account\|helpers/api'" tests/Playwright --include='*.ts'
```
Expected: no output. (`helpers/api'` catches anything Task 1's sed missed;
`helpers/my-account` covers Task 6.) Also confirm the files themselves are
gone:
```bash
ls tests/Playwright/helpers/
```
Expected remaining: `admin-orders.ts`, `assertions.ts`, `block-ui.ts`,
`cart.ts`, `checkout.ts`, `debug.ts`, `flows.ts`, `hosted-checkout.ts`,
`hosted-session.ts`, `request-tracer.ts`, `three-ds.ts`, `wc-api.ts`,
`wp-login.ts` — 13 files, down from 15.

- [ ] **Step 2: Confirm test count parity against the pre-refactor baseline**

```bash
npx playwright test --list | tail -1
```
Expected: `Total: 94 tests in 18 files` — this refactor adds/removes zero
tests.

- [ ] **Step 3: Full `tsc` pass**

```bash
npx tsc --noEmit
```
Expected: only the 5 baseline errors from Global Constraints (with the
former `log-verification.ts(238,24)` one now reported against
`assertions.ts`). Any additional error is a regression introduced by this
refactor — fix it rather than accepting it.

- [ ] **Step 4: Update `ASSERTION-MAP.md`'s stale references**

```bash
grep -n "log-verification\|email-verification\|order-received\|my-account\|helpers/api\|verifyOrderReceived\|extractAllLogs\|extractSessionPostLogs\|extractSessionGetLogs\|extractTokenLogs\|extractTransactionPutLogs\|Mailpit\|MAILPIT" tests/Playwright/ASSERTION-MAP.md
```
Repoint every hit: deleted module paths → `assertions.ts`/`flows.ts`/
`wc-api.ts`; `verifyOrderReceived` → `collectOrderReceivedData` +
`assertOrderReceived`; `extract*Logs` → `getLogs`; any Mailpit mention →
the `custom/v1/get-mail` endpoint. This doc is the human-facing map from GI
phases to helper functions — leaving it pointing at deleted files makes it
actively misleading for the next person porting a suite.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore(playwright): final dangling-reference sweep for three-layer refactor"
```
