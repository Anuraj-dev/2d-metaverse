# Production deployment

The backend pipeline has two workflows:

- `Backend CI` tests only backend and deployment files. It runs type checks, unit tests, a clean build, dependency audit, production image build, and the complete Docker contract smoke test.
- `Backend deploy` runs only after successful CI on `main` or manual dispatch. It assumes an AWS role through GitHub OIDC, pushes a commit-addressed image to ECR, and deploys through Systems Manager. No static AWS keys or SSH key are stored in GitHub.

The GitHub `production` environment should require reviewer approval and prevent deployment from branches other than `main`.

## One-time AWS setup

1. Create or select a `t3.medium` EC2 instance with an Elastic IP. Point the API, LiveKit, and TURN DNS records to it.
2. Authenticate the AWS CLI (`aws login` or an AWS SSO profile).
3. Copy `.env.production.example` outside the repository, replace every placeholder, and keep it out of Git.
4. Run:

```bash
AWS_PROFILE=your-profile \
AWS_REGION=ap-south-1 \
GITHUB_REPOSITORY=owner/repository \
EC2_INSTANCE_ID=i-0123456789abcdef0 \
PROD_ENV_FILE=/secure/path/metaverse-production.env \
PROD_HEALTH_URL=https://api.example.com/health/ready \
deploy/aws/configure-cicd.sh
```

The script creates the ECR repository, encrypted SSM environment parameter, GitHub OIDC deploy role, scoped EC2 runtime policy, required security-group rules, and installs Docker/Nginx through SSM. If GitHub CLI is authenticated, it also creates the GitHub production environment variables.

Obtain Let's Encrypt certificates for the API, LiveKit, and TURN domains on the EC2 host before the first deployment, then install `nginx.conf.example` with its placeholders replaced. LiveKit cannot start its embedded TURN/TLS listener until the TURN certificate exists.

The remote deployment keeps the previous image tag and automatically restores it if `/health/ready` does not become healthy. Database migrations run before the backend is replaced and must therefore remain backward-compatible.

# Alerting (Telegram watchdog)

An `alerter` container runs alongside the stack (compose service `alerter`,
`restart: unless-stopped`). It subscribes to the Docker events stream over a
read-only mount of `/var/run/docker.sock` and posts a Telegram message within a
minute of any container failure. It has zero npm dependencies (native `fetch`
and `node:http`).

What triggers an alert:

- A container exits non-zero (`die` with a non-zero exit code) → **critical**.
- A container restart-loops (3+ restarts within 5 minutes) → **critical**.
- A container reports `health_status: unhealthy` → **warning**.
- A clean exit (code 0, e.g. the one-shot `setup` container finishing) is
  ignored. Repeated alerts for the same container are de-duplicated within a
  10-minute window. Each alert includes the container name, exit code, and the
  last ~50 log lines.

On startup the watchdog posts `🟢 alerter online <hostname>` so you can confirm
the alerting layer itself is alive. Its container HEALTHCHECK passes only once
a readiness file exists, which the process writes after the startup
announcement was delivered and the Docker events subscription is established
(idle entry in no-token mode). If a configured-token announcement cannot be
delivered, the alerter exits non-zero — the compose restart policy retries it,
the healthcheck never passes, and the deploy gate turns a persistently broken
alerting layer into a failed deploy instead of a silent one.

## Bot setup (one-time)

