#!/usr/bin/env bash
# Smoke tests for the Podman agent sandbox.
#
# Tests the full lifecycle: build, create, start, verify, stop, restart,
# remove, recreate, and cleanup. The cleanup handler runs even on failure.
#
# Usage:
#   ./tests/smoke-test.sh
#
# Environment variables:
#   AGENT_IMAGE  Image to test (default: localhost/agent-dev:latest)
#   SKIP_BUILD   Set to 1 to skip the image build step
# Note: We use set -uo pipefail (NOT set -e) because a test script must
# continue past individual command failures and report them.
set -uo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
CLI="$PROJECT_ROOT/bin/agent-sandbox"
AGENT_IMAGE="${AGENT_IMAGE:-localhost/agent-dev:latest}"
SKIP_BUILD="${SKIP_BUILD:-0}"

# Test state
TEST_DIR=""
TEST_PASS=0
TEST_FAIL=0
CONTAINER_NAME=""
HOME_VOLUME=""

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

info() {
  echo "[smoke] $*"
}

pass() {
  echo "[smoke] PASS: $*"
  TEST_PASS=$((TEST_PASS + 1))
}

fail() {
  echo "[smoke] FAIL: $*" >&2
  TEST_FAIL=$((TEST_FAIL + 1))
  # Exit immediately via cleanup; the EXIT trap will also fire but
  # _CLEANUP_DONE prevents double execution.
  CLEANUP_AND_EXIT 1
}

# Run a command and assert it succeeds.
assert_ok() {
  local desc="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    pass "$desc"
  else
    fail "$desc (command: $*)"
  fi
}

# Run a command and assert it fails.
assert_fails() {
  local desc="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    fail "$desc (expected failure, but succeeded: $*)"
  else
    pass "$desc"
  fi
}

# Run a command and capture output, assert it contains a string.
assert_contains() {
  local desc="$1"
  local expected="$2"
  shift 2
  local output
  output="$("$@" 2>&1)" || true
  if echo "$output" | grep -q "$expected"; then
    pass "$desc"
  else
    fail "$desc (expected '$expected' in output, got: $output)"
  fi
}

# Get the container name for the test project.
get_container_name() {
  "$CLI" status "$TEST_DIR" 2>/dev/null | grep '^Sandbox:' | awk '{print $2}'
}

# Get the home volume name for the test project.
get_home_volume() {
  "$CLI" status "$TEST_DIR" 2>/dev/null | grep '^Root home:' | awk '{print $3}'
}

# ---------------------------------------------------------------------------
# Cleanup
# ---------------------------------------------------------------------------

CLEANUP_AND_EXIT() {
  local exit_code="${1:-0}"
  # Prevent double-cleanup (fail() calls this, then EXIT trap fires)
  [[ "${_CLEANUP_DONE:-0}" -eq 1 ]] && return 0
  _CLEANUP_DONE=1
  echo ""
  info "Cleaning up..."

  # Stop and remove the test container if it exists
  if [[ -n "$TEST_DIR" ]]; then
    "$CLI" remove -f "$TEST_DIR" 2>/dev/null || true
  fi

  # Remove the test directory
  if [[ -n "$TEST_DIR" && -d "$TEST_DIR" ]]; then
    rm -rf "$TEST_DIR" 2>/dev/null || true
  fi

  # Report results
  echo ""
  echo "=========================================="
  echo "Smoke test results: $TEST_PASS passed, $TEST_FAIL failed"
  echo "=========================================="

  exit "$exit_code"
}

# Trap to ensure cleanup runs on any exit
trap 'CLEANUP_AND_EXIT 0' EXIT

# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

info "Starting Podman agent sandbox smoke tests"
info "CLI: $CLI"
info "Image: $AGENT_IMAGE"

# Verify prerequisites
assert_ok "Podman is installed" command -v podman
if [[ "$(uname)" == "Darwin" ]]; then
  if podman machine list --format '{{.Running}}' 2>/dev/null | grep -q true; then
    pass "Podman machine is running"
  else
    fail "Podman machine is not running"
  fi
fi

# Step 1: Build the image (or skip)
if [[ "$SKIP_BUILD" == "1" ]]; then
  info "Skipping build (SKIP_BUILD=1)"
else
  info "Step 1: Building image..."
  assert_ok "Image build succeeds" "$CLI" build
fi

