# @ginkgolab/cli

Ginkgo 智能体应用平台官方命令行工具与开箱即用独立分发包。

## 安装与快速启动

### 方式 1：免安装直接启动（推荐）
```bash
npx @ginkgolab/cli
```

### 方式 2：全局安装常驻使用
```bash
npm install -g @ginkgolab/cli
```

安装完成后在任何终端窗口直接运行：
```bash
ginkgo
```
服务启动后会自动打开浏览器并导航至 `http://localhost:3006`。

---

## 常用命令与选项

```bash
# 指定端口启动
ginkgo start -p 8080

# 监听地址（默认 localhost，仅本机可访问；局域网/容器内访问用 0.0.0.0）
ginkgo start -H 0.0.0.0
# 等价的环境变量写法：GINKGO_HOST=0.0.0.0 ginkgo
# 注意：监听地址不会继承系统的 HOSTNAME 环境变量（Docker 等场景会把
# HOSTNAME 设为容器 id，用它做绑定地址会启动失败），只认上述显式来源。

# 无头模式（服务器/后台运行，不自动唤起浏览器）
ginkgo start --no-open

# 指定数据与配置存储目录（默认存放在 ~/.ginkgo）
ginkgo start --home /data/ginkgo-storage

# 查看存储目录与状态
ginkgo config

# 查看当前版本
ginkgo version
```

---

## 数据持久化说明

Ginkgo CLI 服务启动后，所有用户配置、数据源连接、会话历史、看板记录以及插件扩展均持久化在用户本地主目录：
- 默认目录：`~/.ginkgo`（支持通过 `GINKGO_HOME` 环境变量或 `--home` 命令行参数覆盖）；
- 升级 `@ginkgolab/cli` 版本**完全不会丢失或覆盖既有数据**。

## 许可证

MIT License. Copyright (c) 2026 Ginkgo contributors.