1. In Telegram, message [@BotFather](https://t.me/BotFather), send `/newbot`,
   and follow the prompts. Copy the bot token it returns.
2. Start a chat with your new bot (or add it to a group), send it any message,
   then visit `https://api.telegram.org/bot<TOKEN>/getUpdates` and read the
   `chat.id` from the response. For a group the id is negative.
3. Store both values in the production SSM environment parameter (the same
   parameter `deploy-remote.sh` pulls into `.env`):
   - `TELEGRAM_BOT_TOKEN=<token from BotFather>`
   - `TELEGRAM_CHAT_ID=<chat id>`

If either variable is unset, the alerter logs `alerts disabled` and idles — a
missing token never crashes the stack, but you also get no alerts, so set them.

## Troubleshooting: alerter stuck `unhealthy` (EACCES on docker.sock)

If a deploy aborts at the alerter gate and the container logs show
`connect EACCES /var/run/docker.sock`, the alerter's `/events` subscription is
being denied: the image runs as `node` (uid 1000) but the mounted
`/var/run/docker.sock` is `root:docker` mode 0660, so the container must belong
to the socket's group to read it. The compose service adds it via
`group_add: ["${DOCKER_GID:-109}"]`, and `deploy-remote.sh` derives `DOCKER_GID`
from the socket on the box at deploy time (`stat -c %g /var/run/docker.sock`),
falling back to `109` (the common Debian/Ubuntu `docker` gid) if it can't be
read. If the box's docker group differs and auto-derivation is somehow bypassed,
set `DOCKER_GID` in the environment to the value of
`stat -c %g /var/run/docker.sock`. Abort alerts for the alerter and backend
gates now embed the last few log lines, so the EACCES reason is visible in
Telegram without SSHing to the box.

# Log rotation and the log stream

Every service in both compose files (`docker-compose.yml` and
`deploy/docker-compose.prod.yml`) uses the Docker `json-file` logging driver
with `max-size: 10m`, `max-file: 3` (a shared `x-logging` YAML anchor). That
caps on-disk logs at ~30 MB per container, so a chatty or crash-looping
container can never fill the EC2 disk and take the box down. There are no log
files inside containers — the backend writes structured JSON (pino) to stdout
and Docker owns collection and rotation.

This rotated stream is the single source of failure observability on the box:

- Operators read it with `docker compose logs backend` / `docker logs` + `jq`
  (field reference and example queries in `backend/README.md`, "Logging").
- The **alerter** consumes the same containers' lifecycle events and attaches
  the last ~50 log lines of a failed container to its Telegram alert — those
  lines come from this rotated `json-file` stream, so rotation limits also
  bound what an alert can include. Error spikes (including frontend crashes
  surfaced via the backend's `/client-errors` endpoint, logged at error level
  with `module: "client-error"`) are visible in this stream for the watchdog
  layer to observe.

`LOG_LEVEL` (default `info` in production) is part of the backend environment;
set it in the SSM env parameter like any other variable.

# Deploy gates

`deploy-remote.sh` is a sequence of hard gates, ordered so that any gate
failure leaves the previous release both **serving and recorded** — release
state (`.backend-image` and the retention history) is written only after
every gate has passed:

1. **Alerter gate (first, before anything about the release changes).** The
   watchdog is independent of the backend image, so it is pulled, started,
   and must report `healthy` before the deploy proceeds — if alerting cannot
   come up, nothing is deployed at all. "Healthy" is the image's HEALTHCHECK:
   a readiness file the alerter writes only after its startup Telegram
   announcement was delivered AND its Docker events subscription is
   established (in no-token idle mode: on idle entry). The script waits up to
   ~60s (`ALERTER_HEALTH_TIMEOUT`); a container that starts and then
   crash-loops never reports healthy and fails the gate, with its logs
   printed and an alert attempted.
2. **Setup gate.** The migrate+seed `setup` container runs as an explicit,
   exit-code-gated step. Its output is captured; on a non-zero exit the
   script prints the logs, sends a Telegram alert (via `curl` using the same
   `TELEGRAM_*` vars, skipped silently if unset), and aborts with the setup
   exit code — a broken seed can no longer masquerade as a successful deploy.
3. **Backend switch + health check.** Only after `setup` succeeds is the new
   backend image rolled in. If it fails its `/health/ready` check it is
   rolled back to the previous image and a "deploy rolled back" Telegram
   alert is sent (or a hard-failure alert if there is no previous image).
4. **Record.** `.backend-image` and the retention history are updated last,
   so they always describe the release that is actually serving.

Telegram sends from the script use `curl --fail-with-body --retry 1`; a
non-2xx response hits an explicit warning path (the response body is logged,
never the token-bearing URL). `set -Eeuo pipefail` is in force throughout.

The deploy job in `backend-deploy.yml` also fails the workflow if the remote
SSM command's status is not `Success` (previously the status was printed but
never checked).

The gating behavior is regression-tested hermetically in CI:
`deploy/test/deploy-gate.test.sh` runs the real script with PATH-shimmed,
stateful `docker`/`curl`/`aws` stubs and asserts gate ordering (alerter →
setup → backend switch), that an alerter which crashes after starting or
never becomes healthy aborts the deploy before setup/backend changes, that a
failing setup propagates its exit code with no backend switch, that release
state is never recorded on a failed deploy, and that alerts are attempted in
every failure case.

# Frontend deploys (Vercel)

Production frontend deploys go through CI only: the `deploy` job in
`frontend-ci.yml` runs `vercel deploy --prod` on pushes to `main` after
lint/typecheck/test/build/budget pass. `frontend/vercel.json` sets
`git.deploymentEnabled.main: false` so the Vercel Git integration does NOT
also production-deploy `main` (avoiding double deploys with last-writer-wins);
PR preview deployments from the Git integration remain enabled.

# Incident playbook (prod hotfix runbook)

Use this when production is stuck (e.g. the June 2026 incident: seed failed on
missing room keys, leaving 3 rooms instead of 6, and the Vercel frontend never
rebuilt after the campus map work). Steps:

1. **Complete the prod env.** Add the missing keys to the production SSM env
   parameter: `ROOM_4_KEY`, `ROOM_5_KEY`, `ROOM_6_KEY`, and `STAGE_KEY` (plus
   `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID` if not already set).
2. **Re-run the seed and check it.** On the EC2 host. Two things every manual
   compose command here needs: `--env-file .env` (compose does not read it
   implicitly for variable substitution in this file's `${VAR}` references),
   and `BACKEND_IMAGE` — a deploy-time variable that is **not** in `.env`; the
   currently deployed tag is recorded in `/opt/metaverse/.backend-image`.
   ```bash
   cd /opt/metaverse
   # Refresh .env from the SSM parameter updated in step 1:
   aws ssm get-parameter --region <region> --name /metaverse/prod/env \
     --with-decryption --query Parameter.Value --output text > .env.next \
     && chmod 600 .env.next && mv .env.next .env
   # Run the migrate+seed container against the deployed image:
   BACKEND_IMAGE="$(<.backend-image)" \
     docker compose --env-file .env -f docker-compose.prod.yml run --rm setup
   echo "setup exit: $?"          # must be 0
   ```
   If non-zero, read the printed logs — the most common cause is a still-missing
   room/stage key. Fix the env parameter and re-run.
3. **Rebuild the frontend.** Trigger the `Frontend CI` workflow on `main` (push
   or "Run workflow"); its `deploy` job promotes the build to Vercel production.
4. **Verify.** Load the game and confirm all six rooms exist with working doors;
   check the Settings panel shows the expected `build <sha>` and
   `GET /health/ready` returns the matching backend `sha`.

# Release image retention

The AWS setup creates an ECR lifecycle policy that keeps the current image plus
the two most recent rollback images (three releases total). The production
deployment script records the same three-image history on the EC2 host and
removes older local release images after a successful health check.
