#!/usr/bin/env bash
set -Eeuo pipefail

: "${AWS_REGION:?Set AWS_REGION, for example ap-south-1}"
: "${GITHUB_REPOSITORY:?Set GITHUB_REPOSITORY as owner/repository}"
: "${EC2_INSTANCE_ID:?Set EC2_INSTANCE_ID}"
: "${PROD_ENV_FILE:?Set PROD_ENV_FILE to the completed production env file}"
: "${PROD_HEALTH_URL:?Set PROD_HEALTH_URL, for example https://api.example.com/health/ready}"

ECR_REPOSITORY=${ECR_REPOSITORY:-metaverse-backend}
SSM_ENV_PARAMETER=${SSM_ENV_PARAMETER:-/metaverse/prod/env}
DEPLOY_ROLE_NAME=${DEPLOY_ROLE_NAME:-MetaverseGitHubDeployRole}
INSTANCE_ROLE_NAME=${INSTANCE_ROLE_NAME:-MetaverseEc2Role}
INSTANCE_PROFILE_NAME=${INSTANCE_PROFILE_NAME:-MetaverseEc2Profile}

[[ -f "$PROD_ENV_FILE" ]] || { echo "Production env file not found: $PROD_ENV_FILE" >&2; exit 1; }
grep -q '^NODE_ENV=' "$PROD_ENV_FILE" && { echo "Do not put NODE_ENV in the production env file; Compose fixes it to production" >&2; exit 1; }
grep -q 'replace-with' "$PROD_ENV_FILE" && { echo "Production env still contains placeholder values" >&2; exit 1; }

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
OIDC_ARN="arn:aws:iam::$ACCOUNT_ID:oidc-provider/token.actions.githubusercontent.com"
ECR_ARN="arn:aws:ecr:$AWS_REGION:$ACCOUNT_ID:repository/$ECR_REPOSITORY"
PARAMETER_ARN="arn:aws:ssm:$AWS_REGION:$ACCOUNT_ID:parameter${SSM_ENV_PARAMETER}"

if ! aws ecr describe-repositories --region "$AWS_REGION" --repository-names "$ECR_REPOSITORY" >/dev/null 2>&1; then
  aws ecr create-repository \
    --region "$AWS_REGION" \
    --repository-name "$ECR_REPOSITORY" \
    --image-scanning-configuration scanOnPush=true \
    --encryption-configuration encryptionType=AES256 >/dev/null
fi

aws ecr put-lifecycle-policy \
  --region "$AWS_REGION" \
  --repository-name "$ECR_REPOSITORY" \
  --lifecycle-policy-text '{"rules":[{"rulePriority":1,"description":"Keep the current release and two rollback releases","selection":{"tagStatus":"any","countType":"imageCountMoreThan","countNumber":3},"action":{"type":"expire"}}]}' >/dev/null

aws ssm put-parameter \
  --region "$AWS_REGION" \
  --name "$SSM_ENV_PARAMETER" \
  --type SecureString \
  --value "$(<"$PROD_ENV_FILE")" \
  --overwrite >/dev/null

if ! aws iam get-open-id-connect-provider --open-id-connect-provider-arn "$OIDC_ARN" >/dev/null 2>&1; then
  aws iam create-open-id-connect-provider \
    --url https://token.actions.githubusercontent.com \
    --client-id-list sts.amazonaws.com >/dev/null
fi

cat > /tmp/metaverse-github-trust.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {"Federated": "$OIDC_ARN"},
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": {
        "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
        "token.actions.githubusercontent.com:sub": "repo:$GITHUB_REPOSITORY:environment:production"
      }
    }
  }]
}
EOF

if aws iam get-role --role-name "$DEPLOY_ROLE_NAME" >/dev/null 2>&1; then
  aws iam update-assume-role-policy --role-name "$DEPLOY_ROLE_NAME" --policy-document file:///tmp/metaverse-github-trust.json
else
  aws iam create-role \
    --role-name "$DEPLOY_ROLE_NAME" \
    --assume-role-policy-document file:///tmp/metaverse-github-trust.json >/dev/null
