#!/usr/bin/env bash
#
# Dev test runner: applies build-time placeholder replacement + asset build
# against a snapshot of the working copy, runs Playwright tests, then restores.
#
# Flow:
#   1. stash tracked changes in plugin + payment-core submodule (safety net)
#   2. apply stash immediately (keeps working copy dirty, but snapshotted)
#   3. run replace-domain + replace-prefix + build:core so tests hit the real
#      `acme_*` hook names, not `PAYMENTS_CORE_HOOK_PREFIX_*` placeholders
#   4. run Playwright from the tests worktree
#   5. git reset --hard + git stash pop to restore uncommitted work
#
# Usage: run-tests-dev.sh <playwright args...>
#

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TESTS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
# Main plugin root: walk up from payment-core worktree to plugin root.
# Worktree is at: <plugin>/packages/payment-core/.worktrees/<branch>/tests/Playwright/scripts
PLUGIN_DIR="$(cd "$TESTS_DIR/../../../../../.." && pwd)"
CORE_DIR="$PLUGIN_DIR/packages/payment-core"

echo "Plugin:  $PLUGIN_DIR"
echo "Core:    $CORE_DIR"
echo "Tests:   $TESTS_DIR"

stashed_plugin=0
stashed_core=0

is_dirty() {
  local dir="$1"
  # tracked changes only (-uno)
  [[ -n "$(git -C "$dir" status --porcelain -uno)" ]]
}

restore() {
  local status=$?
  echo ""
  echo "=== Restoring working copies ==="

  if (( stashed_plugin == 1 )); then
    echo "- plugin: reset --hard + stash pop"
    git -C "$PLUGIN_DIR" reset --hard HEAD >/dev/null || echo "  plugin reset failed"
    git -C "$PLUGIN_DIR" stash pop >/dev/null || echo "  plugin stash pop failed (check stash list)"
  fi

  if (( stashed_core == 1 )); then
    echo "- payment-core: reset --hard + stash pop"
    git -C "$CORE_DIR" reset --hard HEAD >/dev/null || echo "  core reset failed"
    git -C "$CORE_DIR" stash pop >/dev/null || echo "  core stash pop failed (check stash list)"
  fi

  exit "$status"
}

trap restore EXIT INT TERM

echo ""
echo "=== Snapshot uncommitted work ==="

if is_dirty "$PLUGIN_DIR"; then
  echo "- plugin dirty: stash push + apply"
  git -C "$PLUGIN_DIR" stash push -m "run-tests-dev.sh snapshot $(date -u +%FT%TZ)" >/dev/null
  stashed_plugin=1
  git -C "$PLUGIN_DIR" stash apply >/dev/null
else
  echo "- plugin clean"
fi

if is_dirty "$CORE_DIR"; then
  echo "- payment-core dirty: stash push + apply"
  git -C "$CORE_DIR" stash push -m "run-tests-dev.sh snapshot $(date -u +%FT%TZ)" >/dev/null
  stashed_core=1
  git -C "$CORE_DIR" stash apply >/dev/null
else
  echo "- payment-core clean"
fi

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
