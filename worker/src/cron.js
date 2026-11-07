// cron.js —— 纯函数：cron 解析、时区换算、下次执行时间计算（可用 Node 直接单测）
// Cloudflare Cron Trigger 固定为每分钟一次；任务级的间隔/表达式由这里在 Worker 内判定。

export function tzParts(date, tz) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz || "UTC",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const p = {};
  for (const x of fmt.formatToParts(date)) {
    if (x.type !== "literal") p[x.type] = Number(x.value);
  }
  return {
    minute: p.minute,
    hour: p.hour % 24, // Intl 在 hour12:false 下 0 点可能返回 24
    day: p.day,
    month: p.month,
    weekday: new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay(),
  };
}

export function matchField(field, value, min, max) {
  return String(field).split(",").some((part) => {
    part = part.trim();
    if (!part) return false;
    let base = part, step = 1, hasStep = false;
    const slash = base.indexOf("/");
    if (slash >= 0) {
      step = parseInt(base.slice(slash + 1), 10);
      base = base.slice(0, slash);
      hasStep = true;
      if (!Number.isFinite(step) || step < 1) return false;
    }
    let lo, hi;
    if (base === "*") {
      lo = min; hi = max;
    } else if (base.indexOf("-") >= 0) {
      const ab = base.split("-").map(Number);
      if (!Number.isFinite(ab[0]) || !Number.isFinite(ab[1]) || ab[0] > ab[1]) return false;
      lo = ab[0]; hi = ab[1];
    } else {
      const a = Number(base);
      if (!Number.isFinite(a)) return false;
      lo = a;
      hi = hasStep ? max : a; // "5/10" 表示从 5 起每 10
    }
    if (lo < min || hi > max || value < lo || value > hi) return false;
    return (value - lo) % step === 0;
  });
}

export function cronMatches(expr, date, tz) {
  const f = String(expr || "").trim().split(/\s+/);
  if (f.length !== 5) return false;
  const p = tzParts(date, tz);
  return (
    matchField(f[0], p.minute, 0, 59) &&
    matchField(f[1], p.hour, 0, 23) &&
    matchField(f[2], p.day, 1, 31) &&
    matchField(f[3], p.month, 1, 12) &&
    (matchField(f[4], p.weekday, 0, 7) ||
      (p.weekday === 0 && matchField(f[4], 7, 0, 7)))
  );
}

export function validateCron(expr) {
  const f = String(expr || "").trim().split(/\s+/);
  if (f.length !== 5) throw new Error("cron 表达式必须 5 段: 分 时 日 月 周");
  if (!f.every((x) => /^[0-9*,/-]+$/.test(x))) {
    throw new Error("cron 表达式含非法字符");
  }
  return true;
}

// 计算任务在 afterTs 之后的下一次执行时间（毫秒时间戳）
// 随机加时：jitter_minutes > 0 时，在 [0, N) 分钟内取随机毫秒数累加到固定触发时间上，
// 每次调用（创建 / 编辑 / 启用 / 每次触发后的先占坑）都重新随机。
export function computeNextRun(task, afterTs, tz) {
  let base;
  if (task.schedule_type === "cron") {
    base = afterTs + 86400000; // 逐分钟扫描最多 7 天；低频 cron（如每月/每年）先按每天重算兜底
    let t = Math.floor(afterTs / 60000) * 60000 + 60000;
    for (let i = 0; i < 60 * 24 * 7; i++, t += 60000) {
      if (cronMatches(task.cron_expr, new Date(t), tz)) { base = t; break; }
    }
  } else {
    const mins = Math.max(1, Number(task.interval_minutes) || 1);
    base = Math.floor(afterTs / 60000) * 60000 + mins * 60000;
  }
  const jitter = Math.max(0, Number(task.jitter_minutes) || 0);
  return jitter > 0 ? base + Math.floor(Math.random() * jitter * 60000) : base;
}

export function fmtTs(ts, tz) {
  if (!ts) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: tz || "UTC",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).format(new Date(ts)).replace(/\//g, "-");
}
