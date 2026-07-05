variable "aws_region" {
  description = "AWS region for the reference deployment."
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Environment name used in resource names and tags."
  type        = string
  default     = "playground"
}

variable "project" {
  description = "Short project name used in resource names and tags."
  type        = string
  default     = "facility"
}

variable "allowed_http_cidr_blocks" {
  description = "CIDR blocks allowed to reach the public ALB."
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC."
  type        = string
  default     = "10.61.0.0/16"
}

variable "app_hostname" {
  description = "Public hostname for the Next.js web app."
  type        = string
}

variable "api_hostname" {
  description = "Public hostname for the Fastify API."
  type        = string
}

variable "route53_zone_id" {
  description = "Optional Route53 hosted zone ID. When set, app/api alias records are created."
  type        = string
  default     = ""
}

variable "acm_certificate_arn" {
  description = "Optional ACM certificate ARN for HTTPS listeners on the ALB."
  type        = string
  default     = ""
}

variable "database_name" {
  description = "Initial RDS database name."
  type        = string
  default     = "facility"
}

variable "database_username" {
  description = "RDS master username. The password is AWS-managed in Secrets Manager."
  type        = string
  default     = "facility"
}

variable "database_instance_class" {
  description = "RDS instance class."
  type        = string
  default     = "db.t4g.micro"
}

variable "database_allocated_storage_gb" {
  description = "Allocated RDS storage in GiB."
  type        = number
  default     = 20
}

variable "database_backup_retention_days" {
  description = "RDS backup retention in days."
  type        = number
  default     = 7
}

variable "enable_deletion_protection" {
  description = "Enable deletion protection on persistent resources."
  type        = bool
  default     = true
}

variable "force_destroy_bucket" {
  description = "Allow Terraform to destroy the object bucket even when it contains objects. Keep false for production."
  type        = bool
  default     = false
}

variable "container_image_tags" {
  description = "Image tags used when image_overrides does not provide a full image URI."
  type = object({
    api     = string
    worker  = string
    gateway = string
    web     = string
    runner  = string
  })
  default = {
    api     = "latest"
    worker  = "latest"
    gateway = "latest"
    web     = "latest"
    runner  = "latest"
  }
}

variable "image_overrides" {
  description = "Optional full image URI overrides keyed by api, worker, gateway, web, runner."
  type        = map(string)
  default     = {}
}

variable "api_desired_count" {
  description = "Desired ECS task count for the API service."
  type        = number
  default     = 2
}

variable "worker_desired_count" {
  description = "Desired ECS task count for the worker service."
  type        = number
  default     = 1
}

variable "gateway_desired_count" {
  description = "Desired ECS task count for the internal gateway service."
  type        = number
  default     = 2
}

variable "web_desired_count" {
  description = "Desired ECS task count for the web service."
  type        = number
  default     = 2
}

variable "task_cpu" {
  description = "Per-service Fargate CPU units."
  type = object({
    api     = number
    worker  = number
    gateway = number
    web     = number
    runner  = number
    migrate = number
  })
  default = {
    api     = 512
    worker  = 512
    gateway = 512
    web     = 512
    runner  = 1024
    migrate = 512
  }
}

variable "task_memory" {
  description = "Per-service Fargate memory in MiB."
  type = object({
    api     = number
    worker  = number
    gateway = number
    web     = number
    runner  = number
    migrate = number
  })
  default = {
    api     = 1024
    worker  = 1024
    gateway = 1024
    web     = 1024
    runner  = 2048
    migrate = 1024
  }
}

variable "mcp_oauth_audience" {
  type        = string
  default     = ""
  description = "Expected `aud` for WorkOS OAuth access tokens. Set (with WORKOS_AUTHKIT_DOMAIN) to enable interactive-client OAuth 2.1 on the MCP resource server; empty leaves MCP on fak_ API keys only."
}
