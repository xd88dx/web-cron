// unit.mjs —— 纯逻辑单测（先 npm run build，再 npm test）
// 覆盖 cron 解析 / 时区 / UA 固定 / 浏览器头 / 挑战页与 fallback 判定
import assert from "node:assert/strict";
import { matchField, cronMatches, validateCron, computeNextRun, fmtTs, tzParts } from "../dist/cron.js";
import {
  BROWSER_UAS, pickUa, browserHeaders, chromiumMajorVersion, browserUaPool,
  describeBrowserUa, browserIdentity, uaDataInitScript,
} from "../dist/headers.js";
import { looksLikeChallenge, shouldFallback } from "../dist/http.js";
import { configHash, hashLikeLocal, mergeRemoteKeys } from "../dist/gistsync.js";
import { validateTask } from "../dist/validate.js";
import { resolveSshAuth } from "../dist/ssh.js";

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

console.log("== Gist 同步配置指纹 ==");
function cfg(over) {
  return Object.assign({
    name: "保活", url: "https://example.com/", method: "GET", headers: "", body: "",
    schedule_type: "interval", interval_minutes: 5, cron_expr: null, jitter_minutes: 3,
    timeout_seconds: 30, retries: 0, enabled: 1, sort_order: 1,
    mode: "http",
    ssh_host: "", ssh_port: 22, ssh_user: "", ssh_command: "",
    ssh_auth: "password", ssh_password: "", ssh_key_name: "",
    browser_wait_until: "domcontentloaded", browser_wait_selector: "",
    browser_assert: "", browser_dwell_ms: 0, browser_proxy: "", browser_ua: "",
    browser_screenshot: 0, http_fallback_browser: 0,
  }, over);
}
t("指纹：id 与易变字段（执行统计/时间戳/next_run_at）不参与", () => {
  const a = configHash([cfg({ id: 1, last_run_at: 111, success_count: 9, next_run_at: 222, created_at: 1, updated_at: 2 })]);
  const b = configHash([cfg({ id: 77, last_run_at: 999, success_count: 0, next_run_at: null, created_at: 8, updated_at: 9 })]);
  assert.equal(a, b);
});
t("指纹：配置变化（名称/随机加时/启停/排序）会改变", () => {
  const base = configHash([cfg({ id: 1 })]);
  assert.notEqual(base, configHash([cfg({ id: 1, name: "改名" })]));
  assert.notEqual(base, configHash([cfg({ id: 1, jitter_minutes: 4 })]));
  assert.notEqual(base, configHash([cfg({ id: 1, enabled: 0 })]));
  assert.notEqual(base, configHash([cfg({ id: 1, sort_order: 2 })]));
});
t("指纹：多任务按 (sort_order,id) 排序，与传入顺序无关", () => {
  const x = cfg({ id: 1, name: "X", sort_order: 1 });
  const y = cfg({ id: 2, name: "Y", sort_order: 2 });
  assert.equal(configHash([x, y]), configHash([y, x]));
});
t("指纹：Gist 原始数据经规范化后与本地一致（validate + 默认值补齐）", () => {
  // 拉取后本地存储经 validateTask 规范化：interval 任务 cron_expr 为 null 等
  const localTask = cfg({ id: 4 });
  // Gist 上的原始 JSON：可能带多余易变字段与不同 id
  const rawRemote = { ...cfg({ id: 1, cron_expr: null }), created_at: 1, next_run_at: 99 };
  assert.equal(hashLikeLocal([rawRemote]), configHash([localTask]));
});
t("指纹：非法任务在规范化时被剔除（与拉取跳过逻辑一致）", () => {
  const good = cfg({ id: 1 });
  assert.equal(hashLikeLocal([good, { name: "" }]), configHash([good]));
});
t("指纹：SSH 字段变化（主机/密码）会改变", () => {
  const base = configHash([cfg({ id: 1 })]);
  assert.notEqual(base, configHash([cfg({ id: 1, ssh_host: "h2.example.com" })]));
  assert.notEqual(base, configHash([cfg({ id: 1, ssh_password: "p2" })]));
});
function keyCfg(over) {
  return Object.assign({ id: 1, name: "my-server", private_key: "-----BEGIN X-----\nAAA\n-----END X-----",
    passphrase: "pp", created_at: 111 }, over);
}
t("指纹：密钥内容变化会改变，id/created_at 不参与", () => {
  const base = configHash([cfg({ id: 1 })], [keyCfg({})]);
  assert.notEqual(base, configHash([cfg({ id: 1 })], [keyCfg({ private_key: "-----BEGIN Y-----" })]));
  assert.notEqual(base, configHash([cfg({ id: 1 })], [keyCfg({ passphrase: "pp2" })]));
  assert.notEqual(base, configHash([cfg({ id: 1 })], []));
  // 本机 id 序号不同不影响指纹（两台机器各自续号）
  assert.equal(configHash([cfg({ id: 1 })], [keyCfg({ id: 7, created_at: 999 })]), base);
});
t("指纹：Gist 原始密钥经规范化后与本地一致", () => {
  const local = configHash([cfg({ id: 1 })], [keyCfg({})]);
  // 远端 JSON：id/created_at 是对端序号，带 \r\n 也应规范化对齐
  const remote = [{ ...keyCfg({ id: 42, created_at: 1 }), private_key: "-----BEGIN X-----\r\nAAA\r\n-----END X-----" }];
  assert.equal(hashLikeLocal([cfg({ id: 9 })], remote), local);
});
t("指纹：密钥列表缺省，单参调用兼容", () => {
  assert.equal(configHash([cfg({ id: 1 })]), configHash([cfg({ id: 1 })], []));
});
t("mergeRemoteKeys：新密钥续号插入，同名更新内容沿用 id", () => {
  const s = { sshKeys: [], seqKey: 0 };
  assert.equal(mergeRemoteKeys(s, [{ name: "a", private_key: "K1", passphrase: "" }], 100), 1);
  assert.deepEqual(s.sshKeys.map((k) => [k.id, k.name, k.private_key]), [[1, "a", "K1"]]);
  assert.equal(s.seqKey, 1);
  // 同名再拉：更新内容、沿用 id，不新增
  assert.equal(mergeRemoteKeys(s, [{ name: "a", private_key: "K2", passphrase: "p" }], 200), 0);
  assert.deepEqual(s.sshKeys.map((k) => [k.id, k.name, k.private_key, k.passphrase]),
    [[1, "a", "K2", "p"]]);
});
t("mergeRemoteKeys：本地多余密钥保留；非法条目跳过", () => {
  const s = { sshKeys: [{ id: 5, name: "local-only", private_key: "L", passphrase: "", created_at: 1 }], seqKey: 5 };
  mergeRemoteKeys(s, [{ name: "a", private_key: "K1" }, { name: "", private_key: "x" }, "junk"], 100);
  assert.deepEqual(s.sshKeys.map((k) => k.name), ["local-only", "a"]);
  assert.equal(s.seqKey, 6);
});
t("mergeRemoteKeys：空/缺 sshKeys 字段不动本地密钥（对端旧版本推送场景）", () => {
  const s = { sshKeys: [{ id: 1, name: "a", private_key: "K", passphrase: "", created_at: 1 }], seqKey: 1 };
  assert.equal(mergeRemoteKeys(s, undefined, 100), 0);
  assert.equal(s.sshKeys.length, 1);
});

