// headers.ts —— 拟人化请求头 / 浏览器身份
// 来源：worker/src/headers.js，保留原有随机 UA 行为（不传 ua 时），
// 新增可选 ua 参数与 pickUa()：保活场景下同一任务必须固定 UA，随机性只放在任务之间。
// 真实用户不会每 5 分钟从 Chrome 换成 Firefox，逐次随机 UA 反而是机器人特征。
//
// 【浏览器模式专用】HTTP 模式可以自由伪造整组请求头；但真实 Chromium 会自己生成
// sec-ch-ua / navigator.userAgentData，只改 userAgent 会造成「UA 说 Chrome/141、
// Client Hints 说 Chromium/156」这种真实浏览器不可能出现的矛盾（常见检测点）。
// 因此浏览器模式的身份必须由「同一个主版本号」派生，并同时覆盖 wire 头与 JS 视图。

export const BROWSER_UAS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0",
];

// 按任务 id 稳定地选一个 UA；browser_ua 显式配置时优先使用。
export function pickUa(taskId: number | string, override?: string | null): string {
  const o = String(override || "").trim();
  if (o) return o;
  let h = 0;
  const s = String(taskId);
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) >>> 0;
  return BROWSER_UAS[h % BROWSER_UAS.length];
}

// ---------- HTTP 模式：整组头自己造，天然自洽 ----------
export function browserHeaders(method: string, ua?: string): Record<string, string> {
  const chosen = ua || BROWSER_UAS[Math.floor(Math.random() * BROWSER_UAS.length)];
  const h: Record<string, string> = {
    "User-Agent": chosen,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
  };
  const firefox = chosen.indexOf("Firefox") >= 0 && chosen.indexOf("Chrome") < 0;
  if (!firefox) {
    const m = chosen.match(/Chrome\/(\d+)/);
    const ver = m ? m[1] : "141";
    const edge = chosen.indexOf(" Edg/") >= 0;
    const mac = chosen.indexOf("Macintosh") >= 0;
    // GREASE 品牌与真实 Chromium 一致；版本号也带引号（实测浏览器发 v="156"，不是 v=156）
    h["sec-ch-ua"] = '"Not:A-Brand";v="8", "' + (edge ? "Microsoft Edge" : "Google Chrome") +
      '";v="' + ver + '", "Chromium";v="' + ver + '"';
    h["sec-ch-ua-mobile"] = "?0";
    h["sec-ch-ua-platform"] = mac ? '"macOS"' : '"Windows"';
  }
  if (method === "GET" || method === "HEAD") {
    h["Upgrade-Insecure-Requests"] = "1";
    if (!firefox) {
      h["Sec-Fetch-Dest"] = "document";
      h["Sec-Fetch-Mode"] = "navigate";
      h["Sec-Fetch-Site"] = "none";
      h["Sec-Fetch-User"] = "?1";
    }
  }
  return h;
}

// ---------- 浏览器模式：自洽身份 ----------
export interface UaBrand { brand: string; version: string }

export interface BrowserIdentity {
  userAgent: string;
  clientHints: Record<string, string>;   // 注入 extraHTTPHeaders，覆盖 Chromium 默认 Client Hints
  brands: UaBrand[];
  platform: string;                      // Windows / macOS
  platformVersion: string;
  architecture: string;
  fullVersion: string;                   // "156.0.0.0"
  uaData: boolean;                       // Firefox 没有 navigator.userAgentData
}

// 从运行时 Chromium 版本取主版本号（browser.version() -> "156.0.8078.4"）
export function chromiumMajorVersion(browserVersion: string): string {
  const m = String(browserVersion || "").match(/^(\d+)/);
  return m ? m[1] : "141";
}

// 浏览器模式默认 UA 池：版本恒等于运行时 Chromium 主版本，
// 保证 UA / Client Hints / TLS 栈三者指向同一个浏览器版本。
// 不含 Firefox —— Firefox UA 配 Chromium 的 TLS 与 Client Hints 是无法自洽的组合。
export function browserUaPool(ver: string): string[] {
  return [
    `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${ver}.0.0.0 Safari/537.36`,
    `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${ver}.0.0.0 Safari/537.36 Edg/${ver}.0.0.0`,
    `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${ver}.0.0.0 Safari/537.36`,
  ];
}

