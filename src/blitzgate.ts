// blitzgate.ts —— blitz.cloud 免费托管休眠网关的平台特例（刻意不并入通用主逻辑）
//
// 背景：blitz 的休眠网关对「程序请求」一律回 503 + JSON（A program cannot wake it），
// 对浏览器请求回一张休眠页，页内有一张唤醒表单：
//   <form action="/"><input name="blitz-wake" value="一次性token"><button>Wake it up</button></form>
// 必须提交这张表单（即 GET /?blitz-wake=<token>）网关才拉起应用，随后页面自动切换到应用本体。
// 真人访问时会点这个按钮；这里等价地替用户提交同一张表单，等效一次真人唤醒。
//
// 平台收费卖点即「Pro 可让程序保活」，本特例与其策略相悖，是否启用交由部署方决定：
// 环境变量 BROWSER_WAKE_GATE=0 可整体关闭。
//
// 识别条件刻意收窄到三重叠加，不会误伤任何其它站点：
//   1. HTTP 状态 503；2. 响应头 x-blitz-gate: asleep；3. 页面含 input[name="blitz-wake"] 表单。
import type { Task, ExecResult } from "./types.js";

export const GATE_FORM_INPUT = 'input[name="blitz-wake"]';
export const GATE_WAKE_BUTTON = 'form:has(input[name="blitz-wake"]) button[type="submit"]';

export function gateEnabled(): boolean {
  return process.env.BROWSER_WAKE_GATE !== "0";
}

// HTTP 模式的辅助提示：命中 blitz 休眠网关时给出可读原因（程序请求无法唤醒）
export function gateSleepError(gateHeader: string | null, status: number): string {
  if (gateHeader !== "asleep" || status !== 503) return "";
  return "blitz 休眠网关：程序请求无法唤醒（503），需浏览器仿真提交唤醒表单";
}

// 是否正处于 blitz 休眠页（三重条件全满足才判定，避免对普通 503 页面动手）
export async function isGateSleepPage(page: any, statusCode: number | null, gateHeader: string): Promise<boolean> {
  if (statusCode !== 503) return false;
  if (gateHeader !== "asleep") return false;
  try {
    return (await page.locator(GATE_FORM_INPUT).count()) > 0;
  } catch {
    return false;
  }
}

// 提交唤醒表单并等待应用真正起来（网关冷启动实测约 5~10 秒，页面会自动切到应用）
export async function wake(page: any, task: Task, r: ExecResult): Promise<boolean> {
  try {
    await page.click(GATE_WAKE_BUTTON, { timeout: task.timeout_seconds * 1000 });
  } catch (e: any) {
    r.note = "blitz 休眠网关：唤醒表单提交失败 " + String(e?.message || e).slice(0, 120);
    return false;
  }
  r.note = "blitz 休眠网关：已提交唤醒表单，等待应用拉起";
  const deadline = Date.now() + task.timeout_seconds * 1000;
  while (Date.now() < deadline) {
    await page.waitForTimeout(2000);
    try {
      if ((await page.locator(GATE_FORM_INPUT).count()) === 0) return true;
    } catch {
      return true;  // 页面已跳走（表单查询失败多半意味着导航中），交给后续判定
    }
  }
  r.note += "；等待唤醒超时";
  return false;
}
