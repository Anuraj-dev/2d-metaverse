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
