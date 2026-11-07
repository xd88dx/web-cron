#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
web-cron - 多功能 Cron 定时任务调度器（定时访问设定的网址）
技术栈: Flask + APScheduler + SQLite，无其他重依赖，适合免费托管平台部署。

环境变量:
  PANEL_PASSWORD          管理面板密码（公网托管务必设置；留空则免登录）
  SECRET_KEY              Flask session 密钥（设置了密码时建议修改）
  PORT                    监听端口（托管平台自动注入；本地默认 5000）
  APP_TIMEZONE            调度时区，如 Asia/Shanghai（默认用服务器本地时区）
  WEB_CRON_USE_ENV_PROXY  =1 时 HTTP 请求走系统代理环境变量；默认直连
                          （旧名 CRONWEB_USE_ENV_PROXY 仍兼容）
"""
import gzip
import json
import os
import random
import sqlite3
import time
import zlib
from contextlib import closing
from datetime import datetime, timedelta

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger
from flask import Flask, jsonify, render_template, request, session
from urllib import request as urlrequest
from urllib.error import HTTPError, URLError

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "web-cron.db")
PANEL_PASSWORD = os.environ.get("PANEL_PASSWORD", "").strip()
APP_TIMEZONE = os.environ.get("APP_TIMEZONE", "").strip() or None
USE_ENV_PROXY = (
    os.environ.get("WEB_CRON_USE_ENV_PROXY", os.environ.get("CRONWEB_USE_ENV_PROXY", ""))
    .strip() == "1"
)
HISTORY_KEEP = 200  # 每个任务保留的历史条数

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", "web-cron-please-change-this-secret")

# urllib 默认会读取 http_proxy 环境变量，免费托管/本地代理环境下容易截胡请求，默认禁用
_opener = urlrequest.build_opener() if USE_ENV_PROXY else urlrequest.build_opener(
    urlrequest.ProxyHandler({})
)

# --------------------------------------------------------------------------- DB


def db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def init_db():
    with closing(db()) as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS tasks(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                url TEXT NOT NULL,
                method TEXT NOT NULL DEFAULT 'GET',
                headers TEXT NOT NULL DEFAULT '',
                body TEXT NOT NULL DEFAULT '',
                schedule_type TEXT NOT NULL DEFAULT 'interval',
                interval_minutes INTEGER,
                cron_expr TEXT,
                jitter_minutes INTEGER NOT NULL DEFAULT 0,
                timeout_seconds INTEGER NOT NULL DEFAULT 30,
                retries INTEGER NOT NULL DEFAULT 0,
                enabled INTEGER NOT NULL DEFAULT 1,
                created_at TEXT,
                updated_at TEXT,
                last_run_at TEXT,
                last_ok INTEGER,
                last_status_code INTEGER,
                last_duration_ms INTEGER,
                last_error TEXT,
                success_count INTEGER NOT NULL DEFAULT 0,
                fail_count INTEGER NOT NULL DEFAULT 0,
                sort_order INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS history(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                task_id INTEGER NOT NULL,
                task_name TEXT,
                run_at TEXT,
                ok INTEGER,
                status_code INTEGER,
                duration_ms INTEGER,
                error TEXT,
                snippet TEXT
            );
            CREATE TABLE IF NOT EXISTS settings(
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_history_task ON history(task_id, id DESC);
            """
        )
        # 旧库平滑迁移：tasks 缺列时自动补上（新库由建表语句直接包含）
        cols = [r["name"] for r in conn.execute("PRAGMA table_info(tasks)")]
        if "sort_order" not in cols:
            conn.execute("ALTER TABLE tasks ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0")
            app.logger.info("已迁移：tasks 表新增 sort_order 列")
        if "jitter_minutes" not in cols:
            conn.execute("ALTER TABLE tasks ADD COLUMN jitter_minutes INTEGER NOT NULL DEFAULT 0")
            app.logger.info("已迁移：tasks 表新增 jitter_minutes 列")
        conn.commit()


def now_str():
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


# ----------------------------------------------------------------------- 调度器

scheduler = BackgroundScheduler(timezone=APP_TIMEZONE)


