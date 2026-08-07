mock_provider "aws" {
  override_during = plan

  mock_data "aws_caller_identity" {
    defaults = {
      account_id = "123456789012"
    }
  }

  mock_data "aws_availability_zones" {
    defaults = {
      names = ["us-east-1a", "us-east-1b"]
    }
  }

  mock_data "aws_cloudfront_cache_policy" {
    defaults = {
      id = "managed-caching-disabled"
    }
  }

  mock_data "aws_cloudfront_origin_request_policy" {
    defaults = {
      id = "managed-all-viewer-except-host"
    }
  }

  mock_data "aws_ec2_managed_prefix_list" {
    defaults = {
      id = "pl-cloudfront-origin-facing"
    }
  }

  mock_resource "aws_cloudfront_distribution" {
    defaults = {
      domain_name = "d111111abcdef8.cloudfront.net"
    }
  }

  mock_resource "aws_lb" {
    defaults = {
      arn      = "arn:aws:elasticloadbalancing:us-east-1:123456789012:loadbalancer/app/facility-test/0000000000000000"
      dns_name = "facility-test.us-east-1.elb.amazonaws.com"
      zone_id  = "Z35SXDOTRQ7X7K"
    }
  }

  mock_resource "aws_db_instance" {
    defaults = {
      master_user_secret = [{
        kms_key_id    = "mock-kms-key"
        secret_arn    = "arn:aws:secretsmanager:us-east-1:123456789012:secret:facility-db"
        secret_status = "active"
      }]
    }
  }
}

mock_provider "random" {
  override_during = plan

  mock_resource "random_password" {
    defaults = {
      result = "preview-surface-token-0000000000000000000000000000000000000000"
    }
  }
}

run "managed_preview_needs_no_domain_or_certificate" {
  command = plan

  variables {
    app_hostname = "app.example.com"
    api_hostname = "api.example.com"
    mcp_hostname = "mcp.example.com"
  }

  assert {
    condition     = local.managed_preview_origin
    error_message = "An empty preview_hostname must select the managed preview origin."
  }

  assert {
    condition     = length(aws_cloudfront_distribution.preview) == 1
    error_message = "The managed mode must create one isolated CloudFront distribution."
  }

  assert {
    condition     = length(random_password.preview_surface) == 1
    error_message = "The managed mode must create an unguessable preview-surface token."
  }

  assert {
    condition     = output.preview_url == "https://d111111abcdef8.cloudfront.net"
    error_message = "The managed mode must publish the AWS-assigned HTTPS origin."
  }

  assert {
    condition     = one(aws_cloudfront_distribution.preview[0].origin).domain_name == aws_lb.public.dns_name
    error_message = "Certificate-less managed previews must use the ALB address as their origin."
  }

  assert {
    condition     = one(one(aws_cloudfront_distribution.preview[0].origin).custom_origin_config).origin_protocol_policy == "http-only"
    error_message = "Certificate-less managed previews must use the documented validation-only HTTP origin hop."
  }

  assert {
    condition     = length(aws_lb_listener_rule.http_preview_managed) == 1
    error_message = "Certificate-less managed traffic must have an explicit marked ALB route."
  }

  assert {
    condition     = length(aws_lb_listener_rule.http_preview) == 0 && length(aws_lb_listener_rule.https_preview) == 0
    error_message = "Managed previews must not create custom-hostname ALB routes."
  }

  assert {
    condition     = length(aws_vpc_security_group_ingress_rule.alb_preview_cloudfront) == 1
    error_message = "Managed previews must allow only CloudFront origin traffic on the selected ALB port."
  }

  assert {
    condition     = one([for entry in local.api_environment : entry.value if entry.name == "FACILITY_PREVIEW_SURFACE_TOKEN"]) == random_password.preview_surface[0].result
    error_message = "Only the trusted API path must receive the generated preview-surface token."
  }

  assert {
    condition     = length([for entry in local.worker_environment : entry if entry.name == "FACILITY_PREVIEW_SURFACE_TOKEN"]) == 0
    error_message = "The worker does not serve previews and must not receive the surface token."
  }
}

run "managed_preview_uses_the_existing_https_api_origin" {
  command = plan

  variables {
    app_hostname        = "app.example.com"
    api_hostname        = "api.example.com"
    mcp_hostname        = "mcp.example.com"
    acm_certificate_arn = "arn:aws:acm:us-east-1:123456789012:certificate/00000000-0000-0000-0000-000000000000"
  }

  assert {
    condition     = local.managed_preview_origin && length(aws_cloudfront_distribution.preview) == 1
    error_message = "The production mode must retain the managed preview distribution."
  }

  assert {
    condition     = one(aws_cloudfront_distribution.preview[0].origin).domain_name == "api.example.com"
    error_message = "CloudFront must use the certificate-backed API hostname as its production origin."
  }

  assert {
    condition     = one(one(aws_cloudfront_distribution.preview[0].origin).custom_origin_config).origin_protocol_policy == "https-only"
    error_message = "CloudFront must encrypt the production origin hop."
  }

  assert {
    condition     = length(aws_lb_listener_rule.http_preview_managed) == 0 && length(aws_lb_listener_rule.https_api) == 1
    error_message = "Production managed previews must reuse the existing HTTPS API host rule."
  }

  assert {
    condition     = length(aws_vpc_security_group_ingress_rule.alb_preview_cloudfront) == 1 && aws_vpc_security_group_ingress_rule.alb_preview_cloudfront[0].from_port == 443 && aws_vpc_security_group_ingress_rule.alb_preview_cloudfront[0].to_port == 443
    error_message = "Production managed previews must admit CloudFront only on the HTTPS origin port."
  }
}

run "custom_preview_keeps_the_advanced_override" {
  command = plan

  variables {
    app_hostname        = "app.example.com"
    api_hostname        = "api.example.com"
    mcp_hostname        = "mcp.example.com"
    preview_hostname    = "preview.example.net"
    acm_certificate_arn = "arn:aws:acm:us-east-1:123456789012:certificate/00000000-0000-0000-0000-000000000000"
  }

  assert {
    condition     = !local.managed_preview_origin
    error_message = "A non-empty preview_hostname must select the custom-domain mode."
  }

  assert {
    condition     = length(aws_cloudfront_distribution.preview) == 0 && length(random_password.preview_surface) == 0
    error_message = "The custom-domain mode must not create the managed origin or its token."
  }

  assert {
    condition     = output.preview_url == "https://preview.example.net"
    error_message = "The custom-domain mode must retain the configured HTTPS origin."
  }

  assert {
    condition     = length(aws_lb_listener_rule.https_preview) == 1
    error_message = "The custom-domain mode must route its hostname through the HTTPS listener."
  }

  assert {
    condition     = length(aws_lb_listener_rule.http_preview_managed) == 0 && length(aws_vpc_security_group_ingress_rule.alb_preview_cloudfront) == 0
    error_message = "The custom-domain mode must not retain managed-origin routing or ingress."
  }

  assert {
    condition     = length([for entry in local.api_environment : entry if entry.name == "FACILITY_PREVIEW_SURFACE_TOKEN"]) == 0
    error_message = "The custom-domain mode must not inject a managed-origin token."
  }
}
