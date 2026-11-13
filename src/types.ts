// types.ts —— 全项目共享的数据结构

export type Mode = "http" | "browser" | "ssh";
export type SshAuth = "password" | "key";
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
  // 随机加时（分钟）：每次触发前在 0~N 内取随机数累加到固定触发时间，0 = 关闭
  jitter_minutes: number;
  timeout_seconds: number;
  retries: number;
  enabled: number;

  // 双模式
  mode: Mode;
  // SSH 任务专属字段（mode 为 "ssh" 时生效）
  ssh_host: string;
  ssh_port: number;
  ssh_user: string;
  ssh_command: string;
  ssh_auth: SshAuth;
  ssh_password: string;
  ssh_key_name: string;
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

export interface GistConfig {
  token: string;
  gist_id: string;
  // 自动同步：三方对比（本地 / Gist / 基线）决定推、拉还是跳过
  auto: number;            // 1 = 启用
  interval_min: number;    // 检查间隔（分钟，兜底轮询）
  baseline_hash: string;   // 上次与 Gist 一致时的配置指纹（"" = 从未同步）
  synced_at: number | null; // 上次同步动作发生时间（含手动）
  last_result: string;     // 人读的同步结果（推送/拉取/冲突跳过/错误）
}

export interface StoreData {
  version: number;
  seqTask: number;
  seqHistory: number;
  seqKey: number;
  tasks: Task[];
  history: HistoryEntry[];
  sshKeys: SshKey[];
  // Gist 同步配置（token / gist_id），随 store.json 持久化
  gist: GistConfig;
}

export interface StoreStats {
  tasks: number;
  enabled: number;
  runs24: number;
  rate24: number | null;
}

// SSH 私钥（随 Gist 在多部署间同步；导出备份不含）；任务按名称引用（ssh_key_name）
export interface SshKey {
  id: number;
  name: string;
  private_key: string;
  passphrase: string;
  created_at: number;
}
