// unit.mjs —— 纯逻辑单测（先 npm run build，再 npm test）
// 覆盖 cron 解析 / 时区 / UA 固定 / 浏览器头 / 挑战页与 fallback 判定
import assert from "node:assert/strict";
import { matchField, cronMatches, validateCron, computeNextRun, fmtTs, tzParts } from "../dist/cron.js";
import {
  BROWSER_UAS, pickUa, browserHeaders, chromiumMajorVersion, browserUaPool,
  describeBrowserUa, browserIdentity, uaDataInitScript,
} from "../dist/headers.js";
import { looksLikeChallenge, shouldFallback } from "../dist/http.js";

let pass = 0;
function t(name, fn) {
  try { fn(); pass++; console.log("  ✓ " + name); }
  catch (e) { console.error("  ✗ " + name + " → " + e.message); process.exitCode = 1; }
}

console.log("== cron 字段匹配 ==");
t("星号匹配全范围", () => assert.equal(matchField("*", 37, 0, 59), true));
t("步长 */15", () => {
  assert.equal(matchField("*/15", 0, 0, 59), true);
  assert.equal(matchField("*/15", 30, 0, 59), true);
  assert.equal(matchField("*/15", 7, 0, 59), false);
});
t("范围 9-17", () => {
  assert.equal(matchField("9-17", 9, 0, 23), true);
  assert.equal(matchField("9-17", 17, 0, 23), true);
  assert.equal(matchField("9-17", 18, 0, 23), false);
});
t("逗号列表 1,3,5", () => {
  assert.equal(matchField("1,3,5", 3, 0, 7), true);
  assert.equal(matchField("1,3,5", 4, 0, 7), false);
});
t("a-b/n 步长", () => {
  assert.equal(matchField("0-30/10", 20, 0, 59), true);
  assert.equal(matchField("0-30/10", 25, 0, 59), false);
});
t("越界字段不匹配", () => assert.equal(matchField("99", 99, 0, 59), false));

console.log("== cron 表达式 / 时区 ==");
t("validateCron 合法 5 段", () => assert.equal(validateCron("*/5 * * * *"), true));
t("validateCron 拒绝 4 段", () => assert.throws(() => validateCron("* * * *")));
t("validateCron 拒绝非法字符", () => assert.throws(() => validateCron("* * * * abc")));
t("tzParts 上海时区 +8", () => {
  const p = tzParts(new Date("2026-11-05T01:00:00Z"), "Asia/Shanghai");
  assert.equal(p.hour, 9);
  assert.equal(p.day, 5);
});
t("cronMatches 每天 9 点（上海）", () => {
  assert.equal(cronMatches("0 9 * * *", new Date("2026-11-05T01:00:00Z"), "Asia/Shanghai"), true);
  assert.equal(cronMatches("0 9 * * *", new Date("2026-11-05T02:00:00Z"), "Asia/Shanghai"), false);
});
t("周日 0 与 7 等价", () => {
  const sun = new Date("2026-11-08T01:00:00Z"); // 周日 09:00 CST
  assert.equal(cronMatches("0 9 * * 0", sun, "Asia/Shanghai"), true);
  assert.equal(cronMatches("0 9 * * 7", sun, "Asia/Shanghai"), true);
});
t("computeNextRun interval", () => {
  const after = Date.UTC(2026, 10, 5, 2, 0, 0);
  const next = computeNextRun({ schedule_type: "interval", interval_minutes: 5 }, after, "Asia/Shanghai");
  assert.equal(next, after + 5 * 60000);
});
t("computeNextRun 随机加时：0/缺省关闭，N>0 落在 [base, base+N) 且每次重新随机", () => {
  const after = Date.UTC(2026, 10, 5, 2, 0, 0);
  const base = computeNextRun({ schedule_type: "interval", interval_minutes: 5 }, after, "Asia/Shanghai");
  assert.equal(computeNextRun({ schedule_type: "interval", interval_minutes: 5, jitter_minutes: 0 }, after, "Asia/Shanghai"), base);
  assert.equal(computeNextRun({ schedule_type: "interval", interval_minutes: 5 }, after, "Asia/Shanghai"), base);
  const got = new Set();
  for (let i = 0; i < 50; i++) {
    const next = computeNextRun({ schedule_type: "interval", interval_minutes: 5, jitter_minutes: 3 }, after, "Asia/Shanghai");
    assert.ok(next >= base && next < base + 3 * 60000, "next=" + next + " base=" + base);
    got.add(next);
  }
  assert.ok(got.size > 1, "随机加时应产生不同触发时间，实际 " + got.size);
});
t("computeNextRun 随机加时对 cron 同样生效", () => {
  const after = Date.UTC(2026, 10, 5, 2, 0, 0); // 11-05 10:00 CST
  const base = computeNextRun({ schedule_type: "cron", cron_expr: "0 9 * * *" }, after, "Asia/Shanghai");
  const next = computeNextRun({ schedule_type: "cron", cron_expr: "0 9 * * *", jitter_minutes: 10 }, after, "Asia/Shanghai");
  assert.ok(next >= base && next < base + 10 * 60000, "next=" + next + " base=" + base);
});
t("computeNextRun 每天 9 点跨日", () => {
  const after = Date.UTC(2026, 10, 5, 2, 0, 0); // 11-05 10:00 CST
  const next = computeNextRun({ schedule_type: "cron", cron_expr: "0 9 * * *" }, after, "Asia/Shanghai");
  assert.ok(fmtTs(next, "Asia/Shanghai").includes("2026-11-06 09:00"), fmtTs(next, "Asia/Shanghai"));
});
t("fmtTs 输出可排序格式", () => {
  const s = fmtTs(Date.UTC(2026, 10, 5, 1, 2, 3), "UTC");
  assert.match(s, /^2026-11-05 01:02:03$/);
});