# Step 2: Create a temporary project directory
info "Step 2: Creating temporary project directory..."
TEST_DIR="$(mktemp -d /tmp/agent-smoke-XXXXXX)"
info "Test project: $TEST_DIR"

# Create a test file in the project
echo "test content" > "$TEST_DIR/test-file.txt"
echo "agent sandbox smoke test" > "$TEST_DIR/README.md"
git -C "$TEST_DIR" init -q 2>/dev/null || true
git -C "$TEST_DIR" add -A 2>/dev/null || true
git -C "$TEST_DIR" commit -q -m "initial" 2>/dev/null || true

# Step 3: Create and start a sandbox
info "Step 3: Creating sandbox..."
assert_ok "Create sandbox" "$CLI" create "$TEST_DIR"

info "Step 4: Starting sandbox..."
assert_ok "Start sandbox" "$CLI" start "$TEST_DIR"

CONTAINER_NAME="$(get_container_name)"
HOME_VOLUME="$(get_home_volume)"
info "Container: $CONTAINER_NAME"
info "Home volume: $HOME_VOLUME"

# Step 5: Verify the running user is root
info "Step 5: Verifying user is root..."
assert_contains "User is root (UID 0)" "uid=0(root)" "$CLI" exec "$TEST_DIR" -- id

# Step 6: Verify /workspace is writable
info "Step 6: Verifying /workspace is writable..."
assert_ok "Touch file in /workspace" "$CLI" exec "$TEST_DIR" -- touch /workspace/smoke-test-file
assert_ok "File exists in /workspace" "$CLI" exec "$TEST_DIR" -- test -f /workspace/smoke-test-file
assert_ok "Bind mount shows host file" "$CLI" exec "$TEST_DIR" -- test -f /workspace/test-file.txt

# Step 7: Verify /root persists (marker file from entrypoint)
info "Step 7: Verifying /root initialization..."
assert_ok "Marker file exists" "$CLI" exec "$TEST_DIR" -- test -f /root/.agent-sandbox-initialized
assert_ok "Bashrc exists" "$CLI" exec "$TEST_DIR" -- test -f /root/.bashrc
assert_ok "Mise config exists" "$CLI" exec "$TEST_DIR" -- test -f /root/.config/mise/config.toml

# Step 8: Install a small package with apt
info "Step 8: Installing apt package..."
assert_ok "apt-get update" "$CLI" exec "$TEST_DIR" -- apt-get update -qq
assert_ok "apt-get install tree" "$CLI" exec "$TEST_DIR" -- apt-get install -y -qq tree
assert_contains "tree is installed" "tree v" "$CLI" exec "$TEST_DIR" -- tree --version

# Step 9: Install or invoke a tool with mise
info "Step 9: Verifying mise tools..."
assert_contains "mise --version works" "linux" "$CLI" exec "$TEST_DIR" -- mise --version
assert_contains "node --version works" "v22" "$CLI" exec "$TEST_DIR" -- mise exec -- node --version
assert_contains "python --version works" "Python 3" "$CLI" exec "$TEST_DIR" -- mise exec -- python --version
assert_contains "opencode --version works" "1" "$CLI" exec "$TEST_DIR" -- mise exec -- opencode --version
assert_contains "codex --version works" "codex" "$CLI" exec "$TEST_DIR" -- mise exec -- codex --version
assert_contains "ripgrep works" "ripgrep" "$CLI" exec "$TEST_DIR" -- mise exec -- rg --version
assert_contains "fd works" "fd" "$CLI" exec "$TEST_DIR" -- mise exec -- fd --version
assert_contains "jq works" "jq" "$CLI" exec "$TEST_DIR" -- jq --version

# Step 10: Verify network access in default mode
info "Step 10: Verifying network access..."
assert_ok "DNS resolution works" "$CLI" exec "$TEST_DIR" -- getent hosts github.com
assert_ok "HTTP download works" "$CLI" exec "$TEST_DIR" -- curl -fsSL -o /dev/null https://mise.run

# Step 11: Verify resource limits are visible
info "Step 11: Verifying resource limits..."
MEMORY_LIMIT="$(podman container inspect "$CONTAINER_NAME" --format '{{.HostConfig.Memory}}' 2>/dev/null || echo "0")"
PID_LIMIT="$(podman container inspect "$CONTAINER_NAME" --format '{{.HostConfig.PidsLimit}}' 2>/dev/null || echo "0")"
if [[ "$MEMORY_LIMIT" != "0" && "$MEMORY_LIMIT" != "" ]]; then
  pass "Memory limit is set ($MEMORY_LIMIT)"
