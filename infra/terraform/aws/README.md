# Facility AWS Terraform

This module provisions the AWS reference deployment from the platform architecture:
VPC, two private AZs, public ALB, RDS Postgres 16, S3 object storage, ECR,
ECS Fargate services for `api`, `worker`, `gateway`, and `web`, a runner task
definition for the AWS sandbox driver, KMS, Secrets Manager, and CloudWatch logs.

Topology:

- `app_hostname` routes to the `web` ECS service through the public ALB.
- `api_hostname` routes to the `api` ECS service through the public ALB.
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

- Set `app_hostname` and `api_hostname`.
- Set `acm_certificate_arn` for HTTPS, or leave it empty for HTTP-only testing.
- Set `route53_zone_id` if Terraform should create alias records.
- Set image tags matching the images you push.

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

The script expects Dockerfiles for `api`, `worker`, `gateway`, `web`, and
`runner`. Override paths or image URIs with environment variables documented in
the script when a service image is built elsewhere.

Apply again with matching `container_image_tags`.

## 4. Populate Secrets Manager

Terraform creates encrypted secret containers but never writes secret values.
Populate them with `aws secretsmanager put-secret-value`.

Required runtime values:

- `database_url`: `postgres://facility:<password>@<rds_endpoint>:5432/facility`
- `secret_master_key`: 32-byte base64 value from `openssl rand -base64 32`
- `workos_api_key`
- `workos_client_id`
- `workos_cookie_password`: 32+ random chars
- `workos_authkit_domain`
- `next_public_workos_redirect_uri`: `https://api.example.com/auth/callback`
- `github_app_id`
- `github_app_private_key`
- `github_app_webhook_secret`
- `github_app_slug`

The `dev_anthropic_api_key` and `dev_openai_api_key` secrets exist only for
local/bootstrap fallback compatibility. Prefer provider credentials stored
through the Facility API after boot.

Fetch the RDS managed password:

```bash
aws secretsmanager get-secret-value \
  --secret-id "$(terraform output -raw rds_master_user_secret_arn)" \
  --query SecretString \
  --output text
```

## 5. Run the migration once

Run this only after the `database_url` secret and images are populated:

```bash
aws ecs run-task \
  --cluster "$(terraform output -raw ecs_cluster_name)" \
  --launch-type FARGATE \
  --task-definition "$(terraform output -raw migrate_task_definition_arn)" \
  --network-configuration "awsvpcConfiguration={subnets=$(terraform output -json private_subnet_ids),securityGroups=[$(terraform output -raw service_security_group_id)],assignPublicIp=DISABLED}"
```

Watch `/facility/<environment>/migrate` in CloudWatch Logs for
`applied 0001_control_plane.sql` or `0001_control_plane.sql already applied`.

## 6. Verify service health

```bash
curl -fsS "https://${api_hostname}/health"
curl -fsS "https://${app_hostname}/"
```

For HTTP-only test deployments, use `http://` and the ALB DNS name with `Host`
headers until DNS is configured.
