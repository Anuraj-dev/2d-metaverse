#!/usr/bin/env bash
set -Eeuo pipefail

# Hermetic harness for deploy/deploy-remote.sh.
#
# Runs the REAL deploy script with PATH-shimmed `docker`, `curl`, and `aws`
# stubs — no Docker daemon, no network — and asserts the deploy gates behave
# as designed:
#   1. An alerter that crashes after starting (running on the first sample,
#      gone afterwards) fails the deploy BEFORE setup or the backend switch,
#      with a Telegram POST attempted and no release state recorded.
#   2. An alerter that never reports healthy does the same.
#   3. A failing setup (migrate+seed) container makes the script exit with the
#      setup exit code, after the alerter gate but before the backend switch,
#      with no release state recorded and a Telegram POST attempted.
#   4. The happy path starts the alerter before the backend switch, exits 0,
#      reports the deployed image, and records it in .backend-image.

TEST_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
DEPLOY_SCRIPT=$TEST_DIR/../deploy-remote.sh
FAILURES=0
WORK_DIRS=()
cleanup() { for d in "${WORK_DIRS[@]}"; do rm -rf "$d"; done; }
trap cleanup EXIT

make_stubs() {
  local bin=$1
  mkdir -p "$bin"
  # Stateful docker stub: STUB_ALERTER_MODE controls the alerter lifecycle.
  #   healthy       — ps returns an id, inspect reports healthy
  #   never-healthy — ps returns an id, inspect stays "starting" forever
  #   crash         — ps returns an id on the FIRST sample only (the container
  #                   was running, then exited); inspect reports "starting"
  cat > "$bin/docker" <<'STUB'
#!/usr/bin/env bash
printf 'docker %s\n' "$*" >> "$STUB_LOG"
case "$*" in
  *"run --rm setup"*)
    echo "stub setup output"
    exit "${STUB_SETUP_EXIT:-0}"
    ;;
  *"ps --quiet alerter"*)
    n=0
    [[ -f "$STUB_STATE/ps_count" ]] && n=$(<"$STUB_STATE/ps_count")
    n=$((n + 1))
    printf '%s' "$n" > "$STUB_STATE/ps_count"
    case "${STUB_ALERTER_MODE:-healthy}" in
      crash) [[ "$n" -le 1 ]] && echo "stub-alerter-container-id" ;;
      *) echo "stub-alerter-container-id" ;;
    esac
    exit 0
    ;;
  *"inspect --format {{.State.Health.Status}}"*)
    case "${STUB_ALERTER_MODE:-healthy}" in
      healthy) echo "healthy" ;;
      *) echo "starting" ;;
    esac
    exit 0
    ;;
  *"logs --tail"*)
    # Emit a recognizable line so tests can assert the abort alert embeds it.
    echo "STUB-CONTAINER-LOG-LINE EACCES /var/run/docker.sock"
    exit 0
    ;;
  *) exit 0 ;;
esac
STUB
  cat > "$bin/curl" <<'STUB'
#!/usr/bin/env bash
printf 'curl %s\n' "$*" >> "$STUB_LOG"
case "$*" in
  *sendMessage*) echo '{"ok":true}' ;;
  *health/ready*) echo '{"ok":true}' ;;
esac
exit 0
STUB
  cat > "$bin/aws" <<'STUB'
#!/usr/bin/env bash
printf 'aws %s\n' "$*" >> "$STUB_LOG"
exit 0
STUB
  chmod +x "$bin/docker" "$bin/curl" "$bin/aws"
}

# Usage: run_scenario <setup_exit_code> <alerter_mode> [docker_sock]
# Sets SCENARIO_RC, SCENARIO_LOG (stub invocations), SCENARIO_OUT (script
# output), SCENARIO_APP (the app dir, for release-state assertions).
# docker_sock overrides DOCKER_SOCK so the DOCKER_GID derivation is testable
# without touching the host's real /var/run/docker.sock.
run_scenario() {
  local setup_exit=$1 alerter_mode=$2 docker_sock=${3:-/var/run/docker.sock}
  local work
  work=$(mktemp -d)
  WORK_DIRS+=("$work")
  local app_dir=$work/app
  mkdir -p "$app_dir" "$work/state"
  make_stubs "$work/bin"
  : > "$work/stub.log"
  echo "services: {}" > "$app_dir/docker-compose.prod.yml"
  cat > "$app_dir/.env" <<'ENV'
TELEGRAM_BOT_TOKEN=stub-token
TELEGRAM_CHAT_ID=123456
TELEGRAM_API_BASE=http://telegram.stub
ENV

  local rc=0
  PATH="$work/bin:$PATH" \
  APP_DIR=$app_dir \
  STUB_LOG=$work/stub.log \
  STUB_STATE=$work/state \
  STUB_SETUP_EXIT=$setup_exit \
  STUB_ALERTER_MODE=$alerter_mode \
  DOCKER_SOCK=$docker_sock \
  SKIP_SSM_ENV=1 SKIP_ECR_LOGIN=1 SKIP_PULL=1 ALERTER_HEALTH_TIMEOUT=1 \
    bash "$DEPLOY_SCRIPT" registry.stub/metaverse:cafe123 eu-west-1 /stub/param registry.stub/metaverse:alerter-cafe123 \
    > "$work/out.log" 2>&1 || rc=$?

  SCENARIO_RC=$rc
  SCENARIO_LOG=$work/stub.log
  SCENARIO_OUT=$work/out.log
  SCENARIO_APP=$app_dir
}

