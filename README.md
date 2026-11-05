# web-cron

定时访问设定网址的多功能 cron 调度器。**普通站点走轻量 HTTP 请求，个别有反爬 / 需要拟真访问的站点走真实 Chromium 浏览器仿真**，按任务分别配置。

典型场景：自建代理的伪装页若 10 分钟内无人访问会被服务商暂停，纯 HTTP 保活请求被判定为脚本而无法唤醒应用，此时用浏览器模式定时访问。

技术栈：Node.js 22 + TypeScript + Fastify + Playwright + JSON 原子文件存储。
仓库：`git@github.com:xd88dx/web-cron.git` · 镜像：`ghcr.io/xd88dx/web-cron`

## 版本说明

本仓库是**最终主线**。开发过程中另有两套已冻结的旧版（Python + Flask 版、Cloudflare Worker 版），未随本仓库发布，仅保留在本地原目录 `D:\下载\Github\cronweb`。
`cron.ts` / `headers.ts` / `ui.ts` 由 Worker 版对应纯 JS 模块复制适配而来，cron 语义与请求头生成保持一致，不产生分叉实现。

## 功能

- 任务增删改、启停、立即执行、执行日志、统计面板、JSON 导出/导入
- 调度：固定间隔（每 N 分钟）或 5 段式 cron 表达式（带校验、按 `APP_TIMEZONE` 判定时区）
- 请求：GET/POST/PUT/DELETE/HEAD/PATCH、自定义请求头、请求体、超时、失败重试
- **双模式**（每个任务独立配置）：
  - `🌐 HTTP`：Node fetch + 固定真实浏览器 UA + 完整浏览器头（Accept-Language / sec-ch-ua 版本对齐 / Sec-Fetch-*）
  - `🧭 浏览器仿真`：真实 headless Chromium，执行 JS、渲染 DOM、加载子资源、跟随重定向、自动 Cookie
- **自动升级**：HTTP 模式任务开启开关后，遇 403 / 429 / 503 / 挑战页时自动用浏览器重试一次
- **自动降级**：环境无 Chromium 时，浏览器模式任务自动按 HTTP 执行并在面板与日志中标注 `已降级`
- 拟人化：UA 按任务固定（不再逐次随机）、`navigator.webdriver` 抹除、viewport/locale/timezone/dpr、每任务独立 `storageState` 持久化（跨次访问表现为回头客）、可选停留与滚动
- **身份自洽**（浏览器模式）：UA / `sec-ch-ua` / `navigator.userAgentData` 由运行时 Chromium 主版本统一派生，避免「UA 说 Chrome/141、Client Hints 说 Chromium/156」这类真实浏览器不可能出现的矛盾。详见下方「浏览器身份一致性」
- 密码保护：`PANEL_PASSWORD`（公网部署**必须设置**）

## 本地运行（纯 HTTP 模式，无需浏览器）

```bash
npm install --registry=https://registry.npmmirror.com
npm run build
npm test
PORT=8080 PANEL_PASSWORD=your-password npm start
# 打开 http://127.0.0.1:8080
```

## 启用浏览器仿真

```bash
npm install playwright@1.64.1
npx playwright install chromium      # Windows / macOS / Linux 均可
PORT=8080 npm start
```

启动后服务会在后台探测 Chromium，面板右上角显示「🧭 浏览器仿真：可用」。探测失败时自动降级，不影响 HTTP 任务。

## 部署方式一：Docker / GHCR 镜像（全功能，推荐）

官方 Playwright 镜像已含 Chromium 与系统依赖，但**不含 playwright npm 包**，且镜像 tag 必须与包版本一致（本项目 `1.64.1`），否则找不到浏览器。基础镜像已核实同时提供 `linux/amd64` 与 `linux/arm64` manifest。

**直接拉 GHCR 镜像**（由 `.github/workflows/docker-publish.yml` 自动构建）：

```bash
docker pull ghcr.io/xd88dx/web-cron:latest
docker run -d --init --ipc=host --shm-size=1g \
  -e PANEL_PASSWORD=your-password -e APP_TIMEZONE=Asia/Shanghai \
  -v $(pwd)/data:/app/data -p 8080:8080 ghcr.io/xd88dx/web-cron:latest
```

**本地构建**（仓库根目录即构建上下文）：

```bash
docker compose up -d --build
# 或手动；国内网络可指定 npm 镜像
docker build --build-arg NPM_REGISTRY=https://registry.npmmirror.com -t web-cron .
docker run -d --init --ipc=host --shm-size=1g \
  -e PANEL_PASSWORD=your-password -e APP_TIMEZONE=Asia/Shanghai \
  -v $(pwd)/data:/app/data -p 8080:8080 web-cron
```

`--init`、`--ipc=host` 是官方文档明确推荐（缺 IPC 会让 Chromium OOM 崩溃）。官方同时说明该镜像**不建议用于访问不受信任的网站**，抓取场景应改用非 root 用户：

