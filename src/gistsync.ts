// gistsync.ts —— Gist 自动同步核心
// 场景：两台机器轮流值班（一台醒着一台休眠），各自跑一份 web-cron，靠 Gist 保持任务配置一致。
// 关键是三方对比（本地指纹 / Gist 指纹 / 同步基线），而不是「有差异就推」——
// 否则刚唤醒的机器 B 会把自己过时的配置推上去，覆盖机器 A 刚推送的新修改。
//   本地≠基线、Gist==基线 → 本地有新修改 → 推送
//   Gist≠基线、本地==基线 → 对方推过、本地是旧的 → 拉取（绝不推）
//   两边都≠基线         → 冲突 → 跳过并告警（等人工处理）
// 指纹只算任务配置字段，排除 id / 执行统计 / 时间戳等易变字段，任务跑一次不会被误判为修改。
import { createHash } from "node:crypto";
import { read, mutate, makeTask, taskDefaults } from "./store.js";
import { validateTask, type TaskFields } from "./validate.js";
import type { Task, StoreData } from "./types.js";

export const GIST_API = "https://api.github.com/gists";
export const GIST_FILE = "web-cron.json";

// ------------------------------------------------------------------ 配置指纹

// 参与指纹的配置字段（顺序固定，三版语义一致；各版本可按自身字段增删，只需自洽）
const CONFIG_FIELDS = [
  "name", "url", "method", "headers", "body",
  "schedule_type", "interval_minutes", "cron_expr", "jitter_minutes",
  "timeout_seconds", "retries", "enabled", "sort_order",
  "mode", "browser_wait_until", "browser_wait_selector", "browser_assert",
  "browser_dwell_ms", "browser_proxy", "browser_ua",
  "browser_screenshot", "http_fallback_browser",
] as const;

// 规范化：按 (sort_order, id) 排序后投影固定字段，保证同一数据稳定得到同一串
function canonicalConfig(tasks: Task[]): unknown[] {
  return [...tasks]
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || a.id - b.id)
    .map((t) => {
      const o: Record<string, unknown> = {};
      for (const k of CONFIG_FIELDS) o[k] = (t as unknown as Record<string, unknown>)[k] ?? null;
      return o;
    });
}

export function configHash(tasks: Task[]): string {
  return createHash("sha256").update(JSON.stringify(canonicalConfig(tasks)), "utf8").digest("hex");
}

// Gist 上的原始 JSON 先过与本地一致的规范化（validate + 默认值 + enabled/sort_order），
// 再算指纹——否则「null vs ""」这类规范化差异会让两边指纹永远对不上，造成反复空拉。
function normalizeForHash(raw: any): Task | null {
  let f: TaskFields;
  try { f = validateTask(raw); } catch { return null; }
  const t = { ...taskDefaults(), ...f } as Task;
  t.enabled = raw && raw.enabled === 0 ? 0 : 1;
  t.sort_order = Number(raw?.sort_order) > 0 ? Number(raw.sort_order) : 0;
  return t;
}

export function hashLikeLocal(tasks: any[]): string {
  const normalized = tasks.map(normalizeForHash).filter((t): t is Task => t !== null);
  return configHash(normalized);
}

function gistConfig() {
  return read().gist;
}

// ------------------------------------------------------------------ GitHub API

function gistHeaders(token: string): Record<string, string> {
  return {
    "authorization": `Bearer ${token}`,
    "accept": "application/vnd.github+json",
    "user-agent": "web-cron",
    "content-type": "application/json",
  };
}

async function gistError(r: Response): Promise<string> {
  if (r.status === 401) return "GitHub Token 无效或缺少 gist 权限";
  if (r.status === 403) return "GitHub API 拒绝访问（可能限流，或 Token 无 gist 权限）";
  if (r.status === 404) return "Gist 不存在，请检查 Gist ID";
  return "GitHub API HTTP " + r.status;
}

async function setGist(patch: Partial<ReturnType<typeof gistConfig>>): Promise<void> {
  await mutate((st) => { Object.assign(st.gist, patch); });
}

// ------------------------------------------------------------------ 推 / 拉核心（端点与自动同步共用）

export interface SyncOutcome {
  action: "pushed" | "pulled" | "created";
  imported?: number;
  skipped?: number;
  gist_id: string;
  html_url?: string;
}

