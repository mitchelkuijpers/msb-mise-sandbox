#!/usr/bin/env bash
# Smoke tests for the microsandbox/Bun agent-sandbox CLI.
#
# Tests the full lifecycle: build image, project add/list/remove, create
# sandbox, exec commands, stop/start/restart, and non-interactive agent
# command checks.
#
# Usage:
#   ./tests/smoke-test.sh
#
# Environment variables:
#   AGENT_IMAGE       Image tag to test (default: agent-sandbox:latest)
#   SKIP_BUILD        Set to 1 to skip the image build step
#   SKIP_DOCKER_PULL  Set to 1 to skip the docker pull/run hello-world step
#
# Note: We use set -uo pipefail (NOT set -e) because a test script must
# continue past individual command failures and report them.
set -uo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
CLI="$PROJECT_ROOT/bin/agent-sandbox"
FALLBACK_CLI="bun run $PROJECT_ROOT/src/cli.ts"
AGENT_IMAGE="${AGENT_IMAGE:-agent-sandbox:latest}"
SKIP_BUILD="${SKIP_BUILD:-0}"

# Fall back to bun if the launcher script doesn't exist
if [[ ! -x "$CLI" ]]; then
  CLI="$FALLBACK_CLI"
fi

# Test state
TEST_TEMP_DIR=""
TEST_PASS=0
TEST_FAIL=0

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

  # Remove the test sandbox if it exists
  if [[ -n "$TEST_TEMP_DIR" ]]; then
    AGENT_SANDBOX_HOME="$TEST_TEMP_DIR/registry" "$CLI" remove smoke-test 2>/dev/null || true
  fi

  # Remove the Docker data volume (persists across sandbox removal by design)
  if [[ -n "$TEST_TEMP_DIR" ]]; then
    msb volume rm smoke-test-docker-data 2>/dev/null || true
  fi

  # Remove the test project from the registry
  if [[ -n "$TEST_TEMP_DIR" ]]; then
    AGENT_SANDBOX_HOME="$TEST_TEMP_DIR/registry" "$CLI" project remove smoke-test 2>/dev/null || true
  fi

  # Remove the temp directory
  if [[ -n "$TEST_TEMP_DIR" && -d "$TEST_TEMP_DIR" ]]; then
    rm -rf "$TEST_TEMP_DIR" 2>/dev/null || true
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

info "Starting agent-sandbox CLI smoke tests"
info "CLI: $CLI"
info "Image: $AGENT_IMAGE"
echo ""

# ---------------------------------------------------------------------------
# Step 1: Verify prerequisites
# ---------------------------------------------------------------------------
info "Step 1: Verifying prerequisites..."
assert_ok "microsandbox CLI (msb) is installed" command -v msb
assert_ok "docker is installed" command -v docker
assert_ok "bun is installed" command -v bun
assert_ok "jq is installed" command -v jq
assert_ok "CLI is accessible" test -x "$PROJECT_ROOT/bin/agent-sandbox" -o -f "$PROJECT_ROOT/src/cli.ts"

# Quick sanity: CLI --help works
assert_contains "CLI --help lists commands" "Commands:" "$CLI" --help
assert_contains "CLI --help shows build" "build" "$CLI" --help
assert_contains "CLI --help shows doctor" "doctor" "$CLI" --help
assert_contains "CLI --help shows project" "project" "$CLI" --help

# Check microsandbox daemon health
# Run msb doctor directly (faster than via the CLI) — just the exit code matters
if msb doctor >/dev/null 2>&1; then
  pass "msb doctor passes"
else
  fail "msb doctor failed — is the microsandbox daemon running?"
fi

# ---------------------------------------------------------------------------
# Step 2: Build the image (or skip)
# ---------------------------------------------------------------------------
if [[ "$SKIP_BUILD" == "1" ]]; then
  info "Skipping image build (SKIP_BUILD=1)"
  # Verify image is already loaded — fail early so the user knows to build.
  if msb image list --format json 2>/dev/null | grep -q "$AGENT_IMAGE"; then
    pass "Image ${AGENT_IMAGE} is cached"
  else
    fail "Image ${AGENT_IMAGE} not found — run without SKIP_BUILD=1 or build manually"
  fi
else
  info "Step 2: Building image and loading into microsandbox..."
  assert_ok "Image build and load succeeds" "$CLI" build
fi

