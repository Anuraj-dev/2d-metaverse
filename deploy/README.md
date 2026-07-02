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
the alerting layer itself is alive.

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

# Deploy gates

`deploy-remote.sh` runs the migrate+seed `setup` container as an explicit,
exit-code-gated step **before** switching the backend to the new image:

- The `setup` output is captured; if it exits non-zero the script prints the
  logs, sends a Telegram alert (via `curl` using the same `TELEGRAM_*` vars,
  skipped silently if unset), and aborts. The previously deployed backend keeps
  running — a broken seed can no longer masquerade as a successful deploy.
- Only after `setup` succeeds is the new backend image rolled in. If the new
  backend fails its `/health/ready` check it is rolled back to the previous
  image and a "deploy rolled back" Telegram alert is sent. If there is no
  previous image, a hard-failure alert is sent instead.
- `set -Eeuo pipefail` is in force throughout.

The deploy job in `backend-deploy.yml` also fails the workflow if the remote
SSM command's status is not `Success` (previously the status was printed but
never checked).

# Incident playbook (prod hotfix runbook)

Use this when production is stuck (e.g. the June 2026 incident: seed failed on
missing room keys, leaving 3 rooms instead of 6, and the Vercel frontend never
rebuilt after the campus map work). Steps:

1. **Complete the prod env.** Add the missing keys to the production SSM env
   parameter: `ROOM_4_KEY`, `ROOM_5_KEY`, `ROOM_6_KEY`, and `STAGE_KEY` (plus
   `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID` if not already set).
2. **Re-run the seed and check it.** On the EC2 host:
   ```bash
   cd /opt/metaverse
   docker compose -f docker-compose.prod.yml run --rm setup
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