console.log("== SSH 任务校验与认证解析 ==");
function sshCfg(over) {
  return cfg({ mode: "ssh", name: "SSH 保活", ssh_host: "ssh.example.com", ssh_port: 2222,
    ssh_user: "ibssh_xxx", ssh_command: "true", ssh_auth: "password", ssh_password: "pw", ...over });
}
t("validateTask：SSH 任务 url 自动推导为 ssh://user@host:port", () => {
  const f = validateTask(sshCfg({ url: "" }));
  assert.equal(f.url, "ssh://ibssh_xxx@ssh.example.com:2222");
});
t("validateTask：SSH 缺主机/用户/命令报错", () => {
  assert.throws(() => validateTask(sshCfg({ url: "", ssh_host: "" })), /主机/);
  assert.throws(() => validateTask(sshCfg({ url: "", ssh_user: "" })), /用户名/);
  assert.throws(() => validateTask(sshCfg({ url: "", ssh_command: "" })), /命令/);
});
t("validateTask：SSH 端口钳制与认证方式二值化", () => {
  const f = validateTask(sshCfg({ url: "", ssh_port: 99999, ssh_auth: "bogus" }));
  assert.equal(f.ssh_port, 65535);
  assert.equal(f.ssh_auth, "password");
});
t("validateTask：密钥方式必须选择密钥名称", () => {
  assert.throws(() => validateTask(sshCfg({ url: "", ssh_auth: "key", ssh_key_name: "" })), /密钥/);
});
t("validateTask：http 模式仍然要求 http URL", () => {
  assert.throws(() => validateTask(cfg({ url: "ssh://x", mode: "http" })), /http/);
});
t("resolveSshAuth：密码方式直接返回密码", () => {
  const a = resolveSshAuth(sshCfg({}), []);
  assert.deepEqual(a, { kind: "password", password: "pw" });
});
t("resolveSshAuth：密钥方式按名称命中本机密钥", () => {
  const keys = [{ id: 1, name: "my-server", private_key: "-----BEGIN X-----", passphrase: "pp", created_at: 1 }];
  const a = resolveSshAuth(sshCfg({ ssh_auth: "key", ssh_key_name: "my-server" }), keys);
  assert.deepEqual(a, { kind: "key", privateKey: "-----BEGIN X-----", passphrase: "pp" });
});
t("resolveSshAuth：密钥名称不存在时报错并提示去管理密钥添加", () => {
  assert.throws(
    () => resolveSshAuth(sshCfg({ ssh_auth: "key", ssh_key_name: "ghost" }), []),
    /密钥不存在：ghost/,
  );
});

console.log("\n通过 " + pass + " 项" + (process.exitCode ? "（有失败）" : "，全部通过"));