def schedule_task(row):
    """按任务配置注册/更新 APScheduler 任务"""
    job_id = "task_%s" % row["id"]
    # 随机加时：APScheduler 的 jitter 在每次计算下次触发时间时，于 [0, jitter] 秒内
    # 取随机值累加到固定触发时间上（BaseTrigger._apply_jitter / uniform(0, jitter)），
    # 与完整版 computeNextRun 的「0~N 分钟随机加时」语义一致。
    jitter = int(row["jitter_minutes"] or 0) * 60
    if row["schedule_type"] == "cron":
        trigger = CronTrigger.from_crontab(row["cron_expr"], timezone=APP_TIMEZONE)
        if jitter:
            trigger.jitter = jitter  # from_crontab 不收 jitter，按其内部字段名补上
    else:
        trigger = IntervalTrigger(
            minutes=int(row["interval_minutes"]), timezone=APP_TIMEZONE, jitter=jitter
        )
    scheduler.add_job(
        execute_task,
        trigger,
        args=[row["id"]],
        id=job_id,
        replace_existing=True,
        max_instances=1,
        coalesce=True,
        misfire_grace_time=120,
    )


def unschedule_task(task_id):
    try:
        scheduler.remove_job("task_%s" % task_id)
    except Exception:
        pass


def next_run_str(task_id):
    try:
        job = scheduler.get_job("task_%s" % task_id)
        if job and job.next_run_time:
            return job.next_run_time.strftime("%Y-%m-%d %H:%M:%S")
    except Exception:
        pass
    return None


# --------------------------------------------------------------------- HTTP 执行

# 真实浏览器 UA 池：每次请求随机挑选，避免固定的 Python-urllib UA 被 WAF 直接拒绝
BROWSER_UAS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0",
]


def browser_headers(method):
    """构造一组贴近真实浏览器的请求头；用户自定义头可覆盖其中任意一项"""
    ua = random.choice(BROWSER_UAS)
    headers = {
        "User-Agent": ua,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,"
                  "image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "Accept-Encoding": "gzip, deflate",
        "Connection": "keep-alive",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
    }
    is_firefox = "Firefox" in ua and "Chrome" not in ua
    if not is_firefox:
        # Chromium 系才带 Client Hints，版本号与 UA 保持一致
        import re
        ver_m = re.search(r"Chrome/(\d+)", ua)
        ver = ver_m.group(1) if ver_m else "141"
        edge = " Edg/" in ua
        mac = "Macintosh" in ua
        brands = ['"Not?A_Brand";v=8', '"Chromium";v=%s' % ver]
        if edge:
            brands.insert(1, '"Microsoft Edge";v=%s' % ver)
        else:
            brands.insert(1, '"Google Chrome";v=%s' % ver)
        headers["sec-ch-ua"] = ", ".join(brands)
        headers["sec-ch-ua-mobile"] = "?0"
        headers["sec-ch-ua-platform"] = '"macOS"' if mac else '"Windows"'
        if method in ("GET", "HEAD"):
            headers["Sec-Fetch-Dest"] = "document"
            headers["Sec-Fetch-Mode"] = "navigate"
            headers["Sec-Fetch-Site"] = "none"
            headers["Sec-Fetch-User"] = "?1"
    if method in ("GET", "HEAD"):
        headers["Upgrade-Insecure-Requests"] = "1"
    return headers


def parse_headers(text):
    """支持 JSON 对象或每行 `Key: Value` 两种写法"""
    text = (text or "").strip()
    if not text:
        return {}
    if text.startswith("{"):
        try:
            return {str(k): str(v) for k, v in json.loads(text).items()}
        except Exception:
            return {}
    headers = {}
    for line in text.splitlines():
        if ":" in line:
            k, v = line.split(":", 1)
            if k.strip():
                headers[k.strip()] = v.strip()
    return headers