fi

cat > /tmp/metaverse-deploy-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {"Effect":"Allow","Action":["ecr:GetAuthorizationToken"],"Resource":"*"},
    {"Effect":"Allow","Action":["ecr:BatchCheckLayerAvailability","ecr:CompleteLayerUpload","ecr:GetDownloadUrlForLayer","ecr:InitiateLayerUpload","ecr:PutImage","ecr:UploadLayerPart","ecr:BatchGetImage"],"Resource":"$ECR_ARN"},
    {"Effect":"Allow","Action":["ssm:SendCommand"],"Resource":["arn:aws:ssm:$AWS_REGION::document/AWS-RunShellScript","arn:aws:ec2:$AWS_REGION:$ACCOUNT_ID:instance/$EC2_INSTANCE_ID"]},
    {"Effect":"Allow","Action":["ssm:GetCommandInvocation"],"Resource":"*"}
  ]
}
EOF
aws iam put-role-policy \
  --role-name "$DEPLOY_ROLE_NAME" \
  --policy-name MetaverseDeployPolicy \
  --policy-document file:///tmp/metaverse-deploy-policy.json

PROFILE_ARN=$(aws ec2 describe-instances \
  --region "$AWS_REGION" \
  --instance-ids "$EC2_INSTANCE_ID" \
  --query 'Reservations[0].Instances[0].IamInstanceProfile.Arn' \
  --output text)

