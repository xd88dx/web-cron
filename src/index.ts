// index.ts —— web-cron Node 主线入口（Fastify）
// 单进程：HTTP 服务 + 内嵌调度器 + 可选 Playwright Chromium。
// 监听 0.0.0.0:$PORT，PORT 由托管平台注入。
import fs from "node:fs/promises";
import path from "node:path";
import Fastify from "fastify";
import { computeNextRun, fmtTs } from "./cron.js";
import { validateTask, type TaskFields } from "./validate.js";
import { browserState, detectBrowser, shutdownBrowser } from "./browser.js";
import {
  initStore, read, mutate, stats, getTask, historyFor, taskDefaults,
  screenshotsDir,
} from "./store.js";
import { executeTask, startScheduler, stopScheduler, isRunning } from "./scheduler.js";
import { HTML } from "./ui.js";
import type { Task, StoreData } from "./types.js";

const PORT = parseInt(process.env.PORT || "8080", 10);
const HOST = process.env.HOST || "0.0.0.0";
const TZ = process.env.APP_TIMEZONE || "Asia/Shanghai";
const PASSWORD = process.env.PANEL_PASSWORD || "";

const app = Fastify({ logger: false, bodyLimit: 2 * 1024 * 1024 });

function makeTask(id: number, f: TaskFields, now: number): Task {
  // 默认值必须在前：否则 taskDefaults() 会把 f 里的 mode / cron_expr / 浏览器字段全部覆盖掉
  return {
    id, ...taskDefaults(), ...f,
    created_at: now, updated_at: now,
    next_run_at: computeNextRun(f, now, TZ),
  };
}

// ------------------------------------------------------------------ 通用响应 / CORS / 认证

function json(reply: any, data: unknown, status = 200) {
  return reply.code(status)
    .header("content-type", "application/json; charset=utf-8")
    .header("cache-control", "no-store")
    .send(JSON.stringify(data));
}
const fail = (reply: any, msg: string, status = 400) => json(reply, { error: msg }, status);

app.addHook("onRequest", async (req, reply) => {
  reply.header("access-control-allow-origin", "*");
  reply.header("access-control-allow-headers", "Content-Type, X-Auth");
  reply.header("access-control-allow-methods", "GET, POST, PUT, DELETE, OPTIONS");
  if (req.method === "OPTIONS") { reply.code(204).send(); return; }
  const p = (req.url || "").split("?")[0];
  if (PASSWORD && p.startsWith("/api/") && p !== "/api/login") {
    if (req.headers["x-auth"] !== PASSWORD) {
      reply.code(401).header("content-type", "application/json; charset=utf-8")
        .send(JSON.stringify({ error: "unauthorized" }));
    }
  }
});

// --------------------------------------------------------------------------- 页面

app.get("/", async (_req, reply) => {
  return reply.header("content-type", "text/html; charset=utf-8")
    .header("cache-control", "no-store").send(HTML);
});

app.post("/api/login", async (req, reply) => {
  const d = (req.body || {}) as any;
  if (String(d.password || "") === PASSWORD) return json(reply, { ok: true });
  return fail(reply, "密码错误", 401);
});

// --------------------------------------------------------------------------- 任务 API

app.get("/api/tasks", async (_req, reply) => {
  const d = read();
  const bs = browserState();
  const list = [...d.tasks].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || a.id - b.id);
  return json(reply, {
    tasks: list.map((t) => ({
      ...t,
      next_run_at_str: t.enabled ? fmtTs(t.next_run_at, TZ) : null,
      last_run_at_str: fmtTs(t.last_run_at, TZ),
    })),
    stats: stats(),
    auth_required: Boolean(PASSWORD),
    timezone: TZ,
    browser_available: bs.capable,
    browser_running: bs.running,
    browser_reason: bs.reason,
    browser_concurrency: parseInt(process.env.BROWSER_MAX_CONCURRENCY || "2", 10),
  });
});

app.post("/api/tasks", async (req, reply) => {
  let f: TaskFields;
  try { f = validateTask(req.body); } catch (e: any) { return fail(reply, e.message); }
  const now = Date.now();
  const t = await mutate((d: StoreData) => {
    d.seqTask += 1;
    const task = makeTask(d.seqTask, f, now);
    // 新任务排在列表末尾
    task.sort_order = d.tasks.reduce((m, x) => Math.max(m, x.sort_order || 0), 0) + 1;
    d.tasks.push(task);
    return task;
  });
  return json(reply, { ok: true, id: t.id, next_run_at: t.next_run_at });
});

// 拖拽排序持久化：ids 必须恰好是全部任务 id 的一个排列，按数组顺序写入 sort_order
app.post("/api/tasks/reorder", async (req, reply) => {
  const ids: unknown = (req.body as any)?.ids;
  if (!Array.isArray(ids) || ids.length === 0 || ids.some((x) => !Number.isInteger(x))) {
    return fail(reply, "ids 必须是非空的任务 id 数组");
  }
  const r = await mutate((d) => {
    const want = ids as number[];
    const have = d.tasks.map((t) => t.id);
    if (want.length !== have.length || new Set(want).size !== want.length ||
        want.some((id) => !have.includes(id))) {
      return null;
    }
    want.forEach((id, i) => {
      const t = d.tasks.find((x) => x.id === id)!;
      t.sort_order = i + 1;
      t.updated_at = Date.now();
    });
    return true;
  });
  if (r === null) return fail(reply, "ids 必须恰好包含全部任务 id");
  return json(reply, { ok: true });
});