console.log("== 拟人化请求头 ==");
t("UA 池 5 个真实浏览器 UA", () => {
  assert.equal(BROWSER_UAS.length, 5);
  assert.ok(BROWSER_UAS.every((u) => u.startsWith("Mozilla/5.0")));
});
t("pickUa 同一任务稳定", () => assert.equal(pickUa(42), pickUa(42)));
t("pickUa 不同任务有分散", () => {
  const set = new Set(Array.from({ length: 40 }, (_, i) => pickUa(i)));
  assert.ok(set.size >= 3, "至少出现 3 种 UA，实际 " + set.size);
});
t("pickUa 显式覆盖优先", () => assert.equal(pickUa(1, "MyUA"), "MyUA"));
t("chromium sec-ch-ua 版本与 UA 一致", () => {
  for (const ua of BROWSER_UAS.slice(0, 4)) {
    const h = browserHeaders("GET", ua);
    const ver = ua.match(/Chrome\/(\d+)/)[1];
    assert.ok(h["sec-ch-ua"].includes('v="' + ver + '"'), ua);
    assert.equal(h["sec-ch-ua-mobile"], "?0");
  }
});
t("Firefox UA 不带 Client Hints", () => {
  const h = browserHeaders("GET", BROWSER_UAS[4]);
  assert.equal(h["sec-ch-ua"], undefined);
  assert.equal(h["Sec-Fetch-Dest"], undefined);
});
t("GET 带 Sec-Fetch / UIR", () => {
  const h = browserHeaders("GET", BROWSER_UAS[0]);
  assert.equal(h["Sec-Fetch-Dest"], "document");
  assert.equal(h["Sec-Fetch-Mode"], "navigate");
  assert.equal(h["Upgrade-Insecure-Requests"], "1");
});
t("POST 不带 UIR", () => {
  const h = browserHeaders("POST", BROWSER_UAS[0]);
  assert.equal(h["Upgrade-Insecure-Requests"], undefined);
});

