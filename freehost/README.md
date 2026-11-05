# web-cron · 免费托管 / 翼龙面板版（Python）

定时访问（HTTP 请求）设定的网址，带 Web 管理面板。Python + Flask + APScheduler + SQLite。
**本目录是仓库根目录完整版（Node 主线）的功能阉割版**：只保留纯 HTTP 保活，无浏览器仿真。
适用于 hostfree 一类免费托管，以及翼龙面板（Pterodactyl）等只能跑常驻进程、不能跑 Docker / Chromium 的环境。

## 与完整版的功能边界

| 能力 | 完整版（Node 主线，仓库根目录） | 本版 |
|---|---|---|
| 访问方式 | HTTP + 真实 Chromium 浏览器仿真 | **仅 HTTP** |
| 浏览器身份一致性、HTTP→浏览器自动升级、截图、挑战页检测 | 有 | 无 |
| 拟真请求头（UA 池 / `sec-ch-ua` / `Sec-Fetch-*` / gzip 解压） | 有 | 有 |
| 任务 CRUD、启停、立即执行、间隔 / cron、失败重试、历史、统计、导出导入、密码保护 | 有 | 有 |
| 存储 | JSON 原子文件 | SQLite（`web-cron.db`） |
| 认证 | `X-Auth` 请求头 | Flask session |
| 调度 | 5 秒 tick | APScheduler 常驻进程 |

> **前提说明**：三版是各自独立的实现，不是同一份代码按开关裁剪；「阉割」只在**功能范围**上成立。导出的 JSON 备份三版可互相导入（导入只校验 `tasks` 字段）。

## 功能

- 任务管理：新增 / 编辑 / 删除 / 启动 / 暂停
- 调度方式：固定间隔（每 N 分钟）或 5 段式 cron 表达式
- 请求配置：GET/POST/PUT/DELETE/HEAD/PATCH、自定义请求头、请求体、超时、失败重试
- 浏览器拟人化：每次请求从真实浏览器 UA 池随机选取，并附带完整浏览器请求头（Accept / Accept-Language / Accept-Encoding / Sec-Fetch-* / sec-ch-ua 等，版本号与 UA 保持一致），降低被目标站 WAF 识别为脚本的概率；自定义请求头可覆盖任意默认头
- 立即执行：手动触发一次并返回结果
- 执行日志：状态码、耗时、错误信息、响应片段（每任务保留最近 200 条）
- 统计面板：任务数、运行中、24h 成功率、24h 执行次数
- 数据备份：导出 / 导入 JSON
- 访问保护：设置 `PANEL_PASSWORD` 后需要密码登录（公网托管务必设置）

## 本地运行

```bash
pip install -r requirements.txt
python app.py
# 打开 http://127.0.0.1:5000
```

本机 5000 端口可能被 Docker Desktop 的端口转发占用，可改用 `PORT=5010 python app.py`。

## 部署到 hostfree 等免费托管

1. 上传本目录（或推送到 Git 仓库由平台拉取）
2. 平台选择 Python / Web 应用类型，启动命令 `python app.py`（或直接识别 Procfile）
3. 依赖自动安装 `requirements.txt`（flask、apscheduler）
4. 在环境变量中设置：
   - `PANEL_PASSWORD`：管理密码（**必须**，否则面板对外裸奔）
   - `SECRET_KEY`：随机字符串（设置密码后建议配置，否则重启后需重新登录）
   - `APP_TIMEZONE`（可选）：如 `Asia/Shanghai`，不设则用服务器时区（很多免费平台是 UTC，影响 cron 表达式的「几点执行」）
5. 服务监听 `0.0.0.0:$PORT`，端口由平台自动注入

## 部署到翼龙面板（Pterodactyl）

翼龙面板用 **egg** 定义服务类型与启动命令。本版只需要「能跑 Python 3 且能装 pip 依赖」的通用 egg（如 Generic Python / Python 3 通用模板），**不需要** Docker 构建权限。

1. 新建实例，分配端口（面板会显示分配的端口号）。
2. 通过面板文件管理器或 SFTP 把本目录全部文件上传到容器工作目录（常见为 `/home/container`）。
3. 安装依赖：在面板控制台执行一次 `pip install -r requirements.txt`（无写权限时加 `--user`），或写进 egg 的 install 脚本。部分 egg 首次启动会自动安装，**以你所用面板/egg 的实际配置为准**。
4. 启动命令（Startup Command）：
   ```bash
   python app.py
   ```
   进程必须前台常驻，`app.run(host="0.0.0.0", ...)` 已满足。**不要**用 `gunicorn -w N` 多 worker，否则调度器会起多份、任务重复执行。
5. **端口变量**：`app.py` 只读 `PORT` 环境变量（默认 `5000`）。翼龙面板分配的端口未必注入为 `PORT`（不同 egg 变量名不同，常见 `SERVER_PORT`）。请在面板「环境变量」页按实际 egg 补一条映射，例如 `PORT` = `{{SERVER_PORT}}`，或直接在启动命令里写 `PORT=<面板端口> python app.py`。
   > 变量名与插值语法由你所用 egg / 面板版本决定，请按面板实际配置核对，不要照抄。
6. 环境变量：

   | 名称 | 说明 |
   |---|---|
   | `PANEL_PASSWORD` | 管理密码，**公网部署务必设置** |
   | `SECRET_KEY` | Flask session 密钥，随机字符串；不设则每次重启后需重新登录 |
   | `APP_TIMEZONE` | 可选，如 `Asia/Shanghai`；不设用服务器时区（多为 UTC，影响 cron「几点执行」） |
   | `PORT` | 监听端口，见上一步 |
   | `WEB_CRON_USE_ENV_PROXY` | 可选，`1` 表示 HTTP 出站走系统代理环境变量；默认直连 |

7. **持久化**：SQLite 数据库为工作目录下的 `web-cron.db`。翼龙面板的容器目录通常随实例保留，但**重装 / 重建服务器会清空**。请定期用面板「导出备份」保存任务配置，或把数据库文件放到挂载的持久卷。
8. 面板实例是常驻进程、通常不会因闲置休眠；但进程重启期间调度器会暂停，可加一个「每 5 分钟访问自身」的 HTTP 任务做保活。

> 从旧 CronWeb 版迁移：旧版数据库文件名为 `cronweb.db`，如需沿用数据请改名为 `web-cron.db`（表结构相同）。旧环境变量 `CRONWEB_USE_ENV_PROXY=1` 仍兼容。

## 注意事项

- 调度器运行在 Web 进程内，需保证**单进程单 worker**（`python app.py` 即单进程多线程）。
- 多数免费托管会休眠闲置应用，休眠期间定时任务不会执行；可用自保活任务缓解。
- 默认 HTTP 请求**不走系统代理**；如需走代理，设置 `WEB_CRON_USE_ENV_PROXY=1`。
- 数据库文件 `web-cron.db` 与 `__pycache__/` 已在 `.gitignore` 中忽略。

## API 一览

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/tasks` | 任务列表 + 统计 |
| POST | `/api/tasks` | 新建任务 |
| PUT | `/api/tasks/<id>` | 编辑任务 |
| DELETE | `/api/tasks/<id>` | 删除任务 |
| POST | `/api/tasks/<id>/toggle` | 启动/暂停 |
| POST | `/api/tasks/<id>/run` | 立即执行一次 |
| GET | `/api/tasks/<id>/history` | 执行日志（最近 50 条） |
| GET | `/api/export` | 导出备份 JSON |
| POST | `/api/import` | 导入备份 JSON |
