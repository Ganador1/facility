# Facility AWS Terraform

This module provisions the AWS reference deployment from the platform architecture:
VPC, two private AZs, public ALB, RDS Postgres 16, S3 object storage, ECR,
ECS Fargate services for `api`, `worker`, `gateway`, `web`, and `mcp`, a runner task
definition for the AWS sandbox driver, KMS, Secrets Manager, and CloudWatch logs.

Topology:

- `app_hostname` routes to the `web` ECS service through the public ALB.
- `api_hostname` routes to the `api` ECS service through the public ALB.
- `mcp_hostname` routes to the audience-bound MCP resource server.
- `gateway` has no public ALB route. It is reachable only inside the VPC through
  Cloud Map at the `gateway_internal_url` output.
- Postgres accepts `5432` only from the ECS service security group.
- Migrations are a one-shot ECS task definition. Terraform does not run them.

## 1. Prepare variables

```bash
cd infra/terraform/aws
cp terraform.tfvars.example playground.tfvars
```

Edit `playground.tfvars`:

- Set `app_hostname`, `api_hostname`, and `mcp_hostname`.
- Set `acm_certificate_arn` for HTTPS, or leave it empty for HTTP-only testing.
- Set `route53_zone_id` if Terraform should create alias records.
- Set `enable_cloudfront_api_endpoint = true` to get an AWS-managed HTTPS API
  and webhook URL without a public DNS zone. This is intended for validation;
  use your own hostname and ACM certificate for production.
- Set image tags matching the images you push.
- Select direct `github` authentication for self-hosting or `oidc` for a SaaS
  broker. MCP OAuth is always issued by the dedicated Facility instance.
- Tune `envelope_retention_days` for your data-retention policy.

No secret values belong in tfvars.

## 2. Create AWS resources

```bash
terraform init
terraform apply -var-file=playground.tfvars
```

Record these outputs:

- `ecr_repository_urls`
- `secret_arns`
- `rds_endpoint`
- `rds_master_user_secret_arn`
- `ecs_cluster_name`
- `migrate_task_definition_arn`
- `private_subnet_ids`
- `service_security_group_id`

## 3. Build and push images

From the repository root:

```bash
AWS_REGION=us-east-1 IMAGE_TAG=$(git rev-parse --short HEAD) ./infra/build-images.sh
```

The script expects Dockerfiles for `api`, `worker`, `gateway`, `web`, `mcp`, and
`runner`. Override paths or image URIs with environment variables documented in
the script when a service image is built elsewhere. It builds `linux/amd64` by
default, matching Terraform's default `task_cpu_architecture = "X86_64"`. To
deploy on Graviton, set `CPU_ARCHITECTURE=ARM64` while building and set
`task_cpu_architecture = "ARM64"` in Terraform. The build exits early if an
explicit `PLATFORM` conflicts with `CPU_ARCHITECTURE`.

Apply again with matching `container_image_tags`.

## 4. Populate Secrets Manager

Terraform creates encrypted secret containers but never writes secret values.
Populate them with `aws secretsmanager put-secret-value`.

Required runtime values:

- `database_url`: `postgres://facility:<password>@<rds_endpoint>:5432/facility?sslmode=verify-full`
- `secret_master_key`: 32-byte base64 value from `openssl rand -base64 32`
- `github_oauth_client_id` and `github_oauth_client_secret` in direct mode, or
  `oidc_client_id` and `oidc_client_secret` in broker mode
- `facility_oauth_jwks`: persistent private ES256 JWK set
- `github_app_id`
- `github_app_private_key`
- `github_app_webhook_secret`
- `github_app_slug`

The `dev_anthropic_api_key` and `dev_openai_api_key` secrets exist only for
local/bootstrap fallback compatibility. Prefer provider credentials stored
through the Facility API after boot.

The production service image loads Amazon's published global RDS CA bundle so
`sslmode=verify-full` encrypts the connection and verifies the database
hostname. Do not downgrade this to a non-verifying TLS mode.

Fetch the RDS managed password:

```bash
aws secretsmanager get-secret-value \
  --secret-id "$(terraform output -raw rds_master_user_secret_arn)" \
  --query SecretString \
  --output text
```

## 5. Run the migrate + seed task once

The `migrate` task runs database migrations **and** seeds the bundled essentials
(roles, action types, default sandbox profile) that administrative bootstrap and
`facility doctor` require — seeding is idempotent. Run it only after the
`database_url` secret and images are populated:

```bash
aws ecs run-task \
  --cluster "$(terraform output -raw ecs_cluster_name)" \
  --launch-type FARGATE \
  --task-definition "$(terraform output -raw migrate_task_definition_arn)" \
  --network-configuration "awsvpcConfiguration={subnets=$(terraform output -json private_subnet_ids),securityGroups=[$(terraform output -raw service_security_group_id)],assignPublicIp=DISABLED}"
```

Watch `/facility/<environment>/migrate` in CloudWatch Logs for
`applied 0001_control_plane.sql` (or `already applied`) followed by the seed
summary. `facility doctor` will flag `seed_essentials` if this task did not run.

## 6. Verify service health

```bash
curl -fsS "https://${api_hostname}/health"
curl -fsS "https://${app_hostname}/"
```

For HTTP-only test deployments, use `http://` and the ALB DNS name with `Host`
headers until DNS is configured.

Repeated validation deployments can set
`target_deregistration_delay_seconds = 15` to avoid waiting the production
default of five minutes for every replaced API target. Keep the default `300`
for production unless all in-flight requests are safely bounded below the
shorter drain window.

## Validation status

The reference module has been checked with:

- `terraform init` / `validate` / `fmt -check` — pass.
- `terraform plan` using the example variables in HTTP-only mode without a
  domain.
- The `api` container image builds from the root `Dockerfile` and health-checks
  green in a container against Postgres; the same images back this stack.

A full `terraform apply` provisions ~89 billed resources (RDS, NAT gateway,
ALB, ECS services) — run it when you want a live environment, then
`build-images.sh` + the one-shot migrate task per the steps above. Tear down
with `terraform destroy` (set `enable_deletion_protection=false` and
`force_destroy_bucket=true` for an ephemeral playground).
