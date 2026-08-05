#!/usr/bin/env bash
#
# Dev test runner. Supports two modes:
#
#   built (default)
#     Applies the build-time placeholder replacements + asset build to the
#     working copy, so tests exercise the real hook names and meta keys that
#     ship (e.g. `mastercard_merchant_cloud_order_id`). Faithful to production,
#     but it MUTATES the working copy and must restore it afterwards.
#
#   unbuilt (--unbuilt)
#     Touches nothing. The plugin keeps its `PAYMENTS_CORE_HOOK_PREFIX_*`
#     placeholders and the suite is pointed at them by forcing
#     META_PREFIX=PAYMENTS_CORE_HOOK_PREFIX. Much faster (no composer reinstall,
#     no asset build, no stash dance) and it CANNOT leave the site broken,
#     because the source is never rewritten. Use it for iterating on tests.
#
# Why the mode matters: the site serves this working copy directly. Whatever the
# PHP says at request time is what the tests observe, so the runtime prefix and
# the suite's META_PREFIX have to agree. Built mode makes the source match the
# .env; unbuilt mode makes the env match the source.
#
# Only the hook prefix differs between modes — it appears in PHP only (~244
# occurrences in includes/ + templates/), never in JS/SCSS or built assets. The
# text domain is not asserted on by any test.
#
# built-mode flow:
#   1. stash tracked changes in the plugin + payment-core (+ tests worktree if
#      separate); safety net, stash push only if dirty
#   2. apply the stash immediately (working copy stays dirty, but snapshotted)
#   3. run replace-domain + replace-prefix + build:core
#   4. run Playwright
#   5. reset --hard ALWAYS (step 3 is unconditional, so restore must be too),
#      then stash pop if a stash was taken
#
# NOTE on scope: npm run replace-domain / replace-prefix use --base-dir=. from
# the plugin root, so they recurse into packages/payment-core/ AND any
# packages/payment-core/.worktrees/<branch>/. Every affected checkout must be
# reset afterwards.
#
# Usage:
#   run-tests-dev.sh [--built|--unbuilt] <playwright args...>
#
# Mode may also be set via TEST_MODE=built|unbuilt. The flag wins.
#
# Examples:
#   run-tests-dev.sh 'tests/01-'
#   run-tests-dev.sh --unbuilt 'tests/01-' --grep "MC-004"
#

set -uo pipefail

MODE="${TEST_MODE:-built}"
case "${1:-}" in
  --unbuilt) MODE="unbuilt"; shift ;;
  --built)   MODE="built";   shift ;;
esac

if [[ "$MODE" != "built" && "$MODE" != "unbuilt" ]]; then
  echo "Invalid mode '$MODE' (expected 'built' or 'unbuilt')" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TESTS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
WORKTREE_DIR="$(cd "$TESTS_DIR/.." && pwd)"
# Main plugin root: walk up until we find the dir holding packages/payment-core.
# Works for both layouts: tests in the submodule itself
# (<plugin>/packages/payment-core/tests/Playwright) and tests in a worktree
# (<plugin>/packages/payment-core/.worktrees/<branch>/tests/Playwright).
PLUGIN_DIR="$WORKTREE_DIR"
while [[ "$PLUGIN_DIR" != "/" && ! -d "$PLUGIN_DIR/packages/payment-core" ]]; do
  PLUGIN_DIR="$(dirname "$PLUGIN_DIR")"
done
if [[ "$PLUGIN_DIR" == "/" ]]; then
  echo "Could not locate plugin root (no packages/payment-core above $WORKTREE_DIR)" >&2
  exit 1
fi
CORE_DIR="$PLUGIN_DIR/packages/payment-core"

# When tests live in the submodule itself rather than a worktree, WORKTREE_DIR
# and CORE_DIR are different paths but resolve to the SAME git working tree —
# stashing/resetting it twice would strand the second stash. Compare toplevels,
# not path strings ("$CORE_DIR/tests" != "$CORE_DIR" but is the same repo).
git_top() { git -C "$1" rev-parse --show-toplevel 2>/dev/null; }
WORKTREE_IS_CORE=0
if [[ "$(git_top "$WORKTREE_DIR")" == "$(git_top "$CORE_DIR")" ]]; then
  WORKTREE_IS_CORE=1
fi

echo "Mode:     $MODE"
echo "Plugin:   $PLUGIN_DIR"
echo "Core:     $CORE_DIR"
echo "Worktree: $WORKTREE_DIR"
echo "Tests:    $TESTS_DIR"

