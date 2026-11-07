-- Cloudflare D1 建表脚本
-- wrangler d1 execute web-cron --remote --file=schema.sql
-- 时间字段统一为毫秒时间戳 INTEGER（便于比较与 24h 统计）

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  method TEXT NOT NULL DEFAULT 'GET',
  headers TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  schedule_type TEXT NOT NULL DEFAULT 'interval',
  interval_minutes INTEGER,
  cron_expr TEXT,
  jitter_minutes INTEGER NOT NULL DEFAULT 0,
  timeout_seconds INTEGER NOT NULL DEFAULT 30,
  retries INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER,
  updated_at INTEGER,
  next_run_at INTEGER,
  last_run_at INTEGER,
  last_ok INTEGER,
  last_status_code INTEGER,
  last_duration_ms INTEGER,
  last_error TEXT,
  success_count INTEGER NOT NULL DEFAULT 0,
  fail_count INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL,
  task_name TEXT,
  run_at INTEGER,
  ok INTEGER,
  status_code INTEGER,
  duration_ms INTEGER,
  error TEXT,
  snippet TEXT
);

-- 应用级键值配置（当前存 Gist 同步的 token / gist_id，key=gist，值为 JSON 字符串）
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(enabled, next_run_at);
CREATE INDEX IF NOT EXISTS idx_history_task ON history(task_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_history_time ON history(run_at);