// 上传：无 gist_id 时自动创建私密 Gist 并把 id 回写到本地配置
export async function pushCore(now: number, reason: string): Promise<SyncOutcome> {
  const g = gistConfig();
  if (!g.token) throw new Error("请先填写 GitHub Token（ghp_ xxx）");
  const tasks = read().tasks;
  const hash = configHash(tasks);
  const content = JSON.stringify({
    app: "web-cron-node", version: 1, exported_at: now, tasks,
  }, null, 2);
  let r: Response;
  try {
    r = g.gist_id
      ? await fetch(`${GIST_API}/${g.gist_id}`, {
          method: "PATCH", headers: gistHeaders(g.token),
          body: JSON.stringify({ files: { [GIST_FILE]: { content } } }),
        })
      : await fetch(GIST_API, {
          method: "POST", headers: gistHeaders(g.token),
          body: JSON.stringify({
            description: "web-cron", public: false,
            files: { [GIST_FILE]: { content } },
          }),
        });
  } catch (e: any) {
    throw new Error("无法访问 GitHub API：" + String(e?.message || e));
  }
  if (!r.ok) throw new Error(await gistError(r));
  const j = await r.json() as any;
  const gist_id = String(j.id || g.gist_id || "");
  const patch: Partial<ReturnType<typeof gistConfig>> = {
    gist_id, baseline_hash: hash, synced_at: now, last_result: reason,
  };
  if (gist_id !== g.gist_id) patch.gist_id = gist_id;
  await setGist(patch);
  return { action: g.gist_id ? "pushed" : "created", gist_id, html_url: j.html_url || "" };
}

// 下载：用 Gist 备份覆盖本地任务。执行历史保留，新任务用全新 id（续号），不与旧日志混淆
export async function pullCore(now: number, reason: string): Promise<SyncOutcome> {
  const g = gistConfig();
  if (!g.token) throw new Error("请先填写 GitHub Token（ghp_ xxx）");
  if (!g.gist_id) throw new Error("还没有 Gist ID，可先执行「上传到 Gist」自动创建");
  let r: Response;
  try {
    r = await fetch(`${GIST_API}/${g.gist_id}`, { headers: gistHeaders(g.token) });
  } catch (e: any) {
    throw new Error("无法访问 GitHub API：" + String(e?.message || e));
  }
  if (!r.ok) throw new Error(await gistError(r));
  const j = await r.json() as any;
  const content = j?.files?.[GIST_FILE]?.content;
  if (typeof content !== "string" || !content) throw new Error(`Gist 中没有找到 ${GIST_FILE}`);
  let d: any;
  try { d = JSON.parse(content); } catch { throw new Error("Gist 备份内容不是合法 JSON"); }
  const tasks = Array.isArray(d?.tasks) ? d.tasks : [];
  if (!tasks.length) throw new Error("Gist 备份中没有任务数据");
  let imported = 0, skipped = 0;
  await mutate((store: StoreData) => {
    store.tasks = [];
    for (const raw of tasks) {
      let f: TaskFields;
      try { f = validateTask(raw); } catch { skipped++; continue; }
      store.seqTask += 1;
      const t = makeTask(store.seqTask, f, now);
      t.enabled = raw.enabled === 0 ? 0 : 1;
      if (!t.enabled) t.next_run_at = null;
      // 保留备份里的排序（0/缺失按 0，列表按 id 兜底）；不发明新值，保证拉取后指纹与 Gist 一致
      t.sort_order = Number(raw.sort_order) > 0 ? Number(raw.sort_order) : 0;
      store.tasks.push(t);
      imported++;
    }
  });
  await setGist({
    baseline_hash: hashLikeLocal(tasks),
    synced_at: now, last_result: reason,
  });
  return { action: "pulled", imported, skipped, gist_id: g.gist_id };
}

// ------------------------------------------------------------------ 自动同步

let syncRunning = false;
let mutationTimer: NodeJS.Timeout | null = null;
let lastCheckAt = 0;
let checkTimer: NodeJS.Timeout | null = null;

async function recordResult(msg: string): Promise<void> {
  await setGist({ synced_at: Date.now(), last_result: msg });
}