archive_prior_results() {
  echo ""
  echo "=== Archiving prior test-results (Playwright wipes outputDir on start) ==="
  local archive_root="$TESTS_DIR/test-results-archive"
  mkdir -p "$archive_root"
  if [[ -d "$TESTS_DIR/test-results" && -n "$(ls -A "$TESTS_DIR/test-results" 2>/dev/null)" ]]; then
    local ts
    ts="$(date -u +%Y%m%dT%H%M%SZ)"
    mv "$TESTS_DIR/test-results" "$archive_root/$ts"
    echo "- archived → test-results-archive/$ts"
  else
    echo "- no prior results"
  fi
}

# ---------------------------------------------------------------- unbuilt mode
if [[ "$MODE" == "unbuilt" ]]; then
  # Source keeps its placeholders, so point the suite at them. Exporting wins
  # over .env: dotenv does not override variables already in the environment.
  export META_PREFIX="PAYMENTS_CORE_HOOK_PREFIX"
  echo ""
  echo "=== Unbuilt mode: working copy untouched ==="
  echo "- no replacements, no build, no stash/reset"
  echo "- META_PREFIX forced to PAYMENTS_CORE_HOOK_PREFIX"
  echo ""
  echo "!! KNOWN LIMITATION: wc_ajax flows DO NOT WORK unbuilt."
  echo "!! The gateway registers its AJAX endpoints with the build-time literal"
  echo "!!   add_action( 'wc_ajax_PAYMENTS_CORE_HOOK_PREFIX_reset_hosted_session', ... )"
  echo "!! but the frontend JS builds the endpoint from the RUNTIME prefix"
  echo "!!   'pluginPrefix' => \$core->get_prefix()   // always the gateway id"
  echo "!! Unbuilt, those disagree, so every hosted-session checkout fails with"
  echo "!! 'There was an error obtaining the payment session.' Affects all four"
  echo "!! endpoints: reset_hosted_session, update_hosted_session_from_token,"
  echo "!! authenticate_payer, dcc_quote — i.e. essentially every suite."
  echo "!! Use built mode unless you are testing something that never calls wc_ajax."
  echo ""
  echo "- NOTE: webhook logs land in PAYMENTS_CORE_HOOK_PREFIX-webhooks-logs"

  archive_prior_results

  echo ""
  echo "=== Running Playwright ==="
  cd "$TESTS_DIR"
  npx playwright test "$@"
  exit $?
fi

# ------------------------------------------------------------------ built mode
stashed_plugin=0
stashed_core=0
stashed_worktree=0

is_dirty() {
  local dir="$1"
  # tracked changes only (-uno)
  [[ -n "$(git -C "$dir" status --porcelain -uno)" ]]
}

reset_and_pop() {
  local label="$1" dir="$2" stashed="$3"
  echo "- $label: reset --hard"
  git -C "$dir" reset --hard HEAD >/dev/null || echo "  $label reset failed"
  if (( stashed == 1 )); then
    echo "  + stash pop"
    git -C "$dir" stash pop >/dev/null || echo "  $label stash pop failed (check stash list)"
  fi
}

restore() {
  local status=$?
  echo ""
  echo "=== Restoring working copies ==="
  reset_and_pop "plugin"       "$PLUGIN_DIR"   "$stashed_plugin"
  reset_and_pop "payment-core" "$CORE_DIR"     "$stashed_core"
  if (( WORKTREE_IS_CORE == 0 )); then
    reset_and_pop "worktree"   "$WORKTREE_DIR" "$stashed_worktree"
  fi
  exit "$status"
}

trap restore EXIT INT TERM

snapshot() {
  local label="$1" dir="$2" stash_var="$3"
  if is_dirty "$dir"; then
    echo "- $label dirty: stash push + apply"
    git -C "$dir" stash push -m "run-tests-dev.sh snapshot $(date -u +%FT%TZ)" >/dev/null
    printf -v "$stash_var" 1
    git -C "$dir" stash apply >/dev/null
  else
    echo "- $label clean"
  fi
}

echo ""
echo "=== Snapshot uncommitted work ==="
snapshot "plugin"       "$PLUGIN_DIR"   stashed_plugin
snapshot "payment-core" "$CORE_DIR"     stashed_core
if (( WORKTREE_IS_CORE == 0 )); then
  snapshot "worktree"   "$WORKTREE_DIR" stashed_worktree
fi

echo ""
echo "=== Applying build-time replacements + asset build ==="

cd "$PLUGIN_DIR"
npm run replace-domain || { echo "replace-domain failed"; exit 1; }
npm run replace-prefix || { echo "replace-prefix failed"; exit 1; }
npm run build:core     || { echo "build:core failed"; exit 1; }

archive_prior_results

echo ""
echo "=== Running Playwright ==="

cd "$TESTS_DIR"
npx playwright test "$@"
