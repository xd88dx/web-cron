// types.ts —— 全项目共享的数据结构

export type Mode = "http" | "browser";
export type ScheduleType = "interval" | "cron";
export type WaitUntil = "commit" | "domcontentloaded" | "load" | "networkidle";

export interface Task {
  id: number;
  name: string;
  url: string;
  method: string;
  headers: string;
  body: string;
  schedule_type: ScheduleType;
  interval_minutes: number | null;
  cron_expr: string | null;
  timeout_seconds: number;
  retries: number;
  enabled: number;

  // 双模式
  mode: Mode;
  browser_wait_until: WaitUntil;
  browser_wait_selector: string;
  browser_assert: string;
  browser_dwell_ms: number;
  browser_proxy: string;
  browser_ua: string;
  browser_screenshot: number;
  http_fallback_browser: number;

  created_at: number;
  updated_at: number;
  next_run_at: number | null;

  last_run_at: number | null;
  last_ok: number | null;
  last_status_code: number | null;
  last_duration_ms: number | null;
  last_error: string;
  last_mode: Mode | null;
  last_final_url: string;
  last_page_title: string;
  last_challenge: number;
  success_count: number;
  fail_count: number;

  // 列表显示排序（拖拽排序持久化，小值在前；旧数据 0 时按 id 兜底）
  sort_order: number;
}

export interface HistoryEntry {
  id: number;
  task_id: number;
  task_name: string;
  run_at: number;
  ok: number;
  status_code: number | null;
  duration_ms: number;
  error: string;
  snippet: string;
  mode: Mode;
  final_url: string;
  page_title: string;
  challenge: number;
  screenshot: string;
  degraded: number;
  note: string;
}

export interface ExecResult {
  ok: boolean;
  status_code: number | null;
  duration_ms: number;
  error: string;
  snippet: string;
  mode: Mode;
  final_url: string;
  page_title: string;
  challenge: boolean;
  screenshot: string;
  degraded: boolean;
  note: string;
}

export interface StoreData {
  version: number;
  seqTask: number;
  seqHistory: number;
  tasks: Task[];
  history: HistoryEntry[];
}

export interface StoreStats {
  tasks: number;
  enabled: number;
  runs24: number;
  rate24: number | null;
}