# ---------------------------------------------------------------------------
# Step 3: Set up isolated test environment
# ---------------------------------------------------------------------------
info "Step 3: Creating isolated test environment..."
TEST_TEMP_DIR="$(mktemp -d /tmp/agent-sandbox-smoke-XXXXXX)"
mkdir -p "$TEST_TEMP_DIR/registry"
export AGENT_SANDBOX_HOME="$TEST_TEMP_DIR/registry"
export GITLAB_TOKEN="smoke-test-token"
info "Test registry dir: $AGENT_SANDBOX_HOME"

# ---------------------------------------------------------------------------
# Step 4: Add test project to registry (non-interactive via piped input)
# ---------------------------------------------------------------------------
info "Step 4: Adding test project to the registry..."

# project add is interactive; we pipe answers for the smoke test.
# Answers: GitLab URL (default) / Token env var (default) / no additional secrets
# / Enable Docker support? yes
assert_ok "Project add (non-interactive)" \
  bash -c 'printf "https://gitlab.com\nGITLAB_TOKEN\nn\ny\n" | '"$CLI"' project add smoke-test'

# ---------------------------------------------------------------------------
# Step 5: Verify project list
# ---------------------------------------------------------------------------
info "Step 5: Verifying project registry..."
assert_contains "Project list shows 'smoke-test'" "smoke-test" "$CLI" project list
assert_contains "Project list shows GitLab URL" "gitlab.com" "$CLI" project list
assert_contains "Project list shows secret ref" "GITLAB_TOKEN" "$CLI" project list

# ---------------------------------------------------------------------------
# Step 5b: Inject Docker Hub allow rules (the project was added with Docker
#          enabled; it needs egress to the registry to pull images through
#          the deny-by-default policy).
# ---------------------------------------------------------------------------
info "Step 5b: Injecting Docker Hub network.allow rules..."
HUB_RULES='["auth.docker.io:tcp:443","registry-1.docker.io:tcp:443","production.cloudfront.docker.com:tcp:443","production.cloudflare.docker.com:tcp:443"]'
if jq --argjson rules "$HUB_RULES" \
     '(.projects["smoke-test"].network // {}) as $net | .projects["smoke-test"].network = ($net | .allow = (($net.allow // []) + $rules))' \
     "$AGENT_SANDBOX_HOME/projects.json" > "$AGENT_SANDBOX_HOME/projects.json.tmp" \
     && mv "$AGENT_SANDBOX_HOME/projects.json.tmp" "$AGENT_SANDBOX_HOME/projects.json"; then
  pass "Docker Hub allow rules injected"
else
  fail "Failed to inject Docker Hub allow rules"
fi

# ---------------------------------------------------------------------------
# Step 6: Create and start a sandbox
# ---------------------------------------------------------------------------
info "Step 6: Creating sandbox..."
assert_ok "Create sandbox" "$CLI" create smoke-test

# ---------------------------------------------------------------------------
# Step 7: List sandboxes
# ---------------------------------------------------------------------------
info "Step 7: Listing sandboxes..."
assert_contains "Sandbox list shows 'smoke-test'" "smoke-test" "$CLI" list
assert_contains "Sandbox list shows status" "Running" "$CLI" list

# ---------------------------------------------------------------------------
# Step 8: Verify the sandbox user
# ---------------------------------------------------------------------------
info "Step 8: Verifying user identity..."
assert_contains "User is root (UID 0)" "uid=0(root)" "$CLI" exec smoke-test id

# ---------------------------------------------------------------------------
# Step 9: Verify /workspace is writable
# ---------------------------------------------------------------------------
info "Step 9: Verifying /workspace..."
assert_ok "Touch file in /workspace" "$CLI" exec smoke-test touch /workspace/smoke-test-file
assert_ok "File exists in /workspace" "$CLI" exec smoke-test -- test -f /workspace/smoke-test-file

# ---------------------------------------------------------------------------
# Step 10: Verify development tools installed in the image
# ---------------------------------------------------------------------------
info "Step 10: Verifying development tools..."
assert_contains "node --version works" "v24" "$CLI" exec smoke-test -- node --version
assert_contains "python --version works" "Python 3" "$CLI" exec smoke-test -- python --version
assert_contains "jq works" "jq-" "$CLI" exec smoke-test -- jq --version
assert_contains "ripgrep works" "ripgrep" "$CLI" exec smoke-test -- rg --version
assert_contains "fd works" "fd" "$CLI" exec smoke-test -- fd --version

# mise managed tools
assert_ok "mise is available" "$CLI" exec smoke-test -- mise --version

