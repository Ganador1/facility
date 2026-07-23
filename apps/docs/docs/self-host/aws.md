---
title: AWS (Terraform)
---

# AWS reference deployment

`infra/terraform/aws` provisions the reference production stack — the same
one the platform's own validation deployment runs on:

- VPC (2 AZ), private subnets for services and RDS
- RDS Postgres 16, S3 bucket (envelopes/transcripts), ECR repositories
- ECS Fargate services: `api`, `worker`, `gateway`, `web` behind an ALB
- Fargate runner tasks for the `aws` sandbox driver
- KMS-backed secrets (`SECRET_MASTER_KEY` and friends) into task env
- CloudWatch log groups per service

```bash
cd infra/terraform/aws
terraform init
terraform apply -var-file=yourorg.tfvars
```

The variables file names the domains, identity mode, and GitHub App credentials
(by secret ARN, not value), instance sizes, and the container image tags —
build and push images with the repo's `infra/build-images.sh`.

## Public API and GitHub webhook URL

The GitHub webhook URL comes from the public API origin; GitHub does not create
it. After `terraform apply`, print the configured origin:

```bash
terraform output -raw api_url
```

Append `/webhooks/github` to the result. For example, an output of
`https://api.facility.example.com` produces:

```text
https://api.facility.example.com/webhooks/github
```

For a validation deployment without a public DNS zone, set
`enable_cloudfront_api_endpoint = true`; `api_url` and `github_webhook_url` then
use an AWS-managed CloudFront HTTPS hostname. For production, the configured
`api_hostname` should resolve to the public ALB and have a valid TLS certificate.
Set `route53_zone_id` to let this module create the alias, or create an
equivalent record with an external DNS provider. Configure and install the App
only after the API is reachable so its initial installation event is delivered. See the
[GitHub App guide](github-app) for permissions, event subscriptions, secrets,
and verification.

Any-cloud note: nothing in the services is AWS-specific — this module is a
reference, not a requirement. The sandbox driver seam (`docker` | `aws`) is
where compute specifics live; a Kubernetes Job driver is the documented
extension point.

Once images and the `database_url` secret are populated, run the one-shot
migrate + seed task (it applies migrations **and** seeds the bundled roles,
action types, and default sandbox profile that first bootstrap and `facility
doctor` require — it is idempotent). See the module
[README](https://github.com/theam/facility/tree/main/infra/terraform/aws#5-run-the-migrate--seed-task-once)
for the exact `aws ecs run-task` invocation.

Use `sslmode=verify-full` in the RDS connection URL. The production service
image includes Amazon's global RDS CA bundle so both the API and worker verify
the database certificate and hostname.

After the ECS services roll and the migrate+seed task has completed, run:

```bash
node packages/cli/bin/facility.mjs doctor --url https://<api-host> --key fak_...
```

Do not send production traffic until the doctor reports no `FAIL` checks — it
verifies DB migrations, object storage, seed essentials, the `sandbox_runner`
profile (driver + runner), production `auth_config`, and the audit hash chain.
