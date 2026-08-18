#!/usr/bin/env python3
"""
Assertion Audit Script
Compares Ghost Inspector test assertions against Playwright test files to verify 1:1 coverage.
"""

import json
import os
import glob
import re
import sys
from collections import defaultdict

# ============================================================
# Configuration
# ============================================================

HERE = os.path.dirname(os.path.abspath(__file__))

# Both default to nothing so a missing GI export fails with a clear message
# instead of silently auditing zero suites against a path that never existed.
GI_BASE = os.environ.get("GI_BASE", "")
PW_BASE = os.environ.get(
    "PW_BASE",
    os.path.join(HERE, "tests", "Playwright", "tests"),
)


def require_paths() -> None:
    """
    Checked when an audit actually runs, not at import — `--self-check` is
    useful precisely when no GI export is on hand.
    """
    if not GI_BASE or not os.path.isdir(GI_BASE):
        raise SystemExit(
            "GI_BASE is unset or not a directory.\n"
            "Point it at the Ghost Inspector export root:\n"
            "  GI_BASE=/path/to/ghost-inspector-export python3 audit-assertions.py"
        )
    if not os.path.isdir(PW_BASE):
        raise SystemExit(f"PW_BASE is not a directory: {PW_BASE}")

# GI suite slug -> Playwright directory
SUITE_MAP = {
    "mc-cc-hosted-session-capture-classic":             "01-hosted-session-capture-classic",
    "mc-cc-hosted-session-capture-blocks":              "02-hosted-session-capture-blocks",
    "mc-cc-hosted-checkout-embedded-capture":           "03-hosted-checkout-embedded-capture",
    "mc-cc-hosted-checkout-redirect-capture":           "04-hosted-checkout-redirect-capture",
    "mc-cc-hosted-checkout-redirect-only-authorize":    "05-hosted-checkout-redirect-authorize",
    "mc-cc-hosted-session-3ds":                         "06-hosted-session-3ds",
    "mc-cc-hosted-session-3ds-inactive":                "07-hosted-session-3ds-inactive",
    "mc-cc-hosted-session-session-classic":             "08-hosted-session-session-classic",
    "mc-cc-hosted-session-session-blocks":              "09-hosted-session-session-blocks",
    "mc-cc-hosted-session-declined-transaction-authentication": "10-hosted-session-declined",
    "mc-cc-session-save-cc-deactivated":                "11-hosted-session-save-cc-deactivated",
    "mc-cc-hosted-session-capture-pay-for-order":       "12-hosted-session-pay-for-order",
    "mc-cc-hosted-session-add-payment-method":          "13-hosted-session-add-payment-method",
    "mc-cc-only-authorize-capture-void-by-admin":       "14-authorize-capture-void",
    "mc-cc-refund":                                     "15-refund",
    "mc-cc-subscription-renewal":                       "16-subscription-renewal",
    "mc-cc-subscription-upgrade":                       "17-subscription-upgrade",
    "mc-cc-subscription-manual-renewal":                "18-subscription-manual-renewal",
}

