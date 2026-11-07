// index.js —— web-cron Cloudflare Worker 入口
// 架构：Cron Trigger 每分钟唤醒 -> 查 next_run_at 到期任务 -> 执行并计算下次时间
// 存储：D1；认证：X-Auth 请求头比对 PANEL_PASSWORD（secret）
import { computeNextRun, validateCron, fmtTs } from "./cron.js";
import { browserHeaders } from "./headers.js";
import { HTML } from "./ui.js";

const HISTORY_KEEP = 200;

// 旧库平滑迁移：tasks 缺 sort_order / jitter_minutes 列时自动补上，settings 表不存在时
// 自动创建（列/表已存在时报错被忽略）。新装库由 schema.sql 直接建好；
// 已有部署首个请求/第一次调度时自动完成迁移。
let schemaReady = null;
function ensureSchema(env) {
  if (!schemaReady) {
    schemaReady = Promise.all([
      env.DB.prepare(
        "ALTER TABLE tasks ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0"
      ).run().catch(() => {}),
      env.DB.prepare(
        "ALTER TABLE tasks ADD COLUMN jitter_minutes INTEGER NOT NULL DEFAULT 0"
      ).run().catch(() => {}),
      env.DB.prepare(
        "CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL)"
      ).run().catch(() => {}),
    ]);
  }
  return schemaReady;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "Content-Type, X-Auth",
      "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
    },
  });
}
const fail = (msg, status = 400) => json({ error: msg }, status);

function authError(req, env) {
  if (!env.PANEL_PASSWORD) return null;
  return req.headers.get("X-Auth") === env.PANEL_PASSWORD
    ? null
    : json({ error: "unauthorized" }, 401);
}

function tz(env) {
  return env.APP_TIMEZONE || "UTC";
}

// ------------------------------------------------------------------ 校验 / 请求头

