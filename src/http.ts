// http.ts —— 纯 HTTP 执行（普通站点走这条），以及挑战页 / fallback 判定
import { browserHeaders, pickUa } from "./headers.js";
import { parseHeaders } from "./validate.js";
import { gateSleepError } from "./blitzgate.js";
import type { Task, ExecResult } from "./types.js";

const CHALLENGE_MARKERS = [
  "just a moment", "checking your browser", "attention required",
  "cf-challenge-running", "cf-browser-verification", "cloudflare ray id",
  "enable javascript and cookies to continue", "verify you are human",
  "请稍候", "正在验证", "验证您是真人", "请开启 javascript",
];

export function looksLikeChallenge(text: string): boolean {
  const s = String(text || "").toLowerCase();
  return CHALLENGE_MARKERS.some((m) => s.indexOf(m) >= 0);
}

function extractTitle(html: string): string {
  const m = String(html || "").match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? m[1].replace(/\s+/g, " ").trim().slice(0, 300) : "";
}

function baseResult(): ExecResult {
  return {
    ok: false, status_code: null, duration_ms: 0, error: "", snippet: "",
    mode: "http", final_url: "", page_title: "", challenge: false,
    screenshot: "", degraded: false, note: "",
  };
}

export async function doHttp(task: Task): Promise<ExecResult> {
  const r = baseResult();
  const method = (task.method || "GET").toUpperCase();
  const ua = pickUa(task.id, task.browser_ua);   // 同一任务固定 UA
  const headers = browserHeaders(method, ua);
  Object.assign(headers, parseHeaders(task.headers)); // 用户自定义头优先

  let body: string | undefined;
  if (method !== "GET" && method !== "HEAD" && task.body) {
    body = task.body;
    if (!Object.keys(headers).some((k) => k.toLowerCase() === "content-type")) {
      headers["Content-Type"] = "application/json";
    }
  }

  const timeoutMs = task.timeout_seconds * 1000;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const t0 = performance.now();
  try {
    // Node 的 fetch(undici) 自动添加 Accept-Encoding 并解压 gzip/deflate
    const resp = await fetch(task.url, {
      method, headers, body, signal: ctrl.signal, redirect: "follow",
    });
    r.status_code = resp.status;
    r.final_url = resp.url || task.url;
    const text = await resp.text();
    r.snippet = text.slice(0, 2000);
    r.page_title = extractTitle(text);
    r.challenge = looksLikeChallenge(r.snippet) || looksLikeChallenge(r.page_title);
    const codeOk = resp.status >= 200 && resp.status < 400;
    r.ok = codeOk && !r.challenge;
    if (!r.ok) {
      // blitz 平台特例：休眠网关对程序请求回 503 JSON，明确提示而不是笼统的 HTTP 503
      const gateMsg = gateSleepError(resp.headers.get("x-blitz-gate"), resp.status);
      r.error = gateMsg || (r.challenge ? "疑似反爬挑战页" : "HTTP " + resp.status);
    }
  } catch (e: any) {
    r.error = e?.name === "AbortError" ? "timeout" : String(e?.message || e);
  } finally {
    clearTimeout(timer);
    r.duration_ms = Math.round(performance.now() - t0);
  }
  return r;
}

// HTTP 失败后是否值得升级到真实浏览器重试（保守：只对明确的反爬信号触发）
export function shouldFallback(res: ExecResult): boolean {
  if (res.challenge) return true;
  if (res.status_code === null) return true;          // 网络层失败
  return [403, 429, 503].includes(res.status_code);
}