def do_http(task):
    """执行一次 HTTP 请求，返回 (ok, status_code, duration_ms, error, snippet)"""
    headers = browser_headers((task["method"] or "GET").upper())
    headers.update(parse_headers(task["headers"]))  # 用户自定义头优先
    method = (task["method"] or "GET").upper()
    data = None
    if method != "GET" and task["body"]:
        data = task["body"].encode("utf-8")
        headers.setdefault("Content-Type", "application/json")
    req = urlrequest.Request(task["url"], data=data, method=method, headers=headers)
    start = time.monotonic()
    code, snippet, err = None, "", ""
    try:
        with _opener.open(req, timeout=int(task["timeout_seconds"])) as resp:
            code = resp.status
            raw = resp.read(262144)  # 上限 256KB，防大响应拖垮
            enc = (resp.headers.get("Content-Encoding") or "").lower()
            if "gzip" in enc:
                try:
                    raw = gzip.decompress(raw)
                except Exception:
                    pass
            elif "deflate" in enc:
                try:
                    raw = zlib.decompress(raw)
                except Exception:
                    try:
                        raw = zlib.decompress(raw, -zlib.MAX_WBITS)
                    except Exception:
                        pass
            snippet = raw.decode("utf-8", "replace")
        ok = 200 <= code < 400
        if not ok:
            err = "HTTP %s" % code
    except HTTPError as e:
        ok = False
        code = e.code
        err = "HTTP %s" % e.code
    except URLError as e:
        ok = False
        err = str(getattr(e, "reason", e))
    except Exception as e:  # 超时、连接失败等
        ok = False
        err = "%s: %s" % (type(e).__name__, e)
    dur = int((time.monotonic() - start) * 1000)
    return ok, code, dur, err, snippet[:2000]


def execute_task(task_id):
    """执行任务（含重试），写历史并更新统计。供调度器与手动执行共用。"""
    with closing(db()) as conn:
        row = conn.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone()
    if row is None:
        return None
    attempts = max(0, int(row["retries"] or 0)) + 1
    result = (False, None, 0, "unknown", "")
    for i in range(attempts):
        result = do_http(row)
        if result[0]:
            break
        if i < attempts - 1:
            time.sleep(min(5, 2 ** i))  # 1s, 2s, 4s, 5s...
    ok, code, dur, err, snippet = result
    run_at = now_str()
    with closing(db()) as conn:
        conn.execute(
            "INSERT INTO history(task_id,task_name,run_at,ok,status_code,duration_ms,error,snippet)"
            " VALUES(?,?,?,?,?,?,?,?)",
            (row["id"], row["name"], run_at, int(ok), code, dur, err, snippet),
        )
        conn.execute(
            "UPDATE tasks SET last_run_at=?, last_ok=?, last_status_code=?,"
            " last_duration_ms=?, last_error=?, success_count=success_count+?,"
            " fail_count=fail_count+? WHERE id=?",
            (run_at, int(ok), code, dur, err, 1 if ok else 0, 0 if ok else 1, row["id"]),
        )
        conn.execute(
            "DELETE FROM history WHERE task_id=? AND id NOT IN"
            " (SELECT id FROM history WHERE task_id=? ORDER BY id DESC LIMIT ?)",
            (row["id"], row["id"], HISTORY_KEEP),
        )
        conn.commit()
    return dict(
        ok=ok, status_code=code, duration_ms=dur, error=err, run_at=run_at,
        snippet=snippet,
    )


# -------------------------------------------------------------------------- 认证


@app.before_request
def guard():
    if not PANEL_PASSWORD:
        return None
    p = request.path
    if p == "/" or p.startswith("/static") or p == "/api/login":
        return None
    if p.startswith("/api/") and not session.get("auth"):
        return jsonify(error="unauthorized"), 401
    return None


# -------------------------------------------------------------------------- 路由


@app.route("/")
def index():
    return render_template("index.html")


@app.post("/api/login")
def login():
    data = request.get_json(force=True, silent=True) or {}
    if data.get("password", "") == PANEL_PASSWORD:
        session["auth"] = True
        return jsonify(ok=True)
    return jsonify(error="密码错误"), 401


@app.post("/api/logout")
def logout():
    session.clear()
    return jsonify(ok=True)


