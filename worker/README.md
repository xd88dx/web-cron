# web-cron · Cloudflare Worker 版

定时访问设定网址的调度器，运行在 Cloudflare Workers + D1 + Cron Triggers 上，无需服务器。
**本目录是仓库根目录完整版（Node 主线）的功能阉割版**：只保留纯 HTTP 保活，砍掉浏览器仿真相关能力。

## 与完整版的功能边界

| 能力 | 完整版（Node 主线，仓库根目录） | Worker 版（本目录） |
|---|---|---|
| 访问方式 | HTTP + 真实 Chromium 浏览器仿真 | **仅 HTTP**（Workers `fetch`） |
| 浏览器身份一致性（Client Hints / `navigator.webdriver`） | 有 | 无（Worker 运行时没有浏览器） |
| HTTP 失败自动升级为浏览器重试 | 有 | 无 |
| 截图、挑战页检测、降级标记 | 有 | 无 |
| 任务级固定 UA、并发信号量 | 有 | 无（每次请求随机 UA） |
| 任务 CRUD、启停、立即执行、间隔 / cron、失败重试 | 有 | 有 |
| 执行历史（200 条/任务）、24h 统计、导出导入、密码保护 | 有 | 有 |
| 调度粒度 | 5 秒 tick | Cron Trigger **1 分钟** |
| 存储 | JSON 原子文件 | Cloudflare **D1** |
| 认证 | `X-Auth` 请求头 | `X-Auth` 请求头 |

> **前提说明**：三版是**各自独立的实现**，不是同一份代码按开关裁剪。Worker 运行时没有文件系统、Node API 与 Chromium，必须单独一套 JS + D1；面板 HTML 与调度逻辑也各自维护。因此「阉割」只在**功能范围**上成立：改完整版不会自动同步到本目录。导出的 JSON 备份三版可互相导入（导入只校验 `tasks` 字段）。

## 部署步骤

```bash
cd worker
npm install                       # 或 npm i -g wrangler（本机已有可跳过）
npx wrangler login
npx wrangler d1 create web-cron    # 复制输出里的 database_id 填入 wrangler.toml
npx wrangler d1 execute web-cron --remote --file=schema.sql
npx wrangler secret put PANEL_PASSWORD   # 管理密码，务必设置
npx wrangler deploy
```

部署完成后打开 `https://web-cron.<你的子域>.workers.dev`，输入密码即可。

## 本地开发 / 测试

```bash
cd worker
npm test                                   # 纯逻辑单测（cron 解析、时区、拟人化头）
npx wrangler deploy --dry-run --outdir dist # 仅构建校验，不需要登录/联网
npx wrangler d1 execute web-cron --local --file=schema.sql
npx wrangler dev --local --test-scheduled --port 8799
# 触发一次 cron（本地 dev 时）：
curl --noproxy '*' "http://127.0.0.1:8799/cdn-cgi/handler/scheduled?cron=*+*+*+*+*"
```

本机若存在 HTTP 代理，本地请求务必加 `NO_PROXY=127.0.0.1,localhost` 或 `--noproxy '*'`。
8787 端口常被本机其他服务占用，换端口即可。

## 环境变量 / Secrets

| 名称 | 类型 | 说明 |
|---|---|---|
| `PANEL_PASSWORD` | secret | 管理面板密码；不设置则面板对外无认证（不推荐） |
| `APP_TIMEZONE` | var | cron 表达式判定时区。本仓库 `wrangler.toml` 已设为 `Asia/Shanghai`；**只有删掉该 var 时**，代码才兜底为 `UTC` |
| `DB` | D1 binding | 任务与历史数据，见 `wrangler.toml` |

## 功能清单

- 任务增删改、启动/暂停、立即执行
- 固定间隔（每 N 分钟）/ 5 段式 cron 表达式（支持 `*`、`*/n`、`a-b`、`a-b/n`、逗号列表；按设置时区判定）
- 随机加时：每任务可设 0~N 分钟，每次触发前随机取值累加到固定触发时间（间隔与 Cron 均生效）
- GET/POST/PUT/DELETE/HEAD/PATCH、自定义请求头（可覆盖默认浏览器头）、请求体、超时、失败重试
- 浏览器拟人化：随机真实 UA 池 + 完整浏览器头（`sec-ch-ua` 版本与 UA 一致、`Sec-Fetch-*`、`Accept-Language` 等）
- 执行日志（状态码 / 耗时 / 错误 / 响应片段，每任务保留 200 条）、24h 成功率统计
- JSON 导出 / 导入备份
- Gist 同步：把任务配置备份到 GitHub 私密 Gist / 从 Gist 恢复（Token 与 Gist ID 存 D1 `settings` 表；只同步任务配置，不同步执行历史）
- Gist 自动同步：可选开启，任务变化后立即检查 + Cron Trigger 兜底；三方对比（本地 / Gist / 基线）决定自动推送、自动拉取或冲突跳过告警，多机轮换时不会把过时配置推上去覆盖新修改

## 已知限制

- Cron Trigger 最小粒度 1 分钟，任务最小间隔为 1 分钟；「每 30 秒」这类需求无法在免费 Worker 上实现。极低频 cron（如每年一次）采用「每天重算」兜底，最终仍会命中。
- `runDue()` 在执行 HTTP **之前**先推进 `next_run_at`（先占坑），可降低任务耗时接近 1 分钟时被下一个 Cron Trigger 重复捞起的概率；但 Workers 允许 scheduled 事件并发，**极端情况下仍可能重复执行一次**。建议 `timeout_seconds` 设在 50 以内，且目标站点能容忍偶发重复访问。
- D1 免费额度、Workers 请求数 / CPU 时间限额以 Cloudflare 当期套餐为准。

## API

与完整版路径一致：`GET/POST /api/tasks`、`PUT/DELETE /api/tasks/<id>`、
`POST /api/tasks/<id>/toggle`、`POST /api/tasks/<id>/run`、
`GET /api/tasks/<id>/history`、`GET /api/export`、`POST /api/import`、`POST /api/login`、
`GET/PUT /api/gist`（Gist 同步配置）、`POST /api/gist/push`、`POST /api/gist/pull`。
除 `/api/login` 外，设置密码后所有 `/api/*` 需带 `X-Auth: <密码>`。

## 文件

```
worker/
  src/index.js     Worker 入口：API、D1 CRUD、执行与调度
  src/cron.js      cron 解析 / 时区 / 下次执行时间（纯函数，可单测）
  src/headers.js   拟人化浏览器请求头（纯函数）
  src/ui.js        内嵌管理面板 HTML
  schema.sql       D1 建表
  wrangler.toml    Cron Trigger、D1 绑定、时区
  test/unit.mjs    纯逻辑单测
```