# Phase keyword -> list of Playwright identifiers to look for
PHASE_MATCHERS = [
    # Ordered from most specific to most general to avoid false matches
    ("Verify Session",                              ["verifySessionPost", "verifySessionGet"]),
    ("Verify Authorize/Capture log",                ["verifyAuthorizeCaptureLog"]),
    ("Verify Authentication log",                   ["verifyAuthenticationResult"]),
    ("Verify Initiate Authentication log",          ["verifyInitiateAuthentication"]),
    ("Verify Authenticate Payer log",               ["verifyAuthenticatePayer"]),
    ("Verify Agreement Authentication",             ["verifyAgreement"]),
    ("Verify Agreement Authorize/Capture",          ["verifyAgreement"]),
    ("Verify Agreement",                            ["verifyAgreement"]),
    ("Verify Saved token log",                      ["verifyTokenLog", "verifyTokenLogsEmpty"]),
    ("Verify Refund log",                           ["verifyRefundLog"]),
    ("Verify Void log",                             ["verifyVoidLog"]),
    # extractAllLogs / extractTokenLogs were deleted in the three-layer refactor.
    ("Verify Transaction on logs",                  ["verifyAuthorizeCaptureLog", "verifyRefundLog",
                                                     "verifyVoidLog", "verifyAuthenticationResult",
                                                     "verifyTokenLog"]),
    ("Playgrounds Email",                           ["verifyOrderEmails", "verifyAdminEmail", "verifyCustomerEmail"]),
    ("verify Email - Admin and Customer",           ["verifyOrderEmails", "verifyAdminEmail", "verifyCustomerEmail"]),
    ("verify Email - Only Admin",                   ["verifyAdminEmail", "verifyOrderEmails"]),
    ("verify Email - only Customer",                ["verifyCustomerEmail", "verifyOrderEmails"]),
    ("verify Email",                                ["verifyOrderEmails", "verifyAdminEmail", "verifyCustomerEmail"]),
    ("Check My Account",                            ["verifyPaymentMethods", "verifyOrderInMyAccount", "verifyCartEmpty"]),
    ("My Account - Subscription",                   ["verifySubscription"]),
    ("Check transcation is present on Order backend", ["navigateToOrder", "assertOrderStatus"]),
    ("Check Subscription Backend",                  ["verifySubscription"]),
    ("Get Woo order details",                       ["verifyOrderViaAPI", "getOrder", "getFailedOrders"]),
    # verifyOrderReceived() was split into assertOrderReceived (checks) and
    # collectOrderReceivedData (reads) by the three-layer refactor.
    ("Place Order button enabled",                  ["clickPlaceOrder", "assertOrderReceived",
                                                     "collectOrderReceivedData"]),
    ("Place Order",                                 ["clickPlaceOrder", "assertOrderReceived",
                                                     "collectOrderReceivedData"]),
    ("Fill CC Hosted Checkout",                     ["fillHostedCheckoutCC"]),
    ("Fill CC",                                     ["fillHostedSessionCC", "fillHostedSessionCCPartial"]),
    ("Fill Checkout",                               ["fillBilling", "selectPaymentMethod", "addToCartAndCheckout"]),
    ("BlockUI",                                     ["waitForUnblock"]),
    ("3DS challenge",                               ["handle3DSChallenge", "cards.visaChallenge"]),
    ("Login",                                       ["adminLogin", "frontendLogin"]),
    ("Register",                                    ["createAccountAtCheckout", "frontendLogin"]),
    ("Add Physical Product to Cart",                ["addToCartAndCheckout"]),
    ("Add Virtual Product to Cart",                 ["addToCartAndCheckout"]),
    ("Add Download Product to Cart",                ["addToCartAndCheckout"]),
    ("Add Physical Subscription Product to Cart",   ["addToCartAndCheckout"]),
    ("Fill Checkout",                               ["fillBilling"]),
    ("Add Payment Method",                          ["verifyPaymentMethods"]),
    ("Capture/Void Payment by Admin",               ["verifyVoidLog", "assertOrderStatus"]),
    ("Refund order",                                ["verifyRefundLog"]),
    ("Renewal Order",                               ["verifySubscription", "verifyOrderViaAPI"]),
    ("Subscription Upgrade, Manual renew, Cancel, Change payment MEthod",
                                                    ["verifySubscription"]),
    ("Pay MasterCard",                              ["fillHostedSessionCC", "fillHostedCheckoutCC",
                                                     "clickPlaceOrder"]),
    ("Page full loaded",                            []),   # technical/infra - no direct PW equivalent
]

# ============================================================
# Composite expansion
# ============================================================
#
# The three-layer port moved the low-level calls out of the spec files and behind
# these entry points, so a spec that calls assertCaptureLogTrail no longer
# literally contains "verifySessionPost". Without expanding them, every phase in
# suites 01-15 reports MISSING and the audit reads as near-total coverage loss.
#
# Each list is what the entry point actually performs, read off its body in
# helpers/. Keep it in step with ASSERTION-MAP.md, and run `--self-check` after
# editing: that verifies every identifier named here is still a real helper.

_HOSTED_SESSION_TRAIL = [
    "verifySessionPost", "verifySessionGet", "verifySessionGetCardDetails",
    "verifyTokenLog", "verifyTokenLogsEmpty", "verifyInitiateAuthentication",
    "verifyAuthenticatePayer", "verifyAuthenticationResult",
    "verifyAuthorizeCaptureLog",
]

