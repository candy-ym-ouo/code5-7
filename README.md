# 山海植物志

四季山林植物观察游戏。React 客户端负责地图、观察笔记、采集交互和年度报告，Node.js 服务端负责环境生成、生态演化、持久化和全部权威判定。

## 已实现闭环

- 创建匿名观察档案并持久化到 SQLite
- 四区域、四季、十日制探索与每日行动点
- 植物物候、叶片纹理、主色和环境数据记录
- 拍照、拓印、落叶采集、标准剪取及安全上限
- 错误采集对健康、种群、种子库、区域干扰和下一年度状态的持续影响
- 季节结算、年度报告、分布变化、物候偏移和生态修复
- 越冬迁移走廊、极端冬季气候（寒潮、暴雪、暖冬、冬旱）与种群—种子库—承载力联动结算
- 观察笔记、物种档案、事件时间线、存档导出与恢复
- 幂等命令、乐观并发版本控制和自动化闭环测试

模拟全部由存档种子和年份确定性派生：同一颗种子在任意年份重算都会得到相同的环境、冬季气候与跨年扩散结果；`species_states`、`site_states` 按 `(存档, 年份, …)` 主键分年保存，进入新一年只写入新年份的行，历史年度状态不会被后一年覆盖。

## 环境要求

- Node.js 22.13 或更高版本
- pnpm 10 或 npm 10 或更高版本

项目使用 Node.js 内置 SQLite，不需要额外安装数据库服务。

## 启动

```bash
pnpm install
cp .env.example .env
pnpm db:init
pnpm dev
```


浏览器访问 `http://127.0.0.1:5173`。API 默认运行在 `http://127.0.0.1:8787`，Vite 会代理 `/api`。

## 验证

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
pnpm start
```

`pnpm test:e2e` 会先构建生产包，再启动真实 HTTP 服务，完成“创建档案 → 观察 → 错误采集 → 四季结算 → 年度报告 → 第二年”的闭环，并在结束后清理临时数据库。

## 生产启动

```bash
pnpm build
pnpm start
```

生产模式由 Node.js 同时提供 `/api` 和 `apps/web/dist` 静态资源。请在生产环境设置安全的 `SESSION_SECRET`、正确的 `APP_ORIGIN`，并将 `DATABASE_URL` 指向持久化磁盘。

## 目录

```text
apps/web                 React 客户端
apps/server              Node.js API、SQLite 与游戏服务
packages/contracts       前后端共享命令、类型和校验
packages/game-core       物种目录、环境生成和生态模拟
data/runtime             本地 SQLite 文件
tests                    真实 HTTP 闭环脚本
```

## 数据说明

物种、区域和演化参数是完整的游戏内容配置，不是界面演示数据。模拟结果用于游戏机制，不用于现实科研或生态预测。
