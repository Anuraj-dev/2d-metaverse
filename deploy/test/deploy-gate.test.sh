#!/usr/bin/env bash
set -Eeuo pipefail

# Hermetic harness for deploy/deploy-remote.sh.
#
# Runs the REAL deploy script with PATH-shimmed `docker`, `curl`, and `aws`
# stubs — no Docker daemon, no network — and asserts the deploy gates behave
# as designed:
#   1. A failing setup (migrate+seed) container makes the script exit with the
#      setup exit code, the backend is never switched, and a Telegram POST is
#      attempted.
#   2. A watchdog alerter that fails to reach running state fails the deploy
#      (exit 1) with a Telegram POST attempted.
#   3. The happy path exits 0 and reports the deployed image.

TEST_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
DEPLOY_SCRIPT=$TEST_DIR/../deploy-remote.sh
FAILURES=0
WORK_DIRS=()
cleanup() { for d in "${WORK_DIRS[@]}"; do rm -rf "$d"; done; }
trap cleanup EXIT

make_stubs() {
  local bin=$1
  mkdir -p "$bin"
  cat > "$bin/docker" <<'STUB'
#!/usr/bin/env bash
printf 'docker %s\n' "$*" >> "$STUB_LOG"
case "$*" in
  *"run --rm setup"*)
    echo "stub setup output"
    exit "${STUB_SETUP_EXIT:-0}"
    ;;
  *"ps --status running --quiet alerter"*)
    [[ "${STUB_ALERTER_RUNNING:-1}" == "1" ]] && echo "stub-alerter-container-id"
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

# Usage: run_scenario <setup_exit_code> <alerter_running 0|1>
# Sets SCENARIO_RC, SCENARIO_LOG (stub invocations), SCENARIO_OUT (script output).
run_scenario() {
  local setup_exit=$1 alerter_running=$2
  local work
  work=$(mktemp -d)
  WORK_DIRS+=("$work")
  local app_dir=$work/app
  mkdir -p "$app_dir"
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
  STUB_SETUP_EXIT=$setup_exit \
  STUB_ALERTER_RUNNING=$alerter_running \
  SKIP_SSM_ENV=1 SKIP_ECR_LOGIN=1 SKIP_PULL=1 ALERTER_START_ATTEMPTS=1 \
    bash "$DEPLOY_SCRIPT" registry.stub/metaverse:cafe123 eu-west-1 /stub/param registry.stub/metaverse:alerter-cafe123 \
    > "$work/out.log" 2>&1 || rc=$?

  SCENARIO_RC=$rc
  SCENARIO_LOG=$work/stub.log
  SCENARIO_OUT=$work/out.log
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

echo "Scenario 1: setup container exits 7"
run_scenario 7 1
assert_rc 7 "script must exit with the setup container's exit code"
assert_no_stub "up -d --no-deps backend" "backend must NOT be switched after a setup failure"
assert_stub "sendMessage" "a Telegram alert must be attempted on setup failure"

echo "Scenario 2: setup ok, backend healthy, alerter never reaches running"
run_scenario 0 0
assert_rc 1 "a non-running alerter must fail the deploy"
assert_stub "up -d --no-deps backend" "backend switch should have happened before the alerter gate"
assert_stub "up -d --no-deps alerter" "alerter start must have been attempted"
assert_stub "sendMessage" "a Telegram alert must be attempted when the alerter gate fails"

echo "Scenario 3: happy path"
run_scenario 0 1
assert_rc 0 "happy path must exit 0"
assert_stub "run --rm setup" "setup must run as an explicit step"
assert_stub "up -d --no-deps backend" "backend must be switched on success"
grep -q "Deployed registry.stub/metaverse:cafe123" "$SCENARIO_OUT" \
  || fail "success output must report the deployed image"

if [[ "$FAILURES" -gt 0 ]]; then
  echo "$FAILURES assertion(s) failed" >&2
  exit 1
fi
echo "All deploy-gate scenarios passed"