COMPOSITE_EXPANSIONS = {
    "assertCaptureLogTrail": _HOSTED_SESSION_TRAIL,
    # Delegates to assertCaptureLogTrail with apiOperation AUTHORIZE.
    "assertAuthorizeLogTrail": _HOSTED_SESSION_TRAIL,
    # Deliberately shorter: MPGS runs 3DS and the payment inside its own UI, so
    # only INITIATE_CHECKOUT reaches our log.
    "assertHostedCheckoutLogTrail": ["verifySessionPost", "verifyTokenLogsEmpty"],
    "assertCaptureOperationLog": ["verifyAuthorizeCaptureLog"],
    "checkoutHostedSession": [
        "addToCartAndCheckout", "fillBilling", "createAccountAtCheckout",
        "selectPaymentMethod", "selectSavedToken", "fillHostedSessionCC",
        "clickSaveCardCheckbox", "clickPlaceOrder", "handle3DSChallenge",
        "frontendLogin", "assertOrderReceived", "verifyCartEmpty",
        "verifyOrderViaAPI",
    ],
    "checkoutHostedCheckout": [
        "addToCartAndCheckout", "fillBilling", "createAccountAtCheckout",
        "selectPaymentMethod", "fillHostedCheckoutCC",
        "clickPlaceOrderHostedCheckout", "clickHostedCheckoutPay",
        "handle3DSChallenge", "frontendLogin", "assertOrderReceived",
        "verifyCartEmpty", "verifyOrderViaAPI",
    ],
    "assertOrderComplete": [
        "verifyOrderEmails", "verifyAdminEmail", "navigateToOrder",
        "assertOrderStatus", "assertPaymentMethodMeta", "assertCapturedNote",
        "assertAuthorizedNote", "frontendLogin", "verifyPaymentMethods",
        "verifyOrderInMyAccount",
    ],
}


def expand_composites(pw_content: str) -> str:
    """
    Append the identifiers each composite performs, so the existing phase
    matchers keep working against specs that call the composite instead.
    """
    extra = []
    for composite, performed in COMPOSITE_EXPANSIONS.items():
        if composite in pw_content:
            extra.extend(performed)
    if not extra:
        return pw_content
    return pw_content + "\n// expanded composites: " + " ".join(sorted(set(extra)))


ASSERT_COMMANDS = {
    "assertText", "assertTextPresent", "assertElementPresent",
    "assertElementNotPresent", "assertElementVisible",
    "assertElementNotVisible", "assertEval",
}


# ============================================================
# Helpers
# ============================================================

def normalize_phase(raw: str) -> str:
    """Strip the 'MC - Common Steps for Tests - ' / 'Common Steps for all Projects - ' prefix."""
    raw = raw.strip()
    for prefix in [
        "MC - Common Steps for Tests - ",
        "Common Steps for all Projects - ",
    ]:
        if raw.startswith(prefix):
            return raw[len(prefix):]
    return raw


def extract_deepest_phase(notes: str) -> str:
    """
    Given a notes block like:
        Imported from: MC - Common Steps for Tests - Place Order
        Imported from: MC - Common Steps for Tests - Pay MasterCard
        Imported from: MC - Common Steps for Tests - Fill CC
        Imported from: Common Steps for all Projects - BlockUI

    Return the deepest (last) non-empty phase name.
    """
    lines = [l.strip() for l in notes.split("\n") if l.strip()]
    imported = [l.replace("Imported from:", "").strip()
                for l in lines if l.startswith("Imported from:")]
    if imported:
        return imported[-1]
    return ""


def extract_outermost_phase(notes: str) -> str:
    """Return the first (outermost) imported phase."""
    lines = [l.strip() for l in notes.split("\n") if l.strip()]
    imported = [l.replace("Imported from:", "").strip()
                for l in lines if l.startswith("Imported from:")]
    if imported:
        return imported[0]
    return ""


def collect_gi_phases(gi_suite_dir: str) -> dict:
    """
    Returns a dict mapping phase_display_name -> assertion_count for all JSON test files
    in the given GI suite directory.
    Uses the outermost phase as the "category" so we group by the top-level step group.
    """
    phase_counts = defaultdict(int)

    json_files = sorted(glob.glob(os.path.join(gi_suite_dir, "*.json")))
    for jf in json_files:
        if os.path.basename(jf).startswith("_"):
            continue
        try:
            with open(jf, encoding="utf-8") as f:
                data = json.load(f)
        except Exception:
            continue

        steps = data.get("steps", [])
        for step in steps:
            if step.get("command", "") not in ASSERT_COMMANDS:
                continue
            notes = step.get("notes", "")
            outermost = extract_outermost_phase(notes)
            if not outermost:
                outermost = "(no phase)"
            phase_counts[outermost] += 1

    return dict(phase_counts)


