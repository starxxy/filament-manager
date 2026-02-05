#!/bin/bash
set -e

# ==========================================
# FilamentPro 源码安装脚本 (Source Installer)
# ==========================================

echo -e "\033[36m"
echo "=========================================="
echo "    FilamentPro 源码一键安装向导"
echo "    (适用于已安装 Node.js 的环境)"
echo "=========================================="
echo -e "\033[0m"

# 1. 检查 Node.js 环境
echo -e "\033[33m[1/4] 检查运行环境...\033[0m"
if ! command -v node &> /dev/null; then
    echo -e "\033[31m[错误] 未检测到 Node.js。\033[0m"
    echo "请先安装 Node.js (v14 或更高版本): https://nodejs.org/"
    exit 1
fi

NODE_VER=$(node -v)
echo "检测到 Node.js 版本: $NODE_VER"

if ! command -v git &> /dev/null; then
    echo -e "\033[31m[错误] 未检测到 Git。\033[0m"
    echo "请先安装 Git."
    exit 1
fi

# 2. 下载源码
INSTALL_DIR="filament-manager"
echo -e "\033[33m[2/4] 下载最新源码...\033[0m"

if [ -d "$INSTALL_DIR" ]; then
    echo "目录 $INSTALL_DIR 已存在，正在更新..."
    cd "$INSTALL_DIR"
    git pull origin main
else
    git clone https://github.com/starxxy/filament-manager.git "$INSTALL_DIR"
    cd "$INSTALL_DIR"
fi

# 3. 安装依赖
echo -e "\033[33m[3/4] 安装项目依赖 (需要网络)...\033[0m"
npm install --production

# 4. 创建必要目录
echo -e "\033[33m[4/4] 初始化数据目录...\033[0m"
mkdir -p data backups

echo -e "\033[32m"
echo "=========================================="
echo "    🎉 安装完成！(Installation Complete)"
echo ""
echo "    ➡️  启动命令:"
echo "       cd $INSTALL_DIR"
echo "       npm start"
echo ""
echo "    (若需后台运行，建议安装 pm2: npm install -g pm2)"
echo "    (然后运行: pm2 start server.js --name filament-manager)"
echo "=========================================="
echo -e "\033[0m"
