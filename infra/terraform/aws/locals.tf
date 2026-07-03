data "aws_caller_identity" "current" {}
data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  name_prefix = "${var.project}-${var.environment}"
  azs         = slice(data.aws_availability_zones.available.names, 0, 2)

  tags = {
    Project     = var.project
    Environment = var.environment
    ManagedBy   = "terraform"
  }

  ecr_repositories = toset(["api", "worker", "gateway", "web", "runner"])

  ports = {
    api     = 4400
    worker  = 4400
    gateway = 4410
    web     = 3400
    runner  = 8080
    migrate = 0
  }

  images = {
    for name in local.ecr_repositories :
    name => coalesce(
      lookup(var.image_overrides, name, null),
      "${aws_ecr_repository.service[name].repository_url}:${var.container_image_tags[name]}"
    )
  }

  public_urls = {
    api = "https://${var.api_hostname}"
    web = "https://${var.app_hostname}"
  }

  common_environment = [
    { name = "NODE_ENV", value = "production" },
    { name = "LOG_LEVEL", value = "info" },
    { name = "S3_BUCKET", value = aws_s3_bucket.objects.bucket },
    { name = "AWS_REGION", value = var.aws_region },
  ]

  api_environment = concat(local.common_environment, [
    { name = "PORT", value = tostring(local.ports.api) },
    { name = "PUBLIC_URL", value = local.public_urls.api },
    { name = "WEB_URL", value = local.public_urls.web },
    { name = "FACILITY_GATEWAY_URL", value = "http://${aws_service_discovery_service.gateway.name}.${aws_service_discovery_private_dns_namespace.facility.name}:${local.ports.gateway}" },
  ])

  worker_environment = concat(local.common_environment, [
    { name = "PORT", value = tostring(local.ports.worker) },
    { name = "PUBLIC_URL", value = local.public_urls.api },
    { name = "WEB_URL", value = local.public_urls.web },
    { name = "FACILITY_GATEWAY_URL", value = "http://${aws_service_discovery_service.gateway.name}.${aws_service_discovery_private_dns_namespace.facility.name}:${local.ports.gateway}" },
  ])

  gateway_environment = concat(local.common_environment, [
    { name = "GATEWAY_PORT", value = tostring(local.ports.gateway) },
    { name = "PORT", value = tostring(local.ports.gateway) },
    { name = "PUBLIC_URL", value = "http://${aws_service_discovery_service.gateway.name}.${aws_service_discovery_private_dns_namespace.facility.name}:${local.ports.gateway}" },
  ])

  web_environment = [
    { name = "NODE_ENV", value = "production" },
    { name = "PORT", value = tostring(local.ports.web) },
    { name = "FACILITY_API_URL", value = local.public_urls.api },
  ]

  app_secret_names = toset([
    "database_url",
    "secret_master_key",
    "workos_api_key",
    "workos_client_id",
    "workos_cookie_password",
    "workos_authkit_domain",
    "next_public_workos_redirect_uri",
    "github_app_id",
    "github_app_private_key",
    "github_app_webhook_secret",
    "github_app_slug",
    "dev_anthropic_api_key",
    "dev_openai_api_key",
  ])

  common_secrets = [
    { name = "DATABASE_URL", valueFrom = aws_secretsmanager_secret.app["database_url"].arn },
    { name = "SECRET_MASTER_KEY", valueFrom = aws_secretsmanager_secret.app["secret_master_key"].arn },
    { name = "WORKOS_API_KEY", valueFrom = aws_secretsmanager_secret.app["workos_api_key"].arn },
    { name = "WORKOS_CLIENT_ID", valueFrom = aws_secretsmanager_secret.app["workos_client_id"].arn },
    { name = "WORKOS_COOKIE_PASSWORD", valueFrom = aws_secretsmanager_secret.app["workos_cookie_password"].arn },
    { name = "WORKOS_AUTHKIT_DOMAIN", valueFrom = aws_secretsmanager_secret.app["workos_authkit_domain"].arn },
    { name = "NEXT_PUBLIC_WORKOS_REDIRECT_URI", valueFrom = aws_secretsmanager_secret.app["next_public_workos_redirect_uri"].arn },
    { name = "GITHUB_APP_ID", valueFrom = aws_secretsmanager_secret.app["github_app_id"].arn },
    { name = "GITHUB_APP_PRIVATE_KEY", valueFrom = aws_secretsmanager_secret.app["github_app_private_key"].arn },
    { name = "GITHUB_APP_WEBHOOK_SECRET", valueFrom = aws_secretsmanager_secret.app["github_app_webhook_secret"].arn },
    { name = "GITHUB_APP_SLUG", valueFrom = aws_secretsmanager_secret.app["github_app_slug"].arn },
  ]

  gateway_secrets = concat(local.common_secrets, [
    { name = "DEV_ANTHROPIC_API_KEY", valueFrom = aws_secretsmanager_secret.app["dev_anthropic_api_key"].arn },
    { name = "DEV_OPENAI_API_KEY", valueFrom = aws_secretsmanager_secret.app["dev_openai_api_key"].arn },
  ])

  log_groups = toset(["api", "worker", "gateway", "web", "runner", "migrate"])

  ecs_services = {
    api = {
      desired_count = var.api_desired_count
      image         = local.images.api
      command       = ["node", "services/api/dist/start.js"]
      port          = local.ports.api
      environment   = local.api_environment
      secrets       = local.common_secrets
      public        = true
      health_path   = "/health"
    }
    worker = {
      desired_count = var.worker_desired_count
      image         = local.images.worker
      command       = ["node", "services/api/dist/worker.js"]
      port          = local.ports.worker
      environment   = local.worker_environment
      secrets       = local.common_secrets
      public        = false
      health_path   = "/health"
    }
    gateway = {
      desired_count = var.gateway_desired_count
      image         = local.images.gateway
      command       = []
      port          = local.ports.gateway
      environment   = local.gateway_environment
      secrets       = local.gateway_secrets
      public        = false
      health_path   = "/health"
    }
    web = {
      desired_count = var.web_desired_count
      image         = local.images.web
      command       = ["pnpm", "--filter", "@facility/web", "start"]
      port          = local.ports.web
      environment   = local.web_environment
      secrets       = []
      public        = true
      health_path   = "/"
    }
  }
}