def match_phase(phase_raw: str, pw_content: str) -> tuple:
    """
    Returns (matched_keywords, found_any) given a raw GI phase name and the Playwright spec content.
    matched_keywords: list of PW identifiers that were found.
    """
    phase_normalized = normalize_phase(phase_raw)

    # Find the best matcher
    matched_rule = None
    for keyword, identifiers in PHASE_MATCHERS:
        if keyword.lower() in phase_normalized.lower():
            matched_rule = (keyword, identifiers)
            break

    if matched_rule is None:
        return ([], False, None)

    keyword, identifiers = matched_rule

    if not identifiers:
        # Infrastructure phase — mark as N/A (not expected to have direct PW coverage)
        return ([], None, keyword)  # None = N/A

    found = [ident for ident in identifiers if ident in pw_content]
    return (found, bool(found), keyword)


def load_playwright_spec(pw_suite_dir: str) -> str:
    """
    Load all .spec.ts content for a Playwright suite directory, following any
    `../_shared/...` import.

    Suites 08 and 09 were identical, so their six test bodies now live in
    tests/_shared/session-validation-cases.ts and each spec file is three lines.
    The steps genuinely moved there, so the audit has to read there too —
    unlike helpers/, which holds implementation and would match everything.
    """
    content_parts = []
    for spec_file in glob.glob(os.path.join(pw_suite_dir, "*.spec.ts")):
        try:
            with open(spec_file, encoding="utf-8") as f:
                text = f.read()
        except Exception:
            continue
        content_parts.append(text)

        for rel in re.findall(r"from '\.\./(_shared/[\w.-]+)'", text):
            shared = os.path.join(os.path.dirname(pw_suite_dir), rel)
            if not shared.endswith(".ts"):
                shared += ".ts"
            try:
                with open(shared, encoding="utf-8") as f:
                    content_parts.append(f.read())
            except Exception:
                print(f"  ⚠  shared module imported but unreadable: {shared}")

    return "\n".join(content_parts)


# ============================================================
# Main audit
# ============================================================