console.log("== 浏览器模式自洽身份 ==");
t("chromiumMajorVersion 从 browser.version() 取主版本", () => {
  assert.equal(chromiumMajorVersion("156.0.8078.4"), "156");
  assert.equal(chromiumMajorVersion("140.0.7339.0"), "140");
  assert.equal(chromiumMajorVersion(""), "141");
});
t("browserUaPool 全部使用运行时版本、不含 Firefox", () => {
  const pool = browserUaPool("156");
  assert.equal(pool.length, 3);
  assert.ok(pool.every((u) => u.includes("Chrome/156.")));
  assert.ok(pool.every((u) => !u.includes("Firefox")));
  assert.ok(pool.every((u) => !u.includes("HeadlessChrome")));
});
t("Chrome UA：sec-ch-ua 版本与 UA 一致且带 Google Chrome 品牌", () => {
  const id = describeBrowserUa(browserUaPool("156")[0]);
  assert.equal(id.uaData, true);
  assert.match(id.clientHints["sec-ch-ua"], /"Google Chrome";v="156"/);
  assert.match(id.clientHints["sec-ch-ua"], /"Chromium";v="156"/);
  assert.equal(id.clientHints["sec-ch-ua-platform"], '"Windows"');
  assert.equal(id.platform, "Windows");
  assert.equal(id.fullVersion, "156.0.0.0");
});
t("Edge UA：品牌为 Microsoft Edge", () => {
  const id = describeBrowserUa(browserUaPool("156")[1]);
  assert.match(id.clientHints["sec-ch-ua"], /"Microsoft Edge";v="156"/);
  assert.ok(!id.clientHints["sec-ch-ua"].includes("Google Chrome"));
});
t("macOS UA：platform 与 sec-ch-ua-platform 均为 macOS", () => {
  const id = describeBrowserUa(browserUaPool("156")[2]);
  assert.equal(id.clientHints["sec-ch-ua-platform"], '"macOS"');
  assert.equal(id.platform, "macOS");
});
t("Firefox UA：不发 Client Hints、无 userAgentData", () => {
  const id = describeBrowserUa("Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0");
  assert.equal(id.uaData, false);
  assert.equal(id.clientHints["sec-ch-ua"], "");
  assert.equal(id.brands.length, 0);
});
t("browserIdentity 同一任务稳定、不同任务分散", () => {
  const a = browserIdentity(42, null, "156");
  const b = browserIdentity(42, null, "156");
  assert.equal(a.userAgent, b.userAgent);
  assert.equal(a.clientHints["sec-ch-ua"], b.clientHints["sec-ch-ua"]);
  const set = new Set(Array.from({ length: 40 }, (_, i) => browserIdentity(i, null, "156").userAgent));
  assert.ok(set.size >= 2, "至少 2 种身份，实际 " + set.size);
  assert.ok([...set].every((u) => u.includes("Chrome/156.")));
});
t("browserIdentity 显式 browser_ua 覆盖并按其版本派生", () => {
  const id = browserIdentity(1, "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36", "156");
  assert.match(id.clientHints["sec-ch-ua"], /"Chromium";v="130"/);
});
t("uaDataInitScript 生成的 brands 与 clientHints 同源", () => {
  const id = describeBrowserUa(browserUaPool("156")[0]);
  const script = uaDataInitScript(id);
  assert.ok(script.includes('"Google Chrome"'));
  assert.ok(script.includes("getHighEntropyValues"));
  assert.ok(script.includes("156.0.0.0"));
  const fx = uaDataInitScript(describeBrowserUa(BROWSER_UAS[4]));
  assert.ok(fx.includes("delete Navigator.prototype.userAgentData"));
});

console.log("== 挑战页 / 自动升级判定 ==");
t("识别 Cloudflare 挑战页", () => {
  assert.equal(looksLikeChallenge("<title>Just a moment...</title>"), true);
  assert.equal(looksLikeChallenge("Checking your browser before accessing"), true);
  assert.equal(looksLikeChallenge("<html><title>Normal Site</title></html>"), false);
});
t("识别中文验证页", () => assert.equal(looksLikeChallenge("请开启 JavaScript 后继续"), true));
t("shouldFallback 只对反爬信号触发", () => {
  const base = { ok: false, challenge: false, status_code: 403, error: "", snippet: "", mode: "http",
    final_url: "", page_title: "", screenshot: "", degraded: false, note: "", duration_ms: 0 };
  assert.equal(shouldFallback({ ...base, status_code: 403 }), true);
  assert.equal(shouldFallback({ ...base, status_code: 429 }), true);
  assert.equal(shouldFallback({ ...base, status_code: 503 }), true);
  assert.equal(shouldFallback({ ...base, status_code: null }), true);
  assert.equal(shouldFallback({ ...base, status_code: 404 }), false);
  assert.equal(shouldFallback({ ...base, status_code: 200, challenge: true }), true);
});

console.log("\n通过 " + pass + " 项" + (process.exitCode ? "（有失败）" : "，全部通过"));