if [[ "$PROFILE_ARN" == "None" ]]; then
  cat > /tmp/metaverse-ec2-trust.json <<'EOF'
{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ec2.amazonaws.com"},"Action":"sts:AssumeRole"}]}
EOF
  if ! aws iam get-role --role-name "$INSTANCE_ROLE_NAME" >/dev/null 2>&1; then
    aws iam create-role --role-name "$INSTANCE_ROLE_NAME" --assume-role-policy-document file:///tmp/metaverse-ec2-trust.json >/dev/null
    aws iam attach-role-policy --role-name "$INSTANCE_ROLE_NAME" --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore
  fi
  if ! aws iam get-instance-profile --instance-profile-name "$INSTANCE_PROFILE_NAME" >/dev/null 2>&1; then
    aws iam create-instance-profile --instance-profile-name "$INSTANCE_PROFILE_NAME" >/dev/null
    aws iam add-role-to-instance-profile --instance-profile-name "$INSTANCE_PROFILE_NAME" --role-name "$INSTANCE_ROLE_NAME"
    sleep 10
  fi
  aws ec2 associate-iam-instance-profile \
    --region "$AWS_REGION" \
    --instance-id "$EC2_INSTANCE_ID" \
    --iam-instance-profile Name="$INSTANCE_PROFILE_NAME" >/dev/null
else
  PROFILE_NAME=${PROFILE_ARN##*/}
  INSTANCE_ROLE_NAME=$(aws iam get-instance-profile \
    --instance-profile-name "$PROFILE_NAME" \
    --query 'InstanceProfile.Roles[0].RoleName' \
    --output text)
fi

cat > /tmp/metaverse-instance-policy.json <<EOF
{
  "Version":"2012-10-17",
  "Statement":[
    {"Effect":"Allow","Action":["ecr:GetAuthorizationToken"],"Resource":"*"},
    {"Effect":"Allow","Action":["ecr:BatchCheckLayerAvailability","ecr:GetDownloadUrlForLayer","ecr:BatchGetImage"],"Resource":"$ECR_ARN"},
    {"Effect":"Allow","Action":["ssm:GetParameter"],"Resource":"$PARAMETER_ARN"}
  ]
}
EOF
aws iam put-role-policy \
  --role-name "$INSTANCE_ROLE_NAME" \
  --policy-name MetaverseRuntimePolicy \
  --policy-document file:///tmp/metaverse-instance-policy.json

for GROUP_ID in $(aws ec2 describe-instances --region "$AWS_REGION" --instance-ids "$EC2_INSTANCE_ID" --query 'Reservations[0].Instances[0].SecurityGroups[].GroupId' --output text); do
  for RULE in "tcp 80 80" "tcp 443 443" "tcp 7881 7881" "tcp 5349 5349" "udp 3478 3478" "udp 50000 50100"; do
    read -r PROTOCOL FROM_PORT TO_PORT <<< "$RULE"
    aws ec2 authorize-security-group-ingress \
      --region "$AWS_REGION" \
      --group-id "$GROUP_ID" \
      --ip-permissions "IpProtocol=$PROTOCOL,FromPort=$FROM_PORT,ToPort=$TO_PORT,IpRanges=[{CidrIp=0.0.0.0/0,Description=Metaverse}]" \
      >/dev/null 2>&1 || true
  done
done

BOOTSTRAP_B64=$(base64 -w0 "$(dirname "$0")/bootstrap-host.sh")
jq -n --arg script "$BOOTSTRAP_B64" '{commands:[("echo " + $script + " | base64 -d > /tmp/metaverse-bootstrap.sh"),"chmod 700 /tmp/metaverse-bootstrap.sh","/tmp/metaverse-bootstrap.sh"]}' > /tmp/metaverse-bootstrap-command.json
for attempt in $(seq 1 30); do
  PING_STATUS=$(aws ssm describe-instance-information \
    --region "$AWS_REGION" \
    --filters "Key=InstanceIds,Values=$EC2_INSTANCE_ID" \
    --query 'InstanceInformationList[0].PingStatus' \
    --output text)
  [[ "$PING_STATUS" == "Online" ]] && break
  sleep 10
done
[[ "${PING_STATUS:-}" == "Online" ]] || { echo "EC2 instance did not become available in Systems Manager" >&2; exit 1; }
COMMAND_ID=$(aws ssm send-command \
  --region "$AWS_REGION" \
  --instance-ids "$EC2_INSTANCE_ID" \
  --document-name AWS-RunShellScript \
  --parameters file:///tmp/metaverse-bootstrap-command.json \
  --query Command.CommandId \
  --output text)
aws ssm wait command-executed --region "$AWS_REGION" --command-id "$COMMAND_ID" --instance-id "$EC2_INSTANCE_ID"

ROLE_ARN="arn:aws:iam::$ACCOUNT_ID:role/$DEPLOY_ROLE_NAME"
echo "AWS CI/CD configuration complete."
echo "Set these GitHub production environment variables:"
printf '%-22s %s\n' \
  AWS_REGION "$AWS_REGION" \
  AWS_DEPLOY_ROLE_ARN "$ROLE_ARN" \
  ECR_REPOSITORY "$ECR_REPOSITORY" \
  EC2_INSTANCE_ID "$EC2_INSTANCE_ID" \
  PROD_HEALTH_URL "$PROD_HEALTH_URL" \
  SSM_ENV_PARAMETER "$SSM_ENV_PARAMETER"

if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  gh api --method PUT "repos/$GITHUB_REPOSITORY/environments/production" >/dev/null
  gh variable set AWS_REGION --env production --repo "$GITHUB_REPOSITORY" --body "$AWS_REGION"
  gh variable set AWS_DEPLOY_ROLE_ARN --env production --repo "$GITHUB_REPOSITORY" --body "$ROLE_ARN"
  gh variable set ECR_REPOSITORY --env production --repo "$GITHUB_REPOSITORY" --body "$ECR_REPOSITORY"
  gh variable set EC2_INSTANCE_ID --env production --repo "$GITHUB_REPOSITORY" --body "$EC2_INSTANCE_ID"
  gh variable set PROD_HEALTH_URL --env production --repo "$GITHUB_REPOSITORY" --body "$PROD_HEALTH_URL"
  gh variable set SSM_ENV_PARAMETER --env production --repo "$GITHUB_REPOSITORY" --body "$SSM_ENV_PARAMETER"
  echo "GitHub production environment variables configured with gh."
fi