fail() {
  echo "FAIL: $1" >&2
  echo "--- stub log ---" >&2; cat "$SCENARIO_LOG" >&2 || true
  echo "--- script output ---" >&2; cat "$SCENARIO_OUT" >&2 || true
  FAILURES=$((FAILURES + 1))
}

assert_rc() { [[ "$SCENARIO_RC" -eq "$1" ]] || fail "$2 (expected exit $1, got $SCENARIO_RC)"; }
assert_stub() { grep -q "$1" "$SCENARIO_LOG" || fail "$2"; }
assert_no_stub() { ! grep -q "$1" "$SCENARIO_LOG" || fail "$2"; }
assert_not_recorded() {
  [[ ! -f "$SCENARIO_APP/.backend-image" ]] \
    || fail "release state (.backend-image) must not be recorded on a failed deploy"
}
# Assert the stub-log line matching $1 appears before the line matching $2.
assert_order() {
  local first last
  first=$(grep -n "$1" "$SCENARIO_LOG" | head -1 | cut -d: -f1)
  last=$(grep -n "$2" "$SCENARIO_LOG" | head -1 | cut -d: -f1)
  [[ -n "$first" && -n "$last" && "$first" -lt "$last" ]] || fail "$3"
}

echo "Scenario 1: alerter crashes after starting (running once, then gone)"
run_scenario 0 crash
assert_rc 1 "a crashed alerter must fail the deploy"
assert_no_stub "run --rm setup" "setup must NOT run when the alerter gate fails"
assert_no_stub "up -d --no-deps backend" "backend must NOT be switched when the alerter gate fails"
assert_not_recorded
assert_stub "sendMessage" "a Telegram alert must be attempted when the alerter gate fails"
assert_stub "STUB-CONTAINER-LOG-LINE" "the alerter abort alert must embed the container's log excerpt"

echo "Scenario 2: alerter never becomes healthy"
run_scenario 0 never-healthy
assert_rc 1 "a never-healthy alerter must fail the deploy"
assert_no_stub "run --rm setup" "setup must NOT run when the alerter never becomes healthy"
assert_no_stub "up -d --no-deps backend" "backend must NOT be switched when the alerter never becomes healthy"
assert_not_recorded
assert_stub "sendMessage" "a Telegram alert must be attempted when the alerter never becomes healthy"
assert_stub "STUB-CONTAINER-LOG-LINE" "the alerter abort alert must embed the container's log excerpt"

echo "Scenario 3: setup container exits 7 (alerter healthy)"
run_scenario 7 healthy
assert_rc 7 "script must exit with the setup container's exit code"
assert_order "up -d --no-deps alerter" "run --rm setup" "alerter gate must run before setup"
assert_no_stub "up -d --no-deps backend" "backend must NOT be switched after a setup failure"
assert_not_recorded
assert_stub "sendMessage" "a Telegram alert must be attempted on setup failure"

echo "Scenario 4: happy path"
run_scenario 0 healthy
assert_rc 0 "happy path must exit 0"
assert_order "up -d --no-deps alerter" "run --rm setup" "alerter gate must run before setup"
assert_order "run --rm setup" "up -d --no-deps backend" "setup gate must run before the backend switch"
grep -q "Deployed registry.stub/metaverse:cafe123" "$SCENARIO_OUT" \
  || fail "success output must report the deployed image"
[[ -f "$SCENARIO_APP/.backend-image" && "$(<"$SCENARIO_APP/.backend-image")" == "registry.stub/metaverse:cafe123" ]] \
  || fail "successful deploy must record the image in .backend-image"

echo "Scenario 5: DOCKER_GID is derived from the docker socket's group"
# A regular file stands in for the socket — `stat -c %g` reports its group
# the same way, so the derivation is exercised without a real docker.sock.
FAKE_SOCK=$(mktemp)
WORK_DIRS+=("$FAKE_SOCK")
SOCK_GID=$(stat -c '%g' "$FAKE_SOCK")
run_scenario 0 healthy "$FAKE_SOCK"
assert_rc 0 "happy path with an overridden socket must still exit 0"
grep -q "Alerter docker socket group: $SOCK_GID" "$SCENARIO_OUT" \
  || fail "DOCKER_GID must be derived from the socket's group ($SOCK_GID)"

echo "Scenario 6: DOCKER_GID falls back to 109 when the socket is absent"
run_scenario 0 healthy /nonexistent/docker.sock
assert_rc 0 "happy path with a missing socket must still exit 0"
grep -q "Alerter docker socket group: 109" "$SCENARIO_OUT" \
  || fail "DOCKER_GID must fall back to 109 when the socket cannot be read"

if [[ "$FAILURES" -gt 0 ]]; then
  echo "$FAILURES assertion(s) failed" >&2
  exit 1
fi
echo "All deploy-gate scenarios passed"
