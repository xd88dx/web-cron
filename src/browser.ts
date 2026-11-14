// browser.ts —— 真实 Chromium 浏览器仿真（Playwright）
// 设计要点：
//  * playwright 为 optionalDependencies，运行时动态 import；缺失或 Chromium 未安装时整体降级为纯 HTTP
//  * 共享一个常驻 Chromium + 每任务独立 BrowserContext，storageState 落盘 -> 跨次访问像回头客
//  * 并发信号量（默认 2）+ 空闲 TTL 回收，避免 10 个 Chromium 同时起爆内存
//  * 只做「模拟真实浏览器」，不做 CAPTCHA 求解 / Turnstile 绕过；遇到挑战页如实判失败
import fs from "node:fs/promises";
import path from "node:path";
import { browserIdentity, chromiumMajorVersion, uaDataInitScript } from "./headers.js";
import { parseHeaders } from "./validate.js";
import { profilesDir, screenshotsDir } from "./store.js";
import { looksLikeChallenge } from "./http.js";
import * as blitzgate from "./blitzgate.js";
import type { Task, ExecResult } from "./types.js";

export interface BrowserState {
  capable: boolean;   // 环境是否具备浏览器能力
  running: boolean;   // 当前是否持有 Chromium 实例
  reason: string;
  checked: boolean;
}

const MAX = Math.max(1, parseInt(process.env.BROWSER_MAX_CONCURRENCY || "2", 10) || 2);
const IDLE_TTL = (parseInt(process.env.BROWSER_IDLE_TTL || "600", 10) || 600) * 1000;
const TZ = process.env.APP_TIMEZONE || "Asia/Shanghai";

let pw: any = null;
let browser: any = null;
let chromiumMajor = "";   // 运行时 Chromium 主版本，用于生成自洽的 UA / Client Hints
let state: BrowserState = { capable: false, running: false, reason: "尚未探测", checked: false };
let active = 0;
const waiters: Array<() => void> = [];
let idleTimer: NodeJS.Timeout | null = null;

export function browserState(): BrowserState {
  return { ...state, running: Boolean(browser) };
}

function launchArgs(): string[] {
  const args = [
    "--disable-blink-features=AutomationControlled",
    "--disable-dev-shm-usage",
    "--disable-features=IsolateOrigins,site-per-process",
  ];
  // 官方镜像以 root 运行时 Chromium sandbox 不可用
  if (process.platform === "linux" && typeof process.getuid === "function" && process.getuid() === 0) {
    args.push("--no-sandbox");
  }
  return args;
}

async function launch(): Promise<any> {
  const opts: any = { headless: true, args: launchArgs() };
  // 官方说明 channel="chromium" 用于启用 new headless；某些安装只有默认通道，失败则回退
  const channel = process.env.BROWSER_CHANNEL || "chromium";
  if (channel) opts.channel = channel;
  let b: any;
  try {
    b = await pw.chromium.launch(opts);
  } catch (e) {
    if (!opts.channel) throw e;
    delete opts.channel;
    b = await pw.chromium.launch(opts);
  }
  try { chromiumMajor = chromiumMajorVersion(b.version()); } catch { /* ignore */ }
  return b;
}

// 启动探测：不阻塞 Web 服务，失败时把原因写进状态供面板展示
export async function detectBrowser(): Promise<void> {
  const mod = "playwright"; // 变量间接 import：未安装该包时 TypeScript 也能编译
  try {
    pw = await import(mod);
  } catch (e: any) {
    state = { capable: false, running: false, checked: true,
      reason: "未安装 playwright（免费托管已自动降级为纯 HTTP）" };
    console.log("[browser] " + state.reason);
    return;
  }
  try {
    browser = await launch();
    state = { capable: true, running: true, checked: true, reason: "" };
    console.log("[browser] Chromium 就绪 · 并发上限 " + MAX + " · 空闲回收 " + (IDLE_TTL / 1000) + "s");
    armIdle();
  } catch (e: any) {
    state = { capable: false, running: false, checked: true,
      reason: "Chromium 启动失败（需 playwright install chromium）：" + String(e?.message || e).slice(0, 200) };
    console.log("[browser] " + state.reason);
  }
}

async function ensureBrowser(): Promise<any> {
  if (!state.capable) throw new Error(state.reason || "浏览器不可用");
  if (!browser) {
    browser = await launch();
    state.running = true;
  }
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
  return browser;
}

