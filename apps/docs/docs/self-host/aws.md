---
title: AWS (Terraform)
---

# AWS reference deployment

`infra/terraform/aws` provisions the reference production stack:

- VPC (2 AZ), private subnets for services and RDS
- RDS Postgres 16, S3 bucket (envelopes/transcripts), ECR repositories
- ECS Fargate services: `api`, `worker`, `gateway`, `web`, `mcp` behind an ALB
- Fargate runner tasks for the `aws` sandbox driver
- KMS-backed secrets into task environments
- CloudWatch log groups per service

Nothing in the services is AWS-specific — this module is a reference, not a
requirement. The sandbox driver seam (`docker` | `aws`) is where compute
specifics live; a Kubernetes Job driver is the documented extension point.

This page is the deployment sequence. The module
[README](https://github.com/theam/facility/tree/main/infra/terraform/aws) is
the variable-by-variable reference.

## Before you start

Locally: Node.js 22 or newer, pnpm 11, Docker with `buildx`, Terraform, the AWS
CLI, `jq`, and OpenSSL. Fresh AWS credentials — an old `.env` may carry an
expired session token, so confirm with `aws sts get-caller-identity` before
applying anything.

On GitHub: the App created and installed on the repositories you will automate,
with its webhook **inactive**. The App is configured last, once the API is
reachable, so its first delivery is not lost. See the
[GitHub App guide](github-app).

Somewhere safe: Terraform state. Local state is acceptable only for a
short-lived stack, and only if you keep it until teardown.

Never reuse a destroyed environment's name, state, VPC CIDR, bucket, ECR
repositories, or webhook URL.

```bash
git switch main && git pull --ff-only
corepack enable && pnpm install --frozen-lockfile

export FACILITY_AWS_REGION=us-east-1
export FACILITY_ENV="prod"
export FACILITY_PREFIX="facility-${FACILITY_ENV}"
export FACILITY_IMAGE_TAG="$(git rev-parse --short HEAD)"
export FACILITY_TF_DIR=infra/terraform/aws
```

## 1. Write the variables file, with services at zero

```bash
cp $FACILITY_TF_DIR/terraform.tfvars.example $FACILITY_TF_DIR/${FACILITY_ENV}.tfvars
```

Set the hostnames, `auth_identity_provider = "github"` for self-hosting, the
image tags you are about to push, and — deliberately — no running services:

```hcl
api_desired_count     = 0
worker_desired_count  = 0
gateway_desired_count = 0
web_desired_count     = 0
```

The first apply creates repositories, the database, secret containers, the
network, task definitions and the load balancer **without** starting containers
whose images and secrets do not exist yet. Starting them early produces a
crash-loop that is slower to diagnose than it is to avoid.

Without a public DNS zone, set `enable_cloudfront_api_endpoint = true` to get an
AWS-managed HTTPS origin for the API and the webhook. For production, point
`api_hostname` at the ALB with a valid certificate, and set `route53_zone_id` if
Terraform should create the alias record.

No secret values belong in tfvars. The file is gitignored; keep it that way.

## 2. First apply

```bash
terraform -chdir="$FACILITY_TF_DIR" init
terraform -chdir="$FACILITY_TF_DIR" apply -var-file="${FACILITY_ENV}.tfvars"
```

## 3. Build and push images

The build script defaults to a playground prefix, so `ECR_PREFIX` is mandatory:

```bash
AWS_REGION="$FACILITY_AWS_REGION" \
ECR_PREFIX="$FACILITY_PREFIX" \
IMAGE_TAG="$FACILITY_IMAGE_TAG" \
CPU_ARCHITECTURE=X86_64 \
./infra/build-images.sh
```

Never `latest`: the tag in tfvars must match `FACILITY_IMAGE_TAG` exactly, so
that what is deployed is identifiable from a commit. Apply again once the images
exist.

## 4. Populate the secret containers

Terraform creates encrypted containers and never writes values into them.

| Secret | Value |
|---|---|
| `database_url` | `postgres://facility:<url-encoded-password>@<rds_endpoint>:5432/facility?sslmode=verify-full` |
| `secret_master_key` | `openssl rand -base64 32` |
| `github_oauth_client_id`, `github_oauth_client_secret` | the App's OAuth credentials (`oidc_client_id` / `oidc_client_secret` in broker mode) |
| `facility_oauth_jwks` | a persistent private ES256 JWK set |
| `github_app_id`, `github_app_slug`, `github_app_private_key`, `github_app_webhook_secret` | from the App |

`dev_anthropic_api_key` and `dev_openai_api_key` are a local fallback only —
add provider credentials through Facility after boot instead.

Keep `sslmode=verify-full`. The production image carries Amazon's global RDS CA
bundle so the API and worker verify the database certificate and hostname; a
non-verifying mode is a downgrade, not a shortcut.

```bash
facility_secret_arn() {
  terraform -chdir="$FACILITY_TF_DIR" output -json secret_arns | jq -r --arg n "$1" '.[$n]'
}
facility_put_secret() {
  aws secretsmanager put-secret-value --region "$FACILITY_AWS_REGION" \
    --secret-id "$(facility_secret_arn "$1")" --secret-string "$2" >/dev/null
}
```

The RDS master password lives in its own managed secret:

```bash
aws secretsmanager get-secret-value \
  --region "$FACILITY_AWS_REGION" \
  --secret-id "$(terraform -chdir="$FACILITY_TF_DIR" output -raw rds_master_user_secret_arn)" \
  --query SecretString --output text | jq -r .password
```

URL-encode it before putting it in `database_url`, and never print the values or
commit `.env`, tfvars, or state.

## 5. Migrate and seed, before any service starts

The `migrate` task applies migrations **and** seeds the bundled roles, action
types and default sandbox profile that the next step and `facility doctor`
depend on. It is idempotent.

```bash
FACILITY_CLUSTER="$(terraform -chdir="$FACILITY_TF_DIR" output -raw ecs_cluster_name)"
FACILITY_MIGRATE_DEF="$(terraform -chdir="$FACILITY_TF_DIR" output -raw migrate_task_definition_arn)"
FACILITY_SUBNETS="$(terraform -chdir="$FACILITY_TF_DIR" output -json private_subnet_ids | jq -r 'join(",")')"
FACILITY_SERVICE_SG="$(terraform -chdir="$FACILITY_TF_DIR" output -raw service_security_group_id)"
FACILITY_NETWORK="awsvpcConfiguration={subnets=[${FACILITY_SUBNETS}],securityGroups=[${FACILITY_SERVICE_SG}],assignPublicIp=DISABLED}"

FACILITY_TASK="$(aws ecs run-task --region "$FACILITY_AWS_REGION" \
  --cluster "$FACILITY_CLUSTER" --launch-type FARGATE \
  --task-definition "$FACILITY_MIGRATE_DEF" \
  --network-configuration "$FACILITY_NETWORK" \
  --query 'tasks[0].taskArn' --output text)"

aws ecs wait tasks-stopped --region "$FACILITY_AWS_REGION" \
  --cluster "$FACILITY_CLUSTER" --tasks "$FACILITY_TASK"

aws ecs describe-tasks --region "$FACILITY_AWS_REGION" \
  --cluster "$FACILITY_CLUSTER" --tasks "$FACILITY_TASK" \
  --query 'tasks[0].containers[?name==`migrate`].exitCode | [0]' --output text
```

The exit code must be `0`. If it is not, read
`/facility/<environment>/migrate` in CloudWatch before retrying, and do not
start the API or worker.

## 6. Bind the instance to your GitHub organization

Every instance is dedicated to one Facility organization, one GitHub account and
one App installation, and sign-in admits only explicitly provisioned members.
Until that binding exists, every login fails with `not_invited` or
`installation_access_required` — correctly, but confusingly.

The database accepts connections only from the service security group, so the
binding is created from inside the VPC. The API image carries the CLI for
exactly this, and the `migrate` task definition already has `DATABASE_URL`:

```bash
gh api /user --jq .id                  # your GitHub user id
gh api /orgs/<org> --jq .id            # the account id (/users/<login> for a personal account)
# the installation id is the last path segment of
# https://github.com/organizations/<org>/settings/installations/<id>

aws ecs run-task --region "$FACILITY_AWS_REGION" \
  --cluster "$FACILITY_CLUSTER" --launch-type FARGATE \
  --task-definition "$FACILITY_MIGRATE_DEF" \
  --network-configuration "$FACILITY_NETWORK" \
  --overrides '{"containerOverrides":[{"name":"migrate","command":[
    "node","cli/bin/facility.mjs","instance","bootstrap",
    "--org-name","My Org","--org-slug","my-org",
    "--owner-email","you@example.com","--owner-name","Your Name",
    "--github-user-id","<user id>","--github-login","<login>",
    "--github-account-id","<account id>","--github-account-login","<org login>",
    "--github-installation-id","<installation id>",
    "--github-account-type","organization","--json"]}]}'
```

Wait for the task and assert its exit code exactly as in step 5, then read the
log stream: `{"ok":true,"created":true,...}` on the first run and
`"created":false` on any later one. The command takes an advisory lock, is
idempotent for the same binding, and refuses to modify a database already bound
to a different instance.

That refusal is also the one failure worth recognising in advance:
`bootstrap_failed: Database already contains a different Facility instance`
means something already created an organization — most often a seed run with
demo data. The reference `migrate` task sets `FACILITY_SEED_DEMO=0` precisely so
that this step owns the first organization; keep it that way.

Unlike earlier revisions of this runbook, no operator API key is injected by
hand. You sign in through the browser as the bound owner, and issue keys from
there with `facility keys issue` or `POST /v1/keys` when you need headless
access.

## 7. Start the services

Raise the desired counts in the same tfvars file, apply, and wait:

```bash
terraform -chdir="$FACILITY_TF_DIR" apply -var-file="${FACILITY_ENV}.tfvars"

aws ecs wait services-stable --region "$FACILITY_AWS_REGION" \
  --cluster "$FACILITY_PREFIX" --services api worker gateway web

FACILITY_API_URL="$(terraform -chdir="$FACILITY_TF_DIR" output -raw api_url)"
curl --fail --silent --show-error "$FACILITY_API_URL/health"
```

Then sign in at the `app_hostname` with GitHub, issue an API key, and let the
doctor judge the deployment rather than judging it yourself:

```bash
facility doctor --url "$FACILITY_API_URL" --key fak_…
```

Do not send traffic until it reports no `FAIL`. It verifies migrations, object
storage, seed essentials, the `sandbox_runner` profile, the production
`auth_config`, and the audit hash chain.

Add provider credentials through Facility rather than enabling the gateway's
development fallback:

```bash
facility providers create --provider anthropic --name primary --secret "$ANTHROPIC_API_KEY"
```

## 8. Activate the webhook last

Only once health and doctor pass. GitHub does not invent the webhook URL — it
comes from the public API origin:

```bash
terraform -chdir="$FACILITY_TF_DIR" output -raw github_webhook_url
```

In the App's settings: replace the URL with that exact value, keep
`GITHUB_APP_WEBHOOK_SECRET` identical on both sides, enable **Active**, and keep
SSL verification on. Confirm the subscriptions — `check_run`,
`deployment_status`, `issue_comment`, `issues`, `pull_request`,
`pull_request_review`, `push`, `workflow_run` — then use **Advanced → Recent
deliveries** to redeliver one event and require a `2xx` before invoking an
agent.

If you are replacing an old environment, its URL is gone. Never reactivate the
App against it.

## Repeated deployments and teardown

For validation stacks, `target_deregistration_delay_seconds = 15` avoids waiting
the production default of five minutes for every replaced API target. Keep the
default `300` in production unless in-flight requests are safely bounded below
the shorter drain window.

A full apply provisions roughly 89 billed resources. Tear down with
`terraform destroy`, having set `enable_deletion_protection = false` and
`force_destroy_bucket = true` for anything ephemeral. Verify against the service
APIs and an empty Terraform state rather than the Resource Groups Tagging API,
which keeps listing deleted ARNs for a while and converges later. Secrets enter
an asynchronous force-deletion queue, and the KMS key stays in
`PendingDeletion` for its minimum window — neither is live, and neither blocks a
fresh environment.
