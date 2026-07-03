resource "aws_kms_key" "facility" {
  description             = "Facility ${var.environment} secrets and storage key"
  deletion_window_in_days = 30
  enable_key_rotation     = true

  tags = {
    Name = "${local.name_prefix}-kms"
  }
}

resource "aws_kms_alias" "facility" {
  name          = "alias/${local.name_prefix}"
  target_key_id = aws_kms_key.facility.key_id
}
