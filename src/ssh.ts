// ssh.ts —— SSH 命令执行（ssh2 纯 JS 库，密码 / 私钥两种认证，Windows/Linux 行为一致）
// 任务按名称引用密钥（ssh_key_name）；密钥随 Gist 在多部署间同步，导出备份不含密钥。
import { Client } from "ssh2";
import type { Task, SshKey, ExecResult } from "./types.js";

export type ResolvedAuth =
  | { kind: "key"; privateKey: string; passphrase: string }
  | { kind: "password"; password: string };

// 认证解析：key 方式按名称查本机密钥，查不到直接报错（提示用户去密钥管理添加）
export function resolveSshAuth(task: Task, keys: SshKey[]): ResolvedAuth {
  if (task.ssh_auth === "key") {
    const k = keys.find((x) => x.name === task.ssh_key_name);
    if (!k) {
      throw new Error(`密钥不存在：${task.ssh_key_name}（请在本机「SSH 密钥」管理中添加同名密钥）`);
    }
    return { kind: "key", privateKey: k.private_key, passphrase: k.passphrase };
  }
  return { kind: "password", password: task.ssh_password };
}

function firstLine(text: string, max = 200): string {
  const line = String(text || "").split(/\r?\n/).find((l) => l.trim()) || "";
  return line.trim().slice(0, max);
}

function baseResult(finalUrl: string): ExecResult {
  return {
    ok: false, status_code: null, duration_ms: 0, error: "", snippet: "",
    mode: "ssh", final_url: finalUrl, page_title: "", challenge: false,
    screenshot: "", degraded: false, note: "SSH 命令",
  };
}

export async function doSsh(task: Task, keys: SshKey[]): Promise<ExecResult> {
  const r = baseResult(task.url);
  const timeoutMs = task.timeout_seconds * 1000;
  const t0 = performance.now();
  const conn = new Client();
  let timedOut = false;
  // 总超时：连接 + 认证 + 命令执行全程共享（与 ConnectTimeout 语义对齐）
  const timer = setTimeout(() => {
    timedOut = true;
    r.error = "timeout";
    try { conn.end(); } catch { /* noop */ }
  }, timeoutMs);
  try {
    const auth = resolveSshAuth(task, keys);
    await new Promise<void>((resolve, reject) => {
      conn.once("ready", () => resolve());
      conn.once("error", (e) => reject(e));
      conn.once("close", () => { if (!timedOut) reject(new Error("连接被对端关闭")); });
      conn.connect({
        host: task.ssh_host,
        port: task.ssh_port,
        username: task.ssh_user,
        readyTimeout: timeoutMs,
        // 不校验主机指纹（等价 StrictHostKeyChecking=no）
        hostVerifier: (() => true) as never,
        ...(auth.kind === "key"
          ? { privateKey: auth.privateKey, passphrase: auth.passphrase || undefined }
          : { password: auth.password }),
      });
    });
    const res = await new Promise<{ code: number | null; out: string; err: string }>(
      (resolve, reject) => {
        conn.exec(task.ssh_command, (err, stream) => {
          if (err) { reject(err); return; }
          let out = "", errBuf = "";
          stream.on("data", (c: Buffer) => { if (out.length < 8000) out += c.toString("utf8"); });
          stream.stderr?.on("data", (c: Buffer) => {
            if (out.length < 8000) out += c.toString("utf8");
            if (errBuf.length < 1000) errBuf += c.toString("utf8");
          });
          stream.on("close", (code: number | null) => resolve({ code, out, err: errBuf }));
        });
      },
    );
    r.status_code = typeof res.code === "number" ? res.code : null;
    r.snippet = res.out.slice(0, 2000);
    if (res.code === 0) {
      r.ok = true;
    } else if (!timedOut) {
      const why = firstLine(res.err);
      r.error = `exit ${res.code ?? "?"}` + (why ? `: ${why}` : "");
    }
  } catch (e) {
    if (!timedOut && !r.error) r.error = String((e as Error)?.message || e);
  } finally {
    clearTimeout(timer);
    try { conn.end(); } catch { /* noop */ }
    r.duration_ms = Math.round(performance.now() - t0);
  }
  return r;
}
