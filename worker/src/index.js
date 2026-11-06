// index.js —— web-cron Cloudflare Worker 入口
// 架构：Cron Trigger 每分钟唤醒 -> 查 next_run_at 到期任务 -> 执行并计算下次时间
// 存储：D1；认证：X-Auth 请求头比对 PANEL_PASSWORD（secret）
import { computeNextRun, validateCron, fmtTs } from "./cron.js";
import { browserHeaders } from "./headers.js";
import { HTML } from "./ui.js";

const HISTORY_KEEP = 200;

// 旧库平滑迁移：tasks 缺 sort_order 列时自动补上（列已存在时报错被忽略）。
// 新装库由 schema.sql 直接建好该列；已有部署首个请求/第一次调度时自动完成迁移。
let schemaReady = null;
function ensureSchema(env) {
  if (!schemaReady) {
    schemaReady = env.DB.prepare(
      "ALTER TABLE tasks ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0"
    ).run().catch(() => {});
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
  return {
    name, url, method,
    headers: String(data.headers || ""),
    body: String(data.body || ""),
    schedule_type: st, interval_minutes, cron_expr, timeout_seconds, retries,
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
  // 执行结束后 executeTask 用同一个 now 再算一次，值相同，幂等。
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

async function handleApi(req, env, url) {
  await ensureSchema(env);
  const p = url.pathname;
  const method = req.method;
  const body = async () => { try { return await req.json(); } catch (_) { return {}; } };

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
      "timeout_seconds,retries,enabled,sort_order,created_at,updated_at,next_run_at) VALUES(?,?,?,?,?,?,?,?,?,?,1,?,?,?,?)"
    ).bind(f.name, f.url, f.method, f.headers, f.body, f.schedule_type,
           f.interval_minutes, f.cron_expr, f.timeout_seconds, f.retries,
           Number(mr?.m || 0) + 1, now, now, next).run();
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
        "cron_expr=?,timeout_seconds=?,retries=?,updated_at=?,next_run_at=? WHERE id=?"
      ).bind(f.name, f.url, f.method, f.headers, f.body, f.schedule_type,
             f.interval_minutes, f.cron_expr, f.timeout_seconds, f.retries,
             now, next, id).run();
      return json({ ok: true, next_run_at: next });
    }

    if (p === "/api/tasks/" + id && method === "DELETE") {
      await env.DB.batch([
        env.DB.prepare("DELETE FROM tasks WHERE id=?").bind(id),
        env.DB.prepare("DELETE FROM history WHERE task_id=?").bind(id),
      ]);
      return json({ ok: true });
    }

    if (action === "toggle" && method === "POST") {
      const enabled = task.enabled ? 0 : 1;
      const next = enabled ? computeNextRun(task, Date.now(), tz(env)) : null;
      await env.DB.prepare("UPDATE tasks SET enabled=?,next_run_at=? WHERE id=?")
        .bind(enabled, next, id).run();
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
        "timeout_seconds,retries,enabled,sort_order,created_at,updated_at,next_run_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
      ).bind(f.name, f.url, f.method, f.headers, f.body, f.schedule_type,
             f.interval_minutes, f.cron_expr, f.timeout_seconds, f.retries,
             enabled, so, now, now, next).run();
      imported++;
    }
    return json({ ok: true, imported, skipped });
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
      return await handleApi(request, env, url);
    } catch (e) {
      console.error("api error:", String(e && e.stack || e));
      return fail("服务器内部错误: " + String((e && e.message) || e), 500);
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(ensureSchema(env).then(() => runDue(env, Date.now())));
  },
};