function armIdle(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(async () => {
    if (active > 0 || waiters.length > 0) return;
    try { await browser?.close(); } catch { /* ignore */ }
    browser = null;
    state.running = false;
  }, IDLE_TTL);
  idleTimer.unref();
}

async function acquire(): Promise<void> {
  if (active < MAX) { active++; return; }
  await new Promise<void>((resolve) => waiters.push(resolve));
}

function release(): void {
  const next = waiters.shift();
  if (next) { next(); return; }  // 名额直接移交给等待者，active 不变
  active--;
  if (active === 0 && state.capable) armIdle();
}

// 抹掉最明显的自动化痕迹；与 channel/UA/viewport/locale 一起构成 L2 反检测
const STEALTH_SCRIPT = `
// 真实浏览器的 navigator 上不存在 webdriver 属性。仅把它遮蔽成 undefined 不够：
// 'webdriver' in navigator 仍为 true，sannysoft 的 "WebDriver (New)" 会判 present(failed)。
// 实测该属性在 Navigator.prototype 上且 configurable=true，直接删除最贴近真实浏览器。
try {
  delete Navigator.prototype.webdriver;
} catch (e) {
  try { Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => undefined, configurable: true }); } catch (e2) {}
}
Object.defineProperty(navigator, 'languages', { get: () => ['zh-CN','zh','en'] });
if (!window.chrome) window.chrome = { runtime: {} };
try {
  const q = navigator.permissions && navigator.permissions.query;
  if (q) navigator.permissions.query = function (p) {
    return p && p.name === 'notifications'
      ? Promise.resolve({ state: 'denied', onchange: null })
      : q.call(navigator.permissions, p);
  };
} catch (e) {}
`;

async function readStorageState(taskId: number): Promise<any | undefined> {
  try {
    return JSON.parse(await fs.readFile(path.join(profilesDir(), `task_${taskId}.json`), "utf8"));
  } catch { return undefined; }
}

async function writeStorageState(context: any, taskId: number): Promise<void> {
  try {
    const st = await context.storageState();
    const p = path.join(profilesDir(), `task_${taskId}.json`);
    const tmp = p + ".tmp";
    await fs.writeFile(tmp, JSON.stringify(st), "utf8");
    await fs.rename(tmp, p);
  } catch (e) {
    console.warn("[browser] storageState 写入失败 task " + taskId + ": " + String(e));
  }
}

async function runAssert(page: any, expr: string): Promise<{ pass: boolean; error: string }> {
  if (!expr) return { pass: true, error: "" };
  try {
    let pass = false;
    if (expr.startsWith("text:")) {
      const needle = expr.slice(5);
      const body = await page.evaluate(() => document.body ? document.body.innerText : "");
      pass = String(body).indexOf(needle) >= 0;
    } else if (expr.startsWith("js:")) {
      pass = Boolean(await page.evaluate(expr.slice(3)));
    } else {
      const sel = expr.startsWith("selector:") ? expr.slice(9) : expr;
      pass = (await page.locator(sel).count()) > 0;
    }
    return pass ? { pass: true, error: "" } : { pass: false, error: "断言未通过: " + expr.slice(0, 120) };
  } catch (e: any) {
    return { pass: false, error: "断言异常: " + String(e?.message || e).slice(0, 120) };
  }
}

function baseResult(): ExecResult {
  return {
    ok: false, status_code: null, duration_ms: 0, error: "", snippet: "",
    mode: "browser", final_url: "", page_title: "", challenge: false,
    screenshot: "", degraded: false, note: "",
  };
}