else
  fail "Memory limit is not set"
fi
if [[ "$PID_LIMIT" != "0" && "$PID_LIMIT" != "" ]]; then
  pass "PID limit is set ($PID_LIMIT)"
else
  fail "PID limit is not set"
fi

# Step 12: SSH server tests
info "Step 12: Verifying SSH server..."
assert_ok "sshd is running" podman exec "$CONTAINER_NAME" pgrep -x sshd
assert_ok "sshd listening on port 22" podman exec "$CONTAINER_NAME" bash -c 'ss -tlnp | grep -q ":22 "'
assert_ok "ssh host keys generated" podman exec "$CONTAINER_NAME" test -f /etc/ssh/ssh_host_ed25519_key
assert_ok "authorized_keys exists" podman exec "$CONTAINER_NAME" test -f /root/.ssh/authorized_keys
assert_ok "bash_profile sources bashrc" podman exec "$CONTAINER_NAME" test -f /root/.bash_profile

# Step 13: Stop and restart the container
info "Step 13: Stopping and restarting..."
assert_ok "Stop container" "$CLI" stop "$TEST_DIR"
assert_ok "Container is stopped" test "$(podman container inspect "$CONTAINER_NAME" --format '{{.State.Status}}' 2>/dev/null)" = "exited"
assert_ok "Start container again" "$CLI" start "$TEST_DIR"
assert_ok "Container is running" test "$(podman container inspect "$CONTAINER_NAME" --format '{{.State.Status}}' 2>/dev/null)" = "running"

# Step 14: Verify installed apt packages remain after restart
info "Step 14: Verifying apt persistence after restart..."
assert_contains "tree still installed after restart" "tree v" "$CLI" exec "$TEST_DIR" -- tree --version

# Step 14: Verify /root data remains after restart
info "Step 14: Verifying /root persistence after restart..."
assert_ok "Marker still exists" "$CLI" exec "$TEST_DIR" -- test -f /root/.agent-sandbox-initialized
assert_contains "mise tools still work after restart" "v22" "$CLI" exec "$TEST_DIR" -- mise exec -- node --version

# Step 14: Remove and recreate the container
info "Step 14: Removing and recreating..."
assert_ok "Remove container (keep volume)" "$CLI" remove "$TEST_DIR" <<< "n"
assert_contains "Container is gone" "not created" "$CLI" status "$TEST_DIR"
assert_ok "Recreate container" "$CLI" create "$TEST_DIR"
assert_ok "Start recreated container" "$CLI" start "$TEST_DIR"

# Step 15: Verify /root data remains through the named volume
info "Step 15: Verifying /root persistence through volume..."
assert_ok "Marker still exists after recreate" "$CLI" exec "$TEST_DIR" -- test -f /root/.agent-sandbox-initialized
assert_contains "mise tools still work after recreate" "v22" "$CLI" exec "$TEST_DIR" -- mise exec -- node --version

# Step 16: Verify container-layer apt packages do NOT remain after recreation
info "Step 16: Verifying container-layer apt packages are gone..."
assert_fails "tree is gone after recreate" "$CLI" exec "$TEST_DIR" -- tree --version

# Step 17: Verify workspace files persist (bind mount)
info "Step 17: Verifying workspace bind mount..."
assert_ok "Host test file still in workspace" "$CLI" exec "$TEST_DIR" -- test -f /workspace/test-file.txt

# Step 18: Verify status output
info "Step 18: Verifying status output..."
STATUS_OUTPUT="$("$CLI" status "$TEST_DIR" 2>&1)"
echo "$STATUS_OUTPUT" | grep -q "Sandbox:" || fail "Status missing Sandbox field"
echo "$STATUS_OUTPUT" | grep -q "Project:" || fail "Status missing Project field"
echo "$STATUS_OUTPUT" | grep -q "Image:" || fail "Status missing Image field"
echo "$STATUS_OUTPUT" | grep -q "Status: running" || fail "Status not running"
echo "$STATUS_OUTPUT" | grep -q "Network:" || fail "Status missing Network field"
pass "Status output is correct"

# Step 19: Clean up all test containers and volumes
info "Step 19: Final cleanup..."
assert_ok "Remove with force" "$CLI" remove -f "$TEST_DIR"

info "All tests complete."
