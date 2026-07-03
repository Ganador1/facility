#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AWS_REGION="${AWS_REGION:-us-east-1}"
IMAGE_TAG="${IMAGE_TAG:-$(git -C "$ROOT_DIR" rev-parse --short HEAD 2>/dev/null || echo latest)}"
PLATFORM="${PLATFORM:-linux/amd64}"

: "${AWS_ACCOUNT_ID:=$(aws sts get-caller-identity --query Account --output text)}"
: "${ECR_REGISTRY:=${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com}"
: "${ECR_PREFIX:=facility-playground}"

API_DOCKERFILE="${API_DOCKERFILE:-Dockerfile}"
WORKER_DOCKERFILE="${WORKER_DOCKERFILE:-$API_DOCKERFILE}"
GATEWAY_DOCKERFILE="${GATEWAY_DOCKERFILE:-services/gateway/Dockerfile}"
WEB_DOCKERFILE="${WEB_DOCKERFILE:-apps/web/Dockerfile}"
RUNNER_DOCKERFILE="${RUNNER_DOCKERFILE:-runner/Dockerfile}"

login() {
  aws ecr get-login-password --region "$AWS_REGION" |
    docker login --username AWS --password-stdin "$ECR_REGISTRY"
}

build_and_push() {
  local name="$1"
  local dockerfile="$2"
  local repository="${ECR_REGISTRY}/${ECR_PREFIX}/${name}"
  local image="${repository}:${IMAGE_TAG}"

  if [[ ! -f "$ROOT_DIR/$dockerfile" ]]; then
    printf 'Missing Dockerfile for %s: %s\n' "$name" "$dockerfile" >&2
    printf 'Set %s_DOCKERFILE to the correct path or build this image separately.\n' "${name^^}" >&2
    exit 1
  fi

  docker build --platform "$PLATFORM" -f "$ROOT_DIR/$dockerfile" -t "$image" "$ROOT_DIR"
  docker push "$image"
  printf '%s=%s\n' "$name" "$image"
}

login
build_and_push api "$API_DOCKERFILE"
build_and_push worker "$WORKER_DOCKERFILE"
build_and_push gateway "$GATEWAY_DOCKERFILE"
build_and_push web "$WEB_DOCKERFILE"
build_and_push runner "$RUNNER_DOCKERFILE"
