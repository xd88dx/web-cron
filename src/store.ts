// store.ts —— JSON 原子文件存储（零原生依赖，Docker 与免费托管同构）
// 单进程 + 串行写队列：所有修改经 mutate() 排队，写临时文件 -> fsync -> rename。
// 规模约 10 任务 × 200 条历史，JSON 完全够用；也避免 better-sqlite3 在廉价托管上编译失败。
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import type { StoreData, Task, HistoryEntry, StoreStats } from "./types.js";

const DATA_DIR = path.resolve(process.env.DATA_DIR || "data");
const FILE = path.join(DATA_DIR, "store.json");
export const HISTORY_KEEP = 200;

function empty(): StoreData {
  return { version: 1, seqTask: 0, seqHistory: 0, tasks: [], history: [] };
}

// 读取旧数据时补齐新增字段，保证升级不丢任务
export function taskDefaults(): Omit<Task, "id" | "name" | "url"> {
  return {
    method: "GET", headers: "", body: "",
    schedule_type: "interval", interval_minutes: 5, cron_expr: null,
    timeout_seconds: 30, retries: 0, enabled: 1,
    mode: "http", browser_wait_until: "domcontentloaded",
    browser_wait_selector: "", browser_assert: "", browser_dwell_ms: 0,
    browser_proxy: "", browser_ua: "", browser_screenshot: 0,
    http_fallback_browser: 0,
    created_at: Date.now(), updated_at: Date.now(), next_run_at: null,
    last_run_at: null, last_ok: null, last_status_code: null,
    last_duration_ms: null, last_error: "", last_mode: null,
    last_final_url: "", last_page_title: "", last_challenge: 0,
    success_count: 0, fail_count: 0,
  };
}

function normalizeTask(t: any): Task {
  return { ...taskDefaults(), ...t } as Task;
}

function normalizeHistory(h: any): HistoryEntry {
  return {
    id: Number(h.id) || 0, task_id: Number(h.task_id) || 0,
    task_name: String(h.task_name || ""), run_at: Number(h.run_at) || 0,
    ok: h.ok ? 1 : 0, status_code: h.status_code ?? null,
    duration_ms: Number(h.duration_ms) || 0, error: String(h.error || ""),
    snippet: String(h.snippet || ""), mode: h.mode === "browser" ? "browser" : "http",
    final_url: String(h.final_url || ""), page_title: String(h.page_title || ""),
    challenge: h.challenge ? 1 : 0, screenshot: String(h.screenshot || ""),
    degraded: h.degraded ? 1 : 0, note: String(h.note || ""),
  };
}

let data: StoreData = empty();
let queue: Promise<unknown> = Promise.resolve();

export function initStore(): void {
  fsSync.mkdirSync(DATA_DIR, { recursive: true });
  fsSync.mkdirSync(path.join(DATA_DIR, "profiles"), { recursive: true });
  fsSync.mkdirSync(path.join(DATA_DIR, "screenshots"), { recursive: true });
  if (fsSync.existsSync(FILE)) {
    try {
      const raw = JSON.parse(fsSync.readFileSync(FILE, "utf8"));
      const tasks: Task[] = Array.isArray(raw.tasks) ? raw.tasks.map(normalizeTask) : [];
      const history: HistoryEntry[] = Array.isArray(raw.history) ? raw.history.map(normalizeHistory) : [];
      data = {
        version: 1,
        seqTask: Number(raw.seqTask) || tasks.reduce((m, t) => Math.max(m, t.id), 0),
        seqHistory: Number(raw.seqHistory) || history.reduce((m, h) => Math.max(m, h.id), 0),
        tasks, history,
      };
    } catch (e) {
      // 文件损坏时不静默丢数据：备份后从空库启动
      const bak = FILE + ".corrupt." + Date.now();
      fsSync.copyFileSync(FILE, bak);
      console.error("[store] store.json 解析失败，已备份到 " + bak + "，从空库启动:", String(e));
      data = empty();
    }
  }
  console.log(`[store] ${FILE} · ${data.tasks.length} 个任务 / ${data.history.length} 条历史`);
}

export function read(): StoreData {
  return data;
}

async function persist(): Promise<void> {
  const tmp = FILE + ".tmp";
  const fh = await fs.open(tmp, "w");
  try {
    await fh.writeFile(JSON.stringify(data), "utf8");
    await fh.sync();
  } finally {
    await fh.close();
  }
  await fs.rename(tmp, FILE);
}

// 串行化所有写操作；fn 抛错时回滚内存快照，不落盘
export function mutate<T>(fn: (d: StoreData) => T | Promise<T>): Promise<T> {
  const job = queue.then(async () => {
    const snapshot = data;
    const draft: StoreData = {
      ...data,
      tasks: data.tasks.map((t) => ({ ...t })),
      history: data.history.map((h) => ({ ...h })),
    };
    try {
      const r = await fn(draft);
      data = draft;
      await persist();
      return r;
    } catch (e) {
      data = snapshot;
      throw e;
    }
  });
  queue = job.then(() => undefined, () => undefined);
  return job;
}

export function getTask(id: number): Task | undefined {
  return data.tasks.find((t) => t.id === id);
}

export function stats(): StoreStats {
  const since = Date.now() - 86400000;
  const h = data.history.filter((x) => x.run_at >= since);
  return {
    tasks: data.tasks.length,
    enabled: data.tasks.filter((t) => t.enabled === 1).length,
    runs24: h.length,
    rate24: h.length ? Math.round((h.filter((x) => x.ok === 1).length * 1000) / h.length) / 10 : null,
  };
}

export function insertHistory(d: StoreData, entry: Omit<HistoryEntry, "id">): void {
  d.seqHistory += 1;
  d.history.push({ id: d.seqHistory, ...entry });
  // 每任务仅保留最近 HISTORY_KEEP 条
  const keep = new Map<number, number>();
  for (let i = d.history.length - 1; i >= 0; i--) {
    const h = d.history[i];
    const n = (keep.get(h.task_id) || 0) + 1;
    keep.set(h.task_id, n);
    if (n > HISTORY_KEEP) d.history.splice(i, 1);
  }
}

export function historyFor(taskId: number, limit: number): HistoryEntry[] {
  return data.history
    .filter((h) => h.task_id === taskId)
    .sort((a, b) => b.id - a.id)
    .slice(0, limit);
}

export function profilesDir(): string { return path.join(DATA_DIR, "profiles"); }
export function screenshotsDir(): string { return path.join(DATA_DIR, "screenshots"); }
