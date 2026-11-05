// 纯逻辑单测（Node 直接跑，不需要 wrangler / D1）
import assert from "node:assert/strict";
import { tzParts, matchField, cronMatches, validateCron, computeNextRun, fmtTs } from "../src/cron.js";
import { browserHeaders, BROWSER_UAS } from "../src/headers.js";

let n = 0;
const t = (name, fn) => { fn(); n++; console.log("  ok  " + name); };

console.log("== cron.js ==");

t("matchField: 星号与步长 */5", () => {
  for (let v = 0; v <= 59; v++) {
    assert.equal(matchField("*/5", v, 0, 59), v % 5 === 0);
  }
});

t("matchField: 范围 1-5 / 列表 1,3,5 / 单值 0", () => {
  assert.equal(matchField("1-5", 3, 0, 59), true);
  assert.equal(matchField("1-5", 6, 0, 59), false);
  assert.equal(matchField("1,3,5", 3, 0, 59), true);
  assert.equal(matchField("1,3,5", 4, 0, 59), false);
  assert.equal(matchField("0", 0, 0, 59), true);
  assert.equal(matchField("0", 1, 0, 59), false);
});

t("matchField: 带步长范围 9-17/2 与 5/10", () => {
  assert.equal(matchField("9-17/2", 11, 0, 59), true);
  assert.equal(matchField("9-17/2", 12, 0, 59), false);
  assert.equal(matchField("5/10", 15, 0, 59), true);
  assert.equal(matchField("5/10", 10, 0, 59), false);
});

t("tzParts: UTC 与 Asia/Shanghai 相差 8 小时", () => {
  const d = new Date("2026-11-05T00:30:00Z");
  const u = tzParts(d, "UTC"), s = tzParts(d, "Asia/Shanghai");
  assert.equal(u.hour, 0);
  assert.equal(s.hour, 8);
  assert.equal(s.day, 5);
  assert.equal(s.weekday, new Date(Date.UTC(2026, 10, 5)).getUTCDay());
});

t("cronMatches: 每 5 分钟 / 每天 9:00（上海时区）", () => {
  const a = new Date("2026-11-05T01:00:00Z"); // 上海 09:00
  const b = new Date("2026-11-05T01:03:00Z"); // 上海 09:03
  assert.equal(cronMatches("0 9 * * *", a, "Asia/Shanghai"), true);
  assert.equal(cronMatches("0 9 * * *", b, "Asia/Shanghai"), false);
  assert.equal(cronMatches("*/5 * * * *", a, "Asia/Shanghai"), true);
  assert.equal(cronMatches("*/5 * * * *", b, "Asia/Shanghai"), false);
});

t("cronMatches: 周日字段 0 与 7 等价", () => {
  const sun = new Date("2026-11-08T01:00:00Z"); // 2026-11-08 是周日
  assert.equal(cronMatches("0 9 * * 0", sun, "Asia/Shanghai"), true);
  assert.equal(cronMatches("0 9 * * 7", sun, "Asia/Shanghai"), true);
});

t("validateCron: 段数与非法字符", () => {
  assert.equal(validateCron("*/5 * * * *"), true);
  assert.throws(() => validateCron("99 * * *"), /5 段/);
  assert.throws(() => validateCron("@daily * * * *"), /非法字符/);
});

t("computeNextRun: 间隔 5 分钟对齐到整分钟", () => {
  const after = Date.parse("2026-11-05T00:02:37Z");
  const next = computeNextRun({ schedule_type: "interval", interval_minutes: 5 }, after, "UTC");
  assert.equal(new Date(next).toISOString(), "2026-11-05T00:07:00.000Z");
});

t("computeNextRun: cron 每 5 分钟 / 每天 9:00 上海", () => {
  const after = Date.parse("2026-11-05T00:02:37Z");
  assert.equal(
    new Date(computeNextRun({ schedule_type: "cron", cron_expr: "*/5 * * * *" }, after, "UTC")).toISOString(),
    "2026-11-05T00:05:00.000Z"
  );
  assert.equal(
    new Date(computeNextRun({ schedule_type: "cron", cron_expr: "0 9 * * *" }, after, "Asia/Shanghai")).toISOString(),
    "2026-11-05T01:00:00.000Z"
  );
});

t("fmtTs: 按指定时区格式化", () => {
  const s = fmtTs(Date.parse("2026-11-05T01:00:00Z"), "Asia/Shanghai");
  assert.match(s, /09:00:00/);
  assert.match(s, /2026/);
});

console.log("== headers.js ==");

t("browserHeaders: UA 来自池、随机、版本号与 sec-ch-ua 一致、无禁用头", () => {
  const seen = new Set();
  for (let i = 0; i < 40; i++) {
    const h = browserHeaders("GET");
    assert.ok(BROWSER_UAS.includes(h["User-Agent"]));
    seen.add(h["User-Agent"]);
    assert.ok(h["Accept"] && h["Accept-Language"]);
    assert.equal(h["Upgrade-Insecure-Requests"], "1");
    assert.ok(!("Connection" in h) && !("Host" in h), "不得设置 hop-by-hop 头");
    const firefox = h["User-Agent"].indexOf("Firefox") >= 0;
    if (!firefox) {
      const ver = h["User-Agent"].match(/Chrome\/(\d+)/)[1];
      assert.ok(h["sec-ch-ua"].includes('v=' + ver), "sec-ch-ua 版本须与 UA 一致");
      assert.equal(h["Sec-Fetch-Dest"], "document");
    } else {
      assert.ok(!("sec-ch-ua" in h));
    }
  }
  assert.ok(seen.size >= 3, "UA 应有随机性，实际出现 " + seen.size + " 种");
});

t("browserHeaders: POST 不附加导航类 Sec-Fetch 头", () => {
  const h = browserHeaders("POST");
  assert.ok(!("Upgrade-Insecure-Requests" in h));
  assert.ok(!("Sec-Fetch-Dest" in h));
});

console.log("\n全部 " + n + " 项通过");