def run_audit():
    require_paths()

    total_phases = 0
    covered_phases = 0
    na_phases = 0
    missing_phases = 0
    unknown_phases = 0

    missing_by_suite = defaultdict(list)
    unknown_by_suite = defaultdict(list)

    print("=" * 60)
    print("=== ASSERTION AUDIT REPORT ===")
    print("=" * 60)
    print()

    for gi_slug, pw_dir_name in SUITE_MAP.items():
        gi_suite_dir = os.path.join(GI_BASE, gi_slug)
        pw_suite_dir = os.path.join(PW_BASE, pw_dir_name)

        if not os.path.isdir(gi_suite_dir):
            print(f"Suite: {pw_dir_name}")
            print(f"  ⚠  GI directory not found: {gi_suite_dir}")
            print()
            continue

        pw_content = expand_composites(load_playwright_spec(pw_suite_dir))
        if not pw_content:
            print(f"Suite: {pw_dir_name}")
            print(f"  ⚠  No Playwright spec found in: {pw_suite_dir}")
            print()
            continue

        phase_counts = collect_gi_phases(gi_suite_dir)

        if not phase_counts:
            print(f"Suite: {pw_dir_name}")
            print(f"  (no assertion steps found in GI suite)")
            print()
            continue

        print(f"Suite: {pw_dir_name}")

        suite_total = 0
        suite_covered = 0
        suite_na = 0
        suite_missing = 0
        suite_unknown = 0

        # Sort phases for deterministic output
        for phase_raw in sorted(phase_counts.keys()):
            count = phase_counts[phase_raw]
            phase_normalized = normalize_phase(phase_raw)

            found_keywords, found_any, matched_rule = match_phase(phase_raw, pw_content)

            if matched_rule is None:
                # No matching rule — unknown phase
                suite_total += 1
                suite_unknown += 1
                unknown_by_suite[pw_dir_name].append(f"{phase_normalized} ({count} assertions)")
                print(f"  ❓ {phase_normalized} ({count} assertions) → NO RULE DEFINED")
                continue

            if found_any is None:
                # N/A (infra phase, no PW equivalent expected)
                suite_total += 1
                suite_na += 1
                print(f"  ⬛ {phase_normalized} ({count} assertions) → N/A (infrastructure, no direct PW equivalent)")
                continue

            suite_total += 1
            if found_any:
                suite_covered += 1
                kw_str = ", ".join(found_keywords)
                print(f"  ✅ {phase_normalized} ({count} assertions) → {kw_str} found")
            else:
                suite_missing += 1
                rule_kws = dict(PHASE_MATCHERS).get(matched_rule, [])
                # Re-fetch expected identifiers
                for kw, ids in PHASE_MATCHERS:
                    if kw == matched_rule:
                        rule_kws = ids
                        break
                kw_str = ", ".join(rule_kws)
                missing_by_suite[pw_dir_name].append(f"{phase_normalized} ({count} assertions) — expected: {kw_str}")
                print(f"  ❌ {phase_normalized} ({count} assertions) → MISSING: none of [{kw_str}] found")

        print(
            f"  → Suite total: {suite_total} phases | "
            f"✅ {suite_covered} covered | "
            f"❌ {suite_missing} missing | "
            f"⬛ {suite_na} N/A | "
            f"❓ {suite_unknown} unknown"
        )
        print()

        total_phases += suite_total
        covered_phases += suite_covered
        na_phases += suite_na
        missing_phases += suite_missing
        unknown_phases += suite_unknown

    # ---- Summary ----
    auditable = total_phases - na_phases
    coverage_pct = (covered_phases / auditable * 100) if auditable > 0 else 0.0

    print("=" * 60)
    print("Summary:")
    print(f"  Total GI assertion phases tracked : {total_phases}")
    print(f"  N/A (infrastructure, no PW equiv) : {na_phases}")
    print(f"  Auditable phases                  : {auditable}")
    print(f"  Covered in Playwright             : {covered_phases} ({coverage_pct:.1f}%)")
    print(f"  Missing                           : {missing_phases} ({100 - coverage_pct:.1f}%)")
    print(f"  Unknown (no rule)                 : {unknown_phases}")
    print()

    if missing_by_suite:
        print("Missing phases by suite:")
        for suite, items in sorted(missing_by_suite.items()):
            print(f"  {suite}:")
            for item in items:
                print(f"    - {item}")
        print()

    if unknown_by_suite:
        print("Unknown phases by suite (add rules for these):")
        for suite, items in sorted(unknown_by_suite.items()):
            print(f"  {suite}:")
            for item in items:
                print(f"    - {item}")
        print()


def self_check() -> int:
    """
    Verify every identifier this script looks for is still a real helper or
    shared-module export. Runs without a GI export, so it is the cheap way to
    catch the rot that motivated this pass: the matchers were still naming
    extractAllLogs and extractTokenLogs, deleted in the three-layer refactor,
    which can only ever report as MISSING.
    """
    roots = [
        os.path.join(HERE, "tests", "Playwright", "helpers"),
        os.path.join(HERE, "tests", "Playwright", "tests", "_shared"),
    ]
    exported = set()
    for root in roots:
        for path in glob.glob(os.path.join(root, "*.ts")):
            with open(path, encoding="utf-8") as f:
                exported |= set(re.findall(r"export (?:async )?function (\w+)", f.read()))

    referenced = {i for _, idents in PHASE_MATCHERS for i in idents}
    referenced |= set(COMPOSITE_EXPANSIONS)
    for performed in COMPOSITE_EXPANSIONS.values():
        referenced |= set(performed)
    # Not functions, so not expected in the export list.
    referenced -= {"cards.visaChallenge"}

    unknown = sorted(i for i in referenced if i not in exported)
    if unknown:
        print("SELF-CHECK FAILED — these identifiers are no longer exported by")
        print("helpers/ or tests/_shared/, so any phase relying on them can only")
        print("report MISSING:")
        for i in unknown:
            print(f"  - {i}")
        return 1
    print(f"SELF-CHECK OK — all {len(referenced)} referenced identifiers exist.")
    return 0


if __name__ == "__main__":
    if "--self-check" in sys.argv:
        raise SystemExit(self_check())
    run_audit()
