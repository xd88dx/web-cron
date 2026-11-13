// validate.ts —— 任务输入校验与规范化
import { validateCron } from "./cron.js";
import type { Mode, Task, WaitUntil } from "./types.js";

const METHODS = ["GET", "POST", "PUT", "DELETE", "HEAD", "PATCH"];
const WAIT_UNTILS: WaitUntil[] = ["commit", "domcontentloaded", "load", "networkidle"];

export type TaskFields = Pick<
  Task,
  | "name" | "url" | "method" | "headers" | "body"
  | "schedule_type" | "interval_minutes" | "cron_expr" | "jitter_minutes"
  | "timeout_seconds" | "retries" | "mode"
  | "ssh_host" | "ssh_port" | "ssh_user" | "ssh_command"
  | "ssh_auth" | "ssh_password" | "ssh_key_name"
  | "browser_wait_until" | "browser_wait_selector" | "browser_assert"
  | "browser_dwell_ms" | "browser_proxy" | "browser_ua"
  | "browser_screenshot" | "http_fallback_browser"
>;

function int(v: unknown, def: number, min: number, max: number): number {
  const n = parseInt(String(v ?? ""), 10);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}

export function validateTask(data: any): TaskFields {
  const d = data && typeof data === "object" ? data : {};
  const name = String(d.name || "").trim();
  if (!name) throw new Error("名称不能为空");

  const mode: Mode = d.mode === "browser" ? "browser" : d.mode === "ssh" ? "ssh" : "http";
  // SSH 任务没有 http URL，url 由 ssh 参数推导（也作为 Gist 同步的合并键）
  let url = String(d.url || "").trim();
  const ssh_host = String(d.ssh_host || "").trim();
  const ssh_user = String(d.ssh_user || "").trim();
  const ssh_command = String(d.ssh_command || "").trim();
  const ssh_port = int(d.ssh_port, 22, 1, 65535);
  const ssh_auth: "password" | "key" = d.ssh_auth === "key" ? "key" : "password";
  if (mode === "ssh") {
    if (!ssh_host) throw new Error("SSH 主机不能为空");
    if (!ssh_user) throw new Error("SSH 用户名不能为空");
    if (!ssh_command) throw new Error("SSH 命令不能为空");
    if (ssh_auth === "key" && !String(d.ssh_key_name || "").trim()) {
      throw new Error("密钥方式需选择一把密钥");
    }
    url = `ssh://${ssh_user}@${ssh_host}:${ssh_port}`;
  } else {
    if (!/^https?:\/\//i.test(url)) throw new Error("URL 必须以 http:// 或 https:// 开头");
  }

  const schedule_type = d.schedule_type === "cron" ? "cron" : "interval";
  let interval_minutes: number | null = null;
  let cron_expr: string | null = null;
  if (schedule_type === "cron") {
    cron_expr = String(d.cron_expr || "").trim();
    validateCron(cron_expr);
  } else {
    interval_minutes = int(d.interval_minutes, 0, 1, 1000000);
    if (interval_minutes < 1) throw new Error("间隔至少 1 分钟");
  }

  const method = String(d.method || "GET").toUpperCase();
  if (!METHODS.includes(method)) throw new Error("不支持的请求方法");

  const waitUntil = String(d.browser_wait_until || "domcontentloaded") as WaitUntil;

  const proxy = String(d.browser_proxy || "").trim();
  if (proxy && !/^(https?|socks5h?|socks4):\/\//i.test(proxy)) {
    throw new Error("代理地址需以 http:// / https:// / socks5:// 开头");
  }

  return {
    name, url, method,
    headers: String(d.headers || ""),
    body: String(d.body || ""),
    schedule_type, interval_minutes, cron_expr,
    jitter_minutes: int(d.jitter_minutes, 0, 0, 1440),
    timeout_seconds: int(d.timeout_seconds, 30, 1, 120),
    retries: int(d.retries, 0, 0, 5),
    mode,
    ssh_host, ssh_port, ssh_user, ssh_command, ssh_auth,
    ssh_password: String(d.ssh_password || ""),
    ssh_key_name: String(d.ssh_key_name || "").trim(),
    browser_wait_until: WAIT_UNTILS.includes(waitUntil) ? waitUntil : "domcontentloaded",
    browser_wait_selector: String(d.browser_wait_selector || "").trim(),
    browser_assert: String(d.browser_assert || "").trim(),
    browser_dwell_ms: int(d.browser_dwell_ms, 0, 0, 30000),
    browser_proxy: proxy,
    browser_ua: String(d.browser_ua || "").trim(),
    browser_screenshot: d.browser_screenshot ? 1 : 0,
    http_fallback_browser: d.http_fallback_browser ? 1 : 0,
  };
}

// 请求头文本：支持 "Key: Value" 每行，或 JSON 对象
export function parseHeaders(text: unknown): Record<string, string> {
  const s = String(text || "").trim();
  if (!s) return {};
  if (s.charAt(0) === "{") {
    try {
      const o = JSON.parse(s);
      const out: Record<string, string> = {};
      for (const k of Object.keys(o)) out[k] = String(o[k]);
      return out;
    } catch { return {}; }
  }
  const out: Record<string, string> = {};
  for (const line of s.split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}
