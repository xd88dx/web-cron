// mock_server.mjs —— 集成测试用的本地回显服务（端口 8801）
// /cookieN : 用 Cookie 记录访问次数，验证 storageState 跨次保留
// /fbN     : 第一次请求 403、之后 200，验证 HTTP -> 浏览器自动升级
// /challenge: 返回 Cloudflare 风格挑战页，验证挑战页检测
// /ok      : 恒 200，验证定时调度链路
import http from "node:http";

const counts = new Map();
const PORT = 8801;

http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  const p = u.pathname;

  if (p.startsWith("/cookie")) {
    const m = String(req.headers.cookie || "").match(/visit=(\d+)/);
    const n = m ? Number(m[1]) + 1 : 1;
    res.setHeader("Set-Cookie", `visit=${n}; Path=/; Max-Age=3600`);
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end(`VISIT=${n}`);
    return;
  }
  if (p.startsWith("/fb")) {
    const c = (counts.get(p) || 0) + 1;
    counts.set(p, c);
    if (c === 1) {
      res.writeHead(403, { "Content-Type": "text/plain" });
      res.end("blocked by waf");
    } else {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end("<html><title>OK Page</title><body>WELCOME BACK</body></html>");
    }
    return;
  }
  if (p === "/challenge") {
    res.writeHead(403, { "Content-Type": "text/html; charset=utf-8" });
    res.end("<html><title>Just a moment...</title><body>Checking your browser before accessing</body></html>");
    return;
  }
  res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("OK");
}).listen(PORT, "127.0.0.1", () => console.log(`[mock] http://127.0.0.1:${PORT}`));