def validate_payload(data):
    name = (data.get("name") or "").strip()
    url = (data.get("url") or "").strip()
    if not name:
        return None, "名称不能为空"
    if not url.startswith(("http://", "https://")):
        return None, "URL 必须以 http:// 或 https:// 开头"
    st = data.get("schedule_type") or "interval"
    if st not in ("interval", "cron"):
        return None, "调度类型无效"
    minutes, expr = None, None
    if st == "interval":
        try:
            minutes = int(data.get("interval_minutes"))
        except (TypeError, ValueError):
            return None, "间隔分钟无效"
        if minutes < 1:
            return None, "间隔至少 1 分钟"
    else:
        expr = (data.get("cron_expr") or "").strip()
        try:
            CronTrigger.from_crontab(expr, timezone=APP_TIMEZONE)
        except Exception as e:
            return None, "cron 表达式无效（5 段式: 分 时 日 月 周）: %s" % e
    method = (data.get("method") or "GET").upper()
    if method not in ("GET", "POST", "PUT", "DELETE", "HEAD", "PATCH"):
        return None, "不支持的请求方法"
    try:
        timeout = min(120, max(1, int(data.get("timeout_seconds") or 30)))
        retries = min(5, max(0, int(data.get("retries") or 0)))
        jitter = min(1440, max(0, int(data.get("jitter_minutes") or 0)))
    except (TypeError, ValueError):
        return None, "超时/重试次数无效"
    return dict(
        name=name, url=url, method=method,
        headers=(data.get("headers") or "").strip(),
        body=data.get("body") or "",
        schedule_type=st, interval_minutes=minutes, cron_expr=expr,
        jitter_minutes=jitter, timeout_seconds=timeout, retries=retries,
    ), None


@app.get("/api/tasks")
def list_tasks():
    with closing(db()) as conn:
        rows = [dict(r) for r in conn.execute(
            "SELECT * FROM tasks ORDER BY sort_order ASC, id ASC")]
        n_tasks = len(rows)
        n_enabled = sum(1 for r in rows if r["enabled"])
        since = (datetime.now() - timedelta(hours=24)).strftime("%Y-%m-%d %H:%M:%S")
        h24 = conn.execute(
            "SELECT COUNT(*) c, SUM(ok) s FROM history WHERE run_at >= ?", (since,)
        ).fetchone()
        today = datetime.now().strftime("%Y-%m-%d")
        today_runs = conn.execute(
            "SELECT COUNT(*) c FROM history WHERE run_at >= ?", (today + " 00:00:00",)
        ).fetchone()["c"]
    ok24 = int(h24["s"] or 0)
    total24 = int(h24["c"] or 0)
    for t in rows:
        t["next_run_at"] = next_run_str(t["id"]) if t["enabled"] else None
    stats = dict(
        tasks=n_tasks, enabled=n_enabled,
        rate24=round(ok24 * 100.0 / total24, 1) if total24 else None,
        runs24=total24, runs_today=today_runs,
    )
    return jsonify(tasks=rows, stats=stats, auth_required=bool(PANEL_PASSWORD))


