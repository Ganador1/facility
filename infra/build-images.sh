#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AWS_REGION="${AWS_REGION:-us-east-1}"
IMAGE_TAG="${IMAGE_TAG:-$(git -C "$ROOT_DIR" rev-parse --short HEAD 2>/dev/null || echo latest)}"
CPU_ARCHITECTURE="${CPU_ARCHITECTURE:-X86_64}"

case "$CPU_ARCHITECTURE" in
  X86_64) expected_platform="linux/amd64" ;;
  ARM64) expected_platform="linux/arm64" ;;
  *)
    printf 'CPU_ARCHITECTURE must be X86_64 or ARM64 (received %s)\n' "$CPU_ARCHITECTURE" >&2
    exit 1
    ;;
esac

PLATFORM="${PLATFORM:-$expected_platform}"
if [[ "$PLATFORM" != "$expected_platform" ]]; then
  printf 'PLATFORM=%s does not match CPU_ARCHITECTURE=%s (expected %s)\n' \
    "$PLATFORM" "$CPU_ARCHITECTURE" "$expected_platform" >&2
  exit 1
fi

: "${AWS_ACCOUNT_ID:=$(aws sts get-caller-identity --query Account --output text)}"
: "${ECR_REGISTRY:=${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com}"
: "${ECR_PREFIX:=facility-playground}"

login() {
  aws ecr get-login-password --region "$AWS_REGION" |
    docker login --username AWS --password-stdin "$ECR_REGISTRY"
}

: "${FACILITY_API_URL:?FACILITY_API_URL is required to build the web image}"

BAKE_FILE="$ROOT_DIR/infra/docker-bake.hcl"
if [[ ! -f "$BAKE_FILE" ]]; then
  printf 'Missing Facility image build definition: %s\n' "$BAKE_FILE" >&2
  exit 1
fi
if ! docker buildx version >/dev/null 2>&1; then
  printf '%s\n' 'Docker Buildx is required. Install the buildx plugin and retry.' >&2
  exit 1
fi

export ECR_REGISTRY ECR_PREFIX IMAGE_TAG PLATFORM FACILITY_API_URL

login

# Bake runs independent targets concurrently and shares the root Dockerfile's
# dependency graph. The API target has both api and worker tags because those
# ECS services run the same bytes with different commands.
(
  # Bake automatically reads a .env from its working directory. Run from the
  # env-free infra directory so application secrets are neither parsed nor
  # forwarded into the build definition.
  cd "$ROOT_DIR/infra"
  docker buildx bake --allow=fs.read=.. --file "$BAKE_FILE" --push
)

# Preserve the script's stable machine-readable output contract.
for name in api worker gateway mcp web runner; do
  printf '%s=%s/%s/%s:%s\n' "$name" "$ECR_REGISTRY" "$ECR_PREFIX" "$name" "$IMAGE_TAG"
done