export async function executeBrowser(task: Task): Promise<ExecResult> {
  const r = baseResult();
  const t0 = performance.now();
  await acquire();
  let context: any = null;
  try {
    const b = await ensureBrowser();
    // 身份自洽：UA / sec-ch-ua / navigator.userAgentData 必须来自同一个主版本，
    // 否则「UA Chrome/141 + Client Hints Chromium/156」会被 bot 检测一眼识破。
    const identity = browserIdentity(task.id, task.browser_ua, chromiumMajor || "141");
    // 非 Chromium 系 UA：Client Hints 只能置空、无法真正移除，TLS 栈也仍是 Chromium
    if (!identity.uaData) {
      r.note = "非 Chromium UA：Client Hints 已置空、TLS 栈仍为 Chromium，拟真度受限";
    }
    const opts: any = {
      userAgent: identity.userAgent,
      viewport: { width: 1366, height: 768 },
      locale: "zh-CN",
      timezoneId: TZ,
      colorScheme: "light",
      deviceScaleFactor: 1,
      ignoreHTTPSErrors: true,
      // 用户自定义头优先级最高，放最后展开
      extraHTTPHeaders: { ...identity.clientHints, ...parseHeaders(task.headers) },
    };
    if (task.browser_proxy) opts.proxy = { server: task.browser_proxy };
    const storage = await readStorageState(task.id);
    if (storage) opts.storageState = storage;

    context = await b.newContext(opts);
    await context.addInitScript(STEALTH_SCRIPT);
    await context.addInitScript(uaDataInitScript(identity));
    const page = await context.newPage();
    const timeoutMs = task.timeout_seconds * 1000;
    page.setDefaultTimeout(timeoutMs);

    let gotoError = "";
    let gateHeader = "";   // blitz 休眠网关标记（x-blitz-gate），普通站点恒为空
    try {
      const resp = await page.goto(task.url, {
        waitUntil: task.browser_wait_until, timeout: timeoutMs,
      });
      r.status_code = resp ? resp.status() : null;
      if (resp) gateHeader = String(resp.headers()["x-blitz-gate"] || "");
    } catch (e: any) {
      gotoError = e?.name === "TimeoutError" ? "timeout" : String(e?.message || e).slice(0, 200);
    }

    // blitz.cloud 平台特例：休眠应用对程序请求不可唤醒，浏览器请求会拿到带
    // 「Wake it up」表单的休眠页，需提交表单网关才拉起应用（详见 blitzgate.ts）。
    // BROWSER_WAKE_GATE=0 关闭；判定条件极窄，不影响其它站点。
    if (blitzgate.gateEnabled() && !gotoError &&
        await blitzgate.isGateSleepPage(page, r.status_code, gateHeader)) {
      if (await blitzgate.wake(page, task, r)) {
        try {
          const resp2 = await page.reload({
            waitUntil: task.browser_wait_until || "domcontentloaded", timeout: timeoutMs,
          });
          r.status_code = resp2 ? resp2.status() : null;
        } catch { /* 唤醒成功但 reload 失败：带着当前页面继续判定 */ }
      }
    }

    if (task.browser_wait_selector) {
      try { await page.waitForSelector(task.browser_wait_selector, { timeout: timeoutMs }); }
      catch { /* 断言阶段会再判定 */ }
    }

    // L4 行为模拟：随机停留 + 轻微滚动，模拟真人阅读
    if (task.browser_dwell_ms > 0) {
      const dwell = Math.round(task.browser_dwell_ms * (0.6 + Math.random() * 0.4));
      await page.waitForTimeout(dwell);
      try { await page.mouse.wheel(0, 100 + Math.floor(Math.random() * 300)); } catch { /* ignore */ }
    }

    r.final_url = page.url();
    let title = "", content = "", bodyText = "";
    try { title = await page.title(); } catch { /* ignore */ }
    try { content = await page.content(); } catch { /* ignore */ }
    try { bodyText = await page.evaluate(() => document.body ? document.body.innerText : ""); } catch { /* ignore */ }
    r.page_title = String(title || "").slice(0, 300);
    r.snippet = String(bodyText || content).slice(0, 2000);
    r.challenge = looksLikeChallenge(r.page_title + " " + content.slice(0, 20000));

    const assert = await runAssert(page, task.browser_assert);
    const codeOk = r.status_code === null || (r.status_code >= 200 && r.status_code < 400);
    r.ok = !gotoError && !r.challenge && assert.pass && codeOk;
    if (!r.ok) {
      r.error = r.challenge ? "疑似反爬挑战页" : gotoError || assert.error || ("HTTP " + r.status_code);
    }

    if (task.browser_screenshot && (!r.ok || r.challenge)) {
      try {
        const name = `task_${task.id}_${Date.now()}.png`;
        await page.screenshot({ path: path.join(screenshotsDir(), name), fullPage: false });
        r.screenshot = name;
      } catch { /* ignore */ }
    }

    await writeStorageState(context, task.id);  // Cookie / localStorage 跨次保留
  } catch (e: any) {
    r.error = String(e?.message || e).slice(0, 300);
  } finally {
    if (context) { try { await context.close(); } catch { /* ignore */ } }
    r.duration_ms = Math.round(performance.now() - t0);
    release();
  }
  return r;
}

export async function shutdownBrowser(): Promise<void> {
  if (browser) { try { await browser.close(); } catch { /* ignore */ } }
  browser = null;
  state.running = false;
}