@app.post("/api/tasks")
def create_task():
    data = request.get_json(force=True, silent=True) or {}
    fields, err = validate_payload(data)
    if err:
        return jsonify(error=err), 400
    now = now_str()
    with closing(db()) as conn:
        # 新任务排在列表末尾
        next_sort = int(conn.execute(
            "SELECT COALESCE(MAX(sort_order),0) m FROM tasks").fetchone()["m"] or 0) + 1
        cur = conn.execute(
            "INSERT INTO tasks(name,url,method,headers,body,schedule_type,"
            "interval_minutes,cron_expr,jitter_minutes,timeout_seconds,retries,enabled,sort_order,created_at,updated_at)"
            " VALUES(?,?,?,?,?,?,?,?,?,?,?,1,?,?,?)",
            (fields["name"], fields["url"], fields["method"], fields["headers"],
             fields["body"], fields["schedule_type"], fields["interval_minutes"],
             fields["cron_expr"], fields["jitter_minutes"], fields["timeout_seconds"],
             fields["retries"], next_sort, now, now),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM tasks WHERE id=?", (cur.lastrowid,)).fetchone()
    if row["enabled"]:
        schedule_task(row)
    return jsonify(task=dict(row))


@app.post("/api/tasks/reorder")
def reorder_tasks():
    """拖拽排序持久化：ids 必须恰好是全部任务 id 的一个排列，按数组顺序写入 sort_order"""
    data = request.get_json(force=True, silent=True) or {}
    ids = data.get("ids")
    if (not isinstance(ids, list) or not ids
            or not all(isinstance(x, int) and not isinstance(x, bool) for x in ids)):
        return jsonify(error="ids 必须是非空的任务 id 数组"), 400
    with closing(db()) as conn:
        have = [r["id"] for r in conn.execute("SELECT id FROM tasks")]
        if len(ids) != len(have) or len(set(ids)) != len(ids) or set(ids) != set(have):
            return jsonify(error="ids 必须恰好包含全部任务 id"), 400
        now = now_str()
        for i, tid in enumerate(ids):
            conn.execute(
                "UPDATE tasks SET sort_order=?, updated_at=? WHERE id=?",
                (i + 1, now, tid),
            )
        conn.commit()
    return jsonify(ok=True)


@app.put("/api/tasks/<int:task_id>")
def update_task(task_id):
    data = request.get_json(force=True, silent=True) or {}
    fields, err = validate_payload(data)
    if err:
        return jsonify(error=err), 400
    now = now_str()
    with closing(db()) as conn:
        cur = conn.execute(
            "UPDATE tasks SET name=?,url=?,method=?,headers=?,body=?,schedule_type=?,"
            "interval_minutes=?,cron_expr=?,jitter_minutes=?,timeout_seconds=?,retries=?,updated_at=?"
            " WHERE id=?",
            (fields["name"], fields["url"], fields["method"], fields["headers"],
             fields["body"], fields["schedule_type"], fields["interval_minutes"],
             fields["cron_expr"], fields["jitter_minutes"], fields["timeout_seconds"],
             fields["retries"], now, task_id),
        )
        conn.commit()
        if cur.rowcount == 0:
            return jsonify(error="任务不存在"), 404
        row = conn.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone()
    unschedule_task(task_id)
    if row["enabled"]:
        schedule_task(row)
    return jsonify(task=dict(row))


@app.post("/api/tasks/<int:task_id>/toggle")
def toggle_task(task_id):
    with closing(db()) as conn:
        row = conn.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone()
        if row is None:
            return jsonify(error="任务不存在"), 404
        new_val = 0 if row["enabled"] else 1
        conn.execute("UPDATE tasks SET enabled=? WHERE id=?", (new_val, task_id))
        conn.commit()
        row = conn.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone()
    if new_val:
        schedule_task(row)
    else:
        unschedule_task(task_id)
    return jsonify(task=dict(row))


@app.delete("/api/tasks/<int:task_id>")
def delete_task(task_id):
    with closing(db()) as conn:
        conn.execute("DELETE FROM tasks WHERE id=?", (task_id,))
        conn.execute("DELETE FROM history WHERE task_id=?", (task_id,))
        conn.commit()
    unschedule_task(task_id)
    return jsonify(ok=True)


@app.post("/api/tasks/<int:task_id>/run")
def run_task_now(task_id):
    result = execute_task(task_id)
    if result is None:
        return jsonify(error="任务不存在"), 404
    return jsonify(result=result)


@app.get("/api/tasks/<int:task_id>/history")
def task_history(task_id):
    limit = min(200, max(1, int(request.args.get("limit", 50))))
    with closing(db()) as conn:
        rows = [dict(r) for r in conn.execute(
            "SELECT * FROM history WHERE task_id=? ORDER BY id DESC LIMIT ?",
            (task_id, limit))]
    return jsonify(history=rows)


@app.get("/api/export")
def export_data():
    with closing(db()) as conn:
        tasks = [dict(r) for r in conn.execute("SELECT * FROM tasks ORDER BY id")]
    payload = dict(app="web-cron", version=1, exported_at=now_str(), tasks=tasks)
    return app.response_class(
        json.dumps(payload, ensure_ascii=False, indent=2),
        mimetype="application/json",
        headers={"Content-Disposition": "attachment; filename=web-cron_backup.json"},
    )


@app.post("/api/import")
def import_data():
    data = request.get_json(force=True, silent=True) or {}
    tasks = data.get("tasks") or []
    if not isinstance(tasks, list) or not tasks:
        return jsonify(error="导入文件中没有任务数据"), 400
    imported, skipped = 0, 0
    with closing(db()) as conn:
        so = int(conn.execute(
            "SELECT COALESCE(MAX(sort_order),0) m FROM tasks").fetchone()["m"] or 0)
        for t in tasks:
            fields, err = validate_payload(t)
            if err:
                skipped += 1
                continue
            now = now_str()
            so += 1
            cur = conn.execute(
                "INSERT INTO tasks(name,url,method,headers,body,schedule_type,"
                "interval_minutes,cron_expr,jitter_minutes,timeout_seconds,retries,enabled,sort_order,created_at,updated_at)"
                " VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (fields["name"], fields["url"], fields["method"], fields["headers"],
                 fields["body"], fields["schedule_type"], fields["interval_minutes"],
                 fields["cron_expr"], fields["jitter_minutes"], fields["timeout_seconds"],
                 fields["retries"], 1 if t.get("enabled", 1) else 0, so, now, now),
            )
            conn.commit()
            row = conn.execute("SELECT * FROM tasks WHERE id=?", (cur.lastrowid,)).fetchone()
            if row["enabled"]:
                schedule_task(row)
            imported += 1
    return jsonify(ok=True, imported=imported, skipped=skipped)


