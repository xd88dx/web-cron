// headers.js —— 拟人化请求头：每次请求随机真实浏览器 UA + 完整浏览器指纹头
// 注意：Workers 的 fetch 会自动加 Accept-Encoding: gzip 并解压响应；
// Connection / Host 等 hop-by-hop 头不允许手动设置，故不在此出现。

export const BROWSER_UAS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0",
];

export function browserHeaders(method) {
  const ua = BROWSER_UAS[Math.floor(Math.random() * BROWSER_UAS.length)];
  const h = {
    "User-Agent": ua,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
  };
  const firefox = ua.indexOf("Firefox") >= 0 && ua.indexOf("Chrome") < 0;
  if (!firefox) {
    const m = ua.match(/Chrome\/(\d+)/);
    const ver = m ? m[1] : "141";
    const edge = ua.indexOf(" Edg/") >= 0;
    const mac = ua.indexOf("Macintosh") >= 0;
    h["sec-ch-ua"] = '"Not?A_Brand";v=8, "' + (edge ? "Microsoft Edge" : "Google Chrome") +
      '";v=' + ver + ', "Chromium";v=' + ver;
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
