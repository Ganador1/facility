# Spec: AWS reference deployment (infra/terraform/aws)

**Scope**: a Terraform module that stands up the Facility platform on AWS — the
reference production topology and the validation playground. Self-contained
under `infra/terraform/aws`. No application code changes.

Read first: docs/platform/ARCHITECTURE.md §7, docker-compose.yml (the service
set + env contract these containers expect), Dockerfile + apps/web/Dockerfile
(image build targets: api, gateway, web; worker = api image, `node
services/api/dist/worker.js`; migrate = api image, `node
packages/db/dist/migrate.js`).

## What to provision

- **Networking**: VPC (2 AZ), 2 public + 2 private subnets, IGW, 1 NAT
  gateway, route tables. Security groups: alb-sg (443/80 from internet),
  service-sg (from alb-sg on service ports + intra-service), db-sg (5432 from
  service-sg only).
- **Data**: RDS Postgres 16 (`db.t4g.small` default var, gp3, 20GB,
  multi_az var default false, in private subnets, db-sg). S3 bucket for
  envelopes/transcripts (versioning on, public access blocked, SSE-S3).
- **Registry**: one ECR repo per image (`facility-api`, `facility-gateway`,
  `facility-web`).
- **Secrets**: AWS Secrets Manager entries for `SECRET_MASTER_KEY`,
  `DATABASE_URL` (composed from RDS output), `WORKOS_*`, `GITHUB_APP_*`,
  S3 creds (use an IAM task role for S3 instead of keys where possible —
  task role with least-priv bucket access; still pass S3_ENDPOINT unset so the
  SDK uses AWS S3). Values are provided by the operator via tfvars (by ARN or
  literal marked sensitive) — the module creates the secrets and wires them
  into task defs via `valueFrom`.
- **Compute**: ECS cluster (Fargate). Task defs + services for `api` (behind
  ALB, target group, health `/health`), `gateway` (behind ALB path/host rule
  or internal NLB — internal is fine; sandboxes reach it), `web` (behind ALB,
  default rule), `worker` (no LB, `desiredCount` 1). A one-shot `migrate` task
  (run via `aws ecs run-task`, not a service) — expose it as a null_resource /
  documented command, don't auto-run destructively.
- **ALB**: HTTPS listener (ACM cert ARN via var; HTTP→HTTPS redirect). Host or
  path routing: web at `/`, api at `/api/*` → api target group (strip prefix
  or keep — the web app proxies /api itself, so for the platform the api needs
  its own hostname; provide `api_domain` + `app_domain` vars and route by
  host). Keep it simple: two hostnames (app, api), gateway internal-only.
- **Logs**: one CloudWatch log group per service, 30-day retention.

## Structure

```
infra/terraform/aws/
  main.tf            provider, locals, tags
  network.tf         vpc/subnets/sg
  data.tf            rds, s3
  ecr.tf             repos
  secrets.tf         secrets manager
  ecs.tf             cluster, task defs, services, alb, target groups
  iam.tf             execution role, task roles (S3 access, secrets read)
  variables.tf       all inputs (region, domains, cert_arn, image tags,
                     instance sizes, secret values, desired counts)
  outputs.tf         alb dns, api/app urls, ecr repo urls, rds endpoint
  README.md          apply steps + the image build/push + migrate run
  terraform.tfvars.example
```

Pin the AWS provider (`~> 5.x`), require terraform `>= 1.5`. Remote state left
to the operator (document an S3 backend stub, commented). Default region
`us-east-1`. Tag everything `{Project="facility", ManagedBy="terraform"}`.

## Constraints

- `terraform init` + `terraform validate` MUST pass. `terraform plan` should
  succeed given a filled tfvars (it will need real AWS creds — the DoD is
  validate + a plan dry-run note, not apply).
- No secrets in the module or examples — tfvars.example uses placeholders.
- Least-privilege IAM (no `*` resource on the task role's S3/secrets
  statements — scope to the created bucket ARN and secret ARNs).
- The module must be readable: a top-tier infra engineer should follow it
  without a diagram.

## infra/build-images.sh

A companion script (bash, set -euo pipefail): builds the three images
(`docker build --target api|gateway .`, `-f apps/web/Dockerfile --target web`),
tags with a supplied tag + the ECR repo URLs (from `terraform output`), logs
into ECR, pushes. Idempotent, documented.

## Mechanical floor

```
cd infra/terraform/aws && terraform init -backend=false && terraform validate && terraform fmt -check
bash -n infra/build-images.sh
node guards/run.mjs   # from repo root — actions-pinned etc. still pass
```

## Judgment criteria

Real, applyable HCL (not pseudo); security groups least-open; IAM least-priv;
secrets never literal in code; the two-hostname + internal-gateway topology is
coherent; README lets an operator go from zero to running (init → apply →
build-images → run migrate task → open app URL). Nothing AWS-proprietary
leaks into assumptions the other drivers can't meet — this is one deployment
target, not the only one.