// 三方对比决策。返回 null 表示无需动作（未启用 / 单飞行中）
async function autoSyncOnce(trigger: "mutation" | "timer"): Promise<string | null> {
  const now = Date.now();
  const g = gistConfig();
  if (!g.token || !g.auto) return null;
  if (!g.gist_id) {
    // 从未推过：本地有任务就直接推（建立基线），空则无事可做
    if (!read().tasks.length) return null;
    await pushCore(now, "已推送（首次建立基线）");
    return "pushed";
  }
  // 拉取 Gist 现状
  let resp: Response;
  try {
    resp = await fetch(`${GIST_API}/${g.gist_id}`, { headers: gistHeaders(g.token) });
  } catch (e: any) {
    await recordResult("自动同步失败：无法访问 GitHub API：" + String(e?.message || e));
    return null;
  }
  if (!resp.ok) {
    await recordResult("自动同步失败：" + await gistError(resp));
    return null;
  }
  const j = await resp.json() as any;
  let remoteTasks: any[] | null = null;
  const content = j?.files?.[GIST_FILE]?.content;
  if (typeof content === "string" && content) {
    try {
      const d = JSON.parse(content);
      if (Array.isArray(d?.tasks)) remoteTasks = d.tasks;
    } catch { /* 内容坏了按远端为空处理 */ }
  }
  const remoteHash = remoteTasks && remoteTasks.length
    ? hashLikeLocal(remoteTasks) : "";

  const localHash = configHash(read().tasks);
  const base = g.baseline_hash;

  if (!base) {
    // 本机从未与该 Gist 同步过：以 Gist 为准（新机器加入轮换直接拿最新配置）
    if (remoteHash === localHash) {
      await setGist({ baseline_hash: remoteHash, synced_at: now, last_result: "已建立基线（本地与 Gist 一致）" });
      return "baseline";
    }
    if (!remoteHash) {
      if (!localHash) return null;
      await pushCore(now, "已推送（首次建立基线）");
      return "pushed";
    }
    await pullCore(now, "已拉取（首次以 Gist 为准）");
    return "pulled";
  }

  const localChanged = localHash !== base;
  const remoteChanged = remoteHash !== base;
  if (!localChanged && !remoteChanged) return "same";
  if (localChanged && !remoteChanged) {
    await pushCore(now, "已自动推送（本地有修改）");
    return "pushed";
  }
  if (remoteChanged && !localChanged) {
    if (!remoteHash) {
      // Gist 上文件被删：本地是最后一致状态，重新推上去
      await pushCore(now, "已推送（Gist 文件丢失，本地恢复）");
      return "pushed";
    }
    await pullCore(now, "已自动拉取（Gist 有更新）");
    return "pulled";
  }
  // 两边都改过：跳过并告警，等人工选择上传或下载
  await recordResult("⚠ 冲突：本地与 Gist 都有修改，已跳过自动同步，请手动选择上传或下载");
  return "conflict";
}

// 单飞行 + 免重入；错误落进 last_result，不抛出
async function autoSync(trigger: "mutation" | "timer"): Promise<void> {
  if (syncRunning) return;
  syncRunning = true;
  try {
    await autoSyncOnce(trigger);
  } catch (e: any) {
    await recordResult("自动同步失败：" + String(e?.message || e)).catch(() => undefined);
  } finally {
    syncRunning = false;
  }
}

// 任务增删改后立即检查（短暂去抖合并连续编辑）；不阻塞 HTTP 响应
export function scheduleMutationSync(): void {
  if (mutationTimer) clearTimeout(mutationTimer);
  mutationTimer = setTimeout(() => {
    mutationTimer = null;
    autoSync("mutation").catch(() => undefined);
  }, 1500);
}

// 兜底轮询：每 60s 醒一次，按配置的间隔节流（负责「唤醒后追平对方」）
async function timerTick(): Promise<void> {
  const g = gistConfig();
  if (!g.token || !g.auto) return;
  const intervalMs = Math.max(1, g.interval_min) * 60000;
  if (Date.now() - lastCheckAt < intervalMs - 1500) return;
  lastCheckAt = Date.now();
  await autoSync("timer");
}

export function startAutoSync(): void {
  if (checkTimer) return;
  // 启动即检查一次（进程唤醒/重启后立刻追平），之后每 60s 节流检查
  setTimeout(() => { timerTick().catch(() => undefined); }, 3000);
  checkTimer = setInterval(() => {
    timerTick().catch((e) => console.error("[gistsync] tick error: " + String(e)));
  }, 60000);
}

export function stopAutoSync(): void {
  if (checkTimer) clearInterval(checkTimer);
  if (mutationTimer) clearTimeout(mutationTimer);
  checkTimer = null;
  mutationTimer = null;
}