function validate(data) {
  const name = String(data.name || "").trim();
  const url = String(data.url || "").trim();
  if (!name) throw new Error("名称不能为空");
  if (!/^https?:\/\//i.test(url)) throw new Error("URL 必须以 http:// 或 https:// 开头");
  const st = data.schedule_type === "cron" ? "cron" : "interval";
  let interval_minutes = null, cron_expr = null;
  if (st === "cron") {
    cron_expr = String(data.cron_expr || "").trim();
    validateCron(cron_expr);
  } else {
    interval_minutes = parseInt(data.interval_minutes, 10);
    if (!Number.isFinite(interval_minutes) || interval_minutes < 1) {
      throw new Error("间隔至少 1 分钟");
    }
  }
  const method = String(data.method || "GET").toUpperCase();
  if (!["GET", "POST", "PUT", "DELETE", "HEAD", "PATCH"].includes(method)) {
    throw new Error("不支持的请求方法");
  }
  const timeout_seconds = Math.min(120, Math.max(1, parseInt(data.timeout_seconds, 10) || 30));
  const retries = Math.min(5, Math.max(0, parseInt(data.retries, 10) || 0));
  const jitter_minutes = Math.min(1440, Math.max(0, parseInt(data.jitter_minutes, 10) || 0));
  return {
    name, url, method,
    headers: String(data.headers || ""),
    body: String(data.body || ""),
    schedule_type: st, interval_minutes, cron_expr, jitter_minutes, timeout_seconds, retries,
  };
}

function parseHeaders(text) {
  const s = String(text || "").trim();
  if (!s) return {};
  if (s.charAt(0) === "{") {
    try {
      const o = JSON.parse(s);
      const out = {};
      for (const k of Object.keys(o)) out[k] = String(o[k]);
      return out;
    } catch (_) { return {}; }
  }
  const out = {};
  for (const line of s.split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

// ------------------------------------------------------------------ Gist 同步
// 上传 / 下载的都只是任务配置（与导出备份同一结构），执行历史永远不参与同步。
// 配置（Token / Gist ID / 自动同步基线等）存在 D1 的 settings 表（key=gist 的 JSON）。
// 自动同步是三方对比（本地指纹 / Gist 指纹 / 基线）：本地变了→推，Gist 变了→拉，
// 两边都变→跳过并告警——防止轮换场景下刚唤醒的机器把过时配置推上去覆盖新修改。

const GIST_API = "https://api.github.com/gists";
const GIST_FILE = "web-cron.json";

async function getSetting(env, key) {
  const r = await env.DB.prepare("SELECT value FROM settings WHERE key=?").bind(key).first();
  return r ? String(r.value || "") : "";
}

async function setSetting(env, key, value) {
  await env.DB.prepare(
    "INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value"
  ).bind(key, value).run();
}

async function gistConfig(env) {
  let g = {};
  try { g = JSON.parse(await getSetting(env, "gist")) || {}; } catch (_) {}
  return {
    token: String(g.token || ""),
    gist_id: String(g.gist_id || ""),
    auto: g.auto ? 1 : 0,
    interval_min: Math.min(1440, Math.max(1, parseInt(g.interval_min, 10) || 5)),
    baseline_hash: String(g.baseline_hash || ""),
    synced_at: Number(g.synced_at) || null,
    last_result: String(g.last_result || ""),
    last_check_at: Number(g.last_check_at) || 0,
  };
}

async function saveGistConfig(env, cfg) {
  await setSetting(env, "gist", JSON.stringify({
    token: cfg.token || "", gist_id: cfg.gist_id || "",
    auto: cfg.auto ? 1 : 0, interval_min: cfg.interval_min || 5,
    baseline_hash: cfg.baseline_hash || "", synced_at: cfg.synced_at || 0,
    last_result: cfg.last_result || "", last_check_at: cfg.last_check_at || 0,
  }));
}

function gistHeaders(token) {
  return {
    "authorization": "Bearer " + token,
    "accept": "application/vnd.github+json",
    "user-agent": "web-cron",
    "content-type": "application/json",
  };
}

async function gistError(r) {
  if (r.status === 401) return "GitHub Token 无效或缺少 gist 权限";
  if (r.status === 403) return "GitHub API 拒绝访问（可能限流，或 Token 无 gist 权限）";
  if (r.status === 404) return "Gist 不存在，请检查 Gist ID";
  return "GitHub API HTTP " + r.status;
}

// ------------------------------------------------------------------ 配置指纹
// 参与指纹的配置字段（顺序固定）；id / 执行统计 / 时间戳等易变字段不参与。
const CONFIG_FIELDS = [
  "name", "url", "method", "headers", "body",
  "schedule_type", "interval_minutes", "cron_expr", "jitter_minutes",
  "timeout_seconds", "retries", "enabled", "sort_order",
];

async function configHash(rows) {
  const canon = [...rows]
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || (a.id || 0) - (b.id || 0))
    .map((r) => {
      const o = {};
      for (const k of CONFIG_FIELDS) o[k] = r[k] != null ? r[k] : null;
      return o;
    });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(canon)));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Gist 上的原始 JSON 先过与本地一致的规范化（validate + enabled/sort_order），再算指纹，
// 避免「原始 JSON vs 库内规范化行」的差异让两边指纹永远对不上、造成反复空拉。
function hashLikeLocal(tasks) {
  const normalized = [];
  for (const raw of tasks) {
    let f;
    try { f = validate(raw); } catch (_) { continue; }
    const o = {};
    for (const k of CONFIG_FIELDS) o[k] = f[k] != null ? f[k] : null;
    o.enabled = raw && raw.enabled === 0 ? 0 : 1;
    o.sort_order = Number(raw && raw.sort_order) > 0 ? Number(raw.sort_order) : 0;
    normalized.push(o);
  }
  return configHash(normalized);
}

// ------------------------------------------------------------------ 推 / 拉核心（端点与自动同步共用）

async function gistPushCore(env, now, reason) {
  const g = await gistConfig(env);
  if (!g.token) throw new Error("请先填写 GitHub Token（ghp_ xxx）");
  const xr = await env.DB.prepare("SELECT * FROM tasks ORDER BY id").all();
  const tasks = xr.results || [];
  const hash = await configHash(tasks);
  const content = JSON.stringify({
    app: "web-cron-worker", version: 1, exported_at: now, tasks,
  }, null, 2);
  let r;
  try {
    r = g.gist_id
      ? await fetch(GIST_API + "/" + g.gist_id, {
          method: "PATCH", headers: gistHeaders(g.token),
          signal: AbortSignal.timeout(15000),
          body: JSON.stringify({ files: { [GIST_FILE]: { content } } }),
        })
      : await fetch(GIST_API, {
          method: "POST", headers: gistHeaders(g.token),
          signal: AbortSignal.timeout(15000),
          body: JSON.stringify({
            description: "web-cron", public: false,
            files: { [GIST_FILE]: { content } },
          }),
        });
  } catch (e) {
    throw new Error("无法访问 GitHub API：" + String((e && e.message) || e));
  }
  if (!r.ok) throw new Error(await gistError(r));
  const j = await r.json().catch(() => ({}));
  const gist_id = String(j.id || g.gist_id || "");
  await saveGistConfig(env, { ...g, gist_id, baseline_hash: hash, synced_at: now, last_result: reason });
  return { action: g.gist_id ? "pushed" : "created", gist_id, html_url: j.html_url || "" };
}

async function gistPullCore(env, now, reason) {
  const g = await gistConfig(env);
  if (!g.token) throw new Error("请先填写 GitHub Token（ghp_ xxx）");
  if (!g.gist_id) throw new Error("还没有 Gist ID，可先执行「上传到 Gist」自动创建");
  let r;
  try {
    r = await fetch(GIST_API + "/" + g.gist_id, {
      headers: gistHeaders(g.token), signal: AbortSignal.timeout(15000),
    });
  } catch (e) {
    throw new Error("无法访问 GitHub API：" + String((e && e.message) || e));
  }
  if (!r.ok) throw new Error(await gistError(r));
  const j = await r.json().catch(() => ({}));
  const content = j && j.files && j.files[GIST_FILE] && j.files[GIST_FILE].content;
  if (typeof content !== "string" || !content) throw new Error("Gist 中没有找到 " + GIST_FILE);
  let d;
  try { d = JSON.parse(content); } catch (_) { throw new Error("Gist 备份内容不是合法 JSON"); }
  const tasks = Array.isArray(d.tasks) ? d.tasks : [];
  if (!tasks.length) throw new Error("Gist 备份中没有任务数据");
  let imported = 0, skipped = 0;
  const stmts = [env.DB.prepare("DELETE FROM tasks")];
  for (const t of tasks) {
    let f;
    try { f = validate(t); } catch (_) { skipped++; continue; }
    const next = computeNextRun(f, now, tz(env));
    const enabled = t.enabled === 0 ? 0 : 1;
    imported++;
    stmts.push(env.DB.prepare(
      "INSERT INTO tasks(name,url,method,headers,body,schedule_type,interval_minutes,cron_expr," +
      "jitter_minutes,timeout_seconds,retries,enabled,sort_order,created_at,updated_at,next_run_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
    ).bind(f.name, f.url, f.method, f.headers, f.body, f.schedule_type,
           f.interval_minutes, f.cron_expr, f.jitter_minutes, f.timeout_seconds, f.retries,
           enabled, Number(t.sort_order) > 0 ? Number(t.sort_order) : 0, now, now, next));
  }
  if (imported) await env.DB.batch(stmts);
  await saveGistConfig(env, { ...g, baseline_hash: await hashLikeLocal(tasks), synced_at: now, last_result: reason });
  return { action: "pulled", imported, skipped, gist_id: g.gist_id };
}

// ------------------------------------------------------------------ 自动同步（三方对比）

let autoSyncRunning = false;

async function autoSync(env, trigger) {
  if (autoSyncRunning) return;
  autoSyncRunning = true;
  try {
    let g = await gistConfig(env);
    if (!g.token || !g.auto) return;
    // Worker 每分钟被 Cron Trigger 唤醒，按配置间隔节流（last_check_at 持久化，隔离重启也不丢）
    if (trigger === "timer") {
      const intervalMs = Math.max(1, g.interval_min) * 60000;
      if (Date.now() - g.last_check_at < intervalMs - 1500) return;
    }
    const now = Date.now();
    g = { ...g, last_check_at: now };
    await saveGistConfig(env, g);

    if (!g.gist_id) {
      const tr = await env.DB.prepare("SELECT COUNT(*) c FROM tasks").first();
      if (!Number(tr?.c || 0)) return;
      await gistPushCore(env, now, "已推送");
      return;
    }
    let resp;
    try {
      resp = await fetch(GIST_API + "/" + g.gist_id, {
        headers: gistHeaders(g.token), signal: AbortSignal.timeout(15000),
      });
    } catch (e) {
      await saveGistConfig(env, { ...g, synced_at: now, last_result: "自动同步失败：无法访问 GitHub API：" + String((e && e.message) || e) });
      return;
    }
    if (!resp.ok) {
      await saveGistConfig(env, { ...g, synced_at: now, last_result: "自动同步失败：" + await gistError(resp) });
      return;
    }
    const j = await resp.json().catch(() => ({}));
    let remoteTasks = null;
    const content = j && j.files && j.files[GIST_FILE] && j.files[GIST_FILE].content;
    if (typeof content === "string" && content) {
      try {
        const d = JSON.parse(content);
        if (Array.isArray(d.tasks)) remoteTasks = d.tasks;
      } catch (_) { /* 内容坏了按远端为空处理 */ }
    }
    const remoteHash = remoteTasks && remoteTasks.length ? await hashLikeLocal(remoteTasks) : "";
    const lr = await env.DB.prepare("SELECT * FROM tasks").all();
    const localHash = await configHash(lr.results || []);
    const base = g.baseline_hash;

    if (!base) {
      // 本机从未与该 Gist 同步过：以 Gist 为准（新机器加入轮换直接拿最新配置）
      if (remoteHash === localHash) {
        await saveGistConfig(env, { ...g, baseline_hash: remoteHash, synced_at: now, last_result: "已建立基线" });
      } else if (!remoteHash) {
        const tr = await env.DB.prepare("SELECT COUNT(*) c FROM tasks").first();
        if (Number(tr?.c || 0)) await gistPushCore(env, now, "已推送");
      } else {
        await gistPullCore(env, now, "已拉取");
      }
      return;
    }

    const localChanged = localHash !== base;
    const remoteChanged = remoteHash !== base;
    if (!localChanged && !remoteChanged) return;
    if (localChanged && !remoteChanged) {
      await gistPushCore(env, now, "已推送");
    } else if (remoteChanged && !localChanged) {
      if (!remoteHash) {
        // Gist 上文件被删：本地是最后一致状态，重新推上去
        await gistPushCore(env, now, "已推送");
      } else {
        await gistPullCore(env, now, "已拉取");
      }
    } else {
      // 两边都改过：跳过并告警，等人工选择上传或下载
      await saveGistConfig(env, { ...g, synced_at: now, last_result: "⚠ 冲突：本地与 Gist 都有修改，已跳过自动同步，请手动选择上传或下载" });
    }
  } catch (e) {
    // 自动同步失败不抛出，落状态即可
    try {
      const g = await gistConfig(env);
      await saveGistConfig(env, { ...g, synced_at: Date.now(), last_result: "自动同步失败：" + String((e && e.message) || e) });
    } catch (_) {}
  } finally {
    autoSyncRunning = false;
  }
}

// ---------------------------------------------------------------------- HTTP 执行

async function doHttp(task) {
  const method = (task.method || "GET").toUpperCase();
  const headers = browserHeaders(method);
  Object.assign(headers, parseHeaders(task.headers)); // 自定义头覆盖默认
  let body;
  if (method !== "GET" && method !== "HEAD" && task.body) {
    body = task.body;
    if (!Object.keys(headers).some((k) => k.toLowerCase() === "content-type")) {
      headers["Content-Type"] = "application/json";
    }
  }
  const timeoutMs = Math.min(120, Math.max(1, Number(task.timeout_seconds) || 30)) * 1000;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const t0 = performance.now();
  let ok = false, status_code = null, error = "", snippet = "";
  try {
    const r = await fetch(task.url, {
      method, headers, body, signal: ctrl.signal, redirect: "follow",
    });
    status_code = r.status;
    snippet = (await r.text()).slice(0, 2000); // Workers 的 fetch 自动解压 gzip
    ok = r.status >= 200 && r.status < 400;
    if (!ok) error = "HTTP " + r.status;
  } catch (e) {
    error = e && e.name === "AbortError" ? "timeout" : String((e && e.message) || e);
  } finally {
    clearTimeout(timer);
  }
  return {
    ok, status_code, duration_ms: Math.round(performance.now() - t0),
    error, snippet,
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 执行一次任务；reschedule=true 时推进 next_run_at（定时任务用），手动执行传 false
async function executeTask(env, task, now, reschedule) {
  const attempts = Math.max(0, Number(task.retries) || 0) + 1;
  let res;
  for (let i = 0; i < attempts; i++) {
    res = await doHttp(task);
    if (res.ok) break;
    if (i < attempts - 1) await sleep(Math.min(5000, 2 ** i * 1000));
  }
  const next = computeNextRun(task, now, tz(env));
  const stmts = [
    env.DB.prepare(
      "INSERT INTO history(task_id,task_name,run_at,ok,status_code,duration_ms,error,snippet) VALUES(?,?,?,?,?,?,?,?)"
    ).bind(task.id, task.name, now, res.ok ? 1 : 0, res.status_code,
           res.duration_ms, res.error, res.snippet),
    env.DB.prepare(
      "UPDATE tasks SET last_run_at=?,last_ok=?,last_status_code=?,last_duration_ms=?,last_error=?," +
      "success_count=success_count+?,fail_count=fail_count+?" +
      (reschedule ? ",next_run_at=?" : "") + " WHERE id=?"
    ).bind(
      ...(reschedule
        ? [now, res.ok ? 1 : 0, res.status_code, res.duration_ms, res.error,
           res.ok ? 1 : 0, res.ok ? 0 : 1, next, task.id]
        : [now, res.ok ? 1 : 0, res.status_code, res.duration_ms, res.error,
           res.ok ? 1 : 0, res.ok ? 0 : 1, task.id])
    ),
    env.DB.prepare(
      "DELETE FROM history WHERE task_id=? AND id NOT IN " +
      "(SELECT id FROM history WHERE task_id=? ORDER BY id DESC LIMIT ?)"
    ).bind(task.id, task.id, HISTORY_KEEP),
  ];
  await env.DB.batch(stmts);
  return res;
}

async function runDue(env, now) {
  const r = await env.DB.prepare(
    "SELECT * FROM tasks WHERE enabled=1 AND next_run_at<=? ORDER BY next_run_at ASC LIMIT 50"
  ).bind(now).all();
  const due = r.results || [];
  // 先占坑：执行 HTTP 之前先推进 next_run_at，避免任务耗时接近 1 分钟时被
  // 下一个 Cron Trigger 重复捞起（与完整版 scheduler.ts 的策略一致）。
  // 开了随机加时的任务两次计算各自重新随机（先占坑值随后被 executeTask 覆盖），
  // 但都落在「固定下次时间 + [0,N) 分钟」内且必然大于 now，防重复语义不变。
  if (due.length) {
    await env.DB.batch(due.map((t) => env.DB.prepare(
      "UPDATE tasks SET next_run_at=? WHERE id=? AND next_run_at<=?"
    ).bind(computeNextRun(t, now, tz(env)), t.id, now)));
  }
  for (const t of due) {
    try {
      await executeTask(env, t, now, true);
    } catch (e) {
      console.error("task " + t.id + " failed:", String(e));
    }
  }
}

// --------------------------------------------------------------------------- API

async function handleApi(req, env, url, ctx) {
  await ensureSchema(env);
  const p = url.pathname;
  const method = req.method;
  const body = async () => { try { return await req.json(); } catch (_) { return {}; } };
  // 任务数据变化后触发一次自动同步检查（waitUntil 在响应后继续跑，不阻塞请求）
  const syncLater = () => {
    if (!ctx) return;
    try { ctx.waitUntil(autoSync(env, "mutation").catch(() => {})); } catch (_) {}
  };

  if (p === "/api/login" && method === "POST") {
    const d = await body();
    if (String(d.password || "") === env.PANEL_PASSWORD) return json({ ok: true });
    return fail("密码错误", 401);
  }

  const auth = authError(req, env);
  if (auth) return auth;

  if (p === "/api/tasks" && method === "GET") {
    const [tr, st, st24] = await Promise.all([
      env.DB.prepare("SELECT * FROM tasks ORDER BY sort_order ASC, id ASC").all(),
      env.DB.prepare("SELECT COUNT(*) c, COALESCE(SUM(enabled),0) e FROM tasks").first(),
      env.DB.prepare("SELECT COUNT(*) c, COALESCE(SUM(ok),0) s FROM history WHERE run_at>=?")
        .bind(Date.now() - 86400000).first(),
    ]);
    const tasks = (tr.results || []).map((t) => Object.assign({}, t, {
      next_run_at_str: t.enabled ? fmtTs(t.next_run_at, tz(env)) : null,
      last_run_at_str: fmtTs(t.last_run_at, tz(env)),
    }));
    const n24 = Number(st24?.c || 0);
    return json({
      tasks,
      stats: {
        tasks: Number(st?.c || 0), enabled: Number(st?.e || 0), runs24: n24,
        rate24: n24 ? Math.round((Number(st24?.s || 0) * 1000) / n24) / 10 : null,
      },
      auth_required: Boolean(env.PANEL_PASSWORD), timezone: tz(env),
    });
  }

  if (p === "/api/tasks" && method === "POST") {
    let f;
    try { f = validate(await body()); } catch (e) { return fail(e.message); }
    const now = Date.now();
    const next = computeNextRun(f, now, tz(env));
    const mr = await env.DB.prepare("SELECT COALESCE(MAX(sort_order),0) m FROM tasks").first();
    const ins = await env.DB.prepare(
      "INSERT INTO tasks(name,url,method,headers,body,schedule_type,interval_minutes,cron_expr," +
      "jitter_minutes,timeout_seconds,retries,enabled,sort_order,created_at,updated_at,next_run_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,1,?,?,?,?)"
    ).bind(f.name, f.url, f.method, f.headers, f.body, f.schedule_type,
           f.interval_minutes, f.cron_expr, f.jitter_minutes, f.timeout_seconds, f.retries,
           Number(mr?.m || 0) + 1, now, now, next).run();
    syncLater();
    return json({ ok: true, id: ins?.meta?.last_row_id ?? null, next_run_at: next });
  }

  // 拖拽排序持久化：ids 必须恰好是全部任务 id 的一个排列，按数组顺序写入 sort_order
  if (p === "/api/tasks/reorder" && method === "POST") {
    const d = await body();
    const ids = Array.isArray(d.ids) ? d.ids : [];
    if (!ids.length || ids.some((x) => !Number.isInteger(x))) {
      return fail("ids 必须是非空的任务 id 数组");
    }
    const tr = await env.DB.prepare("SELECT id FROM tasks").all();
    const have = (tr.results || []).map((r) => Number(r.id));
    if (ids.length !== have.length || new Set(ids).size !== ids.length ||
        ids.some((id) => !have.includes(id))) {
      return fail("ids 必须恰好包含全部任务 id");
    }
    await env.DB.batch(ids.map((id, i) =>
      env.DB.prepare("UPDATE tasks SET sort_order=?,updated_at=? WHERE id=?")
        .bind(i + 1, Date.now(), id)));
    syncLater();
    return json({ ok: true });
  }

  let m = p.match(/^\/api\/tasks\/(\d+)(?:\/(\w+))?$/);
  if (m) {
    const id = Number(m[1]), action = m[2];
    const task = await env.DB.prepare("SELECT * FROM tasks WHERE id=?").bind(id).first();
    if (!task) return fail("任务不存在", 404);

    if (p === "/api/tasks/" + id && method === "PUT") {
      let f;
      try { f = validate(await body()); } catch (e) { return fail(e.message); }
      const now = Date.now();
      const next = computeNextRun(f, now, tz(env));
      await env.DB.prepare(
        "UPDATE tasks SET name=?,url=?,method=?,headers=?,body=?,schedule_type=?,interval_minutes=?," +
        "cron_expr=?,jitter_minutes=?,timeout_seconds=?,retries=?,updated_at=?,next_run_at=? WHERE id=?"
      ).bind(f.name, f.url, f.method, f.headers, f.body, f.schedule_type,
             f.interval_minutes, f.cron_expr, f.jitter_minutes, f.timeout_seconds, f.retries,
             now, next, id).run();
      syncLater();
      return json({ ok: true, next_run_at: next });
    }

    if (p === "/api/tasks/" + id && method === "DELETE") {
      await env.DB.batch([
        env.DB.prepare("DELETE FROM tasks WHERE id=?").bind(id),
        env.DB.prepare("DELETE FROM history WHERE task_id=?").bind(id),
      ]);
      syncLater();
      return json({ ok: true });
    }

    if (action === "toggle" && method === "POST") {
      const enabled = task.enabled ? 0 : 1;
      const next = enabled ? computeNextRun(task, Date.now(), tz(env)) : null;
      await env.DB.prepare("UPDATE tasks SET enabled=?,next_run_at=? WHERE id=?")
        .bind(enabled, next, id).run();
      syncLater();
      return json({ ok: true, enabled });
    }

    if (action === "run" && method === "POST") {
      const res = await executeTask(env, task, Date.now(), false);
      return json({ result: res });
    }

    if (action === "history" && method === "GET") {
      const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get("limit") || "50", 10)));
      const r = await env.DB.prepare(
        "SELECT * FROM history WHERE task_id=? ORDER BY id DESC LIMIT ?"
      ).bind(id, limit).all();
      return json({
        history: (r.results || []).map((h) => Object.assign({}, h, {
          run_at_str: fmtTs(h.run_at, tz(env)),
        })),
        timezone: tz(env),
      });
    }
  }

  if (p === "/api/export" && method === "GET") {
    const r = await env.DB.prepare("SELECT * FROM tasks ORDER BY id").all();
    return json({ app: "web-cron-worker", version: 1, exported_at: Date.now(),
                  tasks: r.results || [] });
  }

  if (p === "/api/import" && method === "POST") {
    const d = await body();
    const tasks = Array.isArray(d.tasks) ? d.tasks : [];
    if (!tasks.length) return fail("导入文件中没有任务数据");
    let imported = 0, skipped = 0;
    const mr = await env.DB.prepare("SELECT COALESCE(MAX(sort_order),0) m FROM tasks").first();
    let so = Number(mr?.m || 0);
    for (const t of tasks) {
      let f;
      try { f = validate(t); } catch (_) { skipped++; continue; }
      const now = Date.now();
      const next = computeNextRun(f, now, tz(env));
      const enabled = t.enabled === 0 ? 0 : 1;
      so += 1;
      await env.DB.prepare(
        "INSERT INTO tasks(name,url,method,headers,body,schedule_type,interval_minutes,cron_expr," +
        "jitter_minutes,timeout_seconds,retries,enabled,sort_order,created_at,updated_at,next_run_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
      ).bind(f.name, f.url, f.method, f.headers, f.body, f.schedule_type,
             f.interval_minutes, f.cron_expr, f.jitter_minutes, f.timeout_seconds, f.retries,
             enabled, so, now, now, next).run();
      imported++;
    }
    syncLater();
    return json({ ok: true, imported, skipped });
  }

  // ---------------------------------------------------------------- Gist 同步
  // 端点是薄封装；推/拉核心与三方对比逻辑在模块级（gistPushCore / gistPullCore / autoSync）。

  if (p === "/api/gist" && method === "GET") {
    const g = await gistConfig(env);
    return json({
      token: g.token, gist_id: g.gist_id,
      auto: g.auto, interval_min: g.interval_min,
      synced_at: g.synced_at, last_result: g.last_result,
    });
  }

  if (p === "/api/gist" && method === "PUT") {
    const d = await body();
    const g = await gistConfig(env);
    g.token = String(d.token != null ? d.token : g.token).trim();
    g.gist_id = String(d.gist_id != null ? d.gist_id : g.gist_id).trim();
    if (d.auto !== undefined) g.auto = d.auto ? 1 : 0;
    if (d.interval_min !== undefined) {
      g.interval_min = Math.min(1440, Math.max(1, parseInt(d.interval_min, 10) || 5));
    }
    await saveGistConfig(env, g);
    return json({ ok: true });
  }

  if (p === "/api/gist/push" && method === "POST") {
    try {
      const r = await gistPushCore(env, Date.now(), "手动上传");
      return json({ ok: true, created: r.action === "created", gist_id: r.gist_id, html_url: r.html_url || "" });
    } catch (e) {
      return fail(String((e && e.message) || e), 502);
    }
  }

  // 下载：用 Gist 备份覆盖本地任务。本地执行历史保留，D1 自增 id 续号，不与旧日志混淆
  if (p === "/api/gist/pull" && method === "POST") {
    try {
      const r = await gistPullCore(env, Date.now(), "手动下载恢复");
      return json({ ok: true, imported: r.imported || 0, skipped: r.skipped || 0 });
    } catch (e) {
      return fail(String((e && e.message) || e), 502);
    }
  }

  return fail("Not Found", 404);
}

// ------------------------------------------------------------------------- Worker

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-headers": "Content-Type, X-Auth",
        "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
      }});
    }
    if (url.pathname === "/" || url.pathname === "/index.html") {
      return new Response(HTML, {
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
      });
    }
    if (!url.pathname.startsWith("/api/")) return new Response("Not Found", { status: 404 });
    try {
      return await handleApi(request, env, url, ctx);
    } catch (e) {
      console.error("api error:", String(e && e.stack || e));
      return fail("服务器内部错误: " + String((e && e.message) || e), 500);
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(ensureSchema(env)
      .then(() => runDue(env, Date.now()))
      .then(() => autoSync(env, "timer"))
      .catch((e) => console.error("scheduled error:", String(e))));
  },
};