# ---------------------------------------------------------------------------
# Step 10b: Docker-in-sandbox (the project was created with Docker enabled,
#           so a disk-backed /var/lib/docker volume is mounted).
# ---------------------------------------------------------------------------
info "Step 10b: Verifying Docker-in-sandbox..."
assert_ok "docker-up starts the daemon" "$CLI" exec smoke-test -- docker-up
assert_contains "docker info works" "Server Version" "$CLI" exec smoke-test -- docker info
assert_ok "docker-up is idempotent (no-op when running)" "$CLI" exec smoke-test -- docker-up
if [[ "${SKIP_DOCKER_PULL:-0}" == "1" ]]; then
  info "Skipping docker pull/run (SKIP_DOCKER_PULL=1)"
else
  assert_ok "docker pull hello-world" "$CLI" exec smoke-test -- docker pull hello-world
  assert_contains "docker run --rm hello-world" "Hello from Docker" "$CLI" exec smoke-test -- docker run --rm hello-world
fi

# ---------------------------------------------------------------------------
# Step 11: Non-interactive agent command checks
# ---------------------------------------------------------------------------
info "Step 11: Checking agent CLIs (non-interative)..."
assert_ok "opencode --version succeeds" "$CLI" exec smoke-test -- opencode --version
assert_ok "codex --version succeeds" "$CLI" exec smoke-test -- codex --version
assert_ok "pi --version succeeds" "$CLI" exec smoke-test -- pi --version

# ---------------------------------------------------------------------------
# Step 12: Verify network access (default policy allows DNS + no explicit
#          allow rules, so curl to public HTTPS should be blocked).
#          We test that DNS works (allowed via Rule.allowDns()) and that
#          outbound HTTPS is blocked by default (deny-by-default).
# ---------------------------------------------------------------------------
info "Step 12: Verifying network policy..."
# DNS resolution is always allowed by the deny-by-default policy
assert_ok "DNS resolution works" "$CLI" exec smoke-test getent hosts github.com

# HTTPS egress is denied by default (no allow rule for github.com)
# We check that curl fails rather than succeeds
assert_fails "HTTPS egress is denied by default" \
  "$CLI" exec smoke-test -- curl -fsSL -o /dev/null --connect-timeout 10 https://github.com

# ---------------------------------------------------------------------------
# Step 13: Stop sandbox
# ---------------------------------------------------------------------------
info "Step 13: Stopping sandbox..."
assert_ok "Stop sandbox" "$CLI" stop smoke-test
assert_contains "Sandbox status shows stopped" "Stopped" "$CLI" list

# ---------------------------------------------------------------------------
# Step 14: Start sandbox again
# ---------------------------------------------------------------------------
info "Step 14: Starting sandbox again..."
assert_ok "Start sandbox" "$CLI" start smoke-test
assert_contains "Sandbox status shows running" "Running" "$CLI" list

# ---------------------------------------------------------------------------
# Step 15: Verify tools still work after restart
# ---------------------------------------------------------------------------
info "Step 15: Verifying tool availability after restart..."
assert_contains "node still works after restart" "v24" "$CLI" exec smoke-test -- node --version
assert_ok "opencode still works after restart" "$CLI" exec smoke-test -- opencode --version

# ---------------------------------------------------------------------------
# Step 16: Restart the sandbox (restart command)
# ---------------------------------------------------------------------------
info "Step 16: Testing restart command..."
assert_ok "Restart sandbox" "$CLI" restart smoke-test
assert_contains "Sandbox running after restart" "Running" "$CLI" list
assert_contains "Tools still work after restart" "v24" "$CLI" exec smoke-test -- node --version

# ---------------------------------------------------------------------------
# Step 17: Run doctor (quick health check, non-fatal)
# ---------------------------------------------------------------------------
info "Step 17: Running doctor..."
assert_ok "doctor command passes" "$CLI" doctor

# ---------------------------------------------------------------------------
# Step 18: Remove sandbox and verify removal
# ---------------------------------------------------------------------------
info "Step 18: Removing sandbox..."
assert_ok "Remove sandbox" "$CLI" remove smoke-test
# The sandbox list is global (not isolated to the test registry), so other
# sandboxes may still be present. Assert smoke-test is gone rather than that
# the whole list is empty.
if "$CLI" list 2>/dev/null | grep -q "smoke-test"; then
  fail "Removed sandbox still appears in list"
else
  pass "Removed sandbox absent from list"
fi

# ---------------------------------------------------------------------------
# Step 19: Remove project from registry
# ---------------------------------------------------------------------------
info "Step 19: Removing project from registry..."
assert_ok "Remove project from registry" "$CLI" project remove smoke-test
assert_contains "Project list is empty after removal" "No projects" "$CLI" project list

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
info "All smoke tests complete."
CLEANUP_AND_EXIT 0
