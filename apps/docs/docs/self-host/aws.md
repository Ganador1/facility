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

The variables file names the domain, the WorkOS and GitHub App credentials
(by secret ARN, not value), instance sizes, and the container image tags —
build and push images with the repo's `infra/build-images.sh`.

Any-cloud note: nothing in the services is AWS-specific — this module is a
reference, not a requirement. The sandbox driver seam (`docker` | `aws`) is
where compute specifics live; a Kubernetes Job driver is the documented
extension point.

After the ECS services roll, run:

```bash
facility doctor --url https://<api-host> --key fak_...
```

Do not send production traffic until the doctor reports no `FAIL` checks.
