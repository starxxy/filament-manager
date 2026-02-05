# FilamentPro - 智能3D打印耗材管理系统

FilamentPro 是一款专为 3D 打印爱好者打造的轻量级、现代化的耗材库存管理系统。它支持多设备同步、AI 拍照识别耗材、以及全功能的库存追踪。

![FilamentPro Banner](https://via.placeholder.com/800x200?text=FilamentPro+Manager)

> **当前版本**: v1.0.9

## ✨ 核心功能

*   📱 **多端同步**: 手机、平板、电脑数据实时互通，无需手动刷新。
*   📷 **AI 识别**: 拍照即可通过 AI 识别耗材品牌、颜色和类型（支持本地/云端模型）。
*   🔖 **二维码管理**: (规划中) 为每一卷耗材生成唯一二维码，扫码出库。
*   📊 **数据可视化**: 直观展示库存状态、剩余量和分类统计。
*   🛡️ **自动备份**: 支持数据库自动定时备份与系统升级，数据更安全。
*   🚀 **极速部署**: 提供 Docker 镜像，一键启动。

---

## 📸 界面预览

| 耗材列表 (暗色模式) | 详情编辑 | 添加耗材 (AI) |
| :---: | :---: | :---: |
| ![List View](https://via.placeholder.com/300x600?text=List+View) | ![Edit View](https://via.placeholder.com/300x600?text=Edit+View) | ![AI Camera](https://via.placeholder.com/300x600?text=AI+Camera) |

*(注：请在部署后截图替换上述占位图)*

---

## 🛠️ 安装教程 (Installation)

### 方式一：一键安装 (One-Click) ⚡️

只需执行一条命令即可自动配置并启动服务 (基于 Docker)。

```bash
curl -O https://raw.githubusercontent.com/starxxy/filament-manager/main/install.sh && chmod +x install.sh && ./install.sh
```

---

### 方式二：手动 Docker 安装 🐳
```bash
docker pull stary19/filament-manager:latest
```

**2. 启动容器**
```bash
docker run -d \
  --name filament-manager \
  --restart always \
  -p 3000:3000 \
  -v $(pwd)/data:/app/data \
  stary19/filament-manager:latest
```

*   **端口**: 默认映射到 `3000` 端口。
*   **数据持久化**: 数据将保存在当前目录下的 `data` 文件夹中。

---

### 方式二：手动安装 (源码部署) 📦

适用于开发者或不支持 Docker 的环境。

**1. 环境要求**
*   Node.js v14+
*   NPM 或 Yarn

**2. 下载与运行**
```bash
# 克隆仓库
git clone https://github.com/starxxy/filament-manager.git
cd filament-manager

# 安装依赖
npm install

# 启动服务
npm start
```
访问 `http://localhost:3000` 即可使用。

---

## 🔄 系统升级

### Docker 升级
```bash
docker pull stary19/filament-manager:latest
docker stop filament-manager
docker rm filament-manager
# 重新运行启动命令(参考上方)
```

### 网页升级 (Web UI)
在软件界面中：
1.  点击右上角 **系统设置**。
2.  在 **系统升级** 卡片中，上传最新的 `Upgrade.tar.gz` 升级包。
3.  系统将自动解压并重启服务。

---

## 🤝 加入社区

欢迎加入我们的 3D 打印交流社区，反馈 Bug 或提出新功能建议！

| Bilibili | 抖音 | GitHub |
| :---: | :---: | :---: |
| [在下徐胖胖](https://space.bilibili.com/50622066) | [在下徐胖胖](https://v.douyin.com/iP6e1y3F/) | [Starxxy](https://github.com/starxxy/filament-manager) |

*(扫描软件内的二维码或点击链接直达)*

---

**License**: MIT
**Author**: [Starxxy](https://github.com/starxxy)
