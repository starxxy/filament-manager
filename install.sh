#!/bin/bash
set -e

# ==========================================
# FilamentPro 一键安装脚本 (One-Click Installer)
# ==========================================

echo -e "\033[36m"
echo "=========================================="
echo "    FilamentPro 智能耗材管理系统安装向导"
echo "=========================================="
echo -e "\033[0m"

# 1. 检查 Docker 环境
if ! command -v docker &> /dev/null; then
    echo -e "\033[31m[错误] 未检测到 Docker 环境。\033[0m"
    echo "请先安装 Docker: https://docs.docker.com/get-docker/"
    exit 1
fi

# 2. 准备安装目录
INSTALL_DIR="$(pwd)/filament_data"
echo -e "\033[33m[1/3] 准备数据目录...\033[0m"
if [ ! -d "$INSTALL_DIR" ]; then
    mkdir -p "$INSTALL_DIR"
    echo "已创建数据目录: $INSTALL_DIR"
else
    echo "使用现有目录: $INSTALL_DIR"
fi

# 3. 拉取最新镜像
echo -e "\033[33m[2/3] 拉取最新镜像 (stary19/filament-manager)...\033[0m"
docker pull stary19/filament-manager:latest

# 4. 停止旧容器 (如有)
if [ "$(docker ps -aq -f name=filament-manager)" ]; then
    echo "检测到旧容器，正在停止并移除..."
    docker stop filament-manager >/dev/null 2>&1 || true
    docker rm filament-manager >/dev/null 2>&1 || true
fi

# 5. 启动服务
echo -e "\033[33m[3/3] 正在启动服务...\033[0m"
docker run -d \
  --name filament-manager \
  --restart always \
  -p 3000:3000 \
  -v "$INSTALL_DIR":/app/data \
  stary19/filament-manager:latest

echo -e "\033[32m"
echo "=========================================="
echo "    🎉 安装成功！(Installation Complete)"
echo ""
echo "    🏠 访问地址: http://localhost:3000"
echo "    📂 数据目录: $INSTALL_DIR"
echo "=========================================="
echo -e "\033[0m"