app.put("/api/tasks/:id", async (req, reply) => {
  const id = Number((req.params as any).id);
  let f: TaskFields;
  try { f = validateTask(req.body); } catch (e: any) { return fail(reply, e.message); }
  const now = Date.now();
  const r = await mutate((d) => {
    const t = d.tasks.find((x) => x.id === id);
    if (!t) return null;
    Object.assign(t, f, { updated_at: now });
    t.next_run_at = t.enabled ? computeNextRun(t, now, TZ) : null;
    return { next_run_at: t.next_run_at };
  });
  if (!r) return fail(reply, "任务不存在", 404);
  return json(reply, { ok: true, next_run_at: r.next_run_at });
});

app.delete("/api/tasks/:id", async (req, reply) => {
  const id = Number((req.params as any).id);
  const ok = await mutate((d) => {
    const i = d.tasks.findIndex((x) => x.id === id);
    if (i < 0) return false;
    d.tasks.splice(i, 1);
    d.history = d.history.filter((h) => h.task_id !== id);
    return true;
  });
  if (!ok) return fail(reply, "任务不存在", 404);
  return json(reply, { ok: true });
});

app.post("/api/tasks/:id/toggle", async (req, reply) => {
  const id = Number((req.params as any).id);
  const r = await mutate((d) => {
    const t = d.tasks.find((x) => x.id === id);
    if (!t) return null;
    t.enabled = t.enabled ? 0 : 1;
    t.next_run_at = t.enabled ? computeNextRun(t, Date.now(), TZ) : null;
    return { enabled: t.enabled, next_run_at: t.next_run_at };
  });
  if (!r) return fail(reply, "任务不存在", 404);
  return json(reply, { ok: true, ...r });
});

app.post("/api/tasks/:id/run", async (req, reply) => {
  const id = Number((req.params as any).id);
  if (!getTask(id)) return fail(reply, "任务不存在", 404);
  if (isRunning(id)) return fail(reply, "任务正在执行中，请稍后再试", 409);
  const res = await executeTask(id);
  return json(reply, { result: res });
});

app.get("/api/tasks/:id/history", async (req, reply) => {
  const id = Number((req.params as any).id);
  const q = new URL(req.url, "http://x").searchParams;
  const limit = Math.min(200, Math.max(1, parseInt(q.get("limit") || "50", 10) || 50));
  return json(reply, { history: historyFor(id, limit), timezone: TZ });
});

app.get("/api/export", async (_req, reply) => {
  return json(reply, {
    app: "web-cron-node", version: 1, exported_at: Date.now(),
    tasks: read().tasks,
  });
});

app.post("/api/import", async (req, reply) => {
  let d: any = req.body;
  if (typeof d === "string") { try { d = JSON.parse(d); } catch { return fail(reply, "导入内容不是合法 JSON"); } }
  const tasks = Array.isArray(d?.tasks) ? d.tasks : [];
  if (!tasks.length) return fail(reply, "导入文件中没有任务数据");
  const now = Date.now();
  let imported = 0, skipped = 0;
  await mutate((store) => {
    for (const raw of tasks) {
      let f: TaskFields;
      try { f = validateTask(raw); } catch { skipped++; continue; }
      store.seqTask += 1;
      const t = makeTask(store.seqTask, f, now);
      t.enabled = raw.enabled === 0 ? 0 : 1;
      if (!t.enabled) t.next_run_at = null;
      t.sort_order = store.tasks.reduce((m, x) => Math.max(m, x.sort_order || 0), 0) + 1;
      store.tasks.push(t);
      imported++;
    }
  });
  return json(reply, { ok: true, imported, skipped });
});

// 截图只读接口：文件名严格白名单，防目录穿越
app.get("/api/screenshot", async (req, reply) => {
  const name = new URL(req.url, "http://x").searchParams.get("name") || "";
  if (!/^task_\d+_\d+\.png$/.test(name)) return fail(reply, "非法文件名", 400);
  try {
    const buf = await fs.readFile(path.join(screenshotsDir(), name));
    return reply.header("content-type", "image/png").header("cache-control", "no-store").send(buf);
  } catch {
    return fail(reply, "截图不存在", 404);
  }
});

// --------------------------------------------------------------------------- 启动 / 关闭

async function main() {
  initStore();
  await app.listen({ port: PORT, host: HOST });
  console.log(`[http] web-cron 已启动 http://${HOST}:${PORT} · 时区 ${TZ}`);
  if (!PASSWORD) console.warn("[http] ⚠️ 未设置 PANEL_PASSWORD，管理面板对公网裸露，请务必设置");
  startScheduler();
  // 浏览器探测放到后台，不阻塞 Web 服务；失败即自动降级为纯 HTTP
  detectBrowser().catch((e) => console.error("[browser] 探测异常: " + String(e)));
}

async function shutdown() {
  stopScheduler();
  await shutdownBrowser().catch(() => undefined);
  await app.close().catch(() => undefined);
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

main().catch((e) => {
  console.error("[fatal] " + String(e?.stack || e));
  process.exit(1);
});
