// scheduler.ts —— 定时调度与执行编排
// 防重核心：tick 时「先占坑」—— 在同一个原子写里把 next_run_at 推进到下次，
// 再异步执行。即使单个任务拖过多个触发窗口，也不会被重复捞起。
// Node 单进程单事件循环，天然没有多 worker 各起一份调度器的问题。
import { computeNextRun } from "./cron.js";
import { doHttp, shouldFallback } from "./http.js";
import { doSsh } from "./ssh.js";
import { browserState, executeBrowser } from "./browser.js";
import { mutate, read, insertHistory, getTask } from "./store.js";
import type { Task, ExecResult } from "./types.js";

const TZ = process.env.APP_TIMEZONE || "Asia/Shanghai";
const TICK_MS = 5000;
const running = new Set<number>();

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
export function isRunning(id: number): boolean { return running.has(id); }

// 单次执行：按 mode 分派，并处理「自动升级」与「环境降级」
async function executeOnce(task: Task): Promise<ExecResult> {
  if (task.mode === "ssh") {
    const res = await doSsh(task, read().sshKeys);
    res.note = "SSH 命令";
    return res;
  }

  const capable = browserState().capable;
  const wantBrowser = task.mode === "browser";

  if (wantBrowser && !capable) {
    const res = await doHttp(task);
    res.degraded = true;
    res.note = "本应使用浏览器仿真，当前环境无 Chromium，已自动降级为 HTTP";
    if (!res.error) res.error = "已降级为 HTTP（当前环境不支持浏览器仿真）";
    return res;
  }

  if (wantBrowser) {
    const res = await executeBrowser(task);
    res.note = "真实浏览器仿真（Chromium）" + (res.note ? " · " + res.note : "");
    return res;
  }

  const res = await doHttp(task);
  res.note = "HTTP 请求";
  if (!res.ok && task.http_fallback_browser && shouldFallback(res)) {
    if (browserState().capable) {
      const br = await executeBrowser(task);
      br.note = "HTTP 触发反爬信号 → 已自动升级为浏览器仿真重试" + (br.note ? " · " + br.note : "");
      return br;
    }
    res.note = "HTTP 请求（需浏览器升级，但当前环境不支持）";
    res.error = (res.error ? res.error + " · " : "") + "需浏览器仿真但当前环境不支持，未自动升级";
  }
  return res;
}

async function runWithRetries(task: Task): Promise<ExecResult> {
  const attempts = Math.max(0, Number(task.retries) || 0) + 1;
  let res: ExecResult | null = null;
  for (let i = 0; i < attempts; i++) {
    res = await executeOnce(task);
    if (res.ok) break;
    if (i < attempts - 1) await sleep(Math.min(5000, 2 ** i * 1000));
  }
  return res!;
}

export async function executeTask(
  taskId: number,
  opts: { now?: number } = {},
): Promise<ExecResult | null> {
  const task = getTask(taskId);
  if (!task) return null;
  const snapshot: Task = { ...task };
  const res = await runWithRetries(snapshot);
  const now = Date.now();

  await mutate((d) => {
    const t = d.tasks.find((x) => x.id === taskId);
    if (!t) return;
    t.last_run_at = now;
    t.last_ok = res.ok ? 1 : 0;
    t.last_status_code = res.status_code;
    t.last_duration_ms = res.duration_ms;
    t.last_error = res.error;
    t.last_mode = res.mode;
    t.last_final_url = res.final_url;
    t.last_page_title = res.page_title;
    t.last_challenge = res.challenge ? 1 : 0;
    t.success_count += res.ok ? 1 : 0;
    t.fail_count += res.ok ? 0 : 1;
    insertHistory(d, {
      task_id: taskId, task_name: t.name, run_at: now,
      ok: res.ok ? 1 : 0, status_code: res.status_code,
      duration_ms: res.duration_ms, error: res.error, snippet: res.snippet,
      mode: res.mode, final_url: res.final_url, page_title: res.page_title,
      challenge: res.challenge ? 1 : 0, screenshot: res.screenshot,
      degraded: res.degraded ? 1 : 0, note: res.note,
    });
  });
  return res;
}

export async function tick(): Promise<void> {
  const now = Date.now();
  // 快速路径：绝大多数 tick 没有到期任务，不触发落盘
  const hasDue = read().tasks.some(
    (t) => t.enabled === 1 && t.next_run_at !== null && t.next_run_at <= now,
  );
  if (!hasDue) return;

  const due = await mutate((d) => {
    const out: Task[] = [];
    for (const t of d.tasks) {
      if (t.enabled === 1 && t.next_run_at !== null && t.next_run_at <= now) {
        t.next_run_at = computeNextRun(t, now, TZ); // 先占坑
        out.push({ ...t });
      }
    }
    return out;
  });

  for (const t of due) running.add(t.id);
  // Node 事件循环内并发派发；浏览器任务由 browser.ts 的信号量限制到 MAX
  await Promise.allSettled(due.map(async (t) => {
    try { await executeTask(t.id, { now }); }
    catch (e) { console.error("[scheduler] task " + t.id + " failed: " + String(e)); }
    finally { running.delete(t.id); }
  }));
}

let timer: NodeJS.Timeout | null = null;
export function startScheduler(): void {
  if (timer) return;
  timer = setInterval(() => {
    tick().catch((e) => console.error("[scheduler] tick error: " + String(e)));
  }, TICK_MS);
  setTimeout(() => tick().catch(() => undefined), 1000);
  console.log(`[scheduler] 启动 · 每 ${TICK_MS / 1000}s 检查 · 时区 ${TZ}`);
}

export function stopScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