// 把任意 UA 解析成一组自洽的 wire 头 + JS 可见数据
export function describeBrowserUa(ua: string): BrowserIdentity {
  const firefox = /Firefox\/\d+/.test(ua) && !/Chrome\//.test(ua);
  const edge = /Edg\/(\d+)/.exec(ua);
  const chrome = /Chrome\/(\d+)/.exec(ua);
  const ver = edge?.[1] || chrome?.[1] || "141";
  const mac = /Macintosh/.test(ua);
  const platform = mac ? "macOS" : "Windows";
  const fullVersion = `${ver}.0.0.0`;

  const brands: UaBrand[] = firefox ? [] : edge
    ? [
        { brand: "Not:A-Brand", version: "8" },
        { brand: "Microsoft Edge", version: ver },
        { brand: "Chromium", version: ver },
      ]
    : [
        { brand: "Not:A-Brand", version: "8" },
        { brand: "Google Chrome", version: ver },
        { brand: "Chromium", version: ver },
      ];
  const chUa = brands.map((b) => `"${b.brand}";v="${b.version}"`).join(", ");

  return {
    userAgent: ua,
    // Firefox 不发送 Client Hints；空值用于抵消 Chromium 默认发出的那组
    clientHints: firefox
      ? { "sec-ch-ua": "", "sec-ch-ua-mobile": "", "sec-ch-ua-platform": "" }
      : {
          "sec-ch-ua": chUa,
          "sec-ch-ua-mobile": "?0",
          "sec-ch-ua-platform": `"${platform}"`,
        },
    brands,
    platform,
    platformVersion: mac ? "14.0.0" : "15.0.0",
    architecture: "x86",
    fullVersion,
    uaData: !firefox,
  };
}

// 按任务固定身份（同一任务每次执行都是同一个浏览器），随机性只放在任务之间
export function browserIdentity(
  taskId: number | string, override: string | null | undefined, chromiumMajor: string,
): BrowserIdentity {
  const o = String(override || "").trim();
  if (o) return describeBrowserUa(o);
  const pool = browserUaPool(chromiumMajor);
  let h = 0;
  const s = String(taskId);
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) >>> 0;
  return describeBrowserUa(pool[h % pool.length]);
}

// 注入 navigator.userAgentData，使 JS 可见品牌/平台与 wire 头完全一致。
// 只改 userAgent 不够：Chromium 的 Client Hints 由浏览器自身生成，detector 会交叉比对。
export function uaDataInitScript(id: BrowserIdentity): string {
  if (!id.uaData) {
    // Firefox 没有 navigator.userAgentData：应删除属性，而非留一个返回 undefined 的 getter
    return `(() => {
  try { delete Navigator.prototype.userAgentData; } catch (e) {}
  try {
    if ('userAgentData' in navigator)
      Object.defineProperty(Navigator.prototype, 'userAgentData', { get: () => undefined, configurable: true });
  } catch (e) {}
})();`;
  }
  const payload = {
    brands: id.brands,
    fullVersionList: id.brands,
    mobile: false,
    platform: id.platform,
    platformVersion: id.platformVersion,
    architecture: id.architecture,
    bitness: "64",
    model: "",
    uaFullVersion: id.fullVersion,
    wow64: false,
  };
  return `(() => {
  const D = ${JSON.stringify(payload)};
  const fake = {
    brands: D.brands,
    mobile: D.mobile,
    platform: D.platform,
    getHighEntropyValues: async () => ({
      brands: D.brands,
      fullVersionList: D.fullVersionList,
      mobile: D.mobile,
      platform: D.platform,
      platformVersion: D.platformVersion,
      architecture: D.architecture,
      bitness: D.bitness,
      model: D.model,
      uaFullVersion: D.uaFullVersion,
      wow64: D.wow64,
    }),
    toJSON: () => ({ brands: D.brands, mobile: D.mobile, platform: D.platform }),
  };
  try { Object.defineProperty(Navigator.prototype, 'userAgentData', { get: () => fake, configurable: true }); } catch (e) {}
})();`;
}
