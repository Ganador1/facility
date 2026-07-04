resource "aws_security_group" "alb" {
  name        = "${local.name_prefix}-alb"
  description = "Public ALB ingress for Facility app and API hostnames"
  vpc_id      = aws_vpc.facility.id

  tags = {
    Name = "${local.name_prefix}-alb"
  }
}

resource "aws_security_group" "service" {
  name        = "${local.name_prefix}-service"
  description = "Facility ECS service tasks"
  vpc_id      = aws_vpc.facility.id

  tags = {
    Name = "${local.name_prefix}-service"
  }
}

resource "aws_security_group" "sandbox" {
  name        = "${local.name_prefix}-sandbox"
  description = "Facility ephemeral sandbox runner tasks"
  vpc_id      = aws_vpc.facility.id

  tags = {
    Name = "${local.name_prefix}-sandbox"
  }
}

resource "aws_security_group" "database" {
  name        = "${local.name_prefix}-db"
  description = "Facility RDS Postgres"
  vpc_id      = aws_vpc.facility.id

  tags = {
    Name = "${local.name_prefix}-db"
  }
}

resource "aws_vpc_security_group_ingress_rule" "alb_http" {
  for_each = toset(var.allowed_http_cidr_blocks)

  security_group_id = aws_security_group.alb.id
  cidr_ipv4         = each.value
  from_port         = 80
  ip_protocol       = "tcp"
  to_port           = 80
}

resource "aws_vpc_security_group_ingress_rule" "alb_https" {
  for_each = toset(var.allowed_http_cidr_blocks)

  security_group_id = aws_security_group.alb.id
  cidr_ipv4         = each.value
  from_port         = 443
  ip_protocol       = "tcp"
  to_port           = 443
}

resource "aws_vpc_security_group_egress_rule" "alb_to_api" {
  security_group_id            = aws_security_group.alb.id
  referenced_security_group_id = aws_security_group.service.id
  from_port                    = local.ports.api
  ip_protocol                  = "tcp"
  to_port                      = local.ports.api
}

resource "aws_vpc_security_group_egress_rule" "alb_to_web" {
  security_group_id            = aws_security_group.alb.id
  referenced_security_group_id = aws_security_group.service.id
  from_port                    = local.ports.web
  ip_protocol                  = "tcp"
  to_port                      = local.ports.web
}

resource "aws_vpc_security_group_ingress_rule" "service_from_alb_api" {
  security_group_id            = aws_security_group.service.id
  referenced_security_group_id = aws_security_group.alb.id
  from_port                    = local.ports.api
  ip_protocol                  = "tcp"
  to_port                      = local.ports.api
}

resource "aws_vpc_security_group_ingress_rule" "service_from_alb_web" {
  security_group_id            = aws_security_group.service.id
  referenced_security_group_id = aws_security_group.alb.id
  from_port                    = local.ports.web
  ip_protocol                  = "tcp"
  to_port                      = local.ports.web
}

resource "aws_vpc_security_group_ingress_rule" "gateway_from_services" {
  security_group_id            = aws_security_group.service.id
  referenced_security_group_id = aws_security_group.service.id
  from_port                    = local.ports.gateway
  ip_protocol                  = "tcp"
  to_port                      = local.ports.gateway
}

resource "aws_vpc_security_group_ingress_rule" "gateway_from_sandbox" {
  security_group_id            = aws_security_group.service.id
  referenced_security_group_id = aws_security_group.sandbox.id
  from_port                    = local.ports.gateway
  ip_protocol                  = "tcp"
  to_port                      = local.ports.gateway
}

resource "aws_vpc_security_group_ingress_rule" "db_from_services" {
  security_group_id            = aws_security_group.database.id
  referenced_security_group_id = aws_security_group.service.id
  from_port                    = 5432
  ip_protocol                  = "tcp"
  to_port                      = 5432
}

resource "aws_vpc_security_group_ingress_rule" "db_from_sandbox" {
  security_group_id            = aws_security_group.database.id
  referenced_security_group_id = aws_security_group.sandbox.id
  from_port                    = 5432
  ip_protocol                  = "tcp"
  to_port                      = 5432
}

resource "aws_vpc_security_group_egress_rule" "service_to_db" {
  security_group_id            = aws_security_group.service.id
  referenced_security_group_id = aws_security_group.database.id
  from_port                    = 5432
  ip_protocol                  = "tcp"
  to_port                      = 5432
}

resource "aws_vpc_security_group_egress_rule" "service_to_gateway" {
  security_group_id            = aws_security_group.service.id
  referenced_security_group_id = aws_security_group.service.id
  from_port                    = local.ports.gateway
  ip_protocol                  = "tcp"
  to_port                      = local.ports.gateway
}

resource "aws_vpc_security_group_egress_rule" "service_https_ipv4" {
  security_group_id = aws_security_group.service.id
  cidr_ipv4         = "0.0.0.0/0"
  from_port         = 443
  ip_protocol       = "tcp"
  to_port           = 443
}

resource "aws_vpc_security_group_egress_rule" "sandbox_to_db" {
  security_group_id            = aws_security_group.sandbox.id
  referenced_security_group_id = aws_security_group.database.id
  from_port                    = 5432
  ip_protocol                  = "tcp"
  to_port                      = 5432
}

resource "aws_vpc_security_group_egress_rule" "sandbox_to_gateway" {
  security_group_id            = aws_security_group.sandbox.id
  referenced_security_group_id = aws_security_group.service.id
  from_port                    = local.ports.gateway
  ip_protocol                  = "tcp"
  to_port                      = local.ports.gateway
}

resource "aws_vpc_security_group_egress_rule" "sandbox_https_ipv4" {
  security_group_id = aws_security_group.sandbox.id
  cidr_ipv4         = "0.0.0.0/0"
  from_port         = 443
  ip_protocol       = "tcp"
  to_port           = 443
}