# ---------------------------------------------------------------------- Gist 同步
# 上传 / 下载的都只是任务配置（与导出备份同一结构），执行历史永远不参与同步。
# Gist Token / Gist ID 存在 settings 表（key=gist，值为 JSON 字符串）。

GIST_API = "https://api.github.com/gists"
GIST_FILE = "web-cron.json"


def get_setting(key, default=""):
    with closing(db()) as conn:
        row = conn.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
    return row["value"] if row else default


def set_setting(key, value):
    with closing(db()) as conn:
        conn.execute(
            "INSERT INTO settings(key,value) VALUES(?,?)"
            " ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (key, value),
        )
        conn.commit()


def gist_config():
    try:
        g = json.loads(get_setting("gist") or "{}") or {}
    except Exception:
        g = {}
    return {"token": str(g.get("token") or ""), "gist_id": str(g.get("gist_id") or "")}


def gist_request(method, url, token, payload=None):
    """调用 GitHub Gist API，返回 (http_status, 解析后的 dict)；网络异常向上抛"""
    headers = {
        "Authorization": "Bearer %s" % token,
        "Accept": "application/vnd.github+json",
        "User-Agent": "web-cron",
        "Content-Type": "application/json",
    }
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urlrequest.Request(url, data=data, method=method, headers=headers)
    try:
        with _opener.open(req, timeout=30) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8"))
    except HTTPError as e:
        return e.code, {}


def gist_api_error(status):
    if status == 401:
        return "GitHub Token 无效或缺少 gist 权限"
    if status == 403:
        return "GitHub API 拒绝访问（可能限流，或 Token 无 gist 权限）"
    if status == 404:
        return "Gist 不存在，请检查 Gist ID"
    return "GitHub API HTTP %s" % status


@app.get("/api/gist")
def gist_get():
    return jsonify(**gist_config())


@app.put("/api/gist")
def gist_put():
    data = request.get_json(force=True, silent=True) or {}
    set_setting("gist", json.dumps({
        "token": (data.get("token") or "").strip(),
        "gist_id": (data.get("gist_id") or "").strip(),
    }))
    return jsonify(ok=True)


@app.post("/api/gist/push")
def gist_push():
    g = gist_config()
    if not g["token"]:
        return jsonify(error="请先填写 GitHub Token（classic PAT，勾选 gist 权限）"), 400
    with closing(db()) as conn:
        tasks = [dict(r) for r in conn.execute("SELECT * FROM tasks ORDER BY id")]
    content = json.dumps(
        dict(app="web-cron", version=1, exported_at=now_str(), tasks=tasks),
        ensure_ascii=False, indent=2,
    )
    files = {GIST_FILE: {"content": content}}
    try:
        if g["gist_id"]:
            status, j = gist_request(
                "PATCH", GIST_API + "/" + g["gist_id"], g["token"], {"files": files})
        else:
            status, j = gist_request(
                "POST", GIST_API, g["token"],
                {"description": "web-cron", "public": False, "files": files})
    except Exception as e:
        return jsonify(error="无法访问 GitHub API：%s" % e), 502
    if status >= 300:
        return jsonify(error=gist_api_error(status)), 502
    gist_id = str((j or {}).get("id") or g["gist_id"] or "")
    if gist_id != g["gist_id"]:
        set_setting("gist", json.dumps({"token": g["token"], "gist_id": gist_id}))
    return jsonify(ok=True, created=not g["gist_id"], gist_id=gist_id,
                   html_url=(j or {}).get("html_url") or "")


