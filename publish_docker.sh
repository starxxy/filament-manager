#!/bin/bash

# 配置你的 Docker Hub 用户名
# 请在运行前修改这里，或者运行: DOCKER_USER=yourname ./publish_docker.sh
DOCKER_USER=${DOCKER_USER:-"stary19"}
IMAGE_NAME="filament-manager"
TAG="latest"
VERSION=$(grep '"version":' package.json | cut -d '"' -f 4)

if [ -z "$VERSION" ]; then
    echo "Error: Could not extract version from package.json"
    exit 1
fi

echo "=== 开始构建并发布到 Docker Hub ==="
echo "目标镜像: $DOCKER_USER/$IMAGE_NAME:$TAG 和 :$VERSION"

# 1. 登录 (如果尚未登录)
echo "1. 检查登录状态..."
# docker login

# 2. 构建镜像 (使用 buildx 支持多架构，确保在群晖/树莓派/PC上都能跑)
echo "2. 开始构建镜像 (支持 amd64 和 arm64)..."
# 检查是否支持 buildx
if docker buildx version > /dev/null 2>&1; then
    # 创建构建器实例
    docker buildx create --use --name mybuilder || true
    # 构建并直接推送
    docker buildx build --platform linux/amd64,linux/arm64 \
    -t "$DOCKER_USER/$IMAGE_NAME:$TAG" \
    -t "$DOCKER_USER/$IMAGE_NAME:$VERSION" \
    --push .
else
    echo "警告: 未检测到 docker buildx，将仅构建当前架构镜像..."
    docker build -t "$DOCKER_USER/$IMAGE_NAME:$TAG" -t "$DOCKER_USER/$IMAGE_NAME:$VERSION" .
    docker push "$DOCKER_USER/$IMAGE_NAME:$TAG"
    docker push "$DOCKER_USER/$IMAGE_NAME:$VERSION"
fi

echo "=== 发布完成! ==="
echo "现在你可以把 docker-compose.release.yml 发送给用户了。"