```bash
docker run -d --init --ipc=host --shm-size=1g --user pwuser \
  --security-opt seccomp=seccomp_profile.json \
  -e PANEL_PASSWORD=... -v $(pwd)/data:/app/data -p 8080:8080 web-cron
```

`seccomp_profile.json` 见 [Playwright 官方仓库](https://github.com/microsoft/playwright/blob/main/utils/docker/seccomp_profile.json)。以非 root 运行时需保证 `/app/data` 可写。

## GHCR 自动构建工作流

`.github/workflows/docker-publish.yml`：

| 触发 | 产物 tag |
|---|---|
| push 到 `main` | `:latest`、`:main`、`:sha-<short>` |
| push `v*` tag | `:<tag>` |
| `workflow_dispatch` | 按当前 ref 打 tag |

流程：`vet`（Node 22 → `npm ci` → `npm run build` → `npm test`）通过后，`docker` job 用 Buildx + QEMU 构建 **linux/amd64 + linux/arm64** 双架构并推送到 `ghcr.io/xd88dx/web-cron`，用 GHA cache 加速。`permissions` 需 `contents: read` + `packages: write`（已配置）。

> 相对常见的 Go 版示例有两点必要差异：vet 换成 Node 工具链；**必须加 `docker/setup-qemu-action@v3`** —— Dockerfile 里有 `RUN npm ci`，在 amd64 runner 上构建 arm64 镜像若不装 QEMU 会报 `exec format error`。

## 部署方式二：免费托管（hostfree 等，自动降级）

```bash
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install --registry=https://registry.npmmirror.com
npm run build
PANEL_PASSWORD=your-password PORT=$PORT npm start
```

`playwright` 是 `optionalDependencies`，加上 `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` 后不会下载浏览器二进制；运行时探测失败即自动降级为纯 HTTP。面板会明确显示降级原因。启动命令 `npm start`（或 `node dist/index.js`），服务监听 `0.0.0.0:$PORT`。

> 免费托管的 Web 进程通常会被闲置休眠，调度器随进程停止。可给自己加一个「每 N 分钟访问自身」的 HTTP 任务做自保活。

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `8080` | 监听端口（平台自动注入时以平台为准） |
| `HOST` | `0.0.0.0` | 监听地址 |
| `PANEL_PASSWORD` | 空 | 管理密码，**公网必设**；前端用 `X-Auth` 头传递 |
| `APP_TIMEZONE` | `Asia/Shanghai` | cron 判定时区、浏览器 `timezoneId` |
| `DATA_DIR` | `./data` | 数据目录（store.json / profiles / screenshots） |
| `BROWSER_MAX_CONCURRENCY` | `2` | 浏览器任务并发上限（共享一个 Chromium 的信号量） |
| `BROWSER_IDLE_TTL` | `600` | 空闲多少秒后回收 Chromium 实例 |
| `BROWSER_CHANNEL` | `chromium` | Playwright channel；失败自动回退到默认通道 |
| `BROWSER_PROXY` | 空 | 保留（代理请按任务配置 `browser_proxy`） |
| `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD` | — | 免费托管设为 `1`，跳过浏览器下载 |

## 任务字段（浏览器相关）

| 字段 | 默认 | 说明 |
|---|---|---|
| `mode` | `http` | `http` / `browser` |
| `browser_wait_until` | `domcontentloaded` | `commit` / `domcontentloaded` / `load` / `networkidle` |
| `browser_wait_selector` | 空 | 等待出现的 CSS 选择器 |
| `browser_assert` | 空 | 成功断言：CSS 选择器 / `text:包含文本` / `js:表达式` |
| `browser_dwell_ms` | `0` | 加载后随机停留（0–30000ms）+ 轻微滚动 |
| `browser_proxy` | 空 | 任务级代理，支持 `http://` / `https://` / `socks5://` |
| `browser_ua` | 空 | 固定 UA；留空则按 `task.id` 哈希稳定分配（浏览器模式自动对齐运行时 Chromium 主版本） |
| `browser_screenshot` | `0` | 失败或遇挑战页时保存截图（可在日志中查看） |
| `http_fallback_browser` | `0` | HTTP 遇反爬信号时自动升级为浏览器重试 |

日志额外记录：`mode` / `final_url` / `page_title` / `challenge` / `degraded` / `note` / `screenshot`。

## 调度与并发

- 每 5 秒检查一次到期任务；**先占坑**：取到任务立即把 `next_run_at` 推进到下次，再异步执行，慢任务跨触发窗口也不会重复执行
- HTTP 任务在 Node 事件循环内并发；浏览器任务经共享 Chromium 的信号量限流（默认 2）
- 单进程运行。**不要起多个 worker / 多个容器副本**（会各自跑一份调度器导致重复执行）；需要多副本时须外置分布式锁
- 常驻 Chromium 约 150–300MB，每 context 约 +30–80MB；10 任务 / 每 5 分钟在 2GB 内存 VPS 上够用

## 浏览器身份一致性

真实 Chromium 会**自己生成** `sec-ch-ua` / `sec-ch-ua-mobile` / `sec-ch-ua-platform`，以及 JS 可见的
`navigator.userAgentData`。若只用 `userAgent` 覆盖 UA，就会出现「UA 写 Chrome/141、Client Hints 写
Chromium/156」——真实浏览器两者必然同版本，这是常见 bot 检测点。

本版做法（`src/headers.ts`）：

1. `browser.version()` 取运行时主版本（实测 Playwright 1.64.1 自带 Chromium `156.0.8078.4` → `156`）
2. 由该版本派生浏览器模式 UA 池（Chrome/Windows、Edge/Windows、Chrome/macOS，均 `Chrome/<ver>.0.0.0`），
   按 `task.id` 哈希固定分配给任务
3. 同一版本生成 `sec-ch-ua` 品牌串与 `sec-ch-ua-platform`，经 `extraHTTPHeaders` 覆盖 Chromium 默认值
4. 经 `addInitScript` 覆盖 `Navigator.prototype.userAgentData`（含 `getHighEntropyValues`），使 JS 视图与 wire 头一致
5. 浏览器模式 UA 池**不含 Firefox**：Firefox UA 配 Chromium 的 TLS 栈与 Client Hints 无法自洽
6. **删除而非遮蔽 `navigator.webdriver`**：真实浏览器的 `navigator` 上根本不存在该属性。早期版本用
   `Object.defineProperty(navigator,'webdriver',{get:()=>undefined})` 只是遮蔽，`'webdriver' in navigator`
   仍为 `true`，在 bot.sannysoft.com 的 `WebDriver (New)` 检测上报 `present (failed)`。现改为
   `delete Navigator.prototype.webdriver`（实测该属性 `configurable: true`），修复后该项为 `present (passed)`。

用户自定义请求头优先级最高，可覆盖任意默认头。若手动把 `browser_ua` 设为非 Chromium 系 UA（如 Firefox），
Client Hints 会被置空（Chromium 无法真正删除该头），`navigator.userAgentData` 属性也会被删除，
且 TLS 栈仍是 Chromium —— 日志 `note` 会明确标注「拟真度受限」。
**浏览器模式建议使用 Chromium 系 UA，Firefox UA 留给 HTTP 模式**。

> 已实测：默认身份、Chrome/Windows、Edge/Windows、Chrome/macOS 四种情况下，wire UA、JS UA、
> `sec-ch-ua`、`brands`、`platform`、`getHighEntropyValues().uaFullVersion` 全部指向同一版本 156，
> 且 UA 中不含 `HeadlessChrome`。bot.sannysoft.com 渲染后 `WebDriver (New)` / `WebDriver Advanced`
> 均为 passed，`Plugins` / `Permissions` / `HEADCHR_*` 检测通过。

## 验证

```bash
npm run build && npm test     # 35 项纯逻辑单测（cron / 时区 / UA / 请求头 / 浏览器身份自洽 / 挑战页判定）
```

端到端手动验证：创建 HTTP 任务 → 立即执行 → 查看日志；创建浏览器任务 → 确认 `navigator.webdriver` 被删除、Cookie 跨两次执行保留；把 `next_run_at` 改到过去触发定时链路；无 Chromium 环境确认降级路径。

**关于「HTTP 能否保活」的判据提醒**：拿到 `HTTP 200` 不等于唤醒成功。伪装页返回 200 只说明落地页可取，
服务商是否重置闲置计时器取决于请求侧指纹（TLS/HTTP2、Client Hints、子资源加载等），这些不在响应体里。
因此为需要唤醒的站点**必须选浏览器模式**，并用服务商侧的状态（代理是否可用）作为最终判据，而不是页面状态码。

公开 bot 检测站对照实测（本机网络，2026-11-05）：`bot.sannysoft.com`、`abrahamjuliot.github.io/creepjs`、
`bot.incolumitas.com`、`nowsecure.nl` 四个站点 HTTP 模式均返回 200，**未复现「HTTP 被拦 / 浏览器通过」**；
差异体现在浏览器模式的 snippet 是渲染后 DOM（含 JS 指纹结果），HTTP 模式是原始源码。
这些站点仅用于验证自身浏览器指纹，未对第三方施压。

## 已知限制与合规边界

- **不解决 CAPTCHA / Turnstile**。遇到 Cloudflare 挑战页如实判失败并在日志标记 `挑战页`，不伪造通过。浏览器仿真只是让请求表现得像真实浏览器，用于站点保活与公开 healthcheck，不应被用于规避站点防护或违反服务条款的场景。
- `storageState` 只持久化 Cookie / localStorage / IndexedDB 的 origin 数据，不等同于完整 Chrome profile（无 Service Worker 注册、无 HTTP 缓存）。
- 本版不再支持 Cloudflare Workers / D1；Cloudflare 免费托管的纯 HTTP 方案属于已冻结的旧版，未随本仓库发布。
- 旧 Python 版 SQLite 数据可先用其 `/api/export` 导出 JSON，再用本版「导入备份」迁移。