@app.post("/api/gist/pull")
def gist_pull():
    g = gist_config()
    if not g["token"]:
        return jsonify(error="请先填写 GitHub Token（classic PAT，勾选 gist 权限）"), 400
    if not g["gist_id"]:
        return jsonify(error="还没有 Gist ID，可先执行「上传到 Gist」自动创建"), 400
    try:
        status, j = gist_request("GET", GIST_API + "/" + g["gist_id"], g["token"])
    except Exception as e:
        return jsonify(error="无法访问 GitHub API：%s" % e), 502
    if status >= 300:
        return jsonify(error=gist_api_error(status)), 502
    fobj = ((j or {}).get("files") or {}).get(GIST_FILE) or {}
    content = fobj.get("content") or ""
    if not content:
        return jsonify(error="Gist 中没有找到 %s" % GIST_FILE), 400
    try:
        data = json.loads(content)
    except Exception:
        return jsonify(error="Gist 备份内容不是合法 JSON"), 400
    tasks = data.get("tasks") if isinstance(data, dict) else None
    if not isinstance(tasks, list) or not tasks:
        return jsonify(error="Gist 备份中没有任务数据"), 400

    # 先全部校验再动库：无有效任务直接拒绝，避免把现有任务清空后导入了个寂寞
    prepared, skipped = [], 0
    for t in tasks:
        fields, err = validate_payload(t if isinstance(t, dict) else {})
        if err:
            skipped += 1
            continue
        prepared.append((fields, 1 if t.get("enabled", 1) else 0,
                         t.get("sort_order") if isinstance(t.get("sort_order"), int)
                         and t["sort_order"] > 0 else len(prepared) + 1))
    if not prepared:
        return jsonify(error="Gist 备份中没有可导入的任务"), 400

    # 单事务覆盖：DELETE + 全部 INSERT 一次提交，中途失败自动回滚，原任务原样保留。
    # 执行历史保留不动；新任务 id 由 AUTOINCREMENT 续号，不会与旧日志混淆。
    with closing(db()) as conn:
        old_ids = [r["id"] for r in conn.execute("SELECT id FROM tasks")]
        try:
            conn.execute("DELETE FROM tasks")
            for fields, enabled, so in prepared:
                now = now_str()
                conn.execute(
                    "INSERT INTO tasks(name,url,method,headers,body,schedule_type,"
                    "interval_minutes,cron_expr,jitter_minutes,timeout_seconds,retries,enabled,sort_order,created_at,updated_at)"
                    " VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (fields["name"], fields["url"], fields["method"], fields["headers"],
                     fields["body"], fields["schedule_type"], fields["interval_minutes"],
                     fields["cron_expr"], fields["jitter_minutes"], fields["timeout_seconds"],
                     fields["retries"], enabled, so, now, now),
                )
            conn.commit()
        except Exception:
            conn.rollback()
            raise
    for tid in old_ids:
        unschedule_task(tid)
    with closing(db()) as conn:
        rows = [dict(r) for r in conn.execute("SELECT * FROM tasks WHERE enabled=1")]
    for row in rows:
        schedule_task(row)
    return jsonify(ok=True, imported=len(prepared), skipped=skipped)


# -------------------------------------------------------------------------- 启动

init_db()
scheduler.start()
with closing(db()) as conn:
    for r in conn.execute("SELECT * FROM tasks WHERE enabled=1"):
        try:
            schedule_task(r)
        except Exception as e:
            app.logger.error("恢复调度失败 task_%s: %s", r["id"], e)

if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5000"))
    app.run(host="0.0.0.0", port=port, threaded=True)
