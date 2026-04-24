#!/usr/bin/env bash
#
# Dev test runner: applies build-time placeholder replacement + asset build
# against a snapshot of the working copy, runs Playwright tests, then restores.
#
# Flow:
#   1. stash tracked changes in each of: main plugin, payment-core submodule,
#      tests worktree (safety net; stash push only if dirty)
#   2. apply stash immediately (keeps working copy dirty, but snapshotted)
#   3. run replace-domain + replace-prefix + build:core so tests hit the real
#      `acme_*` hook names, not `PAYMENTS_CORE_HOOK_PREFIX_*` placeholders
#   4. run Playwright from the tests worktree
#   5. reset --hard ALWAYS (replace-prefix is unconditional, so restore must
#      be too), then stash pop if a stash was taken
#
# NOTE on scope: npm run replace-domain / replace-prefix use --base-dir=.
# from the plugin root, so they recurse into packages/payment-core/ AND
# packages/payment-core/.worktrees/<branch>/. All three checkouts
# (PLUGIN_DIR, CORE_DIR, WORKTREE_DIR) must be reset afterwards.
#
# Usage: run-tests-dev.sh <playwright args...>
#

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TESTS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
WORKTREE_DIR="$(cd "$TESTS_DIR/.." && pwd)"
# Main plugin root: walk up from payment-core worktree to plugin root.
# Worktree is at: <plugin>/packages/payment-core/.worktrees/<branch>/tests/Playwright/scripts
PLUGIN_DIR="$(cd "$TESTS_DIR/../../../../../.." && pwd)"
CORE_DIR="$PLUGIN_DIR/packages/payment-core"

echo "Plugin:   $PLUGIN_DIR"
echo "Core:     $CORE_DIR"
echo "Worktree: $WORKTREE_DIR"
echo "Tests:    $TESTS_DIR"

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
  reset_and_pop "worktree"     "$WORKTREE_DIR" "$stashed_worktree"
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
snapshot "worktree"     "$WORKTREE_DIR" stashed_worktree

echo ""
echo "=== Applying build-time replacements + asset build ==="

cd "$PLUGIN_DIR"
npm run replace-domain || { echo "replace-domain failed"; exit 1; }
npm run replace-prefix || { echo "replace-prefix failed"; exit 1; }
npm run build:core     || { echo "build:core failed"; exit 1; }

echo ""
echo "=== Running Playwright ==="

cd "$TESTS_DIR"
npx playwright test "$@"
